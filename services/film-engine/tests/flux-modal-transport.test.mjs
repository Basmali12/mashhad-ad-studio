import test from 'node:test';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createFluxModalTransport,fluxTransportEnvironment} from '../engine/flux-modal-transport.mjs';
const manifest=JSON.parse(await readFile(new URL('../engine/flux/model-manifest.json',import.meta.url),'utf8'));
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900000000','hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{allowPaid=true,runnerFailure=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'flux-transport-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 const engineId=randomUUID(),accountId=randomUUID(),runId=randomUUID(),definition={id:engineId,accountId,modelId:'flux2-klein-4b',version:'4B',gpu:'RTX-PRO-6000',cpu:4,ramGiB:96,minVramGiB:48,volume:'model-volume',weightPath:'models/flux2-klein-4b/'+engineId,revision:1};
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
  if(action==='observe_preparation')return hooks.preparationResult??{status:'completed',cloudStopped:true,progress:{completedBytes:123,totalBytes:123}};
  if(action==='cancel_preparation')return {status:'cancelled',cloudStopped:true};
  if(action==='start'){await onEvent({kind:'function_call',functionCallId:'fc-start',appId:'ap-scoped'});if(fail)throw Error('private failure');return {functionCallId:'fc-start',appId:'ap-scoped',ready:false,cloudStopped:false};}
  if(action==='observe')return hooks.observeResult??{ready:true,cloudStopped:false,activeTasks:1};
  if(action==='cancel_call')return {ready:false,cloudStopped:true,activeTasks:0,admissionClosed:true};
  if(action==='stop')return {ready:false,cloudStopped:!input.pendingUnknown,activeTasks:0,admissionClosed:true,stopMode:'official_cli_graceful_container_stop'};
  if(action==='generate'){await hooks.beforeGenerateEvent?.();await onEvent({kind:'function_call',functionCallId:'fc-generate'});for(const completed of [1,4])await onEvent({kind:'progress',progress:{completed,total:4,unit:'steps'}});if(fail)throw Error('private failure');}
  if(action==='generate'||action==='observe_result')return {imageBase64:png.toString('base64'),mime:'image/png',width:720,height:1280,sha256:digest(png),modelRevision:manifest.revision,scope:{engineId,accountId,runId:input.runId,requestId:input.requestId}};
  throw Error('Unexpected mocked action');
 };
 const transport=createFluxModalTransport({store,runner,allowPaid});
 const start=()=>transport.start({definition,runId,requestId:runId,approved:true});
 const generate=(request={prompt:'صورة لشخصية عراقية',width:720,height:1280,seed:42},extra={})=>transport.generate({definition,runId,scope,requestId:scope.attemptId,approved:true,request,...extra});
 return {store,transport,definition,runId,scope,calls,hooks,start,generate,setFailure:value=>fail=value};
}

test('transport import and environment cannot leak global provider or database credentials',()=>{
 const env=fluxTransportEnvironment({PATH:'safe',MODAL_TOKEN_ID:'private',ENGINE_MASTER_KEY:'private',PGPASSWORD:'private',OPENAI_API_KEY:'private',HF_TOKEN:'private'});assert.deepEqual(env,{PATH:'safe'});
});

test('confirmed preparation failure survives transport without a second paid dispatch',async t=>{
 const f=await fixture(t),q=await f.transport.prepareQuote({definition:f.definition});
 const prepared=await f.transport.prepare({definition:f.definition,quoteId:q.id,requestId:'prepare-fail',approved:true});
 f.hooks.preparationResult={status:'failed',error:'FLUX_PREPARATION_FAILED',cloudStopped:true};
 const result=await f.transport.observePreparation({definition:f.definition,operationId:prepared.operationId});
 assert.equal(result.status,'failed');assert.equal(result.error,'FLUX_PREPARATION_FAILED');assert.equal(result.cloudStopped,true);
 assert.equal(f.calls.filter(c=>c.action==='prepare').length,1);
});

