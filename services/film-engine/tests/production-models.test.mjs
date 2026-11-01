import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionModels,PRODUCTION_MODEL_CONTRACTS} from '../engine/production-models.mjs';
function fixture(){
 const records=new Map(),calls=[],definition={id:'engine',modelId:'wan22-i2v-a14b',version:'pinned-version',revision:3,publication:{approved:true,tested:true,revision:3},accountId:'account'};records.set('engine-definition:engine',definition);
 const store={get:async(k,i)=>records.get(k+':'+i),put:async(k,r)=>records.set(k+':'+r.id,r)};
 const p={id:'project',customerId:'customer',revision:2,modelBindings:{'wan22-i2v-a14b':'engine'},plan:{}},s={stageId:'animate:shot',kind:'animate',modelId:'wan22-i2v-a14b'};
 let active=false;const registry={dispatch:async(actor,op,input)=>{assert.equal(actor.isAdmin,true);calls.push({op,input});if(op.endsWith('status'))return {enabled:true,adapterAvailable:true,preparationState:'ready',blockers:[],runtime:{id:'run',state:active?'running':'stopped',cloudStopped:!active}};if(op.endsWith('quote'))return {id:'quote',dispatchAvailable:true,settingsRevision:3};if(op.endsWith('start')){active=true;return {runtime:{id:'run',state:'running',cloudStopped:false}};}if(op.endsWith('stop'))return {runtime:{id:'run',state:'stopped',cloudStopped:true}};throw Error('NO_NETWORK');}};
 const adapter={version:'adapter-1',estimate:async()=>({estimatedMicroUSD:100}),execute:async({scope})=>({...scope,engineId:'engine',accountId:'account',runId:'run',billingScope:'all_resources',actualMicroUSD:90,result:{assetIds:['video-asset']}})};
 const model=createProductionModels({store,registry,adapters:{'wan22-i2v-a14b':adapter}}),context=async()=>({attempt:{id:'attempt'},priced:await model.quote(s,p),dependencies:[],onProgress:()=>{}});
 return {records,calls,definition,store,registry,p,s,adapter,model,context};
}
test('fixed inference contracts separate image, image edit, video and locale-specific audio',()=>{assert.equal(Object.keys(PRODUCTION_MODEL_CONTRACTS).length,9);assert.equal(PRODUCTION_MODEL_CONTRACTS['qwen-image-edit-2511'].output,'image');assert.equal(PRODUCTION_MODEL_CONTRACTS['habibi-irq'].output,'audio');assert.equal(PRODUCTION_MODEL_CONTRACTS['wan22-i2v-a14b'].output,'video');});
test('model dispatch binds definition/version and results to tenant/project/attempt/account/run',async()=>{
 const f=fixture(),context=await f.context();assert.equal(f.calls.some(c=>c.op.endsWith('start')),false);const r=await f.model.execute(f.s,f.p,context);assert.equal(r.actualMicroUSD,90);assert.equal(r.cloudStopped,true);assert.equal(f.calls.filter(c=>c.op.endsWith('start')).length,1);assert.equal(f.calls.find(c=>c.op.endsWith('stop')).input.expectedRunId,'run');
});
test('changed settings or unavailable model cannot infer or silently fallback',async()=>{const f=fixture(),context=await f.context();f.definition.revision++;await assert.rejects(f.model.execute(f.s,f.p,context),/PRODUCTION_MODEL_NOT_PUBLISHED/);assert.equal(f.calls.some(c=>c.op.endsWith('start')),false);});
test('failed inference after GPU admission is never marked free, even when adapter claims no inference spend',async()=>{
 const f=fixture(),context=await f.context();f.adapter.execute=async()=>{throw Object.assign(Error('private-provider-detail'),{definitiveNoSpend:true});};await assert.rejects(f.model.execute(f.s,f.p,context),e=>e.message==='PRODUCTION_STAGE_FAILED'&&e.definitiveNoSpend===false&&e.cloudStopped===true);assert.equal(f.calls.find(c=>c.op.endsWith('stop')).input.expectedRunId,'run');
});
test('foreign receipt or model-only accounting remains uncertain rather than a completed paid result',async()=>{
 for(const change of [{customerId:'foreign'},{runId:'other'},{billingScope:'inference_only'}]){const f=fixture(),context=await f.context(),original=f.adapter.execute;f.adapter.execute=async input=>({...await original(input),...change});await assert.rejects(f.model.execute(f.s,f.p,context),e=>e.definitiveNoSpend===false);}
});
test('cancellation addresses persisted attempt runtime, not whichever run happens to be current later',async()=>{const f=fixture();f.records.set('production-model-run:attempt',{id:'attempt',customerId:'customer',projectId:'project',engineId:'engine',runId:'original-run'});await f.model.cancel(f.s,f.p,{attempt:{id:'attempt',customerId:'customer',projectId:'project'}});assert.equal(f.calls.at(-1).input.expectedRunId,'original-run');await assert.rejects(f.model.cancel(f.s,f.p,{attempt:{id:'attempt',customerId:'other',projectId:'project'}}),/NOT_FOUND/);});
test('waitReady cannot adopt or stop another runtime that replaced the originally admitted run',async()=>{
 const f=fixture(),context=await f.context(),original=f.registry.dispatch;let inferred=false;
 f.registry.dispatch=async(actor,op,input)=>{const result=await original(actor,op,input);if(op.endsWith('start'))return {runtime:{id:'owned-run',state:'starting',cloudStopped:false}};if(op.endsWith('status'))return {...result,runtime:{id:'replacement-run',state:'running',cloudStopped:false}};return result;};f.adapter.waitReady=async()=>{};f.adapter.execute=async()=>{inferred=true;};
 await assert.rejects(f.model.execute(f.s,f.p,context),/PRODUCTION_STAGE_FAILED/);assert.equal(inferred,false);const stops=f.calls.filter(c=>c.op.endsWith('stop'));assert.ok(stops.length);assert.ok(stops.every(c=>c.input.expectedRunId==='owned-run'));
});


test('prepared model without current tested publication cannot quote or execute for customers',async()=>{const f=fixture();delete f.definition.publication;const q=await f.model.quote(f.s,f.p);assert.equal(q.available,false);assert.deepEqual(q.blockers,['PRODUCTION_MODEL_NOT_PUBLISHED']);await assert.rejects(f.model.execute(f.s,f.p,{attempt:{id:'attempt'},priced:q,dependencies:[]}),/PRODUCTION_MODEL_NOT_PUBLISHED/);assert.equal(f.calls.some(c=>c.op.endsWith('start')),false);});

test("an already occupied engine cannot quote another paid production or bypass its current rental",async()=>{const f=fixture(),original=f.registry.dispatch;f.registry.dispatch=async(a,o,i)=>o.endsWith("status")?{enabled:true,adapterAvailable:true,preparationState:"ready",blockers:[],runtime:{state:"running",cloudStopped:false}}:original(a,o,i);const q=await f.model.quote(f.s,f.p);assert.equal(q.available,false);assert.deepEqual(q.blockers,["PRODUCTION_MODEL_BUSY"]);assert.equal(f.calls.some(c=>c.op.endsWith("start")),false);});
