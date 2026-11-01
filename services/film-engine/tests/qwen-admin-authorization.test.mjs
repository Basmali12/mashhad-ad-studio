/* global structuredClone */
import process from 'node:process';
import {URL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {hash} from '../engine/store.mjs';
const auth=await import(process.env.QWEN_AUTHORIZATION_MODULE||'../engine/admin-inference-authorization.mjs');
const {adminRequestDigest:digest,authorizeAdministrativeInference:authorize,administrativeConsent}=auth;

function fixture(){
 const rows=new Map(),put=(entity,row)=>rows.set(entity+':'+row.id,structuredClone(row)),get=(entity,id)=>rows.get(entity+':'+id),store={get:async(e,id)=>get(e,id)};
 const adminId='admin',testId='qwen-test',runId='qwen-run',projectId='project',customerId=hash('film-customer:'+adminId),stageId='scene_image:testshot1';
 const definition={id:'qwen-engine',accountId:'primary',modelId:'qwen-image-edit-2511',revision:1,version:'2511'},account={id:'primary',workspace:'primary',credentials:'synthetic-encrypted-envelope'};
 const input={projectId,stageId},plan={story:'Keep the same original courtyard; change lighting only.'},request={mode:'edit',prompt:'Keep this scene; use warm evening light.',width:1280,height:720,seed:42,reference_images:[{assetId:'original-flux-image',mime:'image/png',sha256:hash(Buffer.from('synthetic-original')),base64:Buffer.from('synthetic-original').toString('base64')}]};
 const snapshot={projectId,stageId,nativeRequestDigest:digest(request)},binding='consumed-quote-binding',quoteId='quote',requestId='approved-command';
 const grant={id:testId,kind:'administrative-qwen-v1',testId,adminId,engineId:definition.id,accountId:definition.accountId,modelId:definition.modelId,projectId,stageId,quoteId,binding,input,snapshot,planFingerprint:digest(plan),definitionDigest:digest(definition),accountDigest:digest({id:account.id,workspace:account.workspace,credentials:account.credentials,unlinked:false}),nativeRequestDigest:digest(request),runId,revoked:false};
 put('account',account);put('engine-definition',definition);put('production-project',{id:projectId,customerId,plan,adminCommissioning:{ownerId:adminId}});
 put('production-attempt',{id:testId,customerId,projectId,stageId,status:'running',administrative:true});
 put('production-stage',{id:hash(projectId+':'+stageId),customerId,projectId,stageId,modelId:definition.modelId,attemptId:testId,state:'running'});
 put('admin-native-test',{id:testId,customerId,projectId,stageId,engineId:definition.id,accountId:account.id,adminId,runId,status:'running',snapshot});put('admin-native-authorization',grant);
 put('engine-test',{id:testId,engineId:definition.id,accountId:account.id,adminId,settingsRevision:1,status:'running',dispatched:true,binding,quoteId,input,runnerSnapshot:snapshot,createdAt:10,requestId});
 put('engine-test-quote',{id:quoteId,engineId:definition.id,accountId:account.id,adminId,settingsRevision:1,usedBy:testId,dispatchAvailable:true,binding,input,runnerSnapshot:snapshot,fingerprint:'quote-fingerprint',expiresAt:100});
 put('engine-test-command',{id:hash('engine-test:'+adminId+':'+requestId),testId,binding:digest([definition.id,quoteId])});put('engine-test-latest',{id:definition.id,testId});
 put('engine-runtime-history',{id:runId,engineId:definition.id,accountId:account.id,commandRequestId:testId});put('engine-runtime',{id:definition.id,runId,accountId:account.id,commandRequestId:testId,cloudStopped:false});put('engine-command',{id:hash('engine-start:'+testId),runtimeId:runId});
 return {rows,put,get,store,definition,input,snapshot,request,grant,adminId,testId,runId,scope:{customerId,projectId,attemptId:testId},check:()=>authorize({store,definition,scope:{customerId,projectId,attemptId:testId},runId,request,submission:true})};
}

test('Qwen dedicated grant admits exact original-image edit with consumed real administrative consent',async()=>{
 const f=fixture();await administrativeConsent(f.store,{definition:f.definition,input:f.input,testId:f.testId,adminId:f.adminId,snapshot:f.snapshot});assert.equal((await f.check()).p.id,f.scope.projectId);
 assert.equal([...f.rows.keys()].some(k=>/production-(charge|quote|model-run):|film-credit:/.test(k)),false);
});
for(const [name,mutate] of [
 ['changed reference bytes',f=>{f.request.reference_images[0].base64=Buffer.from('different').toString('base64');}],
 ['changed reference hash',f=>{f.request.reference_images[0].sha256=hash('different');}],
 ['changed reference identity',f=>{f.request.reference_images[0].assetId='another-image';}],
 ['changed native prompt',f=>{f.request.prompt+=' unapproved';}],
 ['FLUX grant reused for Qwen',f=>{f.get('admin-native-authorization',f.testId).kind='administrative-flux-v1';}],
 ['changed account credentials',f=>{f.get('account','primary').credentials='changed';}],
 ['changed model revision',f=>{f.definition.revision=2;}],
 ['other rental runtime',f=>{f.get('engine-runtime-history',f.runId).rentalId='unrelated-rental';}],
 ['unconsumed approval',f=>{f.get('engine-test-quote','quote').usedBy='different';}],
 ['changed project ownership',f=>{f.get('production-project',f.scope.projectId).adminCommissioning.ownerId='other';}],
 ['revoked proof',f=>{f.get('admin-native-authorization',f.testId).revoked=true;}],
 ['stopping runtime',f=>{f.get('engine-runtime',f.definition.id).stopRequestedAt=15;}]
])test('Qwen grant refuses '+name,async()=>{const f=fixture();mutate(f);await assert.rejects(f.check(),/ENGINE_TEST_AUTHORIZATION_REQUIRED/);});

test('Qwen request contract preserves exact reference bytes and excludes video/speech authority',()=>{
 assert.equal(typeof auth.nativeAdministrativeImageRequest,'function');
 const built={request:{mode:'edit',prompt:'Edit only light.',settings:{width:1280,height:720,seed:42}},references:[{assetId:'original',mime:'image/png',sha256:hash('original'),bytes:Buffer.from('original')}]};
 const native=auth.nativeAdministrativeImageRequest({modelId:'qwen-image-edit-2511',...built});assert.equal(native.reference_images[0].base64,Buffer.from('original').toString('base64'));
 assert.throws(()=>auth.nativeAdministrativeImageRequest({modelId:'qwen-image-edit-2511',...built,references:[]}),/ENGINE_TEST_AUTHORIZATION_REQUIRED/);
 for(const modelId of ['wan22-i2v-a14b','hunyuanvideo15','habibi-irq'])assert.equal(auth.administrativeImageGrantKind(modelId),null);
 assert.equal(auth.administrativeImageGrantKind('flux2-klein-4b'),'administrative-flux-v1');
});

test('Qwen runner snapshots and binds explicit model-specific administrative grant before native dispatch',async()=>{
 const source=await readFile(process.env.QWEN_RUNNER_SOURCE||new URL('../engine/admin-model-test-runner.mjs',import.meta.url),'utf8');
 assert.match(source,/nativeAdministrativeRequest\(\{modelId:definition\.modelId,\.\.\.built\}\)/);
 assert.match(source,/if\(administrativeGrantKind\(definition\.modelId\)\)try\{consent=await administrativeConsent/);
 assert.match(source,/kind:administrativeGrantKind\(definition\.modelId\)/);
});

// Real commissioning/registry/adapters/transport/storage; only the Python/cloud RPC is mocked.

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {Store} from '../engine/store.mjs';
import {createEngineRegistry} from '../engine/engine-registry.mjs';
import {createEngineCommissioning} from '../engine/engine-commissioning.mjs';
import {createFluxServices,FLUX_MANIFEST} from '../engine/flux-integration.mjs';
import {createQwenServices,QWEN_MANIFEST,createImageAdapterRouter} from '../engine/qwen-integration.mjs';
import {createFluxModalTransport} from '../engine/flux-modal-transport.mjs';
import {createQwenModalTransport} from '../engine/qwen-modal-transport.mjs';
import {createFluxImageAssets} from '../engine/flux-image-assets.mjs';
import {createAdminModelTestRunner} from '../engine/admin-model-test-runner.mjs';
function png(width,height){const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};const chunk=(name,data)=>{const type=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([len,type,data,sum]);};const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc((1+width*3)*height))),chunk('IEND',Buffer.alloc(0))]);}

