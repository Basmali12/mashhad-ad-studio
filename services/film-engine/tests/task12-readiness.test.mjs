import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {performance} from 'node:perf_hooks';
import {Store,hash} from '../engine/store.mjs';
import {createProductionEngine} from '../engine/production-engine.mjs';

function story(durationMs){
 const count=durationMs/10000,split=Math.floor(count/2)*10000;
 return {id:'readiness',story:'قصة عراقية متصلة',durationMs,
 characters:[{id:'salim',name:'سالم',description:'طبيب في الحاضر',age:40,face:'وجه بيضوي وشعر أسود',body:'متوسط القامة',wardrobe:'قميص أزرق',props:[{id:'wallet',description:'محفظة بنية صغيرة'}],referenceIds:[],angles:['front'],voice:{engineId:'habibi-irq',voiceId:'salim-fixed',locale:'ar-IQ'},relationships:[]}],
 chapters:[{id:'chapter-a',title:'البداية',startMs:0,endMs:split},{id:'chapter-b',title:'النهاية',startMs:split,endMs:durationMs}],
 scenes:[{id:'scene-a',chapterId:'chapter-a',description:'مكتب حديث',startMs:0,endMs:split},{id:'scene-b',chapterId:'chapter-b',description:'شارع حديث',startMs:split,endMs:durationMs}],
 utterances:[{id:'line',characterId:'salim',text:'هلا بيك، خلينا نساعد الجيران.',startMs:0,endMs:10000}],
 shots:Array.from({length:count},(_,i)=>({id:'shot-'+i,startMs:i*10000,endMs:(i+1)*10000,prompt:'حدث جديد متسلسل رقم '+i,characterIds:['salim'],propIds:['wallet'],referenceIds:[],utteranceIds:i===0?['line']:[],eventIds:['event-'+i]}))};
}
async function fixture(t,{durationMs=30000,cinematicSync=false,enabled=true}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'task12-readiness-')),store=new Store(folder,randomBytes(32).toString('base64'));
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 let now=1000000,failure=null,ambiguous=false;const calls=[],counts=new Map();
 store.put('film-credit',{id:'credit',customerId:'alice',amount:10000000,remaining:10000000,createdAt:now,expiresAt:now+30*86400000});
 const models={finalComposer:true,cinematicSync,quote:async()=>({available:true,estimatedMicroUSD:100,blockers:[],snapshot:'mock-task12'}),execute:async(s,p,{attempt,onProgress,dependencies})=>{
  calls.push(s.stageId);counts.set(s.stageId,(counts.get(s.stageId)??0)+1);
  for(const dep of dependencies)assert.ok(store.get('production-stage',hash(p.id+':'+dep.stageId))?.state==='completed','dependency was durably completed before dispatch');
  await onProgress({completed:1,total:1,unit:'items'});
  if(failure===s.stageId)throw Object.assign(Error('private-fixture-provider-detail'),{definitiveNoSpend:!ambiguous,cloudStopped:!ambiguous});
  const assetId=randomUUID();store.put('production-asset',{id:assetId,customerId:p.customerId,projectId:p.id,kind:s.kind==='voice'?'audio':'video',durationMs:p.durationMs,sha256:'a'.repeat(64)});
  return {customerId:p.customerId,projectId:p.id,attemptId:attempt.id,cloudStopped:true,actualMicroUSD:s.kind==='save'?0:80,definitiveNoSpend:s.kind==='save',result:{assetIds:s.kind==='save'?[]:[assetId]}};
 },readAsset:async()=>Buffer.from('mock task12 final bytes')};
 const artifacts={commitFinal:async({projectId,customerId})=>{const result={artifactId:'mock-final',durationMs,bytes:23,sha256:'f'.repeat(64)};store.put('production-result',{id:projectId,projectId,customerId,...result});return result;}};
 const options={store,models,artifacts,planner:{billingMode:'none',analyze:async()=>({events:['start','finish']}),plan:async()=>story(durationMs)},now:()=>now,allowExecution:enabled};
 let engine=createProductionEngine(options);const p=await engine.create('alice',{requestId:'create',title:'جاهزية الفيلم',story:'قصة عراقية متصلة وأحداث مرتبة',durationMs});
 const plan=()=>engine.plan('alice',{id:p.id});
 const approve=async()=>{await plan();const quote=await engine.quote('alice',{id:p.id});await engine.approve('alice',{id:p.id,quoteId:quote.id,requestId:randomUUID(),approved:true});return quote;};
 return {store,p,models,calls,counts,plan,approve,get engine(){return engine;},restart(){engine.close();engine=createProductionEngine(options);now+=1000;return engine;},setFailure(id,unknown=false){failure=id;ambiguous=unknown;}};
}

