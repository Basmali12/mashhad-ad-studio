import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

// Execute isolated CPU-only subprocesses so default configuration is tested
// without the explicit Conv choice made by legacy wallet/concurrency fixtures.
const cwd=path.resolve(import.meta.dirname,'..');
function run(code,profile){
 const env={...process.env};delete env.LTX_INFERENCE_PROFILE;
 if(profile!==undefined)env.LTX_INFERENCE_PROFILE=profile;
 return execFileSync(process.execPath,['--input-type=module','-e',code],{cwd,env,encoding:'utf8',stdio:['pipe','pipe','pipe']});
}
const setup=`
 import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';
 import {Store} from './engine/store.mjs';import {createEngineAPI} from './engine/api.mjs';import {quality,inferenceManifest} from './engine/config.mjs';
 const folder=await mkdtemp(path.join(tmpdir(),'film-dfr-only-fixture-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);store.installRentalSchema();
 const account={id:randomUUID(),mode:'local_profile',workspace:'isolated-fixture',volume:'isolated-fixture',activated:true,discovery:{ready:true}};store.put('account',account);
 let dispatches=0,providerCalls=0,checker=true,ready=true,profile=inferenceManifest.id,files=Object.entries(inferenceManifest.files).map(([name,f])=>({name,size:f.size,present:true})),qc='passed';
 const provider={call:async action=>{providerCalls++;if(action==='discover')return {ready:true,files:[]};if(action==='quality_discover')return {ready,profile,files};if(action==='generate'){dispatches++;return {videoVerified:true,sha256:'fixture',cloud_stopped:true};}if(action==='stop'||action==='inspect')return {cloud_stopped:true,running_containers:0,tasks:0};throw Error('REAL_PROVIDER_FORBIDDEN');},session(){dispatches++;throw Error('REAL_SESSION_FORBIDDEN');}};
 const api=await createEngineAPI({folder,key,store,provider,allowPaid:true,allowCustomerRentals:true,textQuality:{available:async()=>{if(!checker)throw Error('TEXT_QC_NOT_CONFIGURED');return {ready:true,gpu:false};},process:async(_job,result)=>({...result,generationSucceeded:true,textQuality:{status:qc}})}});
 const scope={tenantId:'tenant-fixture',rentalId:randomUUID(),engineSlotId:'slot-fixture',accountId:account.id};
 const quote=(extra={})=>api.invoke('quote',{action:'start',accountId:account.id,settings:{},...extra},scope);
 const finish=async()=>{await api.close();await rm(folder,{recursive:true,force:true});};
`;