test('actual private FLUX original  ->  Qwen commissioning  ->  real shared transport binds original bytes, preserves first stage, confirms stop and avoids customer billing',async t=>{
 const folder=await mkdtemp(path.join(tmpdir(),'qwen-admin-native-')),store=new Store(folder,randomBytes(32).toString('base64')),admin={id:'native-admin',isAdmin:true},now=()=>1000000,calls=[];
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 store.put('account',{id:'primary',mode:'token',workspace:'primary',credentials:store.seal({tokenId:'ak-synthetic',tokenSecret:'as-synthetic'},'primary')});
 const rpc=async(action,input,onEvent=async()=>{})=>{const d=input.definition,m=d.modelId==='flux2-klein-4b'?FLUX_MANIFEST:QWEN_MANIFEST,bound={engineId:d.id,accountId:d.accountId,runId:input.runId};calls.push({action,modelId:d.modelId,input});
  if(action==='inspect')return {accountId:d.accountId,volume:d.volume,weightPath:d.weightPath,revision:m.revision,ready:true,deploymentReady:true,files:m.files.map(f=>({...f,present:true,verified:true}))};
  if(action==='start'){await onEvent({kind:'function_call',functionCallId:'fc-start-'+d.id,appId:'ap-'+d.id});return {...bound,appId:'ap-'+d.id,functionCallId:'fc-start-'+d.id,ready:true,activeTasks:1,cloudStopped:false};}
  if(action==='stop')return {...bound,appId:'ap-'+d.id,activeTasks:0,cloudStopped:true,admissionClosed:true,startSettled:true};
  if(action==='generate'){await onEvent({kind:'function_call',functionCallId:'fc-image-'+d.id,appId:'ap-'+d.id});const bytes=png(input.request.width,input.request.height);return {...bound,scope:{...input.scope,...bound},modelRevision:m.revision,imageBase64:bytes.toString('base64'),sha256:hash(bytes)};}
  throw Error('UNEXPECTED_RPC');
 };
 const baseImages=createFluxImageAssets({store,now,makePreview:async()=>png(160,90)}),qwenImages=createFluxImageAssets({store,now,makePreview:async()=>png(160,90),modelProfile:{modelId:'qwen-image-edit-2511',version:QWEN_MANIFEST.version,revision:QWEN_MANIFEST.revision}});
 const flux=createFluxServices({store,now,images:baseImages,allowPaid:true,transport:createFluxModalTransport({store,runner:rpc,now,allowPaid:true})}),qwen=createQwenServices({store,now,images:qwenImages,allowPaid:true,transport:createQwenModalTransport({store,runner:rpc,now,allowPaid:true})});
 const registry=createEngineRegistry({store,adapter:createImageAdapterRouter([flux.registryAdapter,qwen.registryAdapter]),allowPaid:true,now}),defs={};
 for(const [manifest,ramGiB,minVramGiB] of [[FLUX_MANIFEST,64,24],[QWEN_MANIFEST,128,96]]){const e=await registry.dispatch(admin,'admin.engine.save',{accountId:'primary',modelId:manifest.modelId,name:'Private '+manifest.modelId,gpu:'RTX-PRO-6000',cpu:4,ramGiB,minVramGiB,hourPriceUSD:'3'});await registry.dispatch(admin,'admin.engine.inspect',{id:e.id});defs[manifest.modelId]=store.get('engine-definition',e.id);}
 const runner=createAdminModelTestRunner({store,registry,images:baseImages,adapters:{'flux2-klein-4b':flux.productionAdapter,'qwen-image-edit-2511':qwen.productionAdapter},allowPaid:true,now}),commissioning=createEngineCommissioning({store,registry,testRunner:runner,allowPaid:true,now});
 async function run(definition,input,requestId){const q=await commissioning.dispatch(admin,'admin.engine.test.quote',{id:definition.id,input});assert.equal(q.dispatchAvailable,true);const r=await commissioning.dispatch(admin,'admin.engine.test.execute',{id:definition.id,quoteId:q.id,requestId,approved:true});await commissioning.drain();return commissioning.status({id:definition.id,testId:r.latestTest.id});}
 const fd=defs['flux2-klein-4b'],qd=defs['qwen-image-edit-2511'],p=await runner.createProject({definition:fd,adminId:admin.id,input:{prompt:'A quiet contemporary courtyard.'}}),first=await run(fd,{projectId:p.projectId,stageId:p.stageId},'original-once');
 assert.equal(store.get('engine-test',first.latestTest.id).verified,true);const originalStage=structuredClone(store.get('production-stage',hash(p.projectId+':'+p.stageId))),sourceId=originalStage.result.assetIds[0];
 await runner.reviewOutput({definition:fd,input:{projectId:p.projectId,stageId:p.stageId},testId:first.latestTest.id,adminId:admin.id,accept:true});
 const source=await baseImages.loadReference({customerId:hash('film-customer:'+admin.id),projectId:p.projectId,assetId:sourceId}),stageId='scene_image:testshot1';
 store.put('production-stage',{id:hash(p.projectId+':'+stageId),customerId:hash('film-customer:'+admin.id),projectId:p.projectId,stageId,subjectId:'testshot1',kind:'scene_image',deps:[],modelId:qd.modelId,state:'planned',attempts:0});
 await runner.createProject({definition:qd,adminId:admin.id,input:{projectId:p.projectId,stageId,referenceIds:[sourceId]}});
 const result=await run(qd,{projectId:p.projectId,stageId},'edit-once');assert.equal(store.get('engine-test',result.latestTest.id).verified,true);assert.equal(result.latestTest.cloudStopped,true);
 const generated=calls.filter(c=>c.action==='generate'&&c.modelId===qd.modelId);assert.equal(generated.length,1);assert.equal(generated[0].input.referenceImagesBase64[0],source.bytes.toString('base64'));
 assert.deepEqual(store.get('production-stage',hash(p.projectId+':'+p.stageId)),originalStage);const edited=store.get('production-asset',store.get('production-stage',hash(p.projectId+':'+stageId)).result.assetIds[0]);assert.deepEqual(edited.lineage.sourceAssetIds,[sourceId]);assert.equal(store.get('admin-native-authorization',result.latestTest.id).kind,'administrative-qwen-v1');
 assert.equal(calls.filter(c=>c.action==='stop'&&c.modelId===qd.modelId).length,1);
 for(const entity of ['production-charge','production-quote','production-model-run','film-credit'])assert.equal(store.all(entity).length,0);
});