test('read-only inspection and preparation quote never allocate, download, deploy or use GPU',async t=>{
 const f=await fixture(t,{allowPaid:false});await f.transport.inspect({definition:f.definition});const q=await f.transport.prepareQuote({definition:f.definition});
 assert.equal(q.expectedBytes,manifest.totalBytes);assert.equal(q.missingBytes,manifest.totalBytes);assert.equal(q.fileCount,manifest.files.length);assert.equal(q.deploymentRequired,true);assert.equal(q.estimate.expectedSeconds,null);assert.equal(q.estimate.windowSeconds,3600);assert.ok(Math.abs(q.estimate.resourceWindowUSD-.158256)<1e-10);assert.ok(q.estimate.storageUSDPerMonth>1);assert.equal(q.estimate.networkUSD,null);assert.equal(q.estimate.buildUSD,null);assert.ok(f.calls.every(c=>c.action==='inspect'));
 await assert.rejects(f.transport.prepare({definition:f.definition,quoteId:q.id,requestId:'prepare',approved:true}),/FLUX_PAID_DISABLED/);assert.equal(f.calls.length,2);
});

test('account encryption is used only in private runner payload and not persisted operation data',async t=>{
 const f=await fixture(t);await f.start();const call=f.calls[0];assert.equal(call.input.credentials.expectedWorkspace,'fixture-workspace');assert.equal(call.input.credentials.tokenId,'ak-synthetic_private_token');assert.equal(call.input.definition.accountId,f.definition.accountId);
 assert.equal(JSON.stringify(f.store.all('flux-operation')).includes('synthetic_private'),false);assert.equal(JSON.stringify(f.store.all('flux-runtime')).includes('synthetic_private'),false);
});

test('wrong definition, manifest, unlinked account or missing durable registry admission cannot start',async t=>{
 const f=await fixture(t);await assert.rejects(f.transport.start({definition:{...f.definition,gpu:'L40S'},runId:f.runId,approved:true}),/FLUX_DEFINITION_CHANGED/);
 await assert.rejects(f.transport.inspect({definition:f.definition,profile:{manifest:{...manifest,revision:'wrong'}}}),/FLUX_PROFILE_CHANGED/);
 f.store.delete('engine-command',hash('engine-start:'+f.runId));await assert.rejects(f.start(),/FLUX_START_NOT_AUTHORIZED/);
 f.store.put('account',{...f.store.get('account',f.definition.accountId),unlinked:true});await assert.rejects(f.start(),/FLUX_ACCOUNT_UNAVAILABLE/);assert.equal(f.calls.length,0);
});

test('start is dispatched once per owned run even if a caller changes request ID',async t=>{
 const f=await fixture(t);await f.start();await f.start();await f.transport.start({definition:f.definition,runId:f.runId,requestId:'different',approved:true});assert.equal(f.calls.filter(c=>c.action==='start').length,1);
 const observed=await f.transport.observe({definition:f.definition,runId:f.runId});assert.equal(observed.ready,true);assert.equal(f.calls.at(-1).input.requestId,f.runId);
});

test('preparation quote is consumed once and observation follows its saved function call without respawning',async t=>{
 const f=await fixture(t),quote=await f.transport.prepareQuote({definition:f.definition});const result=await f.transport.prepare({definition:f.definition,quoteId:quote.id,requestId:'prepare-one',approved:true});assert.equal(result.status,'submitted');assert.equal(result.cloudStopped,false);
 const op=f.store.get('flux-operation',result.operationId);assert.equal(op.functionCallId,'fc-prepare');await f.transport.prepare({definition:f.definition,quoteId:quote.id,requestId:'prepare-one',approved:true});await assert.rejects(f.transport.prepare({definition:f.definition,quoteId:quote.id,requestId:'second-request',approved:true}),/FLUX_PREPARE_QUOTE_USED/);
 const done=await f.transport.observePreparation({definition:f.definition,operationId:result.operationId});assert.equal(done.cloudStopped,true);assert.equal(f.calls.filter(c=>c.action==='prepare').length,1);
});

test('ambiguous preparation exposes only its private operation ID and never repeats a paid dispatch',async t=>{
 const f=await fixture(t),quote=await f.transport.prepareQuote({definition:f.definition});f.setFailure(true);let operationId;
 await assert.rejects(f.transport.prepare({definition:f.definition,quoteId:quote.id,requestId:'prepare-unknown',approved:true}),error=>{operationId=error.operationId;assert.equal(error.message,'FLUX_STATE_UNKNOWN');return !!operationId;});
 assert.equal(f.store.get('flux-operation',operationId).functionCallId,'fc-prepare');await assert.rejects(f.transport.prepare({definition:f.definition,quoteId:quote.id,requestId:'prepare-unknown',approved:true}),/FLUX_STATE_UNKNOWN/);assert.equal(f.calls.filter(c=>c.action==='prepare').length,1);assert.equal(JSON.stringify(f.store.all('flux-operation')).includes('synthetic_private'),false);
 const cancelled=await f.transport.cancelPreparation({definition:f.definition,operationId,approved:true});assert.equal(cancelled.cloudStopped,true);assert.equal(f.calls.at(-1).action,'cancel_preparation');
});

