import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {id} from './store.mjs';
import {mediaSignature,validMediaSignature} from './film-bridge-security.mjs';

// Uses existing deployed runtime and approved test jobs, never starts work itself.
export function createAdminCommissioning({store,engine,origin,secret,now=Date.now,mediaOrigins=[]}){
 const safe=/^[a-f0-9-]{36}$/;
 async function bound(slotId,jobId){
  const slot=await store.get('film-slot',slotId),job=await store.get('job',jobId),proof=job?.quoteId?await store.get('film-admin-test',job.quoteId):null;
  if(!slot||slot.retired||!job||job.tenantId||job.action!=='generate'||job.accountId!==slot.accountId||job.settings?.gpu!==slot.gpu||proof?.slotId!==slot.id||proof.revision!==slot.revision||job.quality?.contract!==engine.quality.contract)throw Error('REAL_GPU_TEST_REQUIRED');
  return {slot,job};
 }
 const acceptable=job=>job.status==='completed'&&job.cloudStopped===true&&job.result?.videoVerified===true&&(!engine.quality.textQualityRequired||job.result.textQuality?.status==='passed');
 async function file(job){
  if(!safe.test(job.id)||!job.result?.videoVerified||job.cloudStopped!==true)throw Error('MP4_NOT_VERIFIED');
  const target=path.resolve(store.folder,'artifacts',job.id,'video.mp4'),stat=await fs.promises.lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('MP4_NOT_VERIFIED');
  const digest=createHash('sha256');for await(const chunk of fs.createReadStream(target))digest.update(chunk);
  if(digest.digest('hex')!==job.result.sha256)throw Error('MP4_NOT_VERIFIED');
  return {target,bytes:stat.size};
 }
 async function dispatch(actor,operation,input,adminId){
  if(actor.isAdmin!==true)throw Error('FORBIDDEN');
  if(operation==='admin.test.status'){
   const slot=await store.get('film-slot',input.id);if(!slot||slot.retired)throw Error('NOT_FOUND');
   const rows=(await store.all('film-admin-test')).filter(p=>p.slotId===slot.id&&p.revision===slot.revision),proofs=new Set(rows.map(p=>p.id));
   const job=(await store.all('job')).filter(j=>!j.tenantId&&j.accountId===slot.accountId&&proofs.has(j.quoteId)).sort((a,b)=>b.createdAt-a.createdAt)[0];
   const attempt=rows.filter(p=>p.submittedAt).sort((a,b)=>b.submittedAt-a.submittedAt)[0];
   if(attempt&&(!job||attempt.submittedAt>job.createdAt&&attempt.id!==job.quoteId))return {status:attempt.rejected?'failed':'uncertain',cloudStopped:attempt.rejected===true,ready:false,published:slot.published,locked:slot.locked};
   if(!job)return {status:'not_started',ready:false,published:slot.published,locked:slot.locked};
   await bound(slot.id,job.id);
   return {id:job.id,status:job.status,cloudStopped:job.cloudStopped===true,ready:acceptable(job),videoVerified:job.result?.videoVerified===true,published:slot.published,locked:slot.locked,
    elapsedSeconds:job.elapsedSeconds??null,estimatedUSD:job.estimatedUSD??null,recordedCost:job.result?.recordedCost??null,
    events:(job.events||[]).slice(-30).map(e=>({kind:e.kind,phase:e.phase,completed:e.completed,total:e.total})),error:/^[A-Z_]{3,100}$/.test(job.error||'')?job.error:null};
  }
  if(operation==='admin.test.ticket'){
   const {slot,job}=await bound(input.id,input.jobId);await file(job);
   const ticket=id(),expires=now()+180000;
   await store.put('film-admin-media-ticket',{id:ticket,slotId:slot.id,jobId:job.id,sha256:job.result.sha256,expires,adminId,download:input.download===true});
   return {url:origin+'/api/film-media/'+ticket+'?expires='+expires+'&signature='+mediaSignature(secret,ticket,expires),expires};
  }
  if(operation==='admin.test.publish'){
   if(input.reviewed!==true)throw Error('APPROVAL_REQUIRED');
   const checked=await bound(input.id,input.jobId);if(!acceptable(checked.job))throw Error('REAL_GPU_TEST_REQUIRED');await file(checked.job);
   return store.transaction(async()=>{
    const {slot,job}=await bound(input.id,input.jobId),account=await store.get('account',slot.accountId);
    if(!acceptable(job)||!account?.activated||!account.discovery?.ready)throw Error('REAL_GPU_TEST_REQUIRED');
    if((await store.all('rental')).some(r=>r.accountId===slot.accountId&&r.state!=='closed')||(await store.all('job')).some(j=>(j.accountId===slot.accountId||j.sourceId===slot.accountId)&&j.cloudStopped!==true&&['start','generate','prepare'].includes(j.action)))throw Error('ACCOUNT_IN_USE');
    Object.assign(slot,{testJobId:job.id,visualAudioReviewedAt:now(),reviewedQualityContract:engine.quality.contract,published:true,testingOnly:false,locked:false});
    await store.put('film-slot',slot);await store.audit('film_slot_tested_published',slot.id);return {published:true,locked:false,verified:true};
   });
  }
  throw Error('INVALID_INPUT');
 }
 async function handle(req,res,url,secure){
  if(!url.pathname.startsWith('/api/film-media/'))return false;
  const key=url.pathname.slice('/api/film-media/'.length),ticket=await store?.get('film-admin-media-ticket',key);
  if(!ticket)return false; // Existing customer media handler retains its own ownership checks.
  const reject=status=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();return true;};
  if(!secure||!['GET','HEAD'].includes(req.method)||ticket.expires!==Number(url.searchParams.get('expires'))||!validMediaSignature(secret,key,url.searchParams.get('expires'),url.searchParams.get('signature'),now()))return reject(403);
  if(req.headers.origin&&!mediaOrigins.includes(req.headers.origin))return reject(403);
  try{
   const {job}=await bound(ticket.slotId,ticket.jobId);if(job.result?.sha256!==ticket.sha256)throw Error('CHANGED');const media=await file(job);
   let start=0,end=media.bytes-1,status=200;
   if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||!m[1]&&!m[2])return reject(416);start=m[1]?Number(m[1]):Math.max(0,media.bytes-Number(m[2]));end=m[1]&&m[2]?Math.min(Number(m[2]),end):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=media.bytes)return reject(416);status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${media.bytes}`);}
   res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',end-start+1);res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Origin');
   if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
   if(ticket.download)res.setHeader('Content-Disposition','attachment; filename="engine-test.mp4"');res.writeHead(status);
   if(req.method==='HEAD'){res.end();return true;}const stream=fs.createReadStream(media.target,{start,end});res.once?.('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return true;
  }catch{return reject(404);}
 }
 return {dispatch,handle};
}
