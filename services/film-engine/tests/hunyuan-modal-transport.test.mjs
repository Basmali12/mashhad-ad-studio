import test from 'node:test';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createHunyuanModalTransport} from '../engine/hunyuan-modal-transport.mjs';
const manifest=JSON.parse(await readFile(new URL('../engine/hunyuan/model-manifest.json',import.meta.url),'utf8'));
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900000000','hex');
const mp4=Buffer.concat([Buffer.from('000000186674797069736f6d','hex'),Buffer.alloc(64)]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{allowPaid=true,runnerFailure=false,licenseAccepted=true}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'hunyuan-transport-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 const engineId=randomUUID(),accountId=randomUUID(),runId=randomUUID(),definition={id:engineId,accountId,modelId:'hunyuanvideo15',version:'1.5',gpu:'RTX-PRO-6000',cpu:4,ramGiB:128,minVramGiB:48,volume:'model-volume',weightPath:'models/hunyuanvideo15/'+engineId,revision:1};
 store.put('engine-definition',definition);store.put('account',{id:accountId,mode:'token',workspace:'fixture-workspace',credentials:store.seal({tokenId:'ak-synthetic_private_token',tokenSecret:'as-synthetic_private_secret'},accountId)});
 store.put('engine-runtime',{id:engineId,engineId,accountId,runId,state:'starting',cloudStopped:false});store.put('engine-runtime-history',{id:runId,engineId,accountId,runId,cloudStopped:false});store.put('engine-command',{id:hash('engine-start:'+runId),runtimeId:runId});
 const scope={customerId:'customer',projectId:'project',attemptId:'attempt'};
 store.put('production-project',{id:'project',customerId:'customer'});store.put('production-attempt',{id:'attempt',customerId:'customer',projectId:'project',status:'running',chargeId:'charge',quoteId:'quote'});
 store.put('production-quote',{id:'quote',customerId:'customer',projectId:'project',approved:true});store.put('production-charge',{id:'charge',customerId:'customer',projectId:'project',attemptId:'attempt',state:'submitted'});store.put('production-model-run',{id:'attempt',customerId:'customer',projectId:'project',engineId,accountId,runId});
 const calls=[],hooks={};let fail=runnerFailure;
 const runner=async(action,input,onEvent=()=>{})=>{
  calls.push({action,input});
  if(action==='inspect')return {files:[],ready:false,deploymentReady:false,prepareWorkerReady:false};
  if(action==='prepare'){await hooks.beforePrepareEvent?.();await onEvent({kind:'function_call',functionCallId:'fc-prepare'});if(fail)throw Error('private failure must not leak as-synthetic_private_secret');return {status:'submitted',functionCallId:'fc-prepare',cloudStopped:false};}
  if(action==='observe_preparation')return {status:'completed',cloudStopped:true,progress:{completedBytes:123,totalBytes:123}};
  if(action==='cancel_preparation')return {status:'cancelled',cloudStopped:true};
  if(action==='start'){await onEvent({kind:'function_call',functionCallId:'fc-start',appId:'ap-scoped'});if(fail)throw Error('private failure');return {functionCallId:'fc-start',appId:'ap-scoped',ready:false,cloudStopped:false};}
  if(action==='observe')return hooks.observeResult??{ready:true,cloudStopped:false,activeTasks:1};
  if(action==='cancel_call')return {ready:false,cloudStopped:true,activeTasks:0,admissionClosed:true};
  if(action==='stop')return {ready:false,cloudStopped:!input.pendingUnknown,activeTasks:0,admissionClosed:true,stopMode:'official_cli_graceful_container_stop'};
  if(action==='generate'){await hooks.beforeGenerateEvent?.();await onEvent({kind:'function_call',functionCallId:'fc-generate'});for(const completed of [1,50])await onEvent({kind:'progress',progress:{completed,total:50,unit:'steps'}});if(fail)throw Error('private failure');}
  if(action==='generate'||action==='observe_result')return {videoBase64:mp4.toString('base64'),mime:'video/mp4',width:720,height:1280,sha256:digest(mp4),modelRevision:manifest.revision,scope:{engineId,accountId,runId:input.runId,requestId:input.requestId}};
  throw Error('Unexpected mocked action');
 };
 const transport=createHunyuanModalTransport({store,runner,allowPaid,licenseAccepted});
 const start=()=>transport.start({definition,runId,requestId:runId,approved:true});
 const ref={assetId:'reference',mime:'image/png',base64:png.toString('base64'),sha256:digest(png)};store.put('production-asset',{id:'reference',kind:'image',status:'completed',customerId:'customer',projectId:'project',sha256:ref.sha256});
 const generate=(request={prompt:'صورة لشخصية عراقية',width:720,height:1264,seed:42,mode:'image_to_video',reference_images:[ref],num_frames:121,fps:24},extra={})=>transport.generate({definition,runId,scope,requestId:scope.attemptId,approved:true,request,...extra});
 return {store,transport,definition,runId,scope,calls,hooks,start,generate,ref,setFailure:value=>fail=value};
}