test('closing admission prevents generation and stop never calls a GPU class method',async t=>{
 const f=await fixture(t);await f.start();const stopped=await f.transport.stop({definition:f.definition,runId:f.runId,approved:true});assert.equal(stopped.cloudStopped,true);await assert.rejects(f.generate(),/FLUX_GENERATION_NOT_AUTHORIZED/);
 assert.equal(f.calls.at(-1).action,'stop');assert.equal(f.calls.at(-1).input.admissionClosed,true);assert.ok(f.calls.at(-1).input.functionCallIds.includes('fc-start'));const observed=await f.transport.observe({definition:f.definition,runId:f.runId});assert.equal(observed.cloudStopped,true);assert.equal(f.calls.at(-1).action,'stop');
});

test('generation requires submitted wallet hold and exact production owner/project/run scope',async t=>{
 const f=await fixture(t);await f.start();f.store.put('production-charge',{...f.store.get('production-charge','charge'),state:'reserved'});await assert.rejects(f.generate(),/FLUX_GENERATION_NOT_AUTHORIZED/);
 f.store.put('production-charge',{...f.store.get('production-charge','charge'),state:'submitted'});await assert.rejects(f.generate(undefined,{scope:{...f.scope,customerId:'other'}}),/FLUX_GENERATION_NOT_AUTHORIZED/);assert.equal(f.calls.filter(c=>c.action==='generate').length,0);
});

test('image generation has fixed allowed request settings, actual progress and no inline image in database records',async t=>{
 const f=await fixture(t);await f.start();await assert.rejects(f.generate({prompt:'x',width:720,height:1280,seed:42,steps:1}),/FLUX_REQUEST_INVALID/);
 const progress=[],result=await f.generate(undefined,{onProgress:p=>progress.push(p)});assert.equal(result.modelRevision,manifest.revision);assert.equal(result.scope.customerId,'customer');assert.deepEqual(progress.map(p=>p.completed),[1,4]);
 assert.equal(JSON.stringify(f.store.all('flux-operation')).includes(png.toString('base64')),false);
 await f.generate();assert.equal(f.calls.filter(c=>c.action==='generate').length,1);assert.equal(f.calls.at(-1).action,'observe_result');
});

test('edit/multiple references require owned hashes and preserve bytes without URLs or arbitrary paths',async t=>{
 const f=await fixture(t);await f.start();const ref={assetId:'reference',mime:'image/png',base64:png.toString('base64'),sha256:digest(png)};
 await assert.rejects(f.generate({prompt:'x',width:720,height:1280,seed:42,mode:'edit',reference_images:[ref]}),/FLUX_REFERENCE_NOT_OWNED/);
 f.store.put('production-asset',{id:'reference',kind:'image',status:'completed',customerId:'customer',projectId:'project',sha256:ref.sha256});await assert.rejects(f.generate({prompt:'x',width:720,height:1280,seed:42,mode:'edit',reference_images:[{...ref,sha256:'f'.repeat(64)}]}),/FLUX_REFERENCE_INVALID/);
 await f.generate({prompt:'x',width:720,height:1280,seed:42,mode:'edit',reference_images:[ref]});const called=f.calls.find(c=>c.action==='generate');assert.equal(called.input.referenceImagesBase64[0],ref.base64);assert.equal(called.input.request.mode,'edit');assert.equal('reference_images' in called.input.request,false);
});

test('historical result observation never follows or stops a replacement engine runtime',async t=>{
 const f=await fixture(t);await f.start();const replacement=randomUUID();f.store.put('engine-runtime',{id:f.definition.id,engineId:f.definition.id,accountId:f.definition.accountId,runId:replacement,cloudStopped:false});
 const result=await f.transport.observeResult({definition:f.definition,runId:f.runId,scope:f.scope,requestId:'attempt'});assert.equal(result.scope.runId,f.runId);assert.equal(f.calls.at(-1).action,'observe_result');assert.equal(f.store.get('engine-runtime',f.definition.id).runId,replacement);
 await assert.rejects(f.transport.stop({definition:f.definition,runId:f.runId,approved:true}),/FLUX_RUN_CHANGED/);assert.equal(f.calls.filter(c=>c.action==='stop').length,0);
});


