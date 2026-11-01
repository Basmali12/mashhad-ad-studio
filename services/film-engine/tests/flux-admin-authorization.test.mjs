import {Buffer} from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {Store,hash} from '../engine/store.mjs';
import {createEngineRegistry} from '../engine/engine-registry.mjs';
import {createEngineCommissioning} from '../engine/engine-commissioning.mjs';
import {createFluxServices,FLUX_MANIFEST} from '../engine/flux-integration.mjs';
import {createFluxModalTransport} from '../engine/flux-modal-transport.mjs';
import {createFluxImageAssets} from '../engine/flux-image-assets.mjs';
import {createAdminModelTestRunner} from '../engine/admin-model-test-runner.mjs';

function png(width,height){const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};const chunk=(name,data)=>{const type=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([len,type,data,sum]);};const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc((1+width*3)*height))),chunk('IEND',Buffer.alloc(0))]);}
async function fixture(t,{mutate=null}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'flux-admin-real-transport-')),store=new Store(folder,randomBytes(32).toString('base64')),admin={id:'fixture-admin',isAdmin:true};let time=1000000,saved,requestSent,capturedInput,actualFailure;const calls=[];
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 store.put('account',{id:'fixture-primary',mode:'token',workspace:'fixture-primary',credentials:store.seal({tokenId:'ak-synthetic-only-token',tokenSecret:'as-synthetic-only-secret'},'fixture-primary')});
 const rpc=async(action,input,onEvent=async()=>{})=>{calls.push(action);const d=input.definition,bound={engineId:d.id,accountId:d.accountId,runId:input.runId};
  if(action==='inspect')return {accountId:d.accountId,volume:d.volume,weightPath:d.weightPath,revision:FLUX_MANIFEST.revision,ready:true,deploymentReady:true,files:FLUX_MANIFEST.files.map(f=>({...f,present:true,verified:true}))};
  if(action==='start'){await onEvent({kind:'function_call',functionCallId:'fc-synthetic-start',appId:'ap-synthetic'});return {...bound,appId:'ap-synthetic',functionCallId:'fc-synthetic-start',ready:true,activeTasks:1,cloudStopped:false};}
  if(action==='stop')return {...bound,appId:'ap-synthetic',activeTasks:0,cloudStopped:true,admissionClosed:true,startSettled:true};
  if(action==='generate'){await onEvent({kind:'function_call',functionCallId:'fc-synthetic-generate',appId:'ap-synthetic'});requestSent=input.request;const image=png(input.request.width,input.request.height);saved={...bound,scope:{...input.scope,...bound},modelRevision:FLUX_MANIFEST.revision,imageBase64:image.toString('base64'),sha256:hash(image)};return saved;}
  if(action==='observe_result')return saved;
  throw Error('UNEXPECTED_TEST_RPC');
 };
 const native=createFluxModalTransport({store,runner:rpc,allowPaid:true,now:()=>time}),transport={...native,generate:async input=>{capturedInput=input;if(mutate)await mutate({store,input});try{return await native.generate(input);}catch(e){actualFailure=e.message;throw e;}}};
 const images=createFluxImageAssets({store,now:()=>time,makePreview:async()=>png(160,90)}),flux=createFluxServices({store,allowPaid:true,transport,images,now:()=>time}),registry=createEngineRegistry({store,adapter:flux.registryAdapter,allowPaid:true,now:()=>time});
 const entry=await registry.dispatch(admin,'admin.engine.save',{accountId:'fixture-primary',modelId:'flux2-klein-4b',name:'Private real-transport test',gpu:'L40S',cpu:4,ramGiB:64,minVramGiB:24,hourPriceUSD:'3'});await registry.dispatch(admin,'admin.engine.inspect',{id:entry.id});const definition=store.get('engine-definition',entry.id),runner=createAdminModelTestRunner({store,registry,adapters:{'flux2-klein-4b':flux.productionAdapter},images,allowPaid:true,now:()=>time}),commissioning=createEngineCommissioning({store,registry,testRunner:runner,allowPaid:true,now:()=>time});
 const p=await runner.createProject({definition,adminId:admin.id,input:{prompt:'A realistic Iraqi man in a quiet contemporary courtyard.'}}),input={projectId:p.projectId,stageId:p.stageId};
 async function run(){const q=await commissioning.dispatch(admin,'admin.engine.test.quote',{id:definition.id,input});assert.equal(q.dispatchAvailable,true);const result=await commissioning.dispatch(admin,'admin.engine.test.execute',{id:definition.id,quoteId:q.id,requestId:'one-private-image',approved:true});await commissioning.drain();return commissioning.status({id:definition.id,testId:result.latestTest.id});}
 return {store,admin,definition,runner,commissioning,native,input,calls,run,getSent:()=>requestSent,getCaptured:()=>capturedInput,getFailure:()=>actualFailure,advance:()=>time+=1000};
}

