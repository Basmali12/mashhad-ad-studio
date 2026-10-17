import type {IncomingMessage,ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import {localAuthenticatedStorage,localStorageContext,stagedAssets,type StagedAsset} from './bunny-local-store';
const grants=new Map<string,{id:string;subject:string;session:string;until:number}>();
const sessions=new Map<string,{subject:string;until:number}>();
const cookiePrefix='mashhad-bunny-preview-';
function sessionCookie(req:IncomingMessage,host:string){const cookieName=cookiePrefix+host.split(':').at(-1);return req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1);}
export function localMediaRequest(req:IncomingMessage,host:string){return req.headers.host===host&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')&&(!req.headers.origin||req.headers.origin===`http://${host}`)&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(String(req.headers['sec-fetch-site'])));}
function safeAsset(asset:StagedAsset){return {id:asset.id,size:asset.size,type:asset.type,name:asset.originalName??'ملف محفوظ',verified:true};}
// Local acceptance surface; credentials stay on the server, access expires in 15 minutes.
export async function bunnyPreviewRequest(req:IncomingMessage,res:ServerResponse,host:string,saas=false){
 const cookieName=cookiePrefix+host.split(':').at(-1);const url=new URL(req.url??'/',`http://${host}`);if(!['/api/bunny-media','/api/bunny-preview','/api/bunny-session','/storage-check'].includes(url.pathname))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 if(!localMediaRequest(req,host)){res.statusCode=403;res.end('غير مصرح.');return true;}
 if(url.pathname==='/api/bunny-session'){if(req.method!=='POST'||req.headers.origin!==`http://${host}`){res.statusCode=403;res.end();return true;}const cookie=sessionCookie(req,host);if(cookie)sessions.delete(cookie);res.setHeader('Set-Cookie',cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.end('{}');return true;}
 if(saas&&url.pathname==='/storage-check'){res.statusCode=410;res.end('معاينة المالك متاحة خارج بيئة الزبائن فقط.');return true;}
 try{const {storage}=await localStorageContext();
  if(url.pathname==='/storage-check'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'nonce-bunny-local-check'; style-src 'nonce-bunny-local-check'; connect-src 'self'; media-src 'self'; img-src 'self'");
   res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فحص تخزين Bunny الخاص</title><style nonce="bunny-local-check">body{background:#10121b;color:#eee;font:16px system-ui;margin:24px}main{max-width:900px;margin:auto}section{display:flex;flex-wrap:wrap;gap:14px}article{width:260px;border:1px solid #56506d;border-radius:12px;padding:12px}video,img{width:100%;max-height:300px;object-fit:contain}small{word-break:break-all}</style><main><h1>فحص التخزين الخاص</h1><p>نسخ Bunny مطابقة للأصول. المعاينة محلية فقط؛ أصول Convex محفوظة.</p><p id="status">جارٍ فتح الملفات…</p><section id="files"></section></main><script nonce="bunny-local-check">fetch('/api/bunny-media',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(rows=>{document.getElementById('status').textContent=rows.length+' ملفًا محفوظًا';for(const row of rows){const card=document.createElement('article'),media=document.createElement(row.type==='video/mp4'?'video':'img');media.src=row.url;if(row.type==='video/mp4'){media.controls=true;media.preload='metadata'}else media.alt='صورة محفوظة';const caption=document.createElement('small');caption.textContent=row.name+' · '+row.size+' بايت';card.append(media,caption);document.getElementById('files').append(card)}}).catch(()=>{document.getElementById('status').textContent='تعذر فتح التخزين؛ الأصول محفوظة.'})</script></html>`);return true;
  }
  if(url.pathname==='/api/bunny-media'){
   if(req.method!=='POST'||req.headers.origin!==`http://${host}`||req.headers['content-type']!=='application/json'){res.statusCode=403;res.end('غير مصرح.');return true;}
   let subject:string;try{subject=(await localAuthenticatedStorage(req.headers.authorization,saas)).subject;}catch{res.statusCode=401;res.end('{}');return true;}
   const now=Date.now();for(const [token,grant] of grants)if(grant.until<=now)grants.delete(token);for(const [id,session] of sessions)if(session.until<=now)sessions.delete(id);
   const current=sessionCookie(req,host);let session=current&&sessions.get(current)?.subject===subject?current:undefined;
   if(!session){if(current)sessions.delete(current);session=randomUUID();sessions.set(session,{subject,until:now+900000});res.setHeader('Set-Cookie',cookieName+'='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=900');}
   const rows=(await stagedAssets()).filter(a=>a.subject===subject);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rows.map(a=>{const token=randomUUID();grants.set(token,{id:a.id,subject,session:session!,until:now+900000});return {...safeAsset(a),url:'/api/bunny-preview?token='+token};})));return true;
  }
  if(!['GET','HEAD'].includes(req.method??'')){res.statusCode=405;res.end();return true;}
  const grant=grants.get(url.searchParams.get('token')??''),cookie=sessionCookie(req,host);if(!grant||grant.until<=Date.now()||cookie!==grant.session||sessions.get(cookie)?.subject!==grant.subject){res.statusCode=403;res.end('انتهى وصول المعاينة.');return true;}
  const asset=(await stagedAssets()).find(a=>a.subject===grant.subject&&a.id===grant.id);if(!asset){res.statusCode=404;res.end();return true;}
  res.setHeader('Content-Type',asset.type);res.setHeader('Accept-Ranges','bytes');const range=req.headers.range;let start=0,end=asset.size-1;
  if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match){res.statusCode=416;res.setHeader('Content-Range',`bytes */${asset.size}`);res.end();return true;}start=Number(match[1]);end=match[2]?Number(match[2]):end;if(start<0||start>=asset.size||end<start||end>=asset.size){res.statusCode=416;res.setHeader('Content-Range',`bytes */${asset.size}`);res.end();return true;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${asset.size}`);}
  res.setHeader('Content-Length',end-start+1);if(req.method==='HEAD'){res.end();return true;}
  const body=range?await storage.readRange(grant.subject,asset,start,end):await storage.read(grant.subject,asset);await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream),res);return true;
 }catch{if(!res.headersSent){res.statusCode=503;res.end('تعذر فتح النسخة؛ الأصل محفوظ.');}else res.destroy();return true;}
}