test('idle observation closes local admission and cannot leave a phantom-ready GPU or permit more generation',async t=>{
 const f=await fixture(t);await f.start();f.hooks.observeResult={ready:false,cloudStopped:true,activeTasks:0,admissionClosed:true,startSettled:true};
 const observed=await f.transport.observe({definition:f.definition,runId:f.runId});assert.equal(observed.ready,false);assert.equal(observed.cloudStopped,true);assert.equal(f.store.get('flux-runtime',f.runId).admissionClosed,true);
 const input=f.calls.at(-1).input;assert.ok(input.functionCallIds.includes('fc-start'));assert.equal(input.pendingUnknown,false);await assert.rejects(f.generate(),/FLUX_GENERATION_NOT_AUTHORIZED/);assert.equal(f.calls.filter(c=>c.action==='generate').length,0);
});

test('generate admission transaction rechecks a stop that occurs after its initial context validation',async t=>{
 const f=await fixture(t);await f.start();const original=f.store.transaction.bind(f.store);let intercepted=false;
 f.store.transaction=async work=>{if(!intercepted){intercepted=true;await original(async()=>{const r=f.store.get('flux-runtime',f.runId);f.store.put('flux-runtime',{...r,admissionClosed:true});});}return original(work);};
 await assert.rejects(f.generate(),/FLUX_ADMISSION_CLOSED/);assert.equal(f.calls.filter(c=>c.action==='generate').length,0);assert.equal(f.store.all('flux-operation').filter(o=>o.action==='generate').length,0);
});

test('a function-call ID arriving after stop is durably tracked and cancelled without any second generation',async t=>{
 const f=await fixture(t);await f.start();let release,entered;const enteredPromise=new Promise(r=>entered=r),pause=new Promise(r=>release=r);f.hooks.beforeGenerateEvent=async()=>{entered();await pause;};
 const generation=f.generate();const caught=assert.rejects(generation,/FLUX_STATE_UNKNOWN/);await enteredPromise;
 const stopped=await f.transport.stop({definition:f.definition,runId:f.runId,approved:true});assert.equal(stopped.cloudStopped,false,'unrecorded in-flight dispatch is not stopped proof');assert.equal(f.calls.at(-1).input.pendingUnknown,true);
 release();await caught;assert.equal(f.calls.filter(c=>c.action==='generate').length,1);const cancellation=f.calls.find(c=>c.action==='cancel_call');assert.equal(cancellation.input.functionCallId,'fc-generate');assert.equal(cancellation.input.runId,f.runId);assert.equal(cancellation.input.admissionClosed,true);
 const op=f.store.all('flux-operation').find(o=>o.action==='generate');assert.equal(op.functionCallId,'fc-generate');assert.equal(op.state,'uncertain');const final=await f.transport.stop({definition:f.definition,runId:f.runId,approved:true});assert.equal(final.cloudStopped,true);
});


test('preparation CPU call arriving after bootstrap cancellation is cancelled and never respawned',async t=>{
 const f=await fixture(t),q=await f.transport.prepareQuote({definition:f.definition});let release,entered;const started=new Promise(r=>entered=r),pause=new Promise(r=>release=r);f.hooks.beforePrepareEvent=async()=>{entered();await pause;};
 const preparing=f.transport.prepare({definition:f.definition,quoteId:q.id,requestId:'late-preparation',approved:true});await started;
 const op=f.store.all('flux-operation').find(o=>o.action==='prepare');assert.equal(op.state,'dispatching');assert.equal(op.functionCallId,undefined);
 const pending=await f.transport.cancelPreparation({definition:f.definition,operationId:op.id,approved:true});assert.equal(pending.cloudStopped,false);assert.equal(pending.status,'uncertain');release();const result=await preparing;
 assert.equal(result.status,'cancelled');assert.equal(result.cloudStopped,true);assert.equal(result.cancelRequested,true);assert.equal(f.calls.filter(c=>c.action==='prepare').length,1);const cancelled=f.calls.find(c=>c.action==='cancel_preparation');assert.equal(cancelled.input.functionCallId,'fc-prepare');assert.equal(cancelled.input.operationId,op.id);
 const observed=await f.transport.observePreparation({definition:f.definition,operationId:op.id});assert.equal(observed.status,'cancelled');assert.equal(observed.cloudStopped,true);assert.equal(f.calls.filter(c=>c.action==='prepare').length,1);
});
