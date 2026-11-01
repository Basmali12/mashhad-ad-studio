import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {OpenAIDirector} from '../engine/openai-director.mjs';
import {createAIWallet} from '../engine/film-money.mjs';
import {createProductionDirector} from '../engine/production-director.mjs';

const urls=['https://www.britannica.com/place/Baghdad','https://www.loc.gov/item/example'];
const researchOutput=()=>({summary:'ملخص سينمائي جديد مبني على مراجع متعددة مع بقاء المراجعة البشرية مطلوبة.',claims:[{id:'claim-one',text:'ادعاء اختباري موضح بمصدرين مختلفين.',sourceUrls:[...urls],status:'supported'}],originalScenario:'مقطع درامي أصلي مستوحى من السياق، وليس نقلاً من كتاب.',rightsNotes:['صياغة أصلية دون نسخ مقاطع مطوّلة من المصادر.'],needsMoreResearch:false});
const discussion=()=>({intent:'script',reply:'وصل النص، نناقشه ونحافظ على أحداثه دون تشغيل الإنتاج.',proposedDurationMs:10000,orientation:'landscape',missing:[],summary:'سيناريو جاهز للمناقشة.',research:null,edit:null});
const pricing={inputPerMillionUSD:2,cachedInputPerMillionUSD:1,cacheWritePerMillionUSD:3,outputPerMillionUSD:4,source:'synthetic-local-test-rates',checked:'2026-10-31'};
async function fixture(t){
 const folder=await mkdtemp(path.join(tmpdir(),'research-flow-')),store=new Store(folder,randomBytes(32).toString('base64')),now=Date.now(),calls=[],queue=[];let productionCalls=0;
 for(const [id,customerId] of [['project','alice'],['other','bob']]){store.put('production-project',{id,customerId,story:'قصة أصلية محفوظة كما أرسلها المستخدم.',durationMs:10000,revision:1,state:'draft',referenceIds:[]});store.put('film-credit',{id:'funds-'+customerId,customerId,amount:1000000,remaining:1000000,createdAt:now,expiresAt:now+86400000});}
 store.put('config',{id:'openai-director',credentials:store.seal({key:'synthetic-fixture-not-real'},'openai-director')});
 const director=new OpenAIDirector(store,{recordKind:'production-text-call',structuredEnabled:true,billing:createAIWallet(store),pricing,fetcher:async(url,options)=>{
  const payload=JSON.parse(options.body);calls.push({url,payload});const item=queue.shift();assert.ok(item,'test must supply one result for each mocked Responses request');const output=[];
  if(item.research)output.push({id:'search-fixture',type:'web_search_call',status:'completed',action:{type:'search',query:'تاريخ بغداد',sources:urls.map((url,i)=>({type:'url',url,title:'Source '+i}))}});
  output.push({type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(item.value),annotations:item.research?urls.map((url,i)=>({type:'url_citation',url,title:'Source '+i,start_index:i*10,end_index:i*10+5})):[]}]});
  return Response.json({id:'response-'+calls.length,status:'completed',usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:50},output});
 }});
 const production={async adoptPlan(){productionCalls++;throw Error('NO_PRODUCTION_IN_RESEARCH_TEST');},async get(){productionCalls++;throw Error('NO_PRODUCTION_IN_RESEARCH_TEST');},async cancel(){productionCalls++;throw Error('NO_PRODUCTION_IN_RESEARCH_TEST');}},service=createProductionDirector({store,production,director,enabled:true});
 t.after(async()=>{await director.close();store.close();await rm(folder,{recursive:true,force:true});});
 async function quote(requestId='quote-research',extra={}){return service.dispatch('alice','director.research.quote',{id:'project',requestId,query:'تاريخ بغداد',...extra});}
 async function submit(q,requestId='research-call'){return service.dispatch('alice','director.research',{id:'project',quoteId:q.id,requestId,approvedTextCost:true});}
 async function finish(requestId='research-call'){await Promise.all([...director.pending]);return service.call('alice',{id:'project',requestId});}
 return {store,director,service,calls,queue,quote,submit,finish,productionCalls:()=>productionCalls};
}

test('no-needed suggestion without explicit research query rejects for free',async t=>{
 const f=await fixture(t);await f.service.get('alice','project');const s=f.store.get('production-director','project');s.researchSuggestion={needed:false,query:'لا حاجة للبحث',reason:'المستخدم أرسل نصه الخاص.'};f.store.put('production-director',s);
 await assert.rejects(f.service.dispatch('alice','director.research.quote',{id:'project',requestId:'none'}),/RESEARCH_NOT_NEEDED/);assert.equal(f.calls.length,0);assert.equal(f.store.all('film-ai-charge').length,0);assert.equal(f.store.all('director-research').length,0);assert.equal(f.productionCalls(),0);
});

