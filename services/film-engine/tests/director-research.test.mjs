import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {RESEARCH_SCHEMA,RESEARCH_SYSTEM,RESEARCH_POLICY,buildRequest,createDirectorResearch} from '../engine/director-research.mjs';

const clone=x=>structuredClone(x),urls=['https://www.britannica.com/place/Baghdad','https://www.loc.gov/item/example'];
const output=()=>({summary:'ملخص تاريخي أصلي للاختبار، مع مقارنة المصادر.',claims:[{id:'claim-one',text:'ادعاء اختباري يحتاج مراجعة بشرية.',sourceUrls:urls,status:'supported'}],originalScenario:'مشهد سينمائي جديد مستوحى من السياق، وليس نسخة من مرجع.',rightsNotes:['صياغة أصلية، مع عدم نقل نصوص الكتب.'],needsMoreResearch:false});
const evidence=()=>({sources:urls.map((url,i)=>({url,title:'Source '+i})),citations:urls.map((url,i)=>({url,title:'Source '+i,startIndex:i*10,endIndex:i*10+5})),webSearchCalls:1});
async function fixture(t){const folder=await mkdtemp(path.join(tmpdir(),'director-research-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});let time=1000000;store.put('production-project',{id:'project',customerId:'alice'});store.put('production-project',{id:'other-project',customerId:'bob'});const research=createDirectorResearch({store,now:()=>time}),input={customerId:'alice',projectId:'project',requestId:'search-one',query:'تاريخ بغداد',output:output(),evidence:evidence()};return {store,research,input,advance:ms=>time+=ms};}

test('bounded official web-search request proposes cost limits without running any tool',()=>{
 const request=buildRequest({query:'تاريخ بغداد'});assert.equal(request.maxTokens,1600);assert.equal(request.webSearch.maxCalls,1);assert.equal(request.webSearch.toolCostMicroUSD,10000);assert.equal(request.webSearch.searchContentTokenAllowance,8000);assert.equal(request.schema,RESEARCH_SCHEMA);assert.equal(request.instruction,RESEARCH_SYSTEM);assert.equal(JSON.parse(request.messages[0].content).untrustedContent,true);assert.match(request.instruction,/untrusted source data/);assert.match(request.instruction,/full books/);assert.match(request.instruction,/stop; do not expand searches automatically/);
 assert.throws(()=>buildRequest({query:'Baghdad',maxCalls:2}),/EXPANSION_APPROVAL/);assert.throws(()=>buildRequest({query:'Baghdad',maxTokens:3000}),/EXPANSION_APPROVAL/);assert.equal(buildRequest({query:'Baghdad',maxCalls:2,maxTokens:3000,approvedExpansion:true}).webSearch.maxCalls,2);assert.throws(()=>buildRequest({query:'Baghdad',maxCalls:3,approvedExpansion:true}),/LIMIT/);assert.throws(()=>buildRequest({query:'Baghdad',maxTokens:3001,approvedExpansion:true}),/LIMIT/);
 for(const allowedDomains of [['*.gov'],['localhost'],['169.254.169.254'],['example.com'],[]])assert.throws(()=>buildRequest({query:'Baghdad',allowedDomains}),/DOMAINS/);assert.deepEqual(buildRequest({query:'Baghdad',allowedDomains:['loc.gov']}).webSearch.allowedDomains,['loc.gov']);assert.throws(()=>buildRequest({query:'api_key=sk-this-is-not-a-real-key'}),/QUERY/);
});

test('actual source/citation provenance saves original scenario and distinct-domain corroboration without certifying facts',async t=>{
 const f=await fixture(t),r=await f.research.commit(f.input);assert.equal(r.reused,false);assert.equal(r.claims[0].status,'supported');assert.equal(r.sources.length,2);assert.equal(r.citations.length,2);assert.equal(r.originalScenario,f.input.output.originalScenario);assert.equal(Object.hasOwn(r,'documented'),false);assert.equal(Object.hasOwn(r,'customerId'),false);assert.equal(f.store.all('director-research').length,1);assert.equal(f.store.all('film-ledger').length,0);assert.equal(f.store.all('engine-runtime').length,0);
 const cached=await f.research.getCached({customerId:'alice',projectId:'project',query:'  تاريخ   بغداد '});assert.equal(cached.id,r.id);assert.equal(cached.reused,true);
});

test('one domain, sources without citations and unsupported claims remain uncertain rather than pretending verification',async t=>{
 const f=await fixture(t),input=clone(f.input);input.evidence.sources=[{url:urls[0],title:'One source'}];input.evidence.citations=[{url:urls[0],title:'One source',startIndex:0,endIndex:5}];input.output.claims[0].sourceUrls=[urls[0]];let r=await f.research.commit(input);assert.equal(r.claims[0].status,'uncertain');assert.equal(r.needsMoreResearch,true);const noCitations=clone(f.input);noCitations.requestId='search-no-citations';noCitations.evidence.citations=[];r=await f.research.commit(noCitations);assert.equal(r.claims[0].status,'uncertain');assert.equal(r.needsMoreResearch,true);
 const sameHost=clone(f.input);sameHost.requestId='search-subdomains';const second='https://britannica.com/place/Iraq';sameHost.evidence.sources[1].url=second;sameHost.evidence.citations[1].url=second;sameHost.output.claims[0].sourceUrls[1]=second;r=await f.research.commit(sameHost);assert.equal(r.claims[0].status,'uncertain');
});

test('invented URLs, auth URLs, private hosts and invalid tool evidence cannot become trusted sources',async t=>{
 const f=await fixture(t);for(const url of ['http://loc.gov/item/a','https://alice:password@loc.gov/item/a','https://169.254.169.254/metadata','https://loc.gov.evil.test/x','https://loc.gov:8443/x']){const i=clone(f.input);i.evidence.sources[0].url=url;await assert.rejects(f.research.commit(i),/SOURCE_INVALID/);}const i=clone(f.input);i.output.claims[0].sourceUrls.push('https://www.loc.gov/item/invented');await assert.rejects(f.research.commit(i),/SOURCE_UNOBSERVED/);for(const webSearchCalls of [0,3,-1])await assert.rejects(f.research.commit({...f.input,evidence:{...evidence(),webSearchCalls}}),/EVIDENCE/);assert.equal(f.store.all('director-research').length,0);
});

test('cache and idempotence stay within customer/project/policy and expire after seven days',async t=>{
 const f=await fixture(t),r=await f.research.commit(f.input);assert.equal((await f.research.commit(f.input)).id,r.id);assert.equal(f.store.all('director-research').length,1);await assert.rejects(f.research.commit({...f.input,query:'تاريخ مصر'}),/CONFLICT/);await assert.rejects(f.research.getCached({customerId:'bob',projectId:'project',query:f.input.query}),/NOT_FOUND/);assert.equal(await f.research.getCached({customerId:'bob',projectId:'other-project',query:f.input.query}),null);await assert.rejects(f.research.commit({...f.input,customerId:'bob'}),/NOT_FOUND/);f.advance(RESEARCH_POLICY.ttlMs+1);assert.equal(await f.research.getCached({customerId:'alice',projectId:'project',query:f.input.query}),null);assert.equal(f.store.all('director-research').length,1);
});

test('research commit can join the existing server transaction without a nested transaction',async t=>{
 const f=await fixture(t),r=await f.store.transaction(()=>f.research.commit(f.input,true));assert.equal(r.sources.length,2);assert.equal(r.needsMoreResearch,false);assert.equal(f.research.policy.version,RESEARCH_POLICY.version);
});