test('actual commissioning → admin runner → FLUX adapter → real transport authorizes one image without customer billing records',async t=>{
 const f=await fixture(t),r=await f.run();assert.equal(r.workflowState,'needs_review');assert.equal(f.store.get('engine-test',r.latestTest.id).verified,true);assert.equal(r.latestTest.cloudStopped,true);assert.equal(f.calls.filter(x=>x==='generate').length,1);assert.equal(f.calls.filter(x=>x==='stop').length,1);assert.ok(f.getSent().prompt.includes('realistic Iraqi man'));
 assert.equal(f.store.all('production-charge').length,0);assert.equal(f.store.all('production-quote').length,0);assert.equal(f.store.all('production-model-run').length,0);assert.equal(f.store.all('film-credit').length,0);
 const q=f.store.all('engine-test-quote')[0];assert.equal(q.usedBy,r.latestTest.id);assert.ok(f.store.get('admin-native-authorization',r.latestTest.id).nativeRequestDigest);
 const before=f.calls.length;const duplicate=await f.commissioning.dispatch(f.admin,'admin.engine.test.execute',{id:f.definition.id,quoteId:q.id,requestId:'one-private-image',approved:true});await f.commissioning.drain();assert.equal(duplicate.latestTest.id,r.latestTest.id);assert.equal(f.calls.length,before);
 const recovered=await f.native.observeResult(f.getCaptured());assert.ok(recovered.imageBase64);assert.equal(f.calls.filter(x=>x==='generate').length,1);
});

test('caller snapshot without consumed commissioning consent fails before allocation',async t=>{
 const f=await fixture(t),q=await f.runner.quote({definition:f.definition,input:f.input,adminId:f.admin.id});const before=f.calls.length;
 await assert.rejects(f.runner.execute({definition:f.definition,input:f.input,testId:'forged-flag',adminId:f.admin.id,quote:q}),e=>e.message==='ENGINE_TEST_AUTHORIZATION_REQUIRED'&&e.definitiveNoSpend===true);
 assert.equal(f.calls.length,before);assert.equal(f.store.all('engine-runtime').length,0);
});

for(const [name,mutate] of [
 ['changed native prompt',async({input})=>{input.request.prompt+=' unauthorized change';}],
 ['changed exact source plan',async({store,input})=>{const p=store.get('production-project',input.scope.projectId);p.plan.story+=' changed';store.put('production-project',p);}],
 ['foreign administrative owner',async({store,input})=>{const p=store.get('production-project',input.scope.projectId);p.adminCommissioning.ownerId='other-admin';store.put('production-project',p);}],
 ['cancelled consumed test',async({store,input})=>{const e=store.get('engine-test',input.scope.attemptId);e.status='cancelled';e.cloudStopped=true;store.put('engine-test',e);}],
 ['changed account credentials',async({store,input})=>{const a=store.get('account',input.definition.accountId);a.credentials=store.seal({tokenId:'ak-new-synthetic-token',tokenSecret:'as-new-synthetic-secret'},a.id);store.put('account',a);}],
 ['replacement runtime or unrelated rental',async({store,input})=>{const h=store.get('engine-runtime-history',input.runId);h.rentalId='another-rental';store.put('engine-runtime-history',h);}],
 ['revoked consumed quote',async({store,input})=>{const t=store.get('engine-test',input.scope.attemptId),q=store.get('engine-test-quote',t.quoteId);q.dispatchAvailable=false;store.put('engine-test-quote',q);}],
 ['cancelled consumed test at atomic dispatch boundary',async({store,input})=>{const tx=store.transaction.bind(store);store.transaction=async fn=>{store.transaction=tx;const t=store.get('engine-test',input.scope.attemptId);t.status='cancelled';t.cloudStopped=true;store.put('engine-test',t);return tx(fn);};}],
 ['fake administrative marker without grant',async({store,input})=>{store.delete('admin-native-authorization',input.scope.attemptId);}]
])test('real transport rejects '+name+' and stops only the allocated test without inference',async t=>{
 const f=await fixture(t,{mutate}),r=await f.run();assert.equal(r.latestTest.status,name.startsWith('cancelled consumed test')?'cancelled':'failed');assert.equal(r.latestTest.cloudStopped,true);assert.equal(f.calls.filter(x=>x==='generate').length,0);assert.equal(f.calls.filter(x=>x==='stop').length,1);assert.equal(f.getFailure(),'ENGINE_TEST_AUTHORIZATION_REQUIRED');assert.equal(f.store.all('production-charge').length,0);
});


test('canonical proofs survive JSON object key reordering without authorizing changed content',async t=>{
 const f=await fixture(t,{mutate:async({store,input})=>{input.request=Object.fromEntries(Object.entries(input.request).reverse());const p=store.get('production-project',input.scope.projectId);p.plan=Object.fromEntries(Object.entries(p.plan).reverse());store.put('production-project',p);}}),r=await f.run();assert.equal(r.workflowState,'needs_review');assert.equal(f.calls.filter(x=>x==='generate').length,1);
});

test('ordinary malformed customer attempts fail with authorization code, not an undefined SQLite bind',async t=>{
 const f=await fixture(t);await f.run();const input=f.getCaptured(),attemptId='ordinary-missing-quote';f.store.put('production-attempt',{id:attemptId,customerId:input.scope.customerId,projectId:input.scope.projectId,stageId:f.input.stageId,status:'running'});const before=f.calls.length;
 await assert.rejects(f.native.generate({...input,requestId:attemptId,scope:{...input.scope,attemptId}}),/FLUX_GENERATION_NOT_AUTHORIZED/);assert.equal(f.calls.length,before);
});
