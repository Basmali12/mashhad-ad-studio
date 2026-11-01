import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {available,CREDIT_LIFETIME} from '../engine/film-money.mjs';
import {createProductionBilling} from '../engine/production-billing.mjs';

async function fixture(t,balance=1000000) {
 const folder=await mkdtemp(path.join(tmpdir(),'production-billing-')),key=randomBytes(32).toString('base64');let at=1000000,store=new Store(folder,key);
 const f={get store(){return store;},get billing(){return createProductionBilling({store,now:()=>at});},now:()=>at,advance:n=>at+=n,balance:customerId=>available(store.all('film-credit').filter(value=>value.customerId===(customerId||'alice')),at),restart:()=>{store.close();store=new Store(folder,key);}};
 store.put('production-project',{id:'project',customerId:'alice'});store.put('production-project',{id:'other-project',customerId:'bob'});
 store.put('film-credit',{id:'lot',customerId:'alice',amount:balance,remaining:balance,createdAt:at,expiresAt:at+CREDIT_LIFETIME});
 store.put('film-credit',{id:'bob-lot',customerId:'bob',amount:1000000,remaining:1000000,createdAt:at,expiresAt:at+CREDIT_LIFETIME});
 store.put('film-ledger',{id:'historical-ledger',customerId:'alice',type:'existing_history',microUSD:77});
 store.put('film-ai-charge',{id:'historical-ai',customerId:'alice',state:'settled',amountMicroUSD:23,uncoveredMicroUSD:0});
 f.quote=(id='quote',stageIds=['stage'],estimate=100000)=>{const q={id,customerId:'alice',projectId:'project',expiresAt:at+60000,planRevision:1,approved:true,stages:stageIds.map(stageId=>({id:stageId,estimatedMicroUSD:estimate})),estimatedMicroUSD:stageIds.length*estimate};store.put('production-quote',q);return q;};
 f.attempt=(id='attempt',stageId='stage',quoteId='quote',estimate=100000)=>{const a={id,customerId:'alice',projectId:'project',stageId,quoteId,estimatedMicroUSD:estimate,status:'reserved'};store.put('production-attempt',a);return a;};
 f.input=(attemptId='attempt',quoteId='quote',estimate=100000)=>({customerId:'alice',projectId:'project',attemptId,quoteId,estimatedMicroUSD:estimate,approved:true});
 f.quote();f.attempt();t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});return f;
}

test('reserve requires explicit input and persisted quote approval before any wallet mutation',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.billing.reserve({...f.input(),approved:false}),/PRODUCTION_APPROVAL_REQUIRED/);
 f.store.put('production-quote',{...f.store.get('production-quote','quote'),approved:false});
 await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_APPROVAL_REQUIRED/);
 assert.equal(f.balance(),1000000);assert.equal(f.store.all('production-charge').length,0);assert.equal(f.store.all('film-ledger').length,1);
});

test('persisted project, attempt and quote ownership and exact stage estimate cannot be changed',async t=>{
 const f=await fixture(t);
 for(const input of [{...f.input(),customerId:'bob'},{...f.input(),projectId:'other-project'},{...f.input(),attemptId:'missing'},{...f.input(),estimatedMicroUSD:1}])await assert.rejects(f.billing.reserve(input),/PRODUCTION_CHARGE_SCOPE_CHANGED/);
 const quote=f.store.get('production-quote','quote');
 f.store.put('production-quote',{...quote,customerId:'bob'});await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_APPROVAL_REQUIRED/);
 f.store.put('production-quote',{...quote,stages:[{id:'stage',estimatedMicroUSD:2}]});await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_QUOTE_CHANGED/);
 f.store.put('production-quote',{...quote,stages:[...quote.stages,...quote.stages]});await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_QUOTE_CHANGED/);
 assert.equal(f.balance(),1000000);assert.equal(f.balance('bob'),1000000);assert.equal(f.store.all('production-charge').length,0);
});

test('expired quote or insufficient unexpired lots block the stage without a partial debit',async t=>{
 const f=await fixture(t,99999);await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_INSUFFICIENT_CREDIT/);assert.equal(f.balance(),99999);
 f.advance(60000);await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_QUOTE_EXPIRED/);assert.equal(f.store.all('production-charge').length,0);
});

test('duplicate concurrent reservations debit exactly once and fingerprint changes are rejected',async t=>{
 const f=await fixture(t),[a,b]=await Promise.all([f.billing.reserve(f.input()),f.billing.reserve(f.input())]);
 assert.equal(a.id,b.id);assert.equal(f.balance(),900000);assert.equal(f.store.all('production-charge').length,1);assert.equal(f.store.all('film-ledger').filter(value=>value.type==='production_hold').length,1);
 f.store.put('production-attempt',{...f.store.get('production-attempt','attempt'),estimatedMicroUSD:200000});f.quote('quote',['stage'],200000);
 await assert.rejects(f.billing.reserve(f.input('attempt','quote',200000)),/PRODUCTION_CHARGE_SCOPE_CHANGED/);assert.equal(f.balance(),900000);
});