for(const seconds of [30,60,300,600,1200,3600])test(`Task12 actual Mock DAG ${seconds}s: checkpoint/restart, identity, chronology, final-only completion`,async t=>{
 const start=performance.now(),f=await fixture(t,{durationMs:seconds*1000,cinematicSync:seconds===60||seconds===1200}),balance=f.store.get('film-credit','credit').remaining;
 const planned=await f.plan();assert.equal(f.calls.length,0);assert.equal(f.store.get('film-credit','credit').remaining,balance);assert.equal(planned.timeline.shots.length,seconds/10);
 const shots=planned.timeline.shots;assert.equal(new Set(shots.flatMap(s=>s.eventIds)).size,shots.length);for(let i=0;i<shots.length;i++){assert.equal(shots[i].startMs,i*10000);assert.equal(shots[i].endMs,(i+1)*10000);assert.deepEqual(shots[i].characterIds,['salim']);}
 const ids=planned.stages.map(s=>s.id);assert.equal(new Set(ids).size,ids.length);assert.equal(planned.characters[0].voice.voiceId,'salim-fixed');assert.equal(planned.timeline.utterances[0].text,'هلا بيك، خلينا نساعد الجيران.');
 const q=await f.engine.quote('alice',{id:f.p.id});assert.equal(f.store.get('film-credit','credit').remaining,balance);assert.equal(f.store.all('production-charge').length,0);
 const approval={id:f.p.id,quoteId:q.id,requestId:'approval',approved:true};await Promise.all([f.engine.approve('alice',approval),f.engine.approve('alice',approval)]);assert.equal(f.calls.length,0);assert.equal(f.store.get('film-credit','credit').remaining,balance);
 const partial=await f.engine.run('alice',f.p.id,{maxStages:5}),completed=partial.stages.filter(s=>s.state==='completed').map(s=>s.id);assert.equal(partial.state,'queued');assert.equal(f.store.all('production-result').length,0);
 const resumed=f.restart(),done=await resumed.run('alice',f.p.id);assert.equal(done.state,'completed');assert.equal(done.result.durationMs,seconds*1000);assert.ok(done.stages.every(s=>s.state==='completed'));
 for(const id of completed.filter(id=>!['analyze','plan'].includes(id)))assert.equal(f.counts.get(id),1);assert.equal(new Set(f.calls).size,f.calls.length);assert.equal(f.counts.get('voice:line'),1);assert.equal(f.counts.get('quality'),1);assert.equal(f.counts.get('chapter_merge:chapter-a'),1);assert.equal(f.counts.get('chapter_merge:chapter-b'),1);
 const calls=f.calls.length,charges=f.store.all('production-charge').length;await resumed.run('alice',f.p.id);assert.equal(f.calls.length,calls);assert.equal(f.store.all('production-charge').length,charges);assert.equal(f.store.all('production-result').length,1);assert.ok(f.store.all('production-charge').every(c=>c.state==='settled'));assert.ok(f.store.get('film-credit','credit').remaining<balance);
 if(f.models.cinematicSync){assert.equal(f.counts.get('align:line'),1);assert.equal(f.counts.get('timeline_sync'),1);}
 t.diagnostic(JSON.stringify({filmSeconds:seconds,shots:shots.length,stages:done.stages.length,attemptRows:f.store.all('production-attempt').length,chargeRows:charges,elapsedMs:Math.round(performance.now()-start),heapGuarantee:false}));
});

test('Task12 failure in second chapter preserves completed first chapter across approved resume',async t=>{const f=await fixture(t,{durationMs:60000});await f.approve();f.setFailure('animate:shot-4');const stopped=await f.engine.run('alice',f.p.id);assert.equal(stopped.state,'failed');assert.equal(stopped.stages.find(s=>s.id==='chapter_merge:chapter-a').state,'completed');const saved=f.calls.slice();const quote=await f.engine.quote('alice',{id:f.p.id});await f.engine.retry('alice',{id:f.p.id,stageId:'animate:shot-4',quoteId:quote.id,requestId:'retry',approved:true});f.setFailure(null);const done=await f.restart().run('alice',f.p.id);assert.equal(done.state,'completed');for(const id of saved.filter(id=>id!=='animate:shot-4'))assert.equal(f.counts.get(id),1);assert.equal(f.counts.get('animate:shot-4'),2);});
test('Task12 unknown spend/stop state retains hold and cannot auto-resubmit on restart or retry',async t=>{const f=await fixture(t);await f.approve();f.setFailure('animate:shot-0',true);const stopped=await f.engine.run('alice',f.p.id);assert.equal(stopped.error,'PRODUCTION_STATE_UNKNOWN');const n=f.calls.length,charge=f.store.all('production-charge').find(c=>c.state==='uncertain');assert.ok(charge);const restarted=f.restart();await restarted.recover({localProcessStoppedConfirmed:true});assert.equal(f.calls.length,n);const quote=await restarted.quote('alice',{id:f.p.id});await assert.rejects(restarted.retry('alice',{id:f.p.id,stageId:'animate:shot-0',quoteId:quote.id,requestId:'unsafe',approved:true}),/RETRY_UNSAFE/);assert.equal(f.store.get('production-charge',charge.id).state,'uncertain');assert.equal(f.store.all('production-result').length,0);});
test('Task12 cross-user, missing approval, feature closure and lost funds never dispatch a Mock stage',async t=>{const f=await fixture(t,{enabled:false});await f.plan();await assert.rejects(f.engine.get('bob',f.p.id),/NOT_FOUND/);const q=await f.engine.quote('alice',{id:f.p.id});await assert.rejects(f.engine.approve('alice',{id:f.p.id,quoteId:q.id,requestId:'no'}),/APPROVAL_REQUIRED/);await assert.rejects(f.engine.approve('alice',{id:f.p.id,quoteId:q.id,requestId:'closed',approved:true}),/EXECUTION_DISABLED/);assert.equal(f.calls.length,0);const g=await fixture(t);await g.approve();g.store.put('film-credit',{...g.store.get('film-credit','credit'),remaining:0});const result=await g.engine.run('alice',g.p.id);assert.equal(result.error,'PRODUCTION_INSUFFICIENT_CREDIT');assert.equal(g.calls.length,0);assert.equal(g.store.all('production-charge').length,0);});
