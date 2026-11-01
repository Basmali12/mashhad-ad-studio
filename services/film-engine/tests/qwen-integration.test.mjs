import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {Store,hash} from '../engine/store.mjs';
import {createFluxServices,FLUX_MANIFEST} from '../engine/flux-integration.mjs';
import {createQwenServices,QWEN_MANIFEST,createImageAdapterRouter} from '../engine/qwen-integration.mjs';
import {buildQwenRequest} from '../engine/qwen-prompt.mjs';
import {createEngineRegistry} from '../engine/engine-registry.mjs';
import {createProductionModels} from '../engine/production-models.mjs';
import {createProductionEngine} from '../engine/production-engine.mjs';
import {stagesForPlan} from '../engine/production-plan.mjs';
const actor={isAdmin:true},scope={customerId:'customer',projectId:'project',attemptId:'attempt'};
const person={id:'omar',name:'عمر',description:'رجل عراقي',age:40,face:'وجه بيضوي، شعر أسود وشارب كثيف',body:'متوسط القامة',wardrobe:'عباءة بنية',props:[{id:'watch',description:'ساعة فضية'}],referenceIds:[],angles:['front','side','three_quarter'],voice:{engineId:'habibi-irq',voiceId:'omar',locale:'ar-IQ'},relationships:[]};
function png(width,height){
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc((1+width*3)*height);for(let y=0;y<height;y++)pixels[y*(1+width*3)]=0;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

function storyboard(){return {orientation:'landscape',story:'رجل في القصر',durationMs:60000,characters:[structuredClone(person)],utterances:[],shots:['جالس داخل القصر','يقف غاضباً أمام الحراس','يمشي في ساحة القصر'].map((prompt,i)=>({id:'shot'+i,startMs:i*20000,endMs:(i+1)*20000,prompt,location:i===2?'ساحة القصر':'قاعة القصر',characterIds:['omar'],referenceIds:[],utteranceIds:[],eventIds:['event'+i],...(i===2?{characterEdits:[{characterId:'omar',wardrobe:'رداء أخضر',reason:'يستبدل العباءة استعداداً للخروج'}]}:{})}))};}
async function fixture(t,{paid=true,failAt=null}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'qwen-integration-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 const calls=[];let at=1000000,edits=0;const now=()=>at,accountId=randomUUID();store.put('account',{id:accountId,mode:'token',workspace:'synthetic',credentials:store.seal({tokenId:'ak-synthetic-only',tokenSecret:'as-synthetic-only'},accountId)});
 const makeTransport=manifest=>({inspect:async({definition:e})=>({accountId:e.accountId,volume:e.volume,weightPath:e.weightPath,revision:manifest.revision,deploymentReady:true,files:manifest.files.map(f=>({...f,verified:true}))}),start:async({definition:e,runId})=>{calls.push({kind:'start',modelId:e.modelId});return {engineId:e.id,accountId:e.accountId,runId,ready:true};},stop:async({definition:e,runId})=>{at+=1000;calls.push({kind:'stop',modelId:e.modelId});return {engineId:e.id,accountId:e.accountId,runId,cloudStopped:true,admissionClosed:true,activeTasks:0,startSettled:true};},generate:async({definition:e,scope,runId,request,onProgress})=>{calls.push({kind:'generate',modelId:e.modelId,scope,request});if(e.modelId==='qwen-image-edit-2511'&&++edits===failAt)throw Error('fixture-inference-failure');await onProgress?.({completed:40,total:40,unit:'steps'});const bytes=png(request.width,request.height);return {scope:{...scope,engineId:e.id,accountId:e.accountId,runId},modelRevision:manifest.revision,imageBase64:bytes.toString('base64'),sha256:hash(bytes)};}});
 const flux=createFluxServices({store,transport:makeTransport(FLUX_MANIFEST),allowPaid:paid,now}),qwen=createQwenServices({store,transport:makeTransport(QWEN_MANIFEST),allowPaid:paid,now});
 const registry=createEngineRegistry({store,adapter:createImageAdapterRouter([flux.registryAdapter,qwen.registryAdapter]),allowPaid:paid,now}),bindings={};
 for(const [manifest,ram,min] of [[FLUX_MANIFEST,64,24],[QWEN_MANIFEST,128,96]]){const e=await registry.dispatch(actor,'admin.engine.save',{name:manifest.modelId,modelId:manifest.modelId,version:manifest.version,accountId,gpu:'RTX-PRO-6000',cpu:4,ramGiB:ram,minVramGiB:min,hourPriceUSD:'3'});await registry.dispatch(actor,'admin.engine.inspect',{id:e.id});// Explicit local fixture publication, never a real admin action.
 const published=store.get('engine-definition',e.id);store.put('engine-definition',{...published,publication:{approved:true,tested:true,revision:published.revision}});bindings[manifest.modelId]=e.id;}
 const models=createProductionModels({store,registry,now,adapters:{'flux2-klein-4b':flux.productionAdapter,'qwen-image-edit-2511':qwen.productionAdapter}}),engine=createProductionEngine({store,models,now,allowExecution:paid,planner:{billingMode:'none',analyze:async()=>({}),plan:async()=>storyboard()}});
 store.put('film-credit',{id:'funds',customerId:'customer',amount:50000000,remaining:50000000,expiresAt:at+86400000,createdAt:at});await engine.configure(actor,{bindings});const project=await engine.create('customer',{requestId:'story',title:'القصر',story:'قصة ثلاث لقطات',durationMs:60000});await engine.plan('customer',{id:project.id});
 return {store,registry,bindings,models,engine,project,calls,qwen,flux};
}
test('Qwen structured edit requires assigned identity images, preserves wardrobe unless story changes it, and keeps settings',()=>{
 const input={scope,characters:[person],scene:{description:'يقف في القصر'},referenceIds:['face'],referenceBindings:[{assetId:'face',characterId:'omar'}],orientation:'portrait'};
 const r=buildQwenRequest(input);assert.equal(r.settings.num_inference_steps,40);assert.equal(r.settings.true_cfg_scale,4);assert.equal(r.settings.width,720);assert.match(r.prompt,/عباءة بنية/);assert.match(r.prompt,/شارب كثيف/);
 assert.throws(()=>buildQwenRequest({...input,referenceIds:[]}),/INVALID_QWEN_REQUEST/);assert.throws(()=>buildQwenRequest({...input,referenceBindings:[]}),/QWEN_IDENTITY_REFERENCE_REQUIRED/);
 assert.throws(()=>buildQwenRequest({...input,scene:{description:'x',characterEdits:[{characterId:'omar',wardrobe:'بدلة'}]}}),/QWEN_UNAUTHORIZED_IDENTITY_EDIT/);
 const two=buildQwenRequest({...input,characters:[person,{...person,id:'zainab',name:'زينب'}],referenceIds:['face','face2'],referenceBindings:[{assetId:'face',characterId:'omar'},{assetId:'face2',characterId:'zainab'}]});assert.equal(two.mode,'multi_reference');assert.match(two.prompt,/exactly 2/);assert.match(two.prompt,/image\(s\) 2/);
});

test('explicit empty reference scene does not instruct Qwen to copy the referenced person',()=>{
 const r=buildQwenRequest({scope,characters:[],scene:{description:'The same empty room with no person present.'},referenceIds:['room'],referenceBindings:[{assetId:'room',characterId:null}],orientation:'portrait'});
 assert.match(r.prompt,/empty setting with no person present/);assert.doesNotMatch(r.prompt,/Show exactly the referenced/);
});
test('story DAG uses FLUX once for identity and Qwen for angles and ordered scene events',()=>{
 const stages=stagesForPlan(storyboard(),{referenceConditioningModelId:'flux2-klein-4b',imageEditModelId:'qwen-image-edit-2511'});assert.equal(stages.find(s=>s.id==='character_image:omar:0').modelId,'flux2-klein-4b');
 for(const s of stages.filter(s=>s.kind==='scene_image'||s.kind==='character_image'&&s.angleIndex>0))assert.equal(s.modelId,'qwen-image-edit-2511');assert.ok(stages.find(s=>s.id==='character_image:omar:1').deps.includes('character_image:omar:0'));assert.deepEqual(stages.filter(s=>s.kind==='scene_image').map(s=>s.subjectId),['shot0','shot1','shot2']);
});
test('approved image phase saves FLUX identity and Qwen edits once with lineage, private originals and Wan review gate',async t=>{
 const f=await fixture(t),p=f.project,q=await f.engine.quote('customer',{id:p.id,phase:'images'});assert.equal(q.dispatchAvailable,true);assert.equal(f.calls.length,0);
 await assert.rejects(f.engine.approve('customer',{id:p.id,quoteId:q.id,requestId:'no'}),/PRODUCTION_APPROVAL_REQUIRED/);assert.equal(f.calls.length,0);
 await f.engine.approve('customer',{id:p.id,quoteId:q.id,requestId:'yes',approved:true});const result=await f.engine.run('customer',p.id);assert.equal(result.state,'planned');assert.deepEqual(result.completedPhases,['images']);
 const jobs=f.calls.filter(c=>c.kind==='generate');assert.equal(jobs.length,6);assert.equal(jobs[0].modelId,'flux2-klein-4b');assert.ok(jobs.slice(1).every(c=>c.modelId==='qwen-image-edit-2511'&&c.request.reference_images.length));
 const primary=f.store.all('production-asset').find(a=>a.characterId==='omar'&&a.angle==='front');assert.ok(primary);for(const j of jobs.slice(1))assert.ok(j.request.reference_images.some(r=>r.assetId===primary.id));
 const records=f.store.all('qwen-image-request');assert.equal(records.length,5);assert.ok(records.every(r=>r.modelRevision===QWEN_MANIFEST.revision));assert.deepEqual(records.filter(r=>r.shotId).map(r=>r.shotId),['shot0','shot1','shot2']);assert.match(records.find(r=>r.shotId==='shot2').prompt,/رداء أخضر/);
 const plan=structuredClone(f.store.get('production-project',p.id).plan),secondary=f.store.all('production-asset').find(a=>a.characterId==='omar'&&a.angle==='side');plan.shots[0].referenceIds=[secondary.id];const multi=await f.qwen.productionAdapter.requestFor({scope:{customerId:'customer',projectId:p.id,attemptId:'inspect-only'},stage:{kind:'scene_image',subjectId:'shot0'},plan,inputs:[{stageId:'character_image:omar:0',result:{assetIds:[primary.id]}}]});assert.equal(multi.references.length,2);assert.equal(multi.request.mode,'multi_reference');assert.deepEqual(multi.references.map(r=>r.assetId),[primary.id,secondary.id]);
 const saved=f.store.all('production-asset').find(a=>a.shotId==='shot2');await assert.rejects(f.qwen.images.read({customerId:'other',projectId:p.id,assetId:saved.id}),/NOT_FOUND/);await assert.rejects(f.qwen.quality.getAnimationInput({customerId:'customer',projectId:p.id,assetId:saved.id}),/REVIEW|QUALITY|APPROV/);
 assert.ok(f.store.all('production-charge').every(c=>c.state==='settled'));const count=f.calls.length;await f.engine.run('customer',p.id);assert.equal(f.calls.length,count);assert.equal(result.stages.find(s=>s.id==='animate:shot0').state,'planned');
});
test('one failed edit preserves previous successful images and does not retry paid inference automatically',async t=>{
 const f=await fixture(t,{failAt:2}),q=await f.engine.quote('customer',{id:f.project.id,phase:'images'});await f.engine.approve('customer',{id:f.project.id,quoteId:q.id,requestId:'approve',approved:true});const result=await f.engine.run('customer',f.project.id);assert.equal(result.state,'failed');assert.equal(f.calls.filter(c=>c.kind==='generate').length,3);assert.equal(f.store.all('production-asset').length,2);const count=f.calls.length;await f.engine.run('customer',f.project.id);assert.equal(f.calls.length,count);assert.equal(f.store.all('qwen-image-request').filter(r=>r.state==='completed').length,1);
});
test('installed Qwen is not permission to execute, and its resource/profile/account namespace is separate',async t=>{
 const f=await fixture(t,{paid:false}),e=await f.registry.dispatch(actor,'admin.engine.status',{id:f.bindings['qwen-image-edit-2511']});assert.equal(e.softwareInstalled,true);assert.equal(e.expectedBytes,QWEN_MANIFEST.totalBytes);assert.ok(e.blockers.includes('PAID_DISABLED'));assert.equal(f.calls.length,0);const q=await f.engine.quote('customer',{id:f.project.id,phase:'images'});assert.equal(q.dispatchAvailable,false);await assert.rejects(f.registry.dispatch({isAdmin:false},'admin.engine.list'),/FORBIDDEN/);assert.notEqual(f.bindings['qwen-image-edit-2511'],f.bindings['flux2-klein-4b']);
});