test('quote cannot be reused for a second attempt of the same stage or beyond its authorized total',async t=>{
 const f=await fixture(t);await f.billing.reserve(f.input());f.attempt('another');await assert.rejects(f.billing.reserve(f.input('another')),/PRODUCTION_QUOTE_ALREADY_USED/);
 f.quote('multi',['one','two'],100000);f.store.put('production-quote',{...f.store.get('production-quote','multi'),estimatedMicroUSD:100000});f.attempt('first','one','multi');f.attempt('second','two','multi');await f.billing.reserve(f.input('first','multi'));await assert.rejects(f.billing.reserve(f.input('second','multi')),/PRODUCTION_QUOTE_ALREADY_USED/);
 assert.equal(f.balance(),800000);
});

test('multiple simultaneous stage holds serialize against the same wallet funds',async t=>{
 const f=await fixture(t,150000);f.quote('multi',['one','two'],100000);f.attempt('first','one','multi');f.attempt('second','two','multi');
 const result=await Promise.allSettled([f.billing.reserve(f.input('first','multi')),f.billing.reserve(f.input('second','multi'))]);
 assert.equal(result.filter(value=>value.status==='fulfilled').length,1);assert.equal(result.filter(value=>value.status==='rejected').length,1);assert.equal(f.balance(),50000);
});

test('reservation integrates into the parent transaction and rolls back on a later local failure',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.store.transaction(async()=>{await f.billing.reserve(f.input(),true);throw Error('LOCAL_FAILURE');}),/LOCAL_FAILURE/);
 assert.equal(f.balance(),1000000);assert.equal(f.store.all('production-charge').length,0);assert.equal(f.store.all('film-ledger').length,1);
 const charge=await f.store.transaction(()=>f.billing.reserve(f.input(),true));assert.equal(charge.state,'reserved');assert.equal(f.balance(),900000);
});

test('integer settlement refunds excess once and leaves another tenant and financial history unchanged',async t=>{
 const f=await fixture(t),history=f.store.get('film-ledger','historical-ledger'),oldAI=f.store.get('film-ai-charge','historical-ai'),charge=await f.billing.reserve(f.input());
 await f.billing.submitted(charge.id);const settled=await f.billing.settle(charge.id,40000);
 assert.equal(settled.amountMicroUSD,40000);assert.equal(settled.capturedMicroUSD,40000);assert.equal(settled.refundedMicroUSD,60000);assert.equal(f.balance(),960000);assert.equal(f.balance('bob'),1000000);
 await f.billing.settle(charge.id,40000);await f.billing.submitted(charge.id);await f.billing.uncertain(charge.id);assert.equal(f.balance(),960000);assert.equal(f.store.get('production-charge',charge.id).state,'settled');assert.equal(f.store.all('film-ledger').filter(value=>value.type==='production_settlement').length,1);
 assert.deepEqual(f.store.get('film-ledger','historical-ledger'),history);assert.deepEqual(f.store.get('film-ai-charge','historical-ai'),oldAI);
 await assert.rejects(f.billing.settle(charge.id,40001),/PRODUCTION_SETTLEMENT_CONFLICT/);
});

test('refund returns the original lots and never extends expiry or creates spendable rollover credit',async t=>{
 const f=await fixture(t,80000),at=f.now();
 f.store.put('film-credit',{id:'lot',customerId:'alice',amount:80000,remaining:80000,createdAt:at,expiresAt:at+1000});
 f.store.put('film-credit',{id:'second-lot',customerId:'alice',amount:80000,remaining:80000,createdAt:at,expiresAt:at+2000});
 const charge=await f.billing.reserve(f.input());assert.deepEqual(charge.entries,[{lotId:'lot',micros:80000},{lotId:'second-lot',micros:20000}]);f.advance(3000);
 await f.billing.settle(charge.id,50000);assert.equal(f.store.get('film-credit','lot').remaining,30000);assert.equal(f.store.get('film-credit','second-lot').remaining,80000);assert.equal(f.store.get('film-credit','lot').expiresAt,at+1000);assert.equal(f.store.get('film-credit','second-lot').expiresAt,at+2000);assert.equal(f.balance(),0);
});

test('unknown spend and unconfirmed zero keep the full hold across restart without auto-release',async t=>{
 const f=await fixture(t),charge=await f.billing.reserve(f.input());await f.billing.submitted(charge.id);await f.billing.uncertain(charge.id);
 for(const actual of [null,undefined,0]){const pending=await f.billing.settle(charge.id,actual);assert.equal(pending.state,'uncertain');assert.equal(pending.amountMicroUSD,null);assert.equal(f.balance(),900000);}
 f.restart();f.advance(100000);assert.equal(f.store.get('production-charge',charge.id).state,'uncertain');assert.equal(f.balance(),900000);
 await f.billing.submitted(charge.id);assert.equal(f.store.get('production-charge',charge.id).state,'uncertain');assert.equal(f.store.all('film-ledger').filter(value=>value.type==='production_settlement').length,0);
 const settled=await f.billing.settle(charge.id,0,{definitiveNoSpend:true});assert.equal(settled.state,'settled');assert.equal(settled.definitiveNoSpend,true);assert.equal(f.balance(),1000000);
});

