import test from 'node:test';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createWanModalTransport} from '../engine/wan-modal-transport.mjs';
const manifest=JSON.parse(await readFile(new URL('../engine/wan/model-manifest.json',import.meta.url),'utf8'));
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900000000','hex');
const mp4=Buffer.concat([Buffer.from('000000186674797069736f6d','hex'),Buffer.alloc(64)]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{allowPaid=true,runnerFailure=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'wan-transport-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 const engineId=randomUUID(),accountId=randomUUID(),runId=randomUUID(),definition={id:engineId,accountId,modelId:'wan22-i2v-a14b',version:'2.2',gpu:'RTX-PRO-6000',cpu:4,ramGiB:128,minVramGiB:48,volume:'model-volume',weightPath:'models/wan22-i2v-a14b/'+engineId,revision:1};
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
  if(action==='generate'){await hooks.beforeGenerateEvent?.();await onEvent({kind:'function_call',functionCallId:'fc-generate'});for(const completed of [1,40])await onEvent({kind:'progress',progress:{completed,total:40,unit:'steps'}});if(fail)throw Error('private failure');}
  if(action==='generate'||action==='observe_result')return {videoBase64:mp4.toString('base64'),mime:'video/mp4',width:720,height:1280,sha256:digest(mp4),modelRevision:manifest.revision,scope:{engineId,accountId,runId:input.runId,requestId:input.requestId}};
  throw Error('Unexpected mocked action');
 };
 const transport=createWanModalTransport({store,runner,allowPaid});
 const start=()=>transport.start({definition,runId,requestId:runId,approved:true});
 const ref={assetId:'reference',mime:'image/png',base64:png.toString('base64'),sha256:digest(png)};store.put('production-asset',{id:'reference',kind:'image',status:'completed',customerId:'customer',projectId:'project',sha256:ref.sha256});
 const generate=(request={prompt:'صورة لشخصية عراقية',width:720,height:1280,seed:42,mode:'image_to_video',reference_images:[ref],num_frames:81,fps:16},extra={})=>transport.generate({definition,runId,scope,requestId:scope.attemptId,approved:true,request,...extra});
 return {store,transport,definition,runId,scope,calls,hooks,start,generate,ref,setFailure:value=>fail=value};
}

test('Wan quote only inspects pinned metadata and does not dispatch paid work',async t=>{
 const f=await fixture(t,{allowPaid:false}),q=await f.transport.prepareQuote({definition:f.definition});assert.equal(q.expectedBytes,manifest.totalBytes);assert.ok(f.calls.every(c=>c.action==='inspect'));assert.match(f.calls[0].input.appName,/^mashhad-wan-/);await assert.rejects(f.start(),/WAN_PAID_DISABLED/);
});
test('Wan accepts a single owned opening frame and rejects text only, multi image or unsupported timing',async t=>{
 const f=await fixture(t);await f.start();const base={prompt:'x',width:720,height:1280,seed:42,num_frames:81,fps:16,mode:'image_to_video',reference_images:[f.ref]};await assert.rejects(f.generate({...base,reference_images:[]}),/WAN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,reference_images:[f.ref,f.ref]}),/WAN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,mode:'edit'}),/WAN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,num_frames:82}),/WAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,fps:24}),/WAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,width:1024,height:1024}),/WAN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,reference_images:[{...f.ref,assetId:'foreign'}]}),/WAN_REFERENCE_NOT_OWNED/);assert.equal(f.calls.filter(c=>c.action==='generate').length,0);
});
test('Wan returns MP4 with actual steps, never stores inline video and replays only saved result',async t=>{
 const f=await fixture(t);await f.start();const progress=[],result=await f.generate(undefined,{onProgress:p=>progress.push(p)});assert.equal(result.videoBase64,mp4.toString('base64'));assert.deepEqual(progress.map(p=>p.completed),[1,40]);const call=f.calls.find(c=>c.action==='generate');assert.equal(call.input.request.num_frames,81);assert.equal(call.input.request.fps,16);assert.equal(call.input.referenceImagesBase64.length,1);assert.equal(JSON.stringify(f.store.all('wan-operation')).includes(mp4.toString('base64')),false);await f.generate();assert.equal(f.calls.filter(c=>c.action==='generate').length,1);assert.equal(f.calls.at(-1).action,'observe_result');await f.transport.stop({definition:f.definition,runId:f.runId,approved:true});await assert.rejects(f.generate(),/WAN_GENERATION_NOT_AUTHORIZED/);
});
