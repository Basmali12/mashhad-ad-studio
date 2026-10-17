/* global fetch, AbortSignal, URL, URLSearchParams, Buffer, setInterval, clearInterval, process */
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createProfileManager,stopProfile} from './profiles.mjs';
export function createAccountServer({identity,verify,manager,workerToken,observe,origin='https://scan.iraqaistudio.com',ttl=8*3600000,accessDisabled=()=>process.env.CUSTOMER_ACCESS_DISABLED==='true'}){
 const base='/flow-account/',cookieName='__Secure-mashhad-flow-account',sessions=new Map(),sockets=new Map(),attempts=new Map();
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN'};
 const reply=(res,status,value)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 const session=req=>{const key=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1),s=sessions.get(key);return s&&s.expires>Date.now()?{...s,cookie:key}:null;};
 const revoke=key=>{sessions.delete(key);for(const s of sockets.get(key)??[])s.destroy();sockets.delete(key);};
 const body=async req=>{let text='';for await(const c of req){text+=c;if(text.length>16384)throw Error('Request too large');}return text;};
 const isWorker=req=>{const a=Buffer.from(req.headers.authorization??''),b=Buffer.from('Bearer '+workerToken);return !!workerToken&&a.length===b.length&&timingSafeEqual(a,b);};
 const timer=setInterval(()=>{for(const [key,s] of sessions)if(s.expires<=Date.now())revoke(key);for(const [ip,a] of attempts)if(a.until<Date.now())attempts.delete(ip);void manager.idle().catch(()=>undefined);},10000);timer.unref();
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  if(accessDisabled()&&url.pathname.startsWith(base)){
   if(req.method==='GET'){res.writeHead(302,{...headers,Location:'https://iraqaistudio.com/'});return res.end();}
   return reply(res,403,{error:'الدخول متوقف. تواصل للاشتراك وتفعيل اشتراكك.'});
  }
  if(url.pathname==='/internal/session'){
   if(req.method!=='POST'||!isWorker(req))return reply(res,401,{error:'Unauthorized'});
   const a=JSON.parse(await body(req));
   if(a.op==='open'||a.op==='balance'){const profile=await manager.workerProfile(a.subject);if(a.op==='balance'&&[...sessions.values()].some(s=>s.profile.key===profile.key&&s.linkActiveAt>Date.now()-15000))return reply(res,429,{error:'أكمل ربط حسابك أولًا؛ يتحدث الرصيد بعد انتهاء الربط.'});const lease=await manager.acquire(profile,{balanceOnly:a.op==='balance'});for(const [cookie,s] of sessions)if(s.profile.key===profile.key){for(const socket of sockets.get(cookie)??[])socket.destroy();}return reply(res,200,{endpoint:'http://127.0.0.1:9433',lease});}
   if(a.op==='pulse'){await manager.pulse(a.lease);return reply(res,200,{ok:true});}
   if(a.op==='release'){await manager.release(a.lease);return reply(res,200,{ok:true});}
   return reply(res,400,{error:'Unknown operation'});
  }
  if(!url.pathname.startsWith(base))return reply(res,404,{error:'Not found'});
  if(req.method==='POST'&&req.headers.origin!==origin)return reply(res,403,{error:'Forbidden origin'});
  if(req.method==='GET'&&url.pathname===base){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});return res.end(await readFile(new URL('./index.html',import.meta.url)));}
  if(req.method==='GET'&&url.pathname===base+'identity')return reply(res,200,{publishableKey:identity.publishableKey});
  if(req.method==='POST'&&url.pathname===base+'login'){
   const ip=req.socket.remoteAddress,a=attempts.get(ip);if(a&&a.count>=10&&a.until>Date.now())return reply(res,429,{error:'انتظر قليلًا قبل إعادة الدخول.'});
   attempts.set(ip,{count:(a?.until>Date.now()?a.count:0)+1,until:Date.now()+60000});
   const token=new URLSearchParams(await body(req)).get('token'),profile=token?await verify(token):null;if(!profile)return reply(res,401,{error:'سجّل بحساب مشهد المفعّل.'});
   if(profile.pending)return reply(res,403,{error:'حساب مشهد جديد وينتظر التفعيل. أرسل رمز الحساب إلى مالك مشهد ثم أعد فتح الصفحة: '+profile.publicId});
   if(profile.owner)return reply(res,200,{owner:true});
   await manager.open(profile);
   const key=randomBytes(32).toString('hex');sessions.set(key,{profile,expires:Date.now()+ttl,linkActiveAt:Date.now()});
   res.setHeader('Set-Cookie',`${cookieName}=${key}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(ttl/1000)}`);return reply(res,200,{ok:true});
  }
  const s=session(req);if(!s)return reply(res,401,{error:'Unauthorized'});
  if(req.method==='POST'&&url.pathname===base+'account-email'){
   const input=JSON.parse(await body(req));const result=await manager.chooseEmail(s.profile,input.email);await observe(s.profile,false);return reply(res,200,result);
  }
  if(req.method==='GET'&&url.pathname===base+'google-state'){const current=sessions.get(s.cookie);current.linkActiveAt=Date.now();const state=await manager.google(s.profile,'state');if(state.stage==='ready'){await observe(s.profile,true);current.linkActiveAt=0;}return reply(res,200,state);}
  if(req.method==='POST'&&url.pathname===base+'google-open')return reply(res,200,await manager.google(s.profile,'open'));
  if(req.method==='POST'&&url.pathname===base+'google-input'){
   manager.assertViewer(s.profile);
   const record=sessions.get(s.cookie),now=Date.now();
   if(record.inputUntil>now&&record.inputCount>=6)return reply(res,429,{error:'انتظر دقيقة قبل إعادة إرسال بيانات Google.'});
   record.inputCount=record.inputUntil>now?record.inputCount+1:1;record.inputUntil=now+60000;
   const input=JSON.parse(await body(req));
   // Identity comes exclusively from the authenticated HttpOnly session, not the form.
   // Do not log input, include it in errors, or persist it in any database/session.
   try{return reply(res,200,await manager.google(s.profile,'input',{stage:input.stage,value:input.value}));}
   finally{input.value=undefined;}
  }
  if(req.method==='POST'&&url.pathname===base+'logout'){revoke(s.cookie);await manager.lock(s.profile);res.setHeader('Set-Cookie',`${cookieName}=; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);return reply(res,200,{ok:true});}
  if(req.method==='POST'&&url.pathname===base+'confirm'){
   manager.assertViewer(s.profile);const result=await manager.check(s.profile),ready=result===true||result?.ready===true;await observe(s.profile,ready);if(ready)sessions.get(s.cookie).linkActiveAt=0;return reply(res,200,{ready,email:ready?result.email:undefined,message:result?.message??(ready?'تم ربط حساب Flow الخاص. ارجع إلى مشهد.':'سجّل Google، ثم افتح مشروع Flow جديدًا داخل الشاشة واضغط تأكيد الربط.')});
  }
  if(req.method!=='GET')return reply(res,405,{error:'Method not allowed'});
  manager.assertViewer(s.profile);const path='/'+url.pathname.slice(base.length)+url.search;
  const proxy=http.request({host:'127.0.0.1',port:6082,path,method:'GET'},up=>{res.writeHead(up.statusCode,{...up.headers,...headers});up.pipe(res);});proxy.on('error',()=>{if(!res.headersSent)reply(res,502,{error:'الشاشة غير متصلة؛ افتح الرابط مجددًا.'});else res.destroy();});proxy.end();
 }catch(e){if(!res.headersSent)reply(res,e.code==='BUSY'?429:503,{error:e.publicMessage??'تعذر فتح حسابك الخاص؛ حاول لاحقًا.'});else res.destroy();}});
 server.on('upgrade',(req,socket,head)=>{
  if(accessDisabled()){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  const s=session(req);try{if(!s||req.url!==base+'websockify'||req.headers.origin!==origin)throw Error('Unauthorized');manager.assertViewer(s.profile);}catch{socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  const group=sockets.get(s.cookie)??new Set();group.add(socket);sockets.set(s.cookie,group);socket.on('close',()=>group.delete(socket));
  const h={...req.headers,host:'127.0.0.1:6082'};delete h.cookie;delete h.authorization;
  const proxy=http.request({host:'127.0.0.1',port:6082,path:'/websockify',headers:h});proxy.on('upgrade',(r,up,upHead)=>{socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(upHead.length)socket.write(upHead);if(head.length)up.write(head);socket.pipe(up).pipe(socket);socket.on('close',()=>up.destroy());up.on('error',()=>socket.destroy());});proxy.on('error',()=>socket.destroy());proxy.on('response',()=>socket.destroy());proxy.end();
 });server.on('close',()=>{clearInterval(timer);for(const key of sessions.keys())revoke(key);});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const identity=JSON.parse(await readFile('/var/lib/mashhad-flow-trial/identity.json','utf8')),connection=JSON.parse(await readFile('/var/lib/mashhad/connection.secret','utf8'));
 const rpc=async(op,args)=>{const r=await fetch(connection.site+'/runner',{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify({op,args}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Runner refused');return r.json();};
 await stopProfile(); // A restart invalidates old worker leases; never reuse their desktop for another account.
 const manager=createProfileManager({workerProfile:subject=>rpc('flowAccount',{subject}),readyAt:Date.now()+65000});
 const authenticate=async token=>{
  const mutate=async(path,args)=>{const r=await fetch(identity.convexUrl+'/api/mutation',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({path,args,format:'json'}),signal:AbortSignal.timeout(15000)}),j=await r.json();return r.ok&&j.status==='success'?j.value:null;};
  const profile=await mutate('flowAccounts:begin',{});if(profile)return profile;
  // Register only a disabled account bound to the verified token. This grants no
  // browser access, credits, generation privileges, or owner permissions.
  const id=await mutate('wallets:register',{name:'حساب Flow جديد'});
  return id?{pending:true,publicId:'MS-'+id}:null;
 };
 createAccountServer({identity,workerToken:connection.token,manager,observe:(p,ready)=>rpc('flowObserved',{subject:p.subject,key:p.key,ready}),verify:authenticate}).listen(43137,'127.0.0.1');
}