test('duplicate settlement after restart preserves actual charge and expired quote cannot create another hold',async t=>{
 const f=await fixture(t),charge=await f.billing.reserve(f.input());await f.billing.settle(charge.id,20000);f.advance(60001);f.restart();
 const replay=await f.billing.reserve(f.input());assert.equal(replay.id,charge.id);assert.equal(replay.state,'settled');assert.equal(f.balance(),980000);await f.billing.settle(charge.id,20000);assert.equal(f.balance(),980000);
});

test('overage consumes available credit without negatives and records uncovered liability that blocks new stage reservations',async t=>{
 const f=await fixture(t,120000),charge=await f.billing.reserve(f.input());await f.billing.submitted(charge.id);const result=await f.billing.settle(charge.id,150000);
 assert.equal(result.amountMicroUSD,150000);assert.equal(result.capturedMicroUSD,120000);assert.equal(result.uncoveredMicroUSD,30000);assert.equal(f.balance(),0);assert.equal(f.store.get('film-credit','lot').remaining,0);
 const ledger=f.store.all('film-ledger').find(value=>value.type==='production_settlement');assert.equal(ledger.uncoveredMicroUSD,30000);assert.equal(ledger.microUSD,-20000);
 f.store.put('film-credit',{id:'topup',customerId:'alice',amount:1000000,remaining:1000000,createdAt:f.now(),expiresAt:f.now()+100000});f.quote('next');f.attempt('next','stage','next');await assert.rejects(f.billing.reserve(f.input('next','next')),/PRODUCTION_OUTSTANDING_BALANCE/);
 assert.equal(f.balance(),1000000);assert.equal(f.store.get('production-charge',charge.id).uncoveredMicroUSD,30000);
});

test('existing OpenAI liability prevents new production spending from bypassing shared wallet debt',async t=>{
 const f=await fixture(t);f.store.put('film-ai-charge',{id:'historical-ai',customerId:'alice',state:'settled',amountMicroUSD:100,uncoveredMicroUSD:100});await assert.rejects(f.billing.reserve(f.input()),/PRODUCTION_OUTSTANDING_BALANCE/);assert.equal(f.balance(),1000000);
});

test('new approved quote allows a deliberate retry after definitive no-spend without reusing old stage approval',async t=>{
 const f=await fixture(t),charge=await f.billing.reserve(f.input());await f.billing.settle(charge.id,0,{definitiveNoSpend:true});
 f.quote('retry');f.attempt('retry-attempt','stage','retry');const retry=await f.billing.reserve(f.input('retry-attempt','retry'));assert.notEqual(retry.id,charge.id);assert.equal(f.balance(),900000);assert.equal(f.store.all('production-charge').length,2);
});

test('malformed usage, missing refund lots and missing charge IDs fail atomically without lost holds',async t=>{
 const f=await fixture(t),charge=await f.billing.reserve(f.input());
 for(const actual of [-1,1.5,NaN,Infinity,'10000'])await assert.rejects(f.billing.settle(charge.id,actual),/INVALID_PRODUCTION_USAGE/);
 await assert.rejects(f.billing.settle(charge.id,1,{definitiveNoSpend:true}),/INVALID_PRODUCTION_USAGE/);await assert.rejects(f.billing.uncertain('missing'),/PRODUCTION_CHARGE_NOT_FOUND/);
 f.store.delete('film-credit','lot');await assert.rejects(f.billing.settle(charge.id,0,{definitiveNoSpend:true}),/PRODUCTION_REFUND_LOT_MISSING/);assert.equal(f.store.get('production-charge',charge.id).state,'reserved');assert.equal(f.store.all('film-ledger').filter(value=>value.type==='production_settlement').length,0);
});


test('approved long-film stage uses its persisted execution deadline and accepts bounded deterministic colon IDs',async t=>{
 const f=await fixture(t);f.quote('long',['character_image:char:0']);f.attempt('long-attempt','character_image:char:0','long');
 f.store.put('production-quote',{...f.store.get('production-quote','long'),approvedAt:f.now(),executionExpiresAt:f.now()+86400000});
 f.advance(300001);const charge=await f.billing.reserve(f.input('long-attempt','long'));assert.equal(charge.stageId,'character_image:char:0');assert.equal(f.balance(),900000);
 f.advance(86400000);f.quote('expired',['chapter_merge:chapter']);f.attempt('expired-attempt','chapter_merge:chapter','expired');f.store.put('production-quote',{...f.store.get('production-quote','expired'),executionExpiresAt:f.now()-1});await assert.rejects(f.billing.reserve(f.input('expired-attempt','expired')),/PRODUCTION_QUOTE_EXPIRED/);
});
