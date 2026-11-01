import {describe,expect,it} from 'vitest';
import {canApproveProduction,createDirectorClient,directorError,nextPlanAction,type DirectorState,type ProductionOffer,type TextIntent} from './directorClient';
import type {FilmRequest} from './filmClient';
import type {FilmOperation} from '../../../shared/film-contracts';

type Call={operation:FilmOperation;input:Record<string,unknown>;requestId?:string};
const source='  قصة عراقية أصلية\nسالم: هلا بيك.\n';
const state=(change:Partial<DirectorState>={}):DirectorState=>({projectId:'project-one',revision:1,mode:'strict',originalText:source,messages:[],summary:'',missing:[],planReady:false,storyApproved:false,...change});
const quote=(change:Partial<ProductionOffer>={}):ProductionOffer=>({id:'quote-one',projectId:'project-one',estimatedMicroUSD:20000,spendLimitMicroUSD:20000,dispatchAvailable:true,blockers:[],expiresAt:Date.now()+60000,...change});
function fixture(replies:Partial<Record<FilmOperation,unknown>>={}){
 const calls:Call[]=[];
 const request:FilmRequest=async(operation,input={},requestId)=>{calls.push({operation,input,requestId});if(Object.hasOwn(replies,operation))return replies[operation];if(operation==='production.source.begin')return {id:'source-one'};if(operation==='production.create')return {id:'project-one',title:'فيلم',state:'draft',durationMs:10000,revision:1};if(operation.endsWith('.quote'))return {id:'quote-one',projectId:'project-one',stage:'discuss',dispatchAvailable:true,blockers:[],estimatedMicroUSD:1000,expiresAt:Date.now()+60000};return {};};
 return {calls,client:createDirectorClient(request)};
}

