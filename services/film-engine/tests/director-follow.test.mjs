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
async function fixture(t,{review=good,budget=2000000,text=true,qualityHold=false,funds=1000000,failAt=0,clips=2}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'director-follow-')),store=new Store(folder,randomBytes(32).toString('base64'));store.installRentalSchema();
 store.put('config',{id:'openai-director',credentials:store.seal({key:'synthetic-key-not-sent-anywhere'},'openai-director')});
 const events=[],quoted=[],actor={id:'alice',email:'alice@fixture.test'};let customer,seq=0;
 const engine={store,allowPaid:true,invoke:async(route,b,scope)=>{
  events.push(route);
  if(route==='quote'){quoted.push(structuredClone(b));return {id:'quote-'+quoted.length};}
  if(route==='execute'){const id='clip-'+(++seq);store.put('job',{id,quoteId:b.quoteId,tenantId:scope.tenantId,projectId:'p',rentalId:'r',attachedEngineId:'warm',status:seq===failAt?'failed':'completed',error:seq===failAt?'REAL_GENERATION_FAILURE':null,result:{videoVerified:seq!==failAt,sha256:'a'.repeat(64)}});return {id};}
  if(route.endsWith('/accept-review')){assert.equal(b.approved,true);const j=store.get('job',route.split('/')[1]);j.status='completed';store.put('job',j);return j;}
  if(route==='llm/reviews'){assert.equal(b.approvedTextCost,true);assert.equal(b.jobId,'clip-'+seq);return {status:'queued'};}
  if(route.startsWith('llm/calls/'))return review==='uncertain'?{status:'uncertain'}:{status:'completed',model:'gpt-6.1-terra',visualReview:review,evidence:{timestamps:[0,2,4,6,8,9.75]},usage:{computedUSD:.02}};
  if(route==='jobs/warm/stop')return {cloud_stopped:true};
  throw Error('UNEXPECTED_CLOUD_OPERATION');
 }};
 const platform=createFilmPlatform({engine,origin:'https://fixture.test',secret:'only-a-test-bridge-secret-at-least-32',enabled:true,textEnabled:text,textBudgetMicroUSD:budget,startWorker:false,merger:{merge:async()=>({sha256:'final-fixture',duration:20,nativeAudio:true})}});
 customer=(await platform.dispatch(actor,'session')).user.id;
 store.put('film-credit',{id:'fixture-credit',customerId:customer,amount:funds,remaining:funds,createdAt:Date.now(),expiresAt:Date.now()+86400000});
 store.put('job',{id:'warm',status:'ready',cloudStopped:false});
 store.put('rental',{id:'r',customerId:customer,accountId:'a',engineSlotId:'s',engineJobId:'warm',state:'ready',settings:{}});
 const audioContract={language:'ar',dialect:'iraqi',mode:'dialogue',lines:[{speaker:'علي',text:'هاي المحفظة إلك؟'}]};
 store.put('film-project',{id:'p',customerId:customer,name:'قصة',story:'رجل يعيد محفظة',seconds:20,orientation:'portrait',state:'planned',scenes:[{prompt:'A man in a blue shirt notices a small brown wallet.',audioContract:structuredClone(audioContract),status:'pending',attempted:false},{prompt:'The man picks up the small brown wallet.',audioContract:structuredClone(audioContract),status:'pending',attempted:false}]});
 t.after(async()=>{await platform.close();store.close();await rm(folder,{recursive:true,force:true});});
 if(clips===3){const p=store.get('film-project','p');p.seconds=30;p.scenes.push({prompt:'The elderly owner receives the small brown wallet and thanks the man.',audioContract:structuredClone(audioContract),status:'pending',attempted:false});store.put('film-project',p);}
 const run=directorFollow=>platform.dispatch(actor,'project.generate',{projectId:'p',rentalId:'r',approved:true,directorFollow});
 const settled=async()=>{for(let i=0;i<60;i++){const p=store.get('film-project','p');if(p.state!=='generating')return p;await new Promise(r=>setTimeout(r,5));}throw Error('LOCAL_TEST_DID_NOT_SETTLE');};
 return {store,platform,actor,run,settled,events,quoted,audioContract};
}
test('customer completes all clips and merge without any paid review or visual rewrite',async t=>{
 const f=await fixture(t,{review:{...good,visibleText:'detected',causalOrder:'concerns'}});await f.run(true);const p=await f.settled();
 assert.equal(p.state,'completed');assert.equal(p.merge.status,'completed');
 assert.equal(f.events.filter(x=>x==='execute').length,2);assert.equal(f.events.some(x=>x.startsWith('llm/')),false);
 assert.equal(f.quoted[1].prompt,'The man picks up the small brown wallet.');assert.equal(f.quoted[1].previousSceneId,'scene-0');assert.deepEqual(f.quoted[1].audioContract,f.audioContract);
 assert.equal(f.store.all('film-text-reservation').length,0);
 await assert.rejects(f.run(true),/PLAN_REQUIRED/);assert.equal(f.events.filter(x=>x==='execute').length,2);
});
test('already planned production needs no review key, text service or review wallet reserve',async t=>{
 const f=await fixture(t,{text:false,funds:0});f.store.delete('config','openai-director');await f.run(true);
 assert.equal((await f.settled()).merge.status,'completed');assert.equal(f.events.some(x=>x.startsWith('llm/')),false);
});
test('real generation failure still stops without generating next clip or repeating successful output',async t=>{
 const f=await fixture(t,{failAt:2});await f.run(true);const p=await f.settled();
 assert.equal(p.state,'needs_review');assert.equal(p.scenes[0].status,'done');assert.notEqual(p.merge?.status,'completed');
 assert.equal(f.events.filter(x=>x==='execute').length,2);assert.equal(f.events.some(x=>x.startsWith('llm/')),false);
 for(let i=0;i<20&&!f.events.includes('jobs/warm/stop');i++)await new Promise(r=>setTimeout(r,5));assert.ok(f.events.includes('jobs/warm/stop'));
});

test('one approved thirty-second film advances through three distinct scenes and merges once without reviews',async t=>{
 const f=await fixture(t,{clips:3});await f.run(true);const p=await f.settled();
 assert.equal(p.seconds,30);assert.equal(p.state,'completed');assert.equal(p.merge.status,'completed');
 assert.equal(f.events.filter(x=>x==='execute').length,3);assert.equal(f.events.some(x=>x.startsWith('llm/')),false);
 assert.equal(f.quoted[2].previousSceneId,'scene-1');assert.ok(f.quoted[2].prompt.includes('elderly owner'));
 assert.equal(p.scenes.every(s=>s.status==='done'),true);
});
