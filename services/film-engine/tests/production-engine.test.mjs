import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createProductionBilling} from '../engine/production-billing.mjs';
import {createProductionEngine} from '../engine/production-engine.mjs';
import {createProductionModels} from '../engine/production-models.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';

function storyboard(durationMs){
 const count=durationMs/10000,half=durationMs/2;
 return {id:'storyboard',story:'قصة عراقية',durationMs,characters:[{id:'zainab',name:'زينب',description:'طبيبة تساعد جارتها',age:30,face:'وجه بيضوي وشعر أسود',body:'متوسطة القامة',wardrobe:'معطف أزرق',props:[{id:'book',description:'دفتر صغير أحمر'}],referenceIds:[],angles:['front','side'],voice:{engineId:'habibi-irq',voiceId:'zainab-fixed',locale:'ar-IQ'},relationships:[]}],
 chapters:[{id:'first',title:'البداية',startMs:0,endMs:half},{id:'second',title:'الحل',startMs:half,endMs:durationMs}],
 scenes:[{id:'street',chapterId:'first',description:'في الشارع الحالي',startMs:0,endMs:half},{id:'home',chapterId:'second',description:'في بيت الجارة',startMs:half,endMs:durationMs}],
 utterances:[{id:'opening',characterId:'zainab',text:'خلينا نساعد بعض ونلقى الحل.',startMs:0,endMs:20000}],
 shots:Array.from({length:count},(_,i)=>({id:'shot'+i,startMs:i*10000,endMs:(i+1)*10000,prompt:'تتقدم الطبيبة في الحدث '+i,characterIds:['zainab'],propIds:['book'],referenceIds:[],utteranceIds:i<2?['opening']:[],eventIds:['event'+i]}))};
}
async function fixture(t,{durationMs=60000,enabled=true,cinematicSync=false,finalComposer=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'production-core-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 let time=1000000,failStage=null,unknown=false,review=false;const calls=[],progress=[];store.put('film-credit',{id:'credit',customerId:'customer-a',amount:10000000,remaining:10000000,createdAt:time,expiresAt:time+30*86400000});
 const planner={billingMode:'none',analyze:async()=>({characters:['zainab'],events:['help']}),plan:async()=>storyboard(durationMs)};
 const models={cinematicSync,finalComposer,quote:async s=>({estimatedMicroUSD:s.kind==='save'?0:100,available:true,blockers:[],snapshot:'fixture'}),
 execute:async(s,p,{attempt,onProgress})=>{
  calls.push(s.stageId);await onProgress({completed:1,total:2,unit:'steps'});progress.push(s.stageId);
  if(s.stageId===failStage)throw Object.assign(Error('fixture-only-provider-private'),{definitiveNoSpend:!unknown,cloudStopped:!unknown,needsReview:review});
  const assetId=randomUUID();store.put('production-asset',{id:assetId,projectId:p.id,customerId:p.customerId,kind:s.kind==='voice'?'audio':'video',sha256:'a'.repeat(64),durationMs:p.durationMs});await onProgress({completed:2,total:2,unit:'steps'});
  return {customerId:p.customerId,projectId:p.id,attemptId:attempt.id,cloudStopped:true,actualMicroUSD:s.kind==='save'?0:80,definitiveNoSpend:s.kind==='save',result:{assetIds:s.kind==='save'?[]:[assetId]}};
 },readAsset:async()=>Buffer.from('mock-final-video-only')};
 const artifacts={commitFinal:async({projectId,customerId})=>{const result={artifactId:'mock-final',sha256:'f'.repeat(64),bytes:22,durationMs};store.put('production-result',{id:projectId,customerId,projectId,...result});return result;}};
 const options={store,models,artifacts,planner,now:()=>time,allowExecution:enabled,referenceCheck:async(owner,ref)=>owner==='customer-a'&&ref==='owned-ref'};
 let engine=createProductionEngine(options);
 const p=await engine.create('customer-a',{requestId:'create-one',title:'الأمانة',story:'قصة عراقية متصلة وأحداث جديدة',durationMs});
 const prepare=async()=>{await engine.plan('customer-a',{id:p.id,requestId:'plan-one'});return engine.quote('customer-a',{id:p.id});};
 const approve=async()=>{const q=await prepare();await engine.approve('customer-a',{id:p.id,quoteId:q.id,requestId:randomUUID(),approved:true});return q;};
 return {store,p,calls,progress,models,planner,artifacts,engine,prepare,approve,setFailure:(stage,ambiguous=false,needsReview=false)=>{failStage=stage;unknown=ambiguous;review=needsReview;},advance:ms=>time+=ms,restart:()=>{engine=createProductionEngine(options);return engine;}};
}
for(const durationMs of [60000,600000])test(`mock ${durationMs/1000}s film preserves character/voice identities, chapters and partial checkpoints`,async t=>{
 const f=await fixture(t,{durationMs,finalComposer:true}),before=f.store.get('film-credit','credit').remaining,q=await f.prepare();assert.equal(q.dispatchAvailable,true);assert.equal(f.store.get('film-credit','credit').remaining,before);assert.equal(f.calls.length,0);
 await f.engine.approve('customer-a',{id:f.p.id,quoteId:q.id,requestId:'approve-once',approved:true});assert.equal(f.store.get('film-credit','credit').remaining,before);
 await f.engine.run('customer-a',f.p.id,{maxStages:5});const partial=await f.engine.get('customer-a',f.p.id);assert.equal(partial.state,'queued');const done=partial.stages.filter(s=>s.state==='completed').map(s=>s.id);
 const resumed=f.restart();f.advance(600000);const final=await resumed.run('customer-a',f.p.id);assert.equal(final.state,'completed');assert.equal(final.result.durationMs,durationMs);
 assert.equal(final.characters[0].id,'zainab');assert.equal(final.characters[0].voice.voiceId,'zainab-fixed');assert.equal(final.timeline.shots.length,durationMs/10000);assert.equal(final.timeline.chapters.length,2);
 assert.equal(f.calls.filter(x=>x==='voice:opening').length,1);for(const stage of done.filter(s=>!['analyze','plan'].includes(s)))assert.equal(f.calls.filter(x=>x===stage).length,1);
 assert.equal(new Set(f.calls).size,f.calls.length);assert.equal(f.store.all('production-charge').every(c=>c.state==='settled'),true);assert.ok(f.store.get('film-credit','credit').remaining<before);
});
test('failed stage retries with a new approved quote without rerunning successful stages',async t=>{
 const f=await fixture(t);await f.approve();f.setFailure('animate:shot1');let p=await f.engine.run('customer-a',f.p.id);assert.equal(p.state,'failed');const successes=p.stages.filter(s=>s.state==='completed').map(s=>s.id);
 assert.ok(!JSON.stringify(p).includes('fixture-only-provider-private'));const q=await f.engine.quote('customer-a',{id:p.id});
 await assert.rejects(f.engine.approve('customer-a',{id:p.id,quoteId:q.id,requestId:'bad-approve',approved:true}),/PRODUCTION_RETRY_REQUIRED/);
 await f.engine.retry('customer-a',{id:p.id,stageId:'animate:shot1',quoteId:q.id,requestId:'retry-one',approved:true});f.setFailure(null);p=await f.engine.run('customer-a',p.id);assert.equal(p.state,'completed');
 for(const s of successes.filter(s=>!['analyze','plan'].includes(s)))assert.equal(f.calls.filter(x=>x===s).length,1);assert.equal(f.calls.filter(x=>x==='animate:shot1').length,2);
});
test('unknown submission retains hold, forbids retry and restart never dispatches',async t=>{
 const f=await fixture(t);await f.approve();f.setFailure('animate:shot0',true);const p=await f.engine.run('customer-a',f.p.id);assert.equal(p.error,'PRODUCTION_STATE_UNKNOWN');const count=f.calls.length,charge=f.store.all('production-charge').find(c=>c.state==='uncertain');assert.ok(charge);const q=await f.engine.quote('customer-a',{id:p.id});
 await assert.rejects(f.engine.retry('customer-a',{id:p.id,stageId:'animate:shot0',quoteId:q.id,requestId:'unsafe-retry',approved:true}),/PRODUCTION_RETRY_UNSAFE/);await f.restart().recover();await f.restart().recover({localProcessStoppedConfirmed:true});assert.equal(f.calls.length,count);assert.equal(f.store.get('production-charge',charge.id).state,'uncertain');
});
test('customer ownership, explicit approval and closed paid switch protect shared wallet',async t=>{
 const f=await fixture(t,{enabled:false});const q=await f.prepare();assert.equal(q.dispatchAvailable,false);await assert.rejects(f.engine.get('customer-b',f.p.id),/NOT_FOUND/);await assert.rejects(f.engine.quote('customer-b',{id:f.p.id}),/NOT_FOUND/);
 await assert.rejects(f.engine.approve('customer-a',{id:f.p.id,quoteId:q.id,requestId:'none'}),/PRODUCTION_APPROVAL_REQUIRED/);await assert.rejects(f.engine.approve('customer-a',{id:f.p.id,quoteId:q.id,requestId:'disabled',approved:true}),/PRODUCTION_EXECUTION_DISABLED/);assert.equal(f.calls.length,0);assert.equal(f.store.all('film-ledger').length,0);
 await assert.rejects(f.engine.create('customer-a',{requestId:'foreign-ref',title:'x',story:'x',durationMs:60000,referenceIds:['other-ref']}),/REFERENCE_NOT_OWNED/);
});
test('default model registry has no inference fallback and planning has no real API implementation',async t=>{
 const f=await fixture(t);const models=createProductionModels({store:f.store,registry:{dispatch:()=>{throw Error('NO_PROVIDER_CALL');}}});const p=f.store.get('production-project',f.p.id);
 const q=await models.quote({kind:'animate',stageId:'animate:one',modelId:'wan22-i2v-a14b'},p);assert.equal(q.available,false);assert.equal(q.blockers[0],'PRODUCTION_ADAPTER_UNAVAILABLE');
 const e=createProductionEngine({store:f.store,models});await assert.rejects(e.plan('customer-a',{id:p.id}),/PRODUCTION_PLANNER_UNAVAILABLE/);assert.equal(f.calls.length,0);
});
test('create and approval requests are idempotent and cannot be rebound to different content',async t=>{
 const f=await fixture(t);await assert.rejects(f.engine.create('customer-a',{requestId:'create-one',title:'different',story:'other',durationMs:60000}),/IDEMPOTENCY_CONFLICT/);const q=await f.prepare(),i={id:f.p.id,quoteId:q.id,requestId:'same',approved:true};await Promise.all([f.engine.approve('customer-a',i),f.engine.approve('customer-a',i)]);await f.engine.run('customer-a',f.p.id);const count=f.calls.length;await f.engine.approve('customer-a',i);await f.engine.run('customer-a',f.p.id);assert.equal(f.calls.length,count);
});
test('closing the worker pauses at a saved stage boundary and does not admit more work',async t=>{
 const f=await fixture(t);await f.approve();const original=f.models.execute;f.models.execute=async(...args)=>{const result=await original(...args);f.engine.close();return result;};
 const p=await f.engine.run('customer-a',f.p.id);assert.equal(f.calls.length,1);assert.equal(p.state,'queued');assert.equal(p.stages.filter(s=>s.state==='completed').length,3);
});
test('cancelling an uncertain submission never claims stopped or releases its hold',async t=>{
 const f=await fixture(t);await f.approve();f.setFailure('animate:shot0',true);await f.engine.run('customer-a',f.p.id);const held=f.store.all('production-charge').find(c=>c.state==='uncertain');
 const p=await f.engine.cancel('customer-a',{id:f.p.id,approved:true});assert.equal(p.cancelRequested,true);assert.equal(p.state,'failed');assert.equal(p.stages.find(s=>s.id==='animate:shot0').state,'failed');assert.equal(f.store.get('production-charge',held.id).state,'uncertain');
});
test('invalid structured planning output is a retryable plan failure, not a cached successful plan',async t=>{
 const f=await fixture(t);let analyses=0;f.planner.analyze=async()=>{analyses++;return {};};f.planner.plan=async()=>({...storyboard(60000),shots:[]});
 await assert.rejects(f.engine.plan('customer-a',{id:f.p.id}),/PRODUCTION_PLANNING_FAILED/);const failed=await f.engine.get('customer-a',f.p.id);assert.equal(failed.stages.find(s=>s.id==='plan').state,'failed');
 f.planner.plan=async()=>storyboard(60000);const ready=await f.engine.plan('customer-a',{id:f.p.id});assert.equal(ready.state,'planned');assert.equal(analyses,1);
});
test('lost funds before admission records a failed unpaid stage and dispatches no inference',async t=>{
 const f=await fixture(t);await f.approve();const lot=f.store.get('film-credit','credit');lot.remaining=0;f.store.put('film-credit',lot);
 const p=await f.engine.run('customer-a',f.p.id);assert.equal(p.state,'failed');assert.equal(p.error,'PRODUCTION_INSUFFICIENT_CREDIT');assert.equal(f.calls.length,0);assert.equal(f.store.all('production-attempt').length,0);assert.equal(f.store.all('production-charge').length,0);
});
test('read-only reconciliation adopts a confirmed result after interruption without another generation or debit',async t=>{
 const f=await fixture(t);await f.approve();f.setFailure('animate:shot0',true);let p=await f.engine.run('customer-a',f.p.id);const count=f.calls.length,attempt=f.store.all('production-attempt').find(a=>a.status==='uncertain');
 const assetId=randomUUID();f.store.put('production-asset',{id:assetId,customerId:'customer-a',projectId:p.id,sha256:'b'.repeat(64),durationMs:10000});f.models.follow=async()=>({customerId:'customer-a',projectId:p.id,attemptId:attempt.id,cloudStopped:true,actualMicroUSD:80,result:{assetIds:[assetId]}});
 p=await f.restart().reconcile('customer-a',p.id,'animate:shot0');assert.equal(p.state,'queued');assert.equal(f.calls.length,count);assert.equal(p.stages.find(s=>s.id==='animate:shot0').state,'completed');
 f.setFailure(null);p=await f.restart().run('customer-a',p.id);assert.equal(p.state,'completed');assert.equal(f.calls.filter(x=>x==='animate:shot0').length,1);assert.equal(f.store.all('production-charge').filter(c=>c.attemptId===attempt.id).length,1);
});
test('existing authenticated platform routes new projects with server-derived ownership and no model or provider calls',async t=>{
 const f=await fixture(t),platform=createFilmPlatform({engine:{store:f.store,allowPaid:false,productionAvailable:false},origin:'https://fixture.test',secret:'isolated-production-integration-secret-32-bytes',startWorker:false});
 try{const actor={id:'real-customer',email:'fixture@example.test',isAdmin:false},p=await platform.dispatch(actor,'production.create',{requestId:'public-create',title:'فيلم',story:'قصة جديدة',durationMs:600000});assert.equal(p.durationMs,600000);
  await assert.rejects(platform.dispatch({...actor,id:'other-customer'},'production.get',{id:p.id}),/NOT_FOUND/);await assert.rejects(platform.dispatch(actor,'production.plan',{id:p.id,requestId:'planning'}),/PRODUCTION_PLANNER_UNAVAILABLE/);assert.equal(f.calls.length,0);
 }finally{await platform.close();}
});

// No provider work: durable orchestration over mock stage receipts only.
test('cinematic review is resumable through explicit approval, retains completed media and does not duplicate model stages',async t=>{
 const f=await fixture(t,{durationMs:600000,cinematicSync:true});await f.approve();f.setFailure('timeline_sync',false,true);let p=await f.engine.run('customer-a',f.p.id);assert.equal(p.state,'needs_review');assert.equal(p.error,'PRODUCTION_SYNC_NEEDS_REVIEW');assert.equal(p.stages.find(s=>s.id==='timeline_sync').state,'needs_review');const done=p.stages.filter(s=>s.state==='completed').map(s=>s.id),count=f.calls.length;await f.restart().run('customer-a',p.id);assert.equal(f.calls.length,count);const q=await f.engine.quote('customer-a',{id:p.id});await f.engine.retry('customer-a',{id:p.id,stageId:'timeline_sync',quoteId:q.id,requestId:'review-resume',approved:true});f.setFailure(null);p=await f.engine.run('customer-a',p.id);assert.equal(p.state,'completed');for(const s of done.filter(s=>!['analyze','plan'].includes(s)))assert.equal(f.calls.filter(x=>x===s).length,1);assert.equal(f.calls.filter(x=>x==='align:opening').length,1);assert.equal(f.calls.filter(x=>x==='voice:opening').length,1);
});

test('unchanged director adoption rebases verified timeline checkpoint without requeuing successful paid sync stages',async t=>{
 const f=await fixture(t,{cinematicSync:true});await f.approve();await f.engine.run('customer-a',f.p.id);const p=f.store.get('production-project',f.p.id),count=f.calls.length;f.store.put('production-cinematic-timeline',{id:p.id,customerId:p.customerId,planRevision:p.revision,timeline:{durationMs:59960,needsReview:false},assetId:'mock-timeline'});await f.engine.adoptPlan('customer-a',{id:p.id,expectedRevision:p.revision,requestId:'unchanged-revision',plan:p.plan});const updated=f.store.get('production-project',p.id),timeline=f.store.get('production-cinematic-timeline',p.id);assert.equal(timeline.planRevision,updated.revision);assert.equal(updated.measuredDurationMs,59960);assert.equal(f.calls.length,count);assert.equal((await f.engine.get('customer-a',p.id)).stages.find(s=>s.id==='align:opening').state,'completed');
});

test('confirmed local worker interruption releases only a zero-cost local hold and retries without altering unknown GPU admissions',async t=>{
 const f=await fixture(t);f.models.quote=async s=>({estimatedMicroUSD:s.modelId?100:0,available:true,blockers:[],snapshot:'fixture'});f.models.finalComposer=true;const q=await f.approve(),p=f.store.get('production-project',f.p.id),stage=f.store.get('production-stage',hash(p.id+':chapter_merge:first')),attempt={id:'interrupted-local',customerId:p.customerId,projectId:p.id,stageId:stage.stageId,quoteId:q.id,estimatedMicroUSD:0,status:'running',createdAt:1000000};f.store.put('production-attempt',attempt);const billing=createProductionBilling({store:f.store,now:()=>1000000}),charge=await billing.reserve({customerId:p.customerId,projectId:p.id,attemptId:attempt.id,quoteId:q.id,estimatedMicroUSD:0,approved:true});await billing.submitted(charge.id);attempt.chargeId=charge.id;f.store.put('production-attempt',attempt);stage.state='running';stage.attemptId=attempt.id;f.store.put('production-stage',stage);p.state='running';f.store.put('production-project',p);await f.restart().recover();assert.equal(f.store.get('production-charge',charge.id).state,'submitted');assert.equal(f.store.get('production-stage',stage.id).requiresReconcile,true);await f.restart().recover({localProcessStoppedConfirmed:true});assert.equal(f.store.get('production-charge',charge.id).state,'settled');assert.equal(f.store.get('production-charge',charge.id).amountMicroUSD,0);assert.equal(f.store.get('production-stage',stage.id).requiresReconcile,false);const retry=await f.engine.quote(p.customerId,{id:p.id});await f.engine.retry(p.customerId,{id:p.id,stageId:stage.stageId,quoteId:retry.id,requestId:'local-resume',approved:true});const done=await f.engine.run(p.customerId,p.id);assert.equal(done.state,'completed');assert.equal(f.store.all('production-charge').filter(c=>c.attemptId===attempt.id).length,1);assert.equal(f.calls.filter(id=>id==='quality').length,1);
});


test('customer production approval binds spending ceiling and rejects insufficient wallet before queueing or inference',async t=>{
 const f=await fixture(t),q=await f.prepare();assert.equal(q.canAfford,true);assert.equal(q.availableMicroUSD,10000000);const base={id:f.p.id,quoteId:q.id,requestId:'limited-customer-start',approved:true};await assert.rejects(f.engine.approve('customer-a',{...base,spendLimitMicroUSD:q.estimatedMicroUSD-1}),/SPEND_LIMIT_REQUIRED/);const credit=f.store.get('film-credit','credit');credit.remaining=0;f.store.put('film-credit',credit);await assert.rejects(f.engine.approve('customer-a',{...base,spendLimitMicroUSD:q.estimatedMicroUSD}),/INSUFFICIENT_CREDIT/);assert.equal((await f.engine.get('customer-a',f.p.id)).state,'awaiting_approval');assert.equal(f.store.all('production-charge').length,0);assert.equal(f.calls.length,0);credit.remaining=10000000;f.store.put('film-credit',credit);await f.engine.approve('customer-a',{...base,spendLimitMicroUSD:q.estimatedMicroUSD});assert.equal(f.store.get('production-quote',q.id).spendLimitMicroUSD,q.estimatedMicroUSD);await assert.rejects(f.engine.approve('customer-a',{...base,spendLimitMicroUSD:q.estimatedMicroUSD+1}),/IDEMPOTENCY_CONFLICT/);
});
