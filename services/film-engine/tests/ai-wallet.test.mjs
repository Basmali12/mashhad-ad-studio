import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {createAIWallet,available} from '../engine/film-money.mjs';
import {OpenAIDirector} from '../engine/openai-director.mjs';

async function fixture(t,balance=1000000){
 const folder=await mkdtemp(path.join(tmpdir(),'ai-wallet-')),store=new Store(folder,randomBytes(32).toString('base64'));let at=Date.now();
 const wallet=createAIWallet(store,{now:()=>at});
 store.put('film-project',{id:'p',customerId:'alice'});store.put('film-project',{id:'other',customerId:'bob'});
 store.put('film-credit',{id:'lot',customerId:'alice',amount:balance,remaining:balance,createdAt:at,expiresAt:at+100000});
 store.put('film-credit',{id:'bob-lot',customerId:'bob',amount:1000000,remaining:1000000,createdAt:at,expiresAt:at+100000});
 store.put('config',{id:'openai-director',credentials:store.seal({key:'synthetic-local-only'},'openai-director')});
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 return {store,wallet,balance:()=>store.get('film-credit','lot').remaining,advance:n=>at+=n,at:()=>at};
}
const request={requestId:'a',projectId:'p',mode:'discuss',approvedTextCost:true,messages:[{role:'user',content:'هلو'}]};
const discussion={reply:'هلا بيك',intent:'discuss',orientation:null,proposed_duration_seconds:null,ready_to_write:false,continuity_notes:''};
const response=(usage={input_tokens:1000,input_tokens_details:{cached_tokens:400,cache_write_tokens:100},output_tokens:200},text=JSON.stringify(discussion))=>Response.json({status:'completed',usage,output:[{type:'message',content:[{type:'output_text',text}]}]});

test('zero/insufficient customer balance prevents OpenAI submission and creates no debit or hold',async t=>{
 for(const balance of [0,1]){
  const f=await fixture(t,balance);let calls=0;const d=new OpenAIDirector(f.store,{billing:f.wallet,fetcher:async()=>{calls++;return response();}});
  await assert.rejects(d.submit(request),/AI_INSUFFICIENT_CREDIT/);assert.equal(calls,0);assert.equal(f.balance(),balance);assert.equal(f.store.all('film-ai-charge').length,0);assert.equal(f.store.all('text-call').length,0);await d.close();
 }
});
test('actual input/cache/write/output usage is charged once, unused hold returns, and another tenant is untouched',async t=>{
 const f=await fixture(t);let calls=0;const d=new OpenAIDirector(f.store,{billing:f.wallet,fetcher:async(url,options)=>{calls++;assert.equal(JSON.parse(options.body).service_tier,'default');return response();}});
 await d.submit(request);await Promise.all([...d.pending]);await d.submit(request);
 const r=await d.get('a'),charge=f.store.all('film-ai-charge')[0];assert.equal(r.status,'completed');assert.equal(charge.amountMicroUSD,1645);assert.equal(f.balance(),1000000-1645);assert.equal(await f.wallet.reserved('alice'),0);assert.equal(calls,1);assert.equal(f.store.get('film-credit','bob-lot').remaining,1000000);
 await f.wallet.settle(charge.id,.001645);assert.equal(f.balance(),998355);assert.equal(f.store.all('film-ledger').length,2);await d.close();
});
test('provider rejection refunds, but an ambiguous network response keeps an unpriced hold without retry',async t=>{
 for(const uncertain of [false,true]){
  const f=await fixture(t);let calls=0;const d=new OpenAIDirector(f.store,{billing:f.wallet,fetcher:async()=>{calls++;if(uncertain)throw Error('synthetic network loss');return Response.json({error:{}},{status:401});}});
  await d.submit(request);await Promise.all([...d.pending]);const r=f.store.all('film-ai-charge')[0];await d.submit(request);await f.wallet.recover({releaseUnsent:true});
  assert.equal(calls,1);assert.equal(r.state,uncertain?'uncertain':'settled');assert.equal(r.amountMicroUSD,uncertain?null:0);assert.equal(f.balance(),uncertain?1000000-r.heldMicroUSD:1000000);await d.close();
 }
});
test('a locally invalid response still charges recorded provider usage rather than giving free paid tokens',async t=>{
 const f=await fixture(t),d=new OpenAIDirector(f.store,{billing:f.wallet,fetcher:async()=>response(undefined,'invalid JSON')});await d.submit(request);await Promise.all([...d.pending]);assert.equal((await d.get('a')).status,'failed');assert.equal(f.store.all('film-ai-charge')[0].amountMicroUSD,1645);await d.close();
});
test('concurrent holds serialize with GPU funds; expired refunds retain original expiry, and restart never bills legacy calls',async t=>{
 const f=await fixture(t,100000),input={kind:'text-call',requestId:'a',projectId:'p',estimatedMicroUSD:80000};
 const results=await Promise.allSettled([f.wallet.reserve(input),f.wallet.reserve({...input,requestId:'b'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.balance(),20000);
 const charge=f.store.all('film-ai-charge')[0];await f.wallet.recover();assert.equal(f.balance(),20000,'a live queued hold is not released by the watchdog');
 f.advance(100001);await f.wallet.settle(charge.id,.005);assert.equal(f.balance(),95000);assert.equal(available(f.store.all('film-credit').filter(l=>l.customerId==='alice'),f.at()),0);
 f.store.put('text-call',{id:'legacy',status:'completed',projectId:'p',usage:{computedUSD:.1}});await f.wallet.recover({releaseUnsent:true});assert.equal(f.store.all('film-ai-charge').length,1);assert.equal(f.balance(),95000);
});
test('startup releases only never-submitted holds and recovers a known submitted usage receipt idempotently',async t=>{
 const f=await fixture(t),a=await f.wallet.reserve({kind:'text-call',requestId:'a',projectId:'p',estimatedMicroUSD:100000}),b=await f.wallet.reserve({kind:'text-call',requestId:'b',projectId:'p',estimatedMicroUSD:100000});
 await f.wallet.sent(b.id);f.store.put('text-call',{id:'b',projectId:'p',status:'completed',usage:{computedUSD:.005}});await f.wallet.recover({releaseUnsent:true});await f.wallet.recover({releaseUnsent:true});assert.equal(f.balance(),995000);assert.equal(f.store.get('film-ai-charge',a.id).amountMicroUSD,0);assert.equal(f.store.get('film-ai-charge',b.id).amountMicroUSD,5000);
});

test('an exceptional over-estimate excess never makes balances negative and is recovered once from a later topup',async t=>{
 const f=await fixture(t,10000),r=await f.wallet.reserve({kind:'text-call',requestId:'a',projectId:'p',estimatedMicroUSD:10000});await f.wallet.sent(r.id);await f.wallet.settle(r.id,.02);assert.equal(f.balance(),0);assert.equal(f.store.get('film-ai-charge',r.id).uncoveredMicroUSD,10000);
 f.store.put('film-credit',{id:'topup',customerId:'alice',amount:50000,remaining:50000,createdAt:f.at(),expiresAt:f.at()+100000});await f.wallet.collectOutstanding('alice');await f.wallet.collectOutstanding('alice');assert.equal(f.store.get('film-credit','topup').remaining,40000);assert.equal(f.store.get('film-ai-charge',r.id).uncoveredMicroUSD,0);await f.wallet.requireFunds('alice');
});
