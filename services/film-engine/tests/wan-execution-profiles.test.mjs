/* global structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import {hash} from '../engine/store.mjs';
import * as wan from '../engine/wan-integration.mjs';
import {buildWanRequest} from '../engine/wan-prompt.mjs';
import {getWanExecutionProfile,listWanExecutionProfiles,assertLightWanManifest,buildAcceleratedWanRequest,createWanComparisonPlan,LIGHTWAN_REVISION,LIGHTX2V_COMMIT} from '../engine/wan-execution-profiles.mjs';
import {modelLicenseEligibility} from '../engine/model-licenses.mjs';
import {createAcceleratedWanServices} from '../engine/wan-accelerated-integration.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../engine/wan/accelerated-manifest.json',import.meta.url),'utf8'));
const baseFactory=options=>(wan.createWanCoreServices??wan.createWanServices)(options);
function input(){
 const shot={id:'clock',sceneId:'room',startMs:0,endMs:5000,characterIds:['man'],prompt:'A reflective man in his room',location:'same room',motionPlan:{start:'A man sits by the window.',development:'The man slowly raises his gaze.',end:'His gaze remains steady.',camera:'A subtle camera dolly inward.'}};
 return {scope:{customerId:'owner',projectId:'film',attemptId:'candidate'},shot,plan:{orientation:'portrait',videoResolution:'720p',seed:42,characters:[{id:'man',name:'الرجل',face:'oval face',body:'average build',age:40,wardrobe:'charcoal shirt',props:[],referenceIds:['image-one']}],shots:[shot]},sourceAsset:{assetId:'image-one',sha256:'a'.repeat(64),approved:true,width:720,height:1280,characterIds:['man']},seed:42};
}
test('both Wan paths receive the actual scene event, setting and lighting, not metadata alone',()=>{
 const i=input();i.shot.prompt='Night interior. The man raises the telephone, hesitates, then lowers it.';i.shot.location='A simple Iraqi bedroom at night';
 const original=buildWanRequest(i),accelerated=buildAcceleratedWanRequest(i,{manifest});
 for(const r of [original,accelerated]){
  assert.ok(r.prompt.includes(i.shot.prompt));assert.ok(r.prompt.includes(i.shot.location));
  assert.ok(r.prompt.includes(i.shot.motionPlan.development));assert.ok(r.prompt.includes('continuous 5-second shot'));
 }
 assert.equal(original.prompt,accelerated.prompt);
 assert.equal(original.settings.num_inference_steps,40);assert.equal(accelerated.settings.num_inference_steps,4);
});
function fixture({paid=true,commissioned=true,missing=false}={}){
 const rows=new Map(),calls=[],store={get:(kind,id)=>rows.get(kind+':'+id),put:(kind,row)=>rows.set(kind+':'+row.id,row)},definition={id:'candidate-engine',accountId:'primary',modelId:'wan22-i2v-a14b',version:'2.2',gpu:'RTX-PRO-6000',cpu:4,ramGiB:128,minVramGiB:96,volume:'private-volume',weightPath:'models/wan22-i2v-a14b/candidate-engine'},data=input();
 const transport={executionProfile:'accelerated',modelRevision:LIGHTWAN_REVISION,sourceCommit:LIGHTX2V_COMMIT,commissioned,
  async inspect(){return {accountId:definition.accountId,volume:definition.volume,weightPath:definition.weightPath,revision:manifest.revision,deploymentReady:true,files:manifest.files.slice(missing?1:0).map(f=>({...f,verified:true}))};},
  async start(i){calls.push({action:'start',...i});return {engineId:definition.id,accountId:definition.accountId,runId:i.runId,ready:true};},
  async generate(i){calls.push({action:'generate',...i});const bytes=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');return {modelRevision:LIGHTWAN_REVISION,scope:{...i.scope,engineId:definition.id,accountId:definition.accountId,runId:i.runId},mp4Bytes:bytes,sha256:hash(bytes)};},
 };
 const quality={async getAnimationInput({customerId,projectId,assetId,characterIds,includeBytes}){if(customerId!=='owner'||projectId!=='film'||assetId!=='image-one')throw Error('NOT_FOUND');return {...data.sourceAsset,characterIds,...(includeBytes?{mime:'image/png',bytes:Buffer.from('same-owned-image')}:{})};}};
 const commits=[],videos={async commit(i){commits.push(i);return {assetId:'candidate-video'};}};
 const options={store,allowPaid:paid,quality,videos,acceleratedTransport:transport};
 const service=createAcceleratedWanServices(options,{createCoreServices:baseFactory,manifest});return {rows,store,calls,definition,data,transport,quality,videos,commits,options,service};
}
test('trusted backend enumerates Original Quality and Accelerated without changing original defaults',()=>{
 assert.deepEqual(listWanExecutionProfiles().map(p=>p.label),['Original Quality','Accelerated']);assert.equal(getWanExecutionProfile().steps,40);assert.equal(getWanExecutionProfile('accelerated').steps,4);assert.equal(getWanExecutionProfile('accelerated').precision,'nvfp4');assert.throws(()=>getWanExecutionProfile('four-step-original'),/INVALID/);assert.throws(()=>getWanExecutionProfile('toString'),/INVALID/);
 const before=listWanExecutionProfiles();before[0].steps=1;assert.equal(getWanExecutionProfile().steps,40);
});
test('accelerated manifest locks the two genuine I2V NVFP4 experts and rejects swapped T2V or modified files',()=>{
 assert.equal(assertLightWanManifest(manifest),manifest);
 for(const mutate of [m=>m.executionProfile='original-quality',m=>m.revision='0'.repeat(40),m=>m.sourceCommit='0'.repeat(40),m=>m.files.find(f=>f.sha256.startsWith('c77b')).sha256='0'.repeat(64),m=>m.files.find(f=>f.sha256.startsWith('d76b')).repoId='third-party/T2V',m=>m.files[0].path='../unsafe',m=>m.totalBytes++,m=>m.files[0].size--]){const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>assertLightWanManifest(copy));}
 const incomplete=structuredClone(manifest);incomplete.files=incomplete.files.filter(f=>f.role!=='vae_native');incomplete.totalBytes=incomplete.files.reduce((n,f)=>n+f.size,0);assert.throws(()=>assertLightWanManifest(incomplete),/NATIVE_COMPONENTS_REQUIRED/);
});
test('same image/prompt/seed/81frames720p preserve visual contract with trained four-step scheduler and distinct fingerprint',()=>{
 const i=input(),original=buildWanRequest(i),fast=buildAcceleratedWanRequest(i,{manifest});assert.equal(fast.prompt,original.prompt);assert.equal(fast.sourceAssetId,original.sourceAssetId);assert.equal(fast.sourceSHA256,original.sourceSHA256);assert.equal(fast.settings.width,original.settings.width);assert.equal(fast.settings.height,original.settings.height);assert.equal(fast.settings.num_frames,81);assert.equal(fast.settings.fps,16);assert.equal(fast.settings.seed,42);assert.equal(fast.settings.num_inference_steps,4);assert.equal(fast.settings.cfg_enabled,false);assert.equal(fast.settings.denoising_schedule,'1000-750-500-250');assert.equal(fast.settings.boundary_step_index,2);assert.notEqual(fast.fingerprint,original.fingerprint);assert.equal(original.settings.num_inference_steps,40);assert.equal(original.settings.dtype,'bfloat16');assert.equal(fast.settings.dtype,'nvfp4');
 assert.throws(()=>buildAcceleratedWanRequest({...i,plan:{...i.plan,videoResolution:'480p'}},{manifest}),/FORMAT_UNSUPPORTED/);
 assert.throws(()=>buildAcceleratedWanRequest({...i,shot:{...i.shot,endMs:1000}},{manifest}),/FORMAT_UNSUPPORTED/);
});
test('comparison plan reuses the successful baseline and creates exactly one unapproved candidate without dispatch',()=>{
 const baseline={prompt:'Exact previous prompt',imageAssetId:'image-one',imageSHA256:'a'.repeat(64),videoAssetId:'existing-original',videoSHA256:'b'.repeat(64),seed:42,width:720,height:1280,numFrames:81,fps:16},before=JSON.stringify(baseline),p=createWanComparisonPlan(baseline);assert.equal(JSON.stringify(baseline),before);assert.equal(p.baseline.generate,false);assert.equal(p.baseline.reuseExisting,true);assert.equal(p.candidate.attempts,1);assert.equal(p.candidate.automaticRetry,false);assert.equal(p.dispatchAvailable,false);assert.equal(p.approvalRequired,true);assert.equal(p.weightsReady,false);assert.equal(p.shared.prompt,baseline.prompt);assert.equal(p.shared.imageSHA256,baseline.imageSHA256);assert.equal(createWanComparisonPlan(baseline).id,p.id);assert.notEqual(createWanComparisonPlan({...baseline,prompt:'Changed'}).id,p.id);
 assert.throws(()=>createWanComparisonPlan({...baseline,videoSHA256:null}),/BASELINE_REQUIRED/);
});
test('Accelerated cannot silently inherit the original transport or an unrelated revision',()=>{
 const f=fixture();assert.throws(()=>createAcceleratedWanServices({...f.options,transport:{}},{createCoreServices:baseFactory,manifest}),/SEPARATE_TRANSPORT_REQUIRED/);assert.throws(()=>createAcceleratedWanServices({...f.options,acceleratedTransport:{...f.transport,modelRevision:wan.WAN_MANIFEST.revision}},{createCoreServices:baseFactory,manifest}),/PROFILE_MISMATCH/);assert.throws(()=>createAcceleratedWanServices({...f.options,modelProfile:{}},{createCoreServices:baseFactory,manifest}),/SEPARATE_TRANSPORT_REQUIRED/);
 const closed=createAcceleratedWanServices({...f.options,acceleratedTransport:undefined},{createCoreServices:baseFactory,manifest});assert.equal(closed.commissioned,false);assert.throws(()=>closed.productionAdapter.execute({}),/NOT_COMMISSIONED/);assert.equal(f.calls.length,0);
});
test('missing one checkpoint blocks both native start and generation without a paid call',async()=>{
 const f=fixture({missing:true}),packet={definition:f.definition,runId:'run',approved:true};await assert.rejects(f.service.transport.start(packet),/WEIGHTS_NOT_READY/);await assert.rejects(f.service.transport.generate(packet),/WEIGHTS_NOT_READY/);assert.equal(f.calls.length,0);
});
test('disabled paid switch, missing commissioning or consent, and wrong resources fail before native calls',async()=>{
 for(const change of [{paid:false},{commissioned:false},{}]){const f=fixture(change);await assert.rejects(f.service.transport.start({definition:f.definition,runId:'run',approved:change.paid===undefined&&change.commissioned===undefined?false:true}),/NOT_COMMISSIONED/);assert.equal(f.calls.length,0);}
 const f=fixture();await assert.rejects(f.service.transport.start({definition:{...f.definition,cpu:8},runId:'run',approved:true}),/RESOURCE_PROFILE_MISMATCH/);assert.equal(f.calls.length,0);
});
test('real core adapter preserves image ownership, account and output lineage in a separate request collection',async()=>{
 const f=fixture(),scope=f.data.scope,stage={kind:'animate',subjectId:'clock',stageId:'animate:clock'},inputs=[{stageId:'scene_image:clock',result:{assetIds:['image-one']}}],baseline={id:'old',state:'completed',modelId:'wan22-i2v-a14b',assetId:'original-video'};f.store.put('wan-video-request',baseline);
 const out=await f.service.productionAdapter.execute({scope,stage,plan:f.data.plan,definition:f.definition,runId:'run',inputs});assert.equal(out.result.assetIds[0],'candidate-video');assert.equal(f.calls.length,1);const called=f.calls[0];assert.equal(called.executionProfile,'accelerated');assert.equal(called.steps,4);assert.equal(called.profileFingerprint,f.commits[0].request.settings.profile_fingerprint);assert.equal(called.enableCfg,false);assert.equal(called.accelerationRevision,LIGHTWAN_REVISION);assert.equal(called.definition.accountId,'primary');assert.equal(called.request.num_frames,81);assert.equal(f.commits[0].request.revision,LIGHTWAN_REVISION);assert.equal(f.commits[0].request.settings.num_inference_steps,4);assert.equal(f.commits[0].sourceAssetId,'image-one');assert.equal(f.store.get('wan-accelerated-video-request','candidate').state,'completed');assert.deepEqual(f.store.get('wan-video-request','old'),baseline);
 await assert.rejects(f.service.productionAdapter.requestFor({scope:{...scope,customerId:'other'},stage,plan:f.data.plan,inputs}),/NOT_FOUND/);
});

test('accelerated licensing is bound to its own exact manifest without changing original eligibility',()=>{
 const result=modelLicenseEligibility(manifest.modelId,manifest);
 assert.equal(result.manifestVerified,true);assert.equal(result.commercial.allowed,true);
 assert.equal(result.checkedAt,'2026-11-01');
 const changed=structuredClone(manifest);changed.files[0].sha256='0'.repeat(64);
 assert.equal(modelLicenseEligibility(manifest.modelId,changed).commercial.allowed,false);
 assert.equal(modelLicenseEligibility(manifest.modelId,{...manifest,executionProfile:'original-quality'}).commercial.allowed,false);
 const original=JSON.parse(fs.readFileSync(new URL('../engine/wan/model-manifest.json',import.meta.url),'utf8'));
 assert.equal(modelLicenseEligibility(original.modelId,original).manifestVerified,true);
});