test('Hunyuan metadata quote is scoped and cannot run paid work when disabled',async t=>{
 const f=await fixture(t,{allowPaid:false}),q=await f.transport.prepareQuote({definition:f.definition});assert.equal(q.expectedBytes,manifest.totalBytes);assert.ok(f.calls.every(c=>c.action==='inspect'));assert.match(f.calls[0].input.appName,/^mashhad-hunyuan-/);await assert.rejects(f.start(),/HUNYUAN_PAID_DISABLED/);
});
test('Hunyuan accepts text only or exactly one owned reference without changing another model route',async t=>{
 const f=await fixture(t);await f.start();const base={prompt:'x',width:720,height:1280,seed:42,num_frames:121,fps:24,mode:'text_to_video'};await assert.rejects(f.generate({...base,fps:16}),/HUNYUAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,num_frames:125}),/HUNYUAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,width:480,height:832}),/HUNYUAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,reference_images:[f.ref]}),/HUNYUAN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,mode:'image_to_video'}),/HUNYUAN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,mode:'image_to_video',reference_images:[f.ref,f.ref]}),/HUNYUAN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,mode:'image_to_video',reference_images:[{...f.ref,assetId:'foreign'}]}),/HUNYUAN_REFERENCE_NOT_OWNED/);await assert.rejects(f.transport.inspect({definition:{...f.definition,modelId:'wan22-i2v-a14b'}}),/HUNYUAN_DEFINITION_CHANGED/);const result=await f.generate(base);assert.equal(result.mime,'video/mp4');assert.equal(f.calls.find(c=>c.action==='generate').input.referenceImagesBase64.length,0);
});
test('Hunyuan I2V steps and MP4 result recovery are durable without storing inline video',async t=>{
 const f=await fixture(t);await f.start();const progress=[],result=await f.generate(undefined,{onProgress:p=>progress.push(p)});assert.deepEqual(progress.map(p=>p.completed),[1,50]);assert.equal(result.videoBase64,mp4.toString('base64'));assert.equal(f.calls.find(c=>c.action==='generate').input.referenceImagesBase64.length,1);assert.equal(JSON.stringify(f.store.all('hunyuan-operation')).includes(mp4.toString('base64')),false);await f.generate();assert.equal(f.calls.filter(c=>c.action==='generate').length,1);assert.equal(f.calls.at(-1).action,'observe_result');await f.transport.stop({definition:f.definition,runId:f.runId,approved:true});await assert.rejects(f.generate(),/HUNYUAN_GENERATION_NOT_AUTHORIZED/);assert.equal(f.store.all('wan-operation').length,0);
});
test('Hunyuan license acknowledgement is separate from paid approval and free metadata remains available',async t=>{
 const f=await fixture(t,{licenseAccepted:false});await f.transport.inspect({definition:f.definition});const q=await f.transport.prepareQuote({definition:f.definition});assert.equal(q.dispatchAvailable,false);assert.deepEqual(q.blockers,['HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED']);await assert.rejects(f.start(),/HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED/);await assert.rejects(f.transport.prepare({definition:f.definition,quoteId:q.id,requestId:'prepare',approved:true}),/HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED/);await assert.rejects(f.generate(),/HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED/);assert.ok(f.calls.every(c=>c.action==='inspect'));
});
test('Hunyuan validates official mode-specific portrait buckets without altering the source reference',async t=>{
 const f=await fixture(t);await f.start();const base={prompt:'x',width:720,height:1280,seed:42,num_frames:121,fps:24,mode:'image_to_video',reference_images:[f.ref]};await assert.rejects(f.generate(base),/HUNYUAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,width:480,height:848}),/HUNYUAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,mode:'text_to_video',reference_images:[],height:1264}),/HUNYUAN_REQUEST_INVALID/);await f.generate({...base,height:1264});const sent=f.calls.find(c=>c.action==='generate');assert.equal(sent.input.request.height,1264);assert.equal(sent.input.referenceImagesBase64[0],f.ref.base64);
});
