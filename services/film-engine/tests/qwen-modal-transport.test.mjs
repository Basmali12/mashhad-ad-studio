import test from 'node:test';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createQwenModalTransport} from '../engine/qwen-modal-transport.mjs';
const manifest=JSON.parse(await readFile(new URL('../engine/qwen/model-manifest.json',import.meta.url),'utf8'));
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900000000','hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{allowPaid=true,runnerFailure=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'qwen-transport-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 const engineId=randomUUID(),accountId=randomUUID(),runId=randomUUID(),definition={id:engineId,accountId,modelId:'qwen-image-edit-2511',version:'2511',gpu:'RTX-PRO-6000',cpu:4,ramGiB:128,minVramGiB:48,volume:'model-volume',weightPath:'models/qwen-image-edit-2511/'+engineId,revision:1};
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
  if(action==='generate'||action==='observe_result')return {imageBase64:png.toString('base64'),mime:'image/png',width:720,height:1280,sha256:digest(png),modelRevision:manifest.revision,scope:{engineId,accountId,runId:input.runId,requestId:input.requestId}};
  throw Error('Unexpected mocked action');
 };
 const transport=createQwenModalTransport({store,runner,allowPaid});
 const start=()=>transport.start({definition,runId,requestId:runId,approved:true});
 const ref={assetId:'reference',mime:'image/png',base64:png.toString('base64'),sha256:digest(png)};store.put('production-asset',{id:'reference',kind:'image',status:'completed',customerId:'customer',projectId:'project',sha256:ref.sha256});
 const generate=(request={prompt:'صورة لشخصية عراقية',width:720,height:1280,seed:42,mode:'edit',reference_images:[ref]},extra={})=>transport.generate({definition,runId,scope,requestId:scope.attemptId,approved:true,request,...extra});
 return {store,transport,definition,runId,scope,calls,hooks,start,generate,ref,setFailure:value=>fail=value};
}

test('Qwen preparation quote is metadata only and keeps the pinned independent namespace',async t=>{
 const f=await fixture(t,{allowPaid:false});const q=await f.transport.prepareQuote({definition:f.definition});assert.equal(q.expectedBytes,manifest.totalBytes);assert.equal(q.fileCount,34);assert.ok(q.estimate.storageUSDPerMonth>4);assert.ok(f.calls.every(c=>c.action==='inspect'));assert.match(f.calls[0].input.appName,/^mashhad-qwen-/);assert.match(f.calls[0].input.resultsVolume,/^mashhad-qwen-results-/);await assert.rejects(f.start(),/QWEN_PAID_DISABLED/);
});
test('Qwen rejects another model/profile/account and requires durable paid admission',async t=>{
 const f=await fixture(t);await assert.rejects(f.transport.inspect({definition:{...f.definition,modelId:'flux2-klein-4b'}}),/QWEN_DEFINITION_CHANGED/);await assert.rejects(f.transport.inspect({definition:f.definition,profile:{manifest:{...manifest,revision:'wrong'}}}),/QWEN_PROFILE_CHANGED/);f.store.delete('engine-command',hash('engine-start:'+f.runId));await assert.rejects(f.start(),/QWEN_START_NOT_AUTHORIZED/);assert.equal(f.calls.length,0);
});
test('Qwen requires one to three owned references and fixed exact 720p output',async t=>{
 const f=await fixture(t);await f.start();const base={prompt:'x',width:720,height:1280,seed:42};await assert.rejects(f.generate(base),/QWEN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,mode:'text_to_image',reference_images:[f.ref]}),/QWEN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,mode:'multi_reference',reference_images:Array(4).fill(f.ref)}),/QWEN_REFERENCE_INVALID/);await assert.rejects(f.generate({...base,width:1024,height:1024,reference_images:[f.ref]}),/QWEN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,steps:4,reference_images:[f.ref]}),/QWEN_REQUEST_INVALID/);await assert.rejects(f.generate({...base,reference_images:[{...f.ref,assetId:'foreign'}]}),/QWEN_REFERENCE_NOT_OWNED/);assert.equal(f.calls.filter(c=>c.action==='generate').length,0);
});
test('Qwen fixed 40-step progress, private reference bytes and one durable generation compose',async t=>{
 const f=await fixture(t);await f.start();const progress=[],result=await f.generate(undefined,{onProgress:p=>progress.push(p)});assert.deepEqual(progress.map(p=>[p.completed,p.total]),[[1,40],[40,40]]);assert.equal(result.modelRevision,manifest.revision);assert.equal(result.scope.customerId,'customer');assert.equal(f.calls.find(c=>c.action==='generate').input.referenceImagesBase64[0],f.ref.base64);await f.generate();assert.equal(f.calls.filter(c=>c.action==='generate').length,1);assert.equal(f.calls.at(-1).action,'observe_result');assert.equal(JSON.stringify(f.store.all('qwen-operation')).includes('synthetic_private'),false);assert.equal(JSON.stringify(f.store.all('qwen-operation')).includes(png.toString('base64')),false);assert.equal(f.store.all('flux-operation').length,0);
});
test('Qwen stop closes its admission and result recovery never touches a replacement',async t=>{
 const f=await fixture(t);await f.start();await f.transport.stop({definition:f.definition,runId:f.runId,approved:true});await assert.rejects(f.generate(),/QWEN_GENERATION_NOT_AUTHORIZED/);const replacement=randomUUID();f.store.put('engine-runtime',{id:f.definition.id,engineId:f.definition.id,accountId:f.definition.accountId,runId:replacement,cloudStopped:false});const result=await f.transport.observeResult({definition:f.definition,runId:f.runId,scope:f.scope,requestId:'attempt'});assert.equal(result.scope.runId,f.runId);await assert.rejects(f.transport.stop({definition:f.definition,runId:f.runId,approved:true}),/QWEN_RUN_CHANGED/);assert.equal(f.store.get('engine-runtime',f.definition.id).runId,replacement);
});
