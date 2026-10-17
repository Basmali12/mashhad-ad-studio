/* global fetch, AbortSignal, URL, URLSearchParams, Buffer, process, setInterval, clearInterval */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function createTrialServer({authFile, identityFile, origin, upstreamPort=6081, ttl=8*60*60*1000}) {
 const sessions=new Map(), failures=new Map(), sockets=new Map();
 const base='/flow-trial/', cookieName='__Secure-mashhad-trial';
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN'};
 const reply=(res,status,text,type='text/plain; charset=utf-8',extra={})=>{res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(text);};
 const session=req=>{const value=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);const until=sessions.get(value);return until&&until>Date.now()?value:undefined;};
 const revoke=key=>{sessions.delete(key);for(const socket of sockets.get(key)??[])socket.destroy();sockets.delete(key);};
 const timer=setInterval(()=>{for(const [key,until] of sessions)if(until<=Date.now())revoke(key);for(const [key,v] of failures)if(v.until<=Date.now())failures.delete(key);},10000);timer.unref();
 const server=http.createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,origin);
   if(!url.pathname.startsWith(base))return reply(res,404,'Not found');
   if(req.method==='POST'&&req.headers.origin!==origin)return reply(res,403,'Forbidden origin');
   if(req.method==='GET'&&url.pathname===base)return reply(res,200,await readFile(new URL('./index.html',import.meta.url)),'text/html; charset=utf-8');
   if(req.method==='GET'&&url.pathname===base+'identity'){
    if(!identityFile)return reply(res,503,'Identity not configured');
    const identity=JSON.parse(await readFile(identityFile,'utf8'));
    return reply(res,200,JSON.stringify({publishableKey:identity.publishableKey}),'application/json');
   }
   if(req.method==='POST'&&url.pathname===base+'login'){
    const ip=req.headers['x-forwarded-for']??req.socket.remoteAddress;
    const failed=failures.get(ip);if(failed?.until>Date.now()&&failed.count>=5)return reply(res,429,'محاولات كثيرة؛ انتظر 15 دقيقة.');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)return reply(res,413,'Request too large');}
    let accepted=false;
    if(identityFile){
     const identity=JSON.parse(await readFile(identityFile,'utf8')),token=new URLSearchParams(body).get('token');
     if(token){const verified=await fetch(identity.convexUrl+'/api/query',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({path:'access:allowed',args:{},format:'json'}),signal:AbortSignal.timeout(15000)});const result=await verified.json();accepted=verified.ok&&result.status==='success'&&result.value===true;}
    }else{
    let auth;try{auth=JSON.parse(await readFile(authFile,'utf8'));}catch{return reply(res,503,'التجربة مقفلة حتى إعداد كلمة دخول المالك.');}
    const password=new URLSearchParams(body).get('password')??'';
    const expected=Buffer.from(auth.hash,'hex'),actual=scryptSync(password,auth.salt,64);
    accepted=expected.length===actual.length&&timingSafeEqual(expected,actual);
    }
    if(!accepted){
     const current=failed?.until>Date.now()?failed:{count:0,until:Date.now()+900000};current.count++;failures.set(ip,current);return reply(res,401,'كلمة الدخول غير صحيحة.');
    }
    failures.delete(ip);const key=randomBytes(32).toString('hex');sessions.set(key,Date.now()+ttl);
    return reply(res,200,'تم الدخول','text/plain; charset=utf-8',{'Set-Cookie':`${cookieName}=${key}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(ttl/1000)}`});
   }
   const key=session(req);if(!key)return reply(res,401,'Unauthorized');
   if(req.method==='POST'&&url.pathname===base+'logout'){revoke(key);return reply(res,200,'تم قفل الشاشة. جلسة Google تبقى على السيرفر.',undefined,{'Set-Cookie':`${cookieName}=; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});}
   if(req.method!=='GET')return reply(res,405,'Method not allowed');
   const proxy=http.request({host:'127.0.0.1',port:upstreamPort,path:'/'+url.pathname.slice(base.length)+url.search,method:'GET'},up=>{res.writeHead(up.statusCode,{...up.headers,...headers});up.pipe(res);});
   proxy.on('error',()=>reply(res,502,'شاشة التجربة غير متصلة.'));proxy.end();
  }catch{if(!res.headersSent)reply(res,500,'تعذر تنفيذ الطلب.');else res.destroy();}
 });
 server.on('upgrade',(req,socket,head)=>{
  const key=session(req);if(req.url!==base+'websockify'||req.headers.origin!==origin||!key){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  const group=sockets.get(key)??new Set();group.add(socket);sockets.set(key,group);socket.on('close',()=>group.delete(socket));
  const proxyHeaders={...req.headers,host:`127.0.0.1:${upstreamPort}`};delete proxyHeaders.cookie;
  const proxy=http.request({host:'127.0.0.1',port:upstreamPort,path:'/websockify',headers:proxyHeaders});
  proxy.on('upgrade',(response,upstream,upHead)=>{
   socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
   if(upHead.length)socket.write(upHead);if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);socket.on('close',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
  });proxy.on('error',()=>socket.destroy());proxy.on('response',()=>socket.destroy());proxy.end();
 });
 server.on('close',()=>{clearInterval(timer);for(const key of sessions.keys())revoke(key);});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))createTrialServer({identityFile:'/var/lib/mashhad-flow-trial/identity.json',origin:'https://scan.iraqaistudio.com'}).listen(43136,'127.0.0.1');