test('DFR main is default; candidate aliases it; explicit Conv has its historical contract',()=>{
 const code=`import {quality,inferenceManifest,manifest} from './engine/config.mjs';console.log(JSON.stringify({quality,count:Object.keys(inferenceManifest.files).length,legacyCount:Object.keys(manifest.files).length}));`;
 const main=JSON.parse(run(code));assert.equal(main.quality.profile,'dfr-main');assert.equal(main.quality.pipeline,'DFRPipeline');assert.equal(main.quality.textQualityRequired,true);assert.equal(main.quality.convVAE,false);assert.equal(main.count,6);assert.equal(main.legacyCount,5);
 assert.deepEqual(JSON.parse(run(code,'dfr-candidate')),main);
 const conv=JSON.parse(run(code,'conv-stable'));assert.equal(conv.quality.contract,'ltx25-native-crop-720-v1');assert.equal(conv.quality.textQualityRequired,false);assert.equal(conv.count,5);
 assert.throws(()=>run(code,'not-a-profile'));
});
test('DFR default fails closed for missing checker, six components, wrong profile and corrupt weights',()=>{
 run(setup+`try{
  checker=false;await assert.rejects(quote(),/TEXT_QC_NOT_CONFIGURED/);checker=true;
  ready=false;await assert.rejects(quote(),/LTX_DFR_WEIGHTS_REQUIRED/);ready=true;
  const complete=files;files=files.slice(0,5);await assert.rejects(quote(),/LTX_DFR_WEIGHTS_REQUIRED/);assert.equal(store.get('account',account.id).discovery.ready,false);
  files=complete.map((f,i)=>i?f:{...f,size:f.size-1});await assert.rejects(quote(),/LTX_DFR_WEIGHTS_REQUIRED/);
  files=complete;profile='ltx25-conv-stable-v1';await assert.rejects(quote(),/LTX_DFR_WEIGHTS_REQUIRED/);profile=inferenceManifest.id;
  store.put('account',{...account,corruptFiles:[files[0].name]});await assert.rejects(quote(),/WEIGHTS_NOT_READY/);store.put('account',account);
  store.put('account',{...account,corruptFiles:['vae/ltx-2.5-video-vae-conv-bf16.safetensors']});await quote();assert.equal(store.get('account',account.id).discovery.ready,true);store.put('account',account);
  const q=await quote();assert.equal(q.quality.contract,'ltx25-dfr-diffvae-720-v1');assert.equal(q.quality.textQualityRequired,true);assert.equal(dispatches,0);
 }finally{await finish();}`);
});
test('DFR refuses unsupported L40S before any paid session, without silently selecting Conv',()=>{
 run(setup+`try{await assert.rejects(quote({settings:{gpu:'L40S'}}),/DFR_RTX_PRO_6000_10S_ONLY/);assert.equal(dispatches,0);assert.equal(quality.profile,'dfr-main');}finally{await finish();}`);
});
test('DFR startup does not run supplier or checker; missing configured checker fails without bootstrap',()=>{
 run(`import {TextQuality} from './engine/text-quality.mjs';`+setup+`try{
  assert.equal(providerCalls,0);assert.equal(dispatches,0);assert.equal(store.get('account',account.id).discovery.ready,true);
  const checker=new TextQuality(folder,{python:path.join(folder,'absent-python')});
  await assert.rejects(checker.available(),/TEXT_QC_NOT_CONFIGURED/);assert.equal(providerCalls,0);assert.equal(dispatches,0);
 }finally{await finish();}`);
});
test('customer DFR text warning preserves verified output and continues without falsely certifying text quality',()=>{
 run(setup+`try{
  qc='needs_review';const q=await quote({action:'generate',projectId:'p',sceneId:'s',prompt:'A chronological Arabic dialogue scene.',audioContract:{lines:[{speaker:'علي',text:'شلونك اليوم؟'}]}});
  const j=await api.invoke('execute',{quoteId:q.id,approvedCost:true},scope);
  for(let n=0;n<100&&store.get('job',j.id).status!=='completed';n++)await new Promise(r=>setTimeout(r,5));
  const saved=store.get('job',j.id);assert.equal(saved.status,'completed');assert.equal(saved.result.qualityWarning,'TEXT_QUALITY_NOT_CERTIFIED_CONTINUATION_ALLOWED');assert.equal(saved.result.videoVerified,true);assert.equal(saved.result.generationSucceeded,true);assert.equal(saved.result.textQuality.status,'needs_review');assert.equal(dispatches,1);
  await assert.rejects(quote({action:'generate',projectId:'p',sceneId:'s',retryOfJobId:j.id,prompt:'A chronological Arabic dialogue scene.',audioContract:{lines:[{speaker:'علي',text:'شلونك اليوم؟'}]}}),/RETRY_REQUIRES_VERIFIED_FAILURE_AND_STOP/);assert.equal(dispatches,1);
 }finally{await finish();}`);
});
test('DFR slot publication requires passed text acceptance, same contract, stopped GPU and human review',()=>{
 run(setup+`import {createFilmPlatform} from './engine/film-platform.mjs';
 const platform=createFilmPlatform({engine:api,origin:'https://fixture.test',secret:'fixture-only-secret-012345678901234567890',startWorker:false});
 const admin={id:'admin',email:'admin@fixture.test',isAdmin:true};
 try{const slot=await platform.dispatch(admin,'admin.slot.save',{accountId:account.id,name:'DFR fixture',hourPriceUSD:'3'});
  const job={id:randomUUID(),accountId:account.id,settings:{gpu:'RTX-PRO-6000'},quality,status:'completed',cloudStopped:true,result:{videoVerified:true,textQuality:{status:'needs_review'}}};store.put('job',job);
  const verify=()=>platform.dispatch(admin,'admin.slot.verify',{id:slot.id,jobId:job.id,reviewed:true});
  await assert.rejects(verify(),/REAL_GPU_TEST_REQUIRED/);job.result.textQuality.status='passed';job.cloudStopped=false;store.put('job',job);await assert.rejects(verify(),/REAL_GPU_TEST_REQUIRED/);
  job.cloudStopped=true;store.put('job',job);await verify();await platform.dispatch(admin,'admin.slot.publish',{id:slot.id});
  job.result.textQuality.status='needs_review';store.put('job',job);await assert.rejects(platform.dispatch(admin,'admin.slot.publish',{id:slot.id}),/REAL_GPU_TEST_REQUIRED/);assert.equal(dispatches,0);
 }finally{await platform.close();await finish();}`);
});