test('approved bounded web search stores provenance before production and settles actual token plus tool usage once',async t=>{
 const f=await fixture(t),before=f.store.get('film-credit','funds-alice').remaining,q=await f.quote();assert.equal(q.dispatchAvailable,true);assert.equal(q.cached,false);assert.ok(q.estimatedMicroUSD>10000);assert.equal(f.calls.length,0);assert.equal(f.store.all('film-ai-charge').length,0);assert.equal(f.store.get('film-credit','funds-alice').remaining,before);
 await assert.rejects(f.service.dispatch('alice','director.research',{id:'project',quoteId:q.id,requestId:'no-approval'}),/APPROVAL_REQUIRED/);assert.equal(f.calls.length,0);
 f.queue.push({research:true,value:researchOutput()});await f.submit(q);const result=await f.finish();assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(f.calls.length,1);const payload=f.calls[0].payload;assert.equal(payload.tools[0].type,'web_search');assert.equal(payload.max_tool_calls,1);assert.ok(payload.tools[0].filters.allowed_domains.includes('loc.gov'));assert.ok(payload.include.includes('web_search_call.action.sources'));assert.equal(payload.max_output_tokens,1600);assert.equal(payload.text.format.strict,true);
 const state=await f.service.get('alice','project');assert.equal(state.researchResults.length,1);assert.equal(state.researchResults[0].sources.length,2);assert.equal(state.researchResults[0].claims[0].status,'supported');assert.equal(state.outline,null);assert.equal(state.planReady,false);assert.equal(f.productionCalls(),0);assert.equal(f.store.all('engine-runtime').length,0);
 const charges=f.store.all('film-ai-charge');assert.equal(charges.length,1);assert.equal(charges[0].state,'settled');assert.equal(charges[0].amountMicroUSD,10400);assert.equal(f.store.get('film-credit','funds-alice').remaining,before-10400);await f.submit(q);await f.finish();assert.equal(f.calls.length,1);assert.equal(f.store.all('film-ai-charge').length,1);
});

test('cached query reuse is project-private, free and makes no second Responses request',async t=>{
 const f=await fixture(t);f.queue.push({research:true,value:researchOutput()});await f.submit(await f.quote());assert.equal((await f.finish()).status,'completed');const balance=f.store.get('film-credit','funds-alice').remaining,q=await f.quote('cached-quote');assert.equal(q.cached,true);assert.equal(q.estimatedMicroUSD,0);await f.submit(q,'cached-call');assert.equal((await f.finish('cached-call')).status,'completed');assert.equal(f.calls.length,1);assert.equal(f.store.all('film-ai-charge').length,1);assert.equal(f.store.get('film-credit','funds-alice').remaining,balance);assert.equal(f.store.all('director-research').length,1);
 await assert.rejects(f.service.dispatch('bob','director.research.quote',{id:'project',requestId:'foreign',query:'تاريخ بغداد'}),/NOT_FOUND/);const own=await f.service.dispatch('bob','director.research.quote',{id:'other',requestId:'own',query:'تاريخ بغداد'});assert.equal(own.cached,false);assert.equal(f.calls.length,1);
});

test('research budget expansion requires explicit approval and cannot cross hard ceilings',async t=>{
 const f=await fixture(t);await assert.rejects(f.quote('expand-denied',{maxCalls:2}),/EXPANSION_APPROVAL/);await assert.rejects(f.quote('tokens-denied',{maxTokens:3000}),/EXPANSION_APPROVAL/);const expanded=await f.quote('expand-approved',{maxCalls:2,maxTokens:3000,approvedExpansion:true});assert.equal(expanded.dispatchAvailable,true);assert.ok(expanded.estimatedMicroUSD>20000);await assert.rejects(f.quote('over-calls',{maxCalls:3,approvedExpansion:true}),/LIMIT/);await assert.rejects(f.quote('over-tokens',{maxTokens:3001,approvedExpansion:true}),/LIMIT/);assert.equal(f.calls.length,0);assert.equal(f.store.all('film-ai-charge').length,0);
});

test('invented model URL fails application validation but actual usage settles without automatic replay',async t=>{
 const f=await fixture(t),value=researchOutput();value.claims[0].sourceUrls.push('https://www.loc.gov/item/not-returned-by-tool');f.queue.push({research:true,value});const q=await f.quote();await f.submit(q);const result=await f.finish();assert.equal(result.status,'failed');assert.match(result.error,/RESEARCH_SOURCE_UNOBSERVED|OPERATION_FAILED/);assert.equal(f.store.all('director-research').length,0);assert.equal(f.store.all('film-ai-charge')[0].amountMicroUSD,10400);await f.submit(q);await f.finish();assert.equal(f.calls.length,1);assert.equal(f.productionCalls(),0);
});

test('ready screenplay discussion does not enable web search or generate a film',async t=>{
 const f=await fixture(t),q=await f.service.dispatch('alice','director.message.quote',{id:'project',requestId:'discuss-quote',text:'هاي قصتي جاهزة، لا تغيّرها؛ خلينا نناقشها.'});assert.equal(f.calls.length,0);f.queue.push({research:false,value:discussion()});await f.service.dispatch('alice','director.message',{id:'project',requestId:'discuss-call',quoteId:q.id,approvedTextCost:true});await Promise.all([...f.director.pending]);assert.equal((await f.service.call('alice',{id:'project',requestId:'discuss-call'})).status,'completed');const payload=f.calls[0].payload;assert.equal(payload.tools,undefined);assert.equal(payload.max_tool_calls,undefined);const s=await f.service.get('alice','project');assert.equal(s.researchSuggestion,null);assert.equal(s.researchResults.length,0);assert.equal(s.storyApproved,false);assert.equal(s.outline,null);assert.equal(f.productionCalls(),0);assert.equal(f.store.all('film-ai-charge')[0].amountMicroUSD,400);
});
