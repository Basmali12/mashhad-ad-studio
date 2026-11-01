import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {createEngineRegistry} from '../engine/engine-registry.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';
import {ENGINE_MODEL_CATALOG} from '../../../shared/engine-catalog.ts';

const admin={id:'admin',email:'fixture@example.test',isAdmin:true};
async function fixture(t,{mock=true,paid=true}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'engine-registry-')),store=new Store(folder,randomBytes(32).toString('base64'));
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 store.put('account',{id:'account-one',activated:true,credentials:store.seal({tokenId:'synthetic-only',tokenSecret:'synthetic-only'},'account-one')});
 let at=1000000;const calls={start:0,stop:0,observe:0,files:0};
 const adapter={profile:e=>({manifest:{modelId:e.modelId,version:e.version,revision:'fixture-pinned-123',files:[{path:'model.safetensors',size:42,sha256:'a'.repeat(64)}]},validateResources:()=>true}),inspectFiles:async(e,m)=>{calls.files++;return {accountId:e.accountId,volume:e.volume,weightPath:e.weightPath,revision:m.revision,files:m.files.map(f=>({...f,verified:true}))};},start:async()=>{calls.start++;return {ready:false};},observe:async()=>{calls.observe++;return {ready:true};},stop:async()=>{calls.stop++;return {cloudStopped:false};}};
 const catalog=mock?ENGINE_MODEL_CATALOG.map(m=>({...m,enabled:true})):ENGINE_MODEL_CATALOG;
 const options={store,now:()=>at,allowPaid:paid,...(mock?{adapter,catalog}:{})};
 let registry=createEngineRegistry(options);
 const invoke=(op,input={})=>registry.dispatch(admin,'admin.engine.'+op,input);
 const config={modelId:catalog[0].id,accountId:'account-one',name:'محرك تجريبي',gpu:'RTX-PRO-6000',cpu:4,ramGiB:96,minVramGiB:24,version:'fixture-version',hourPriceUSD:'3'};
 const e=await invoke('save',config);
 const ready=async()=>{await invoke('inspect',{id:e.id});return invoke('quote',{id:e.id,action:'start'});};
 const start=async(requestId='one')=>{const q=await ready();return invoke('start',{id:e.id,quoteId:q.id,requestId,approved:true});};
 return {store,adapter,calls,config,e,invoke,ready,start,setTime:v=>at=v,restart:()=>registry=createEngineRegistry(options),registry};
}
test('all eight production descriptors stay disabled; saves and inspection never allocate resources',async t=>{
 const f=await fixture(t,{mock:false});const models=await f.invoke('models');assert.equal(models.length,ENGINE_MODEL_CATALOG.length);assert.ok(models.every(m=>m.enabled===false));
 assert.equal(f.e.preparationState,'needs_manifest');assert.equal(f.e.adapterAvailable,false);assert.match(f.e.weightPath,/^models\/flux2-klein-4b\//);
 const q=await f.ready();assert.equal(q.dispatchAvailable,false);assert.equal(q.estimate.resourceWindowUSD,null);
 await assert.rejects(f.invoke('start',{id:f.e.id,quoteId:q.id,requestId:'denied',approved:true}),/ENGINE_ADAPTER_UNAVAILABLE/);
 assert.deepEqual(f.calls,{start:0,stop:0,observe:0,files:0});assert.equal(f.store.all('engine-runtime').length,0);
});
test('server auth rejects every registry operation for customers',async t=>{
 const f=await fixture(t);for(const op of ['models','list','save','inspect','quote','start','stop','status'])await assert.rejects(f.registry.dispatch({isAdmin:false},'admin.engine.'+op,{id:f.e.id}),/FORBIDDEN/);
});
test('definitions isolate same-account models and reject browser manifests/resource mismatches',async t=>{
 const f=await fixture(t);const second=await f.invoke('save',{...f.config,modelId:'habibi-irq',version:null,volume:'',minVramGiB:null});assert.notEqual(second.id,f.e.id);assert.notEqual(second.weightPath,f.e.weightPath);assert.equal(second.version,ENGINE_MODEL_CATALOG.find(m=>m.id===second.modelId).version);assert.equal(second.minVramGiB,null);
 for(const bad of [{manifest:{}},{weightPath:'../other'},{gpu:'H100'},{cpu:0},{ramGiB:0},{volume:'../bad'},{modelId:'missing'}])await assert.rejects(f.invoke('save',{...f.config,...bad}),/INVALID_ENGINE_CONFIG/);
 assert.ok(!JSON.stringify(await f.invoke('list')).includes('synthetic-only'));
});
test('readiness requires pinned file hashes and exact account/namespace/revision',async t=>{
 const f=await fixture(t);const original=f.adapter.inspectFiles;
 for(const override of [{accountId:'other'},{weightPath:'other/path'},{revision:'other'},{files:[{path:'model.safetensors',size:42,verified:true}]}]){
  f.adapter.inspectFiles=async(e,m)=>({...await original(e,m),...override});assert.equal((await f.invoke('inspect',{id:f.e.id})).preparationState,'needs_preparation');
 }
 f.adapter.inspectFiles=original;assert.equal((await f.invoke('inspect',{id:f.e.id})).preparationState,'ready');
});
test('explicit approval and paid switch gate dispatch; no transfer implementation in task2',async t=>{
 const f=await fixture(t,{paid:false});const q=await f.ready();assert.equal(q.dispatchAvailable,false);assert.ok(q.blockers.includes('PAID_DISABLED'));
 await assert.rejects(f.invoke('start',{id:f.e.id,quoteId:q.id,requestId:'no-approval'}),/ENGINE_APPROVAL_REQUIRED/);
 await assert.rejects(f.invoke('start',{id:f.e.id,quoteId:q.id,requestId:'paid-off',approved:true}),/ENGINE_NOT_READY/);
 const prepare=await f.invoke('quote',{id:f.e.id,action:'prepare'});assert.equal(prepare.dispatchAvailable,false);assert.ok(prepare.blockers.includes('PREPARATION_ADAPTER_UNAVAILABLE'));assert.equal(f.calls.start,0);
});
test('concurrent duplicate starts dispatch once; another request blocked; restart only observes',async t=>{
 const f=await fixture(t),q=await f.ready(),input={id:f.e.id,quoteId:q.id,requestId:'same',approved:true};
 const results=await Promise.all([f.invoke('start',input),f.invoke('start',input)]);assert.equal(f.calls.start,1);assert.equal(results[0].runtime.id,results[1].runtime.id);assert.equal(results[0].runtime.state,'starting');
 await assert.rejects(f.invoke('start',{...input,requestId:'other'}),/ENGINE_QUOTE_EXPIRED/);
 const q2=await f.ready();await assert.rejects(f.invoke('start',{...input,quoteId:q2.id}),/IDEMPOTENCY_CONFLICT/);
 f.restart();assert.equal((await f.invoke('status',{id:f.e.id})).runtime.state,'running');assert.equal(f.calls.start,1);
});
test('startup, idle, failure and stop latency counted until confirmed stop; provider cost separate',async t=>{
 const f=await fixture(t);await f.start();f.setTime(1060000);assert.equal((await f.invoke('status',{id:f.e.id})).runtime.estimatedCustomerUSD,.05);
 await f.invoke('stop',{id:f.e.id,approved:true});f.setTime(1120000);assert.equal((await f.invoke('stop',{id:f.e.id,approved:true})).runtime.state,'stopping');assert.equal(f.calls.stop,1);
 f.adapter.observe=async()=>({cloudStopped:true,activeTasks:1});assert.equal((await f.invoke('status',{id:f.e.id})).runtime.cloudStopped,false);
 f.adapter.observe=async()=>({cloudStopped:true,admissionClosed:true,activeTasks:0,recordedProviderUSD:.08});const final=await f.invoke('status',{id:f.e.id});assert.equal(final.runtime.cloudStopped,true);assert.equal(final.runtime.estimatedCustomerUSD,.1);assert.equal(final.runtime.recordedProviderUSD,.08);
 f.setTime(1180000);assert.equal((await f.invoke('status',{id:f.e.id})).runtime.estimatedCustomerUSD,.1);
});
test('ambiguous dispatch never retries or leaks provider errors, edits/capacity remain blocked',async t=>{
 const f=await fixture(t);f.adapter.start=async()=>{f.calls.start++;throw Error('provider-secret-fixture');};const q=await f.ready(),input={id:f.e.id,quoteId:q.id,requestId:'ambiguous',approved:true};const r=await f.invoke('start',input);
 assert.equal(r.runtime.state,'failed');assert.equal(r.runtime.cloudStopped,false);assert.equal(r.runtime.requiresReconcile,true);assert.ok(!JSON.stringify(r).includes('provider-secret-fixture'));
 await f.invoke('start',input);assert.equal(f.calls.start,1);await assert.rejects(f.invoke('save',{...f.config,id:f.e.id}),/ENGINE_BUSY/);
 f.setTime(1060000);assert.equal((await f.invoke('list'))[0].runtime.estimatedCustomerUSD,.05);
});
test('quotes cannot survive config edits or expiry; existing account rentals block new adapter dispatch',async t=>{
 const f=await fixture(t),q=await f.ready();await f.invoke('save',{...f.config,id:f.e.id,name:'renamed'});
 await assert.rejects(f.invoke('start',{id:f.e.id,quoteId:q.id,requestId:'stale',approved:true}),/ENGINE_CONFIG_CHANGED/);
 const fresh=await f.ready();f.setTime(fresh.expiresAt);await assert.rejects(f.invoke('start',{id:f.e.id,quoteId:fresh.id,requestId:'expired',approved:true}),/ENGINE_QUOTE_EXPIRED/);
 f.store.put('rental',{id:'old-active',accountId:f.config.accountId,state:'uncertain'});await assert.rejects(f.start(),/ENGINE_BUSY/);assert.equal(f.calls.start,0);
});
test('film gateway dispatch integrates registry behind server admin auth without model configuration',async t=>{
 const f=await fixture(t,{mock:false});const platform=createFilmPlatform({engine:{store:f.store,allowPaid:false,productionAvailable:false},origin:'https://fixture.test',secret:'local-fixture-only-secret-at-least-32-bytes',startWorker:false});
 assert.equal((await platform.dispatch(admin,'admin.engine.models')).length,ENGINE_MODEL_CATALOG.length);await assert.rejects(platform.dispatch({...admin,isAdmin:false},'admin.engine.list'),/FORBIDDEN/);
 assert.equal((await platform.dispatch(admin,'admin.engine.list')).length,1);assert.equal(f.calls.start,0);await platform.close();
});
test('consumed approvals cannot launch another run and old request replay retains its original meter',async t=>{
 const f=await fixture(t),q=await f.ready(),input={id:f.e.id,quoteId:q.id,requestId:'first-run',approved:true};
 const first=await f.invoke('start',input);f.setTime(1060000);f.adapter.stop=async()=>({cloudStopped:true,admissionClosed:true,activeTasks:0});await f.invoke('stop',{id:f.e.id,approved:true});
 await assert.rejects(f.invoke('start',{...input,requestId:'another'}),/ENGINE_QUOTE_EXPIRED/);
 const second=await f.start('second-run');assert.notEqual(second.runtime.id,first.runtime.id);
 const replay=await f.invoke('start',input);assert.equal(replay.runtime.id,first.runtime.id);assert.equal(replay.runtime.cloudStopped,true);assert.equal(replay.runtime.estimatedCustomerUSD,.05);assert.equal(f.calls.start,2);assert.equal(f.store.all('engine-runtime-history').length,2);
});
test('late inspection cannot certify another account or a changed resource/settings revision',async t=>{
 const f=await fixture(t);f.store.put('account',{id:'account-two',activated:false});
 let entered,release;const started=new Promise(r=>entered=r),waiting=new Promise(r=>release=r),original=f.adapter.inspectFiles;
 f.adapter.inspectFiles=async(e,m)=>{entered();await waiting;return original(e,m);};
 const pending=f.invoke('inspect',{id:f.e.id});await started;
 await f.invoke('save',{...f.config,id:f.e.id,accountId:'account-two',volume:f.e.volume});release();
 await assert.rejects(pending,/ENGINE_CONFIG_CHANGED/);const [saved]=await f.invoke('list');assert.equal(saved.accountId,'account-two');assert.equal(saved.preparationState,'needs_preparation');assert.equal(f.store.get('engine-inspection',f.e.id),null);
});
test('stop cannot freeze the meter while start is pending; explicit scoped follow-up stops late allocation',async t=>{
 const f=await fixture(t);let entered,release,providerLive=false;
 const started=new Promise(r=>entered=r),waiting=new Promise(r=>release=r);
 f.adapter.start=async()=>{f.calls.start++;entered();await waiting;providerLive=true;return {ready:true};};
 f.adapter.stop=async()=>{f.calls.stop++;providerLive=false;return {cloudStopped:true,admissionClosed:true,activeTasks:0};};
 const starting=f.start();await started;const early=await f.invoke('stop',{id:f.e.id,approved:true});
 assert.equal(early.runtime.state,'stopping');assert.equal(early.runtime.cloudStopped,false);
 f.setTime(1060000);release();const late=await starting;assert.equal(providerLive,true);assert.equal(late.runtime.state,'stopping');assert.equal(late.runtime.cloudStopped,false);assert.equal(late.runtime.estimatedCustomerUSD,.05);
 const final=await f.invoke('stop',{id:f.e.id,approved:true});assert.equal(providerLive,false);assert.equal(final.runtime.state,'stopped');assert.equal(f.calls.start,1);assert.equal(f.calls.stop,2);
});
test('internal expected-run stop cannot cancel a replacement runtime on the same definition',async t=>{
 const f=await fixture(t);const first=await f.start();f.adapter.stop=async()=>({cloudStopped:true,admissionClosed:true,activeTasks:0});await f.invoke('stop',{id:f.e.id,approved:true});const replacement=await f.start('replacement');assert.notEqual(first.runtime.id,replacement.runtime.id);
 await assert.rejects(f.invoke('stop',{id:f.e.id,expectedRunId:first.runtime.id,approved:true}),/ENGINE_STATE_UNKNOWN/);assert.equal((await f.invoke('list'))[0].runtime.id,replacement.runtime.id);
});


test('explicit stop may reconcile a failed stop without reopening admission or starting again',async t=>{
 const f=await fixture(t);await f.start();f.adapter.stop=async()=>{f.calls.stop++;throw Error('unknown-stop');};
 const uncertain=await f.invoke('stop',{id:f.e.id,approved:true});assert.equal(uncertain.runtime.requiresReconcile,true);
 f.adapter.stop=async()=>{f.calls.stop++;return {cloudStopped:true,admissionClosed:true,activeTasks:0};};
 const stopped=await f.invoke('stop',{id:f.e.id,approved:true});assert.equal(stopped.runtime.state,'stopped');assert.equal(f.calls.stop,2);assert.equal(f.calls.start,1);
});


test('preparation access failures remain safe, stopped and recoverable without status dispatching a replacement',async t=>{
 const f=await fixture(t);let prepares=0,observes=0;
 f.adapter.prepareQuote=async()=>({id:'provider-quote',dispatchAvailable:true,blockers:[],expectedBytes:42,missingBytes:42,fileCount:1,missingFiles:[],estimate:{resourceWindowUSD:0.1}});
 f.adapter.prepare=async()=>{prepares++;return {operationId:'operation',status:'submitted',cloudStopped:false};};
 f.adapter.observePreparation=async()=>{observes++;return {status:'failed',cloudStopped:true,error:'SPEECH_COMPONENT_ACCESS_DENIED'};};
 const q=await f.invoke('quote',{id:f.e.id,action:'prepare'});
 await f.invoke('prepare',{id:f.e.id,quoteId:q.id,requestId:'codec-access-attempt',approved:true});
 const denied=await f.invoke('status',{id:f.e.id});assert.equal(denied.preparation.status,'failed');assert.equal(denied.preparation.error,'SPEECH_COMPONENT_ACCESS_DENIED');assert.equal(denied.preparation.cloudStopped,true);assert.equal(denied.preparationState,'needs_preparation');
 await f.invoke('status',{id:f.e.id});assert.equal(prepares,1);assert.equal(observes,1);assert.equal(f.calls.start,0);
});
