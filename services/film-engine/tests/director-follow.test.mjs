import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';

// Real store and orchestration; only generation and OpenAI boundaries are fakes.
const good={summary:'لم تظهر كتابة بالعينات.',visibleText:'not_seen_in_samples',continuity:'no_obvious_issue_in_samples',causalOrder:'unknown',audioAssessment:'not_checked',findings:[],suggestedCorrections:[],nextVisualPrompt:'The same man in a blue shirt picks up the same small brown wallet. A smooth medium tracking shot.'};
async function fixture(t,{review=good,budget=2000000,text=true,qualityHold=false,funds=1000000}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'director-follow-')),store=new Store(folder,randomBytes(32).toString('base64'));store.installRentalSchema();
 store.put('config',{id:'openai-director',credentials:store.seal({key:'synthetic-key-not-sent-anywhere'},'openai-director')});
 const events=[],quoted=[],actor={id:'alice',email:'alice@fixture.test'};let customer,seq=0;
 const engine={store,allowPaid:true,invoke:async(route,b,scope)=>{
  events.push(route);
  if(route==='quote'){quoted.push(structuredClone(b));return {id:'quote-'+quoted.length};}
  if(route==='execute'){const id='clip-'+(++seq);store.put('job',{id,quoteId:b.quoteId,tenantId:scope.tenantId,projectId:'p',rentalId:'r',attachedEngineId:'warm',status:qualityHold?'needs_review':'completed',error:qualityHold?'GENERATION_SUCCEEDED_TEXT_REVIEW_REQUIRED':null,result:{videoVerified:true,sha256:'a'.repeat(64)}});return {id};}
  if(route.endsWith('/accept-review')){assert.equal(b.approved,true);const j=store.get('job',route.split('/')[1]);j.status='completed';store.put('job',j);return j;}
  if(route==='llm/reviews'){assert.equal(b.approvedTextCost,true);assert.equal(b.jobId,'clip-'+seq);return {status:'queued'};}
  if(route.startsWith('llm/calls/'))return review==='uncertain'?{status:'uncertain'}:{status:'completed',model:'gpt-6.1-terra',visualReview:review,evidence:{timestamps:[0,2,4,6,8,9.75]},usage:{computedUSD:.02}};
  if(route==='jobs/warm/stop')return {cloud_stopped:true};
  throw Error('UNEXPECTED_CLOUD_OPERATION');
 }};
 const platform=createFilmPlatform({engine,origin:'https://fixture.test',secret:'only-a-test-bridge-secret-at-least-32',enabled:true,textEnabled:text,textBudgetMicroUSD:budget,startWorker:false,merger:{merge:async()=>{throw Error('MERGE_UNAVAILABLE');}}});
 customer=(await platform.dispatch(actor,'session')).user.id;
 store.put('film-credit',{id:'fixture-credit',customerId:customer,amount:funds,remaining:funds,createdAt:Date.now(),expiresAt:Date.now()+86400000});
 store.put('job',{id:'warm',status:'ready',cloudStopped:false});
 store.put('rental',{id:'r',customerId:customer,accountId:'a',engineSlotId:'s',engineJobId:'warm',state:'ready',settings:{}});
 const audioContract={language:'ar',dialect:'iraqi',mode:'dialogue',lines:[{speaker:'علي',text:'هاي المحفظة إلك؟'}]};
 store.put('film-project',{id:'p',customerId:customer,name:'قصة',story:'رجل يعيد محفظة',seconds:20,orientation:'portrait',state:'planned',scenes:[{prompt:'A man in a blue shirt notices a small brown wallet.',audioContract:structuredClone(audioContract),status:'pending',attempted:false},{prompt:'The man picks up the small brown wallet.',audioContract:structuredClone(audioContract),status:'pending',attempted:false}]});
 t.after(async()=>{await platform.close();store.close();await rm(folder,{recursive:true,force:true});});
 const run=directorFollow=>platform.dispatch(actor,'project.generate',{projectId:'p',rentalId:'r',approved:true,directorFollow});
 const settled=async()=>{for(let i=0;i<60;i++){const p=store.get('film-project','p');if(p.state!=='generating')return p;await new Promise(r=>setTimeout(r,5));}throw Error('LOCAL_TEST_DID_NOT_SETTLE');};
 return {store,platform,actor,run,settled,events,quoted,audioContract};
}
test('opt-in follows each completed clip once, refines next visual only and keeps last frame and locked dialogue',async t=>{
 const f=await fixture(t);await f.run(true);const p=await f.settled();assert.equal(p.state,'completed');
 assert.equal(f.events.filter(x=>x==='execute').length,2);assert.equal(f.events.filter(x=>x==='llm/reviews').length,2);
 assert.ok(f.events.indexOf('llm/reviews')<f.events.lastIndexOf('quote'));
 assert.equal(f.quoted[1].prompt,good.nextVisualPrompt);assert.equal(f.quoted[1].previousSceneId,'scene-0');assert.deepEqual(f.quoted[1].audioContract,f.audioContract);
 assert.equal(p.scenes[1].originalPrompt,'The man picks up the small brown wallet.');assert.equal(p.visualReviews.length,2);assert.equal(p.reviewState,'completed');
 assert.equal(f.store.all('film-text-reservation').length,1);assert.equal(f.store.all('film-text-reservation')[0].reservedMicroUSD,500000);
 await assert.rejects(f.run(true),/PLAN_REQUIRED/);assert.equal(f.events.filter(x=>x==='execute').length,2);
});
for(const [name,review] of [['visible text',{...good,visibleText:'detected'}],['uncertain text',{...good,visibleText:'uncertain'}],['causal error',{...good,causalOrder:'concerns'}],['unknown request','uncertain'],['missing next prompt',{...good,nextVisualPrompt:null}],['dialogue leaked into visual prompt',{...good,nextVisualPrompt:'علي: هاي المحفظة إلك؟'}]]){
 test(name+' stops before second generation, preserves first result and requests safe engine stop',async t=>{
  const f=await fixture(t,{review});await f.run(true);const p=await f.settled();
  assert.equal(p.state,'needs_review');assert.equal(p.scenes[0].status,'done');assert.equal(p.scenes[1].attempted,false);assert.equal(p.directorFollow.failed,true);
  assert.equal(f.events.filter(x=>x==='execute').length,1);assert.equal(f.events.filter(x=>x==='llm/reviews').length,1);
  for(let i=0;i<20&&!f.events.includes('jobs/warm/stop');i++)await new Promise(r=>setTimeout(r,5));assert.ok(f.events.includes('jobs/warm/stop'));
 });
}
test('no opt-in means no OpenAI charge or rewrite; disabled text and insufficient customer credit reject before GPU submission',async t=>{
 const legacy=await fixture(t);await legacy.run(false);assert.equal((await legacy.settled()).state,'completed');assert.equal(legacy.events.includes('llm/reviews'),false);assert.equal(legacy.store.all('film-text-reservation').length,0);
 for(const options of [{funds:0},{text:false}]){const f=await fixture(t,options);await assert.rejects(f.run(true),/AI_INSUFFICIENT_CREDIT|TEXT_DISABLED/);assert.equal(f.events.length,0);assert.equal(f.store.get('film-project','p').state,'planned');}
});
test('missing encrypted key rejects before any generation, and interrupted director intent never resubmits',async t=>{
 const f=await fixture(t);f.store.delete('config','openai-director');await assert.rejects(f.run(true),/OPENAI_KEY_REQUIRED/);assert.equal(f.events.length,0);
 const p=f.store.get('film-project','p');p.reviewPending='interrupted-call';p.reviewState='running';p.state='generating';p.directorFollow={id:'follow',calls:[{index:0,id:'interrupted-call',status:'submitted'}]};f.store.put('film-project',p);
 const restarted=createFilmPlatform({engine:{store:f.store,allowPaid:false,invoke:async()=>{throw Error('NO_CLOUD_AFTER_RESTART');}},origin:'https://fixture.test',secret:'test-restart-secret-at-least-32-characters',startWorker:false});
 try{const visible=await restarted.dispatch(f.actor,'project.get',{id:'p'});assert.equal(visible.reviewState,'needs_review');assert.equal(f.store.get('film-project','p').directorFollow.failed,true);assert.equal(f.events.length,0);}finally{await restarted.close();}
});


test('OCR-held verified clip reaches director before failure; accepted same clip continues without regenerating',async t=>{
 const f=await fixture(t,{qualityHold:true});await f.run(true);const p=await f.settled();assert.equal(p.state,'completed');
 assert.equal(f.events.filter(x=>x==='execute').length,2);assert.equal(f.events.filter(x=>x==='llm/reviews').length,2);assert.equal(f.events.filter(x=>x.endsWith('/accept-review')).length,2);
 assert.equal(f.quoted[1].previousSceneId,'scene-0');assert.deepEqual(f.quoted[1].audioContract,f.audioContract);
});
