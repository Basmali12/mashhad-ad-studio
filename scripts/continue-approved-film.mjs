// One owner-approved continuation of an existing 30-second film. No successful scene is regenerated.
import fs from 'node:fs';
import {Buffer} from 'node:buffer';
import {setTimeout} from 'node:timers';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import http from 'node:http';
import https from 'node:https';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {pathToFileURL,URL} from 'node:url';
const PROJECT='1c78c5a7-b1e1-4eb6-a916-0a24207da633';
const RECEIPT='/root/mashhad-resume-'+PROJECT+'.json';
const readEnv=file=>Object.fromEntries(fs.readFileSync(file,'utf8').split('\n').filter(l=>l&&l[0]!=='#'&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim()];}));
if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
const env=readEnv('/etc/iraq-ai-film-platform-staging/film.env'),gateway=readEnv('/etc/mashhad-film/gateway.env');Object.assign(process.env,env);
const {openStore}=await import(pathToFileURL('/srv/iraq-ai-studio-staging/current/services/film-engine/engine/open-store.mjs'));
const store=await openStore(env.FILM_DATA_DIR,env.ENGINE_MASTER_KEY);
const digest=b=>createHash('sha256').update(b).digest('hex');
const actor={id:gateway.MASHHAD_FILM_LEGACY_OWNER_ID,email:gateway.MASHHAD_FILM_LEGACY_OWNER_EMAIL,name:'مالك المشروع',isAdmin:false};
const target=new URL(gateway.FILM_BACKEND_ORIGIN);if(target.protocol!=='https:'||target.username||target.password||target.pathname!=='/')throw Error('APPROVED_BACKEND_REQUIRED');
const caFile=gateway.NODE_EXTRA_CA_CERTS||env.NODE_EXTRA_CA_CERTS;const ca=caFile?fs.readFileSync(caFile):undefined;
let receipt=null,stopPromise=null;
function save(){fs.writeFileSync(RECEIPT,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});}
function emit(value){console.log(JSON.stringify({at:new Date().toISOString(),...value}));}
async function call(operation,input={},requestId=randomUUID()){
 const body=JSON.stringify({requestId,actor,operation,input}),time=String(Date.now()),nonce=randomUUID();
 const signature=createHmac('sha256',env.FILM_BRIDGE_SECRET).update(time+'\n'+nonce+'\n'+body).digest('hex');
 const transport=target.protocol==='https:'?https:http;
 return new Promise((resolve,reject)=>{const req=transport.request(new URL('/api/film-bridge',target),{method:'POST',ca,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'x-film-time':time,'x-film-nonce':nonce,'x-film-signature':signature}},res=>{const chunks=[];let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>2e6){req.destroy();reject(Error('BRIDGE_TOO_LARGE'));}else chunks.push(b);});res.on('end',()=>{try{const result=JSON.parse(Buffer.concat(chunks));if(res.statusCode!==200||result.error&&!result.id)throw Error(/^[A-Z_]{3,80}$/.test(result.error)?result.error:'BRIDGE_REJECTED');resolve(result);}catch(e){reject(e);}});});req.on('error',()=>reject(Error('BRIDGE_NETWORK_UNCERTAIN')));req.setTimeout(30000,()=>{req.destroy();reject(Error('BRIDGE_NETWORK_UNCERTAIN'));});req.end(body);});
}
async function stop(){
 if(stopPromise)return stopPromise;if(!receipt)return;stopPromise=(async()=>{
 if(!receipt.rentalId){const r=(await store.all('rental')).find(r=>r.id===digest(receipt.customerId+':'+receipt.rentalRequestId));if(r)receipt.rentalId=r.id;}
 if(!receipt.rentalId)return;
 let rental=await store.get('rental',receipt.rentalId);
 if(rental?.state!=='closed'&&!receipt.stopSubmitted){receipt.stopSubmitted=true;save();try{await call('rental.stop',{id:receipt.rentalId},receipt.stopRequestId);}catch{emit({stop:'REQUEST_UNCERTAIN_FOLLOW_ONLY'});}}
 for(let i=0;i<60;i++){try{await call('rental.status',{id:receipt.rentalId});}catch{ /* A read failure never authorizes another paid request. */ }rental=await store.get('rental',receipt.rentalId);if(rental?.state==='closed')break;await new Promise(r=>setTimeout(r,2000));}
 const warm=rental?.engineJobId?await store.get('job',rental.engineJobId):null;
 receipt.stopConfirmed=rental?.state==='closed'&&warm?.cloudStopped===true;receipt.rentalBilledMicroUSD=rental?.chargedMicroUSD||0;receipt.providerRecordedUSD=rental?.providerRecordedUSD??null;receipt.closedAt=rental?.closedAt||null;receipt.finishedAt=Date.now();save();
 emit({stopConfirmed:receipt.stopConfirmed,billedMicroUSD:receipt.rentalBilledMicroUSD,providerRecordedUSD:receipt.providerRecordedUSD,activeRentals:(await store.all('rental')).filter(r=>r.customerId===receipt.customerId&&r.state!=='closed').length});
 })();return stopPromise;
}
async function main(){
 const p=await store.get('film-project',PROJECT);if(!p||p.customerId!==digest('film-customer:'+actor.id)||!actor.id||!actor.email)throw Error('OWNER_PROJECT_MISMATCH');
 const prior=await store.get('rental',p.rentalId),priorWarm=prior?.engineJobId?await store.get('job',prior.engineJobId):null;
 const slot=prior?await store.get('film-slot',prior.engineSlotId):null;
 if(!slot||slot.gpu!=='RTX-PRO-6000'||slot.settings?.gpu!=='RTX-PRO-6000'||slot.hourMicros!==3000000||!slot.published||slot.locked||slot.retired)throw Error('APPROVED_RTX_SLOT_REQUIRED');
 const first=p.scenes?.[0],firstJob=first?.jobId?await store.get('job',first.jobId):null;
 const firstPath=firstJob?path.join(store.folder,'artifacts',firstJob.id,'video.mp4'):null,lastFrame=firstJob?path.join(store.folder,'artifacts',firstJob.id,'last-frame.png'):null;
 if(p.seconds!==30||p.scenes?.length!==3||first?.status!=='done'||firstJob?.status!=='completed'||!firstJob.result?.videoVerified||digest(fs.readFileSync(firstPath))!==firstJob.result.sha256||!fs.existsSync(lastFrame))throw Error('EXISTING_FIRST_SCENE_NOT_VERIFIED');
 if(p.scenes.slice(1).some(s=>s.attempted||s.jobId)||prior?.state!=='closed'||priorWarm?.cloudStopped!==true)throw Error('RESUME_NOT_SAFE');
 const account=await store.get('account',slot.accountId);if(!account?.discovery?.ready||account.activated===false)throw Error('SAVED_WEIGHTS_NOT_READY');
 if((await store.all('rental')).some(r=>r.state!=='closed'&&(r.accountId===slot.accountId||r.customerId===p.customerId)))throw Error('ACTIVE_RENTAL_EXISTS');
 const quote=await call('rental.quote',{serverId:slot.id});
 emit({preflight:true,projectId:PROJECT,requestedSeconds:30,preservedSeconds:10,remainingSeconds:20,gpu:slot.gpu,hourPriceUSD:quote.pricePerHourUSD,canStart:quote.canStart,priorStopped:true,firstFileVerified:true,lastFramePresent:true});
 if(process.argv[2]!=='--approve-remaining-scenes')return;
 if(!quote.canStart||quote.priceMicroUSD!==3000000)throw Error('RENTAL_PREFLIGHT_FAILED');
 const fd=fs.openSync(RECEIPT,'wx',0o600);fs.closeSync(fd);
 receipt={version:1,projectId:PROJECT,customerId:p.customerId,startedAt:Date.now(),state:'starting',preservedJobId:firstJob.id,preservedSHA256:firstJob.result.sha256,rentalRequestId:randomUUID(),resumeRequestId:randomUUID(),stopRequestId:randomUUID(),maxWallSeconds:900,maxRentalMicroUSD:750000};save();
 process.once('SIGTERM',()=>{void stop().finally(()=>process.exit(1));});process.once('SIGINT',()=>{void stop().finally(()=>process.exit(1));});
 receipt.startSubmitted=true;save();
 const r=await call('rental.start',{serverId:slot.id,revision:quote.revision,priceMicroUSD:quote.priceMicroUSD,approved:true,requestId:receipt.rentalRequestId},receipt.rentalRequestId);receipt.rentalId=r.id;save();
 let lastLog=0,resumed=false;
 for(;;){
  const rental=await call('rental.status',{id:r.id}),current=await store.get('film-project',PROJECT);
  if(Date.now()-receipt.startedAt>900000||rental.billedMicroUSD>=750000)throw Error('CONTINUATION_TIME_OR_COST_GUARD');
  if(!resumed&&rental.state==='ready'){
   receipt.resumeSubmitted=true;save();await call('project.resume',{projectId:PROJECT,rentalId:r.id,approved:true},receipt.resumeRequestId);resumed=true;receipt.state='generating';save();await new Promise(resolve=>setTimeout(resolve,3000));continue;
  }else if(!resumed&&['closed','uncertain','stopping'].includes(rental.state))throw Error('RENTAL_NOT_READY');
  if(resumed&&['needs_review','failed','uncertain'].includes(current.state))throw Error('CONTINUATION_FAILED_NO_RETRY');
  if(current.merge?.status==='completed'){
   if(current.scenes[0].jobId!==receipt.preservedJobId||digest(fs.readFileSync(firstPath))!==receipt.preservedSHA256)throw Error('FIRST_OUTPUT_CHANGED');
   if(current.scenes.some(s=>s.status!=='done')||!fs.existsSync(current.merge.path)||digest(fs.readFileSync(current.merge.path))!==current.merge.sha256)throw Error('FINAL_FILE_NOT_VERIFIED');
   receipt.state='completed';receipt.finalPath=current.merge.path;receipt.finalSHA256=current.merge.sha256;receipt.duration=current.merge.duration;save();emit({completed:true,duration:receipt.duration,finalPath:receipt.finalPath,preservedFirstJob:receipt.preservedJobId});break;
  }
  if(['failed','unavailable'].includes(current.merge?.status||''))throw Error('MERGE_FAILED_ORIGINAL_CLIPS_PRESERVED');
  if(Date.now()-lastLog>=15000){lastLog=Date.now();const scene=current.scenes.find(s=>s.status==='submitted'),job=scene?.jobId?await store.get('job',scene.jobId):null,event=job?.events?.at(-1);emit({state:receipt.state,rentalState:rental.state,elapsedSeconds:Math.floor((Date.now()-receipt.startedAt)/1000),billedMicroUSD:rental.billedMicroUSD,completedScenes:current.scenes.filter(s=>s.status==='done').length,phase:event?.phase||rental.phase||null,completed:event?.completed??null,total:event?.total??null});}
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
}
try{await main();}catch(e){const code=/^[A-Z_]{3,80}$/.test(e.message)?e.message:e.code==='EEXIST'?'EXISTING_CONTINUATION_RECEIPT_NO_SECOND_JOB':'LOCAL_CONTINUATION_FAILED';if(receipt){receipt.state='failed';receipt.error=code;save();}emit({error:code,noRetry:true});process.exitCode=1;}finally{if(receipt)await stop();await store.close();}