describe('customer director integration contract',()=>{
 it('creating an ordinary conversation preserves original text and never starts a provider',async()=>{
  const f=fixture();await f.client.create('  هلو، من انت؟  ','one-create');
  expect(f.calls).toEqual([{operation:'production.create',input:{requestId:'one-create',title:'هلو، من انت؟',durationMs:10000,story:'  هلو، من انت؟  '},requestId:'one-create'}]);
 });
 it('ordinary message prepares one text quote without consenting to production',async()=>{
  const f=fixture(),intent=await f.client.message('project-one','شلونك اليوم؟');
  expect(intent.operation).toBe('director.message');expect(f.calls.map(c=>c.operation)).toEqual(['director.message.quote']);expect(f.calls[0].input).toMatchObject({id:'project-one',text:'شلونك اليوم؟'});expect(f.calls[0].input.approved).toBeUndefined();
 });
 it('large complete story is chunked losslessly and create receives only its stored source identifier',async()=>{
  const f=fixture(),long=source.repeat(1200);await f.client.create(long,'long-create');
  const chunks=f.calls.filter(c=>c.operation==='production.source.chunk');expect(chunks.length).toBeGreaterThan(2);expect(chunks.map(c=>c.input.text).join('')).toBe(long);expect(chunks.every(c=>String(c.input.text).length<=12000)).toBe(true);expect(chunks.map(c=>c.input.index)).toEqual(chunks.map((_,i)=>i));
  expect(f.calls[0].input.totalCharacters).toBe(long.length);expect(f.calls.at(-2)?.input).toEqual({id:'source-one',chunkCount:chunks.length});expect(f.calls.at(-1)?.input).toMatchObject({sourceId:'source-one',requestId:'long-create'});expect(f.calls.at(-1)?.input.story).toBeUndefined();
 });
 it('long pasted message also uses a source reference rather than truncating a prompt',async()=>{
  const f=fixture(),long='لا تغيّر أحداث القصة. '.repeat(1400);await f.client.message('project-one',long);
  expect(f.calls.filter(c=>c.operation==='production.source.chunk').map(c=>c.input.text).join('')).toBe(long);expect(f.calls.at(-1)?.operation).toBe('director.message.quote');expect(f.calls.at(-1)?.input).toMatchObject({id:'project-one',textId:'source-one'});expect(f.calls.at(-1)?.input.text).toBeUndefined();
 });
 it('rejects text beyond the safe source limit before sending anything',async()=>{
  const f=fixture();await expect(f.client.storeText('أ'.repeat(1000001))).rejects.toThrow('مليون حرف');expect(f.calls).toHaveLength(0);
 });
 it('explicit text consent is scoped to the displayed quote and retains the intent identity',async()=>{
  const f=fixture(),intent=await f.client.message('project-one','نناقش القصة');await f.client.submit(intent);
  expect(f.calls.at(-1)).toMatchObject({operation:'director.message',requestId:intent.requestId,input:{id:'project-one',quoteId:intent.offer.id,requestId:intent.requestId,approvedTextCost:true}});expect(f.calls.some(c=>c.operation==='production.approve')).toBe(false);
 });
 it('expired or unavailable text offers cannot be dispatched',async()=>{
  const f=fixture(),intent=await f.client.message('project-one','نناقش');intent.offer.expiresAt=Date.now()-1;await expect(f.client.submit(intent)).rejects.toThrow('انتهت');intent.offer.expiresAt=Date.now()+60000;intent.offer.dispatchAvailable=false;await expect(f.client.submit(intent)).rejects.toThrow();expect(f.calls.map(c=>c.operation)).toEqual(['director.message.quote']);
 });
 it('ambiguous gateway failure is not retried and follow-up only reads persisted state',async()=>{
  const calls:Call[]=[],request:FilmRequest=async(operation,input={},requestId)=>{calls.push({operation,input,requestId});if(operation==='director.message')throw Error('network disconnected');return operation==='production.get'?{id:'project-one',state:'draft'}:state({pendingCall:{requestId:'stable-submit',status:'uncertain',stage:'discuss'}});};
  const client=createDirectorClient(request),intent:TextIntent={offer:{id:'quote-one',projectId:'project-one',stage:'discuss',dispatchAvailable:true,blockers:[],estimatedMicroUSD:1000,expiresAt:Date.now()+60000},operation:'director.message',requestId:'stable-submit'};
  await expect(client.submit(intent)).rejects.toThrow('network disconnected');await client.read('project-one');expect(calls.map(c=>c.operation)).toEqual(['director.message','production.get','director.get']);expect(calls.filter(c=>c.operation==='director.message')).toHaveLength(1);
 });
 it('planning uses the exact next hierarchical scene identifiers',async()=>{
  const f=fixture();await f.client.plan('project-one',{stage:'scene',chapterId:'chapter-three',sceneId:'scene-five'});expect(f.calls[0].operation).toBe('director.plan.quote');expect(f.calls[0].input).toMatchObject({id:'project-one',stage:'scene',chapterId:'chapter-three',sceneId:'scene-five'});
 });
 it('search is bounded to the research quote and never runs on ordinary discussion',async()=>{
  const f=fixture(),intent=await f.client.research('project-one','قصة تاريخية موثقة');expect(intent.operation).toBe('director.research');expect(f.calls.map(c=>c.operation)).toEqual(['director.research.quote']);expect(f.calls[0].input).toMatchObject({query:'قصة تاريخية موثقة',maxCalls:1,maxTokens:1600});
 });
 it('resolved scene or voice edits preserve server identifiers instead of guessing by array position',()=>{
  expect(nextPlanAction(state({editSuggestion:{scope:'local',targetType:'scene',targetId:'stable-scene-five',chapterId:'chapter-two',instruction:'غيّر المشهد الخامس'}}))).toEqual({stage:'revision',targetType:'scene',targetId:'stable-scene-five',chapterId:'chapter-two'});
  expect(nextPlanAction(state({editSuggestion:{scope:'local',targetType:'voice',targetId:'narrator-one',instruction:'خلّي الراوي عراقي'}}))).toEqual({stage:'revision',targetType:'voice',targetId:'narrator-one'});
 });
 it('a pending text request blocks a new planning action and server resume checkpoints win',()=>{
  expect(nextPlanAction(state({pendingCall:{requestId:'pending',stage:'chapter',status:'queued'}}))).toBeNull();expect(nextPlanAction(state({nextAction:{stage:'source_summary',sourceIndex:3}}))).toEqual({stage:'source_summary',sourceIndex:3});
 });
 it.each([
  ['unpublished model',{dispatchAvailable:false,blockers:['PRODUCTION_MODEL_NOT_PUBLISHED']},100000],
  ['unknown cost',{estimatedMicroUSD:null},100000],
  ['insufficient funds',{},19999],
  ['lower approved limit',{spendLimitMicroUSD:19999},100000],
  ['expired quote',{expiresAt:1},100000],
  ['server wallet rejection',{canAfford:false},100000],
 ] as Array<[string,Partial<ProductionOffer>,number]>)('prevents production for %s',async(_label,change,balance)=>{
  const f=fixture(),q=quote(change);expect(canApproveProduction(q,balance)).toBe(false);await expect(f.client.approve(q,balance,'approved-once')).rejects.toThrow();expect(f.calls).toHaveLength(0);
 });
 it('production approval carries explicit price ceiling, project, quote and stable idempotency identity',async()=>{
  const f=fixture(),q=quote();await f.client.approve(q,50000,'approved-once');expect(f.calls).toEqual([{operation:'production.approve',input:{id:'project-one',quoteId:'quote-one',requestId:'approved-once',approved:true,spendLimitMicroUSD:20000},requestId:'approved-once'}]);
 });
 it('status read after refresh cannot approve, retry or create a second production',async()=>{
  const f=fixture({'production.get':{id:'project-one',state:'running'},'director.get':state({storyApproved:true})});const data=await f.client.read('project-one');expect(data.project.state).toBe('running');expect(f.calls.map(c=>c.operation)).toEqual(['production.get','director.get']);
 });
 it('backend errors are propagated safely and insufficient credit has a useful Arabic message',async()=>{
  const f=fixture({'production.get':{error:'NOT_FOUND',message:'not your data'}});await expect(f.client.read('other-person-project')).rejects.toThrow('NOT_FOUND');expect(directorError(Error('AI_INSUFFICIENT_CREDIT'))).toContain('عبّي رصيدك');expect(directorError(Error('INTERNAL_UNRECOGNIZED_CODE'))).not.toContain('INTERNAL_UNRECOGNIZED_CODE');
 });
});
