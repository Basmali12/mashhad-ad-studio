import type {FilmOperation} from '../../../shared/film-contracts';
import {isFailure,type FilmRequest,unavailable} from './filmClient';

export type ProductionSummary={id:string;title:string;state:string;durationMs:number;pinned?:boolean;archived?:boolean;revision:number};
export type Speaker={id:string;name:string;voice:{voiceId:string;engineId:string;locale:string};description?:string};
export type ProductionProject=ProductionSummary & {story?:string;characters?:Speaker[];narrators?:Speaker[];result?:{fileId?:string;durationMs?:number}|null;activity?:{label:string;progress?:{completed:number;total:number;unit:string}|null};stages?:Array<{id:string;kind:string;state:string;progress?:{completed:number;total:number;unit:string}|null}>;error?:string|null;measuredDurationMs?:number|null};
export type PlanAction={stage:string;chapterId?:string;sceneId?:string;sourceIndex?:number;targetType?:string;targetId?:string};
export type DirectorState={projectId:string;revision:number;mode:'strict'|'creative';originalText:string;source?:{id:string;characters:number;sha256:string}|null;messages:Array<{id:string;role:'user'|'assistant';text:string}>;pendingCall?:{requestId:string;status:string;stage:string}|null;nextAction?:PlanAction|null;lastIntent?:string|null;orientation?:string|null;targetDurationMs?:number;summary:string;missing:string[];error?:string|null;planReady:boolean;storyApproved:boolean;outline?:{title:string;summary:string;durationMs:number;characters:Speaker[];narrators:Speaker[];chapters:Array<{id:string;title:string}>}|null;editSuggestion?:{scope:string;targetType:string;targetId:string;chapterId?:string;instruction:string}|null;researchSuggestion?:{needed:boolean;query:string;reason?:string}|null;researchResults?:Array<{id:string;summary:string;originalScenario:string;sources:Array<{title:string;url:string}>}>;revisions?:Array<{id:string;stage:string;targetType?:string;targetId?:string;approved:boolean}>;pendingRevision?:{id:string;summary:string}|null;approvalReview?:{title:string;durationMs:number;chapterCount:number;sceneCount:number;shotCount:number;models:string[];readiness:Array<{modelId:string;state:string}>}|null};
export type TextOffer={id:string;projectId:string;stage:string;estimatedMicroUSD:number|null;dispatchAvailable:boolean;blockers:string[];expiresAt:number;cached?:boolean};
export type ProductionOffer={id:string;projectId:string;estimatedMicroUSD:number|null;spendLimitMicroUSD?:number|null;availableMicroUSD?:number;canAfford?:boolean;dispatchAvailable:boolean;blockers:string[];expiresAt:number};
export type TextIntent={offer:TextOffer;operation:'director.message'|'director.plan'|'director.research';requestId:string};
export const localId=():string=>crypto.randomUUID();
const knownErrors:Record<string,string>={
 PRODUCTION_MODEL_BUSY:'المحرك المطلوب لديه جلسة مشغولة. أوقف استئجارك القائم أو انتظر توفره؛ لم يبدأ إنتاج آخر.',AI_INSUFFICIENT_CREDIT:'رصيدك لا يكفي. عبّي رصيدك أولاً.',INSUFFICIENT_CREDIT:'رصيدك لا يكفي. عبّي رصيدك أولاً.',PRODUCTION_INSUFFICIENT_CREDIT:'رصيدك لا يكفي. عبّي رصيدك أولاً.',OPENAI_KEY_REQUIRED:'خدمة المخرج غير مهيأة لدى الإدارة.',DIRECTOR_OPERATION_DISABLED:'المخرج غير مفعّل حالياً لدى الإدارة.',DIRECTOR_STATE_UNKNOWN:'نتيجة الطلب غير محسومة. حدّث الحالة دون إعادة الطلب.',DIRECTOR_BUSY:'المخرج يعمل على رسالتك السابقة. يمكنك فتح محادثة جديدة.',PRODUCTION_EXECUTION_DISABLED:'الإنتاج غير مفعّل أو المحركات غير معتمدة؛ لم يبدأ تشغيل.',PRODUCTION_APPROVAL_REQUIRED:'يلزم اعتماد التكلفة قبل الإنتاج.',DIRECTOR_VOICE_APPROVAL_REQUIRED:'الصوت المطلوب يحتاج ملف صوت معتمداً. لم يُبدّل صوت الشخصية تلقائياً.',NOT_FOUND:'المحادثة غير موجودة أو لا تخص حسابك.',DIRECTOR_ORIENTATION_REQUIRED:'حدد عمودي أو أفقي بالدردشة قبل اعتماد السيناريو.'
};
export function directorError(error:unknown){const value=error instanceof Error?error.message:'';return knownErrors[value]??(/^[A-Z][A-Z0-9_]+$/.test(value)?'تعذر إكمال هذه الخطوة. حالتها محفوظة؛ لم تبدأ إعادة تلقائية.':value||unavailable);}
export function blockerLabel(code:string){return knownErrors[code]??(/LICENSE|RIGHTS/.test(code)?'حقوق الاستخدام غير معتمدة':/VOICE/.test(code)?'الصوت المرجعي غير معتمد':/PUBLISH|UNPUBLISHED/.test(code)?'المحرك غير منشور':/READY|PREPAR|MANIFEST|WEIGHT/.test(code)?'أوزان المحرك أو تجهيزه غير مكتمل':/BIND|UNASSIGNED|ENGINE|ADAPTER/.test(code)?'محرك مطلوب غير مربوط أو غير متاح':/CREDIT|FUNDS|BALANCE/.test(code)?'الرصيد غير كافٍ':'متطلبات التشغيل غير مكتملة');}
export function nextPlanAction(s:DirectorState):PlanAction|null{
 if(s.pendingCall)return null;
 if(s.editSuggestion){const e=s.editSuggestion;return e.scope==='outline'?{stage:'outline'}:{stage:'revision',targetType:e.targetType,targetId:e.targetId,...(e.chapterId?{chapterId:e.chapterId}:{})};}
 return s.nextAction??(!s.outline?{stage:'outline'}:null);
}
export function canApproveProduction(q:ProductionOffer,balance:number){return q.dispatchAvailable&&q.estimatedMicroUSD!==null&&Number.isSafeInteger(q.estimatedMicroUSD)&&q.estimatedMicroUSD>=0&&(q.spendLimitMicroUSD??q.estimatedMicroUSD)>=q.estimatedMicroUSD&&q.expiresAt>Date.now()&&balance>=q.estimatedMicroUSD&&q.canAfford!==false;}

/** Explicit actions only. Polling calls read(); it never recreates or submits an intent. */
export function createDirectorClient(request:FilmRequest){
 const execute=async<T>(operation:FilmOperation,input:Record<string,unknown>={},requestId=localId()):Promise<T>=>{const value=await request(operation,input,requestId);if(isFailure(value))throw Error(value.error);return value as T;};
 async function storeText(text:string,requestId=localId()){
  if(!text.trim()||text.length>1000000)throw Error('النص فارغ أو يتجاوز مليون حرف؛ لم يُقتطع منه شيء.');
  const start=await execute<{id:string}>('production.source.begin',{requestId,totalCharacters:text.length},requestId);
  let chunks=0;for(let offset=0;offset<text.length;offset+=12000){await execute('production.source.chunk',{id:start.id,index:chunks,text:text.slice(offset,offset+12000)},requestId+'-'+chunks);chunks++;}
  await execute('production.source.complete',{id:start.id,chunkCount:chunks},requestId+'-complete');return start.id;
 }
 async function create(text:string,requestId=localId()){
  const source=text.length>20000?{sourceId:await storeText(text,requestId+'-source')}:{story:text};
  return execute<ProductionProject>('production.create',{requestId,title:text.trim().slice(0,100)||'قصة جديدة',durationMs:10000,...source},requestId);
 }
 async function message(id:string,text:string){
  const requestId=localId(),body=text.length>20000?{textId:await storeText(text,requestId+'-source')}:{text};
  const offer=await execute<TextOffer>('director.message.quote',{id,requestId,...body},requestId);
  return {offer,operation:'director.message',requestId:localId()} as TextIntent;
 }
 async function plan(id:string,action:PlanAction){const requestId=localId(),offer=await execute<TextOffer>('director.plan.quote',{id,requestId,...action},requestId);return {offer,operation:'director.plan',requestId:localId()} as TextIntent;}
 async function research(id:string,query?:string){const requestId=localId(),offer=await execute<TextOffer>('director.research.quote',{id,requestId,...(query?{query}:{}),maxCalls:1,maxTokens:1600},requestId);return {offer,operation:'director.research',requestId:localId()} as TextIntent;}
 async function submit(intent:TextIntent){if(!intent.offer.dispatchAvailable||intent.offer.expiresAt<=Date.now())throw Error('هذا العرض غير متاح أو انتهت صلاحيته؛ اطلب عرضاً جديداً.');return execute(intent.operation,{id:intent.offer.projectId,quoteId:intent.offer.id,requestId:intent.requestId,approvedTextCost:true},intent.requestId);}
 async function read(id:string){const [project,director]=await Promise.all([execute<ProductionProject>('production.get',{id}),execute<DirectorState>('director.get',{id})]);return {project,director};}
 async function approve(q:ProductionOffer,balance:number,requestId=localId()){
  if(!canApproveProduction(q,balance))throw Error('المحركات أو التكلفة أو الرصيد غير جاهزة؛ لم يبدأ إنتاج.');
  return execute<ProductionProject>('production.approve',{id:q.projectId,quoteId:q.id,requestId,approved:true,spendLimitMicroUSD:q.spendLimitMicroUSD??q.estimatedMicroUSD},requestId);
 }
 return {execute,storeText,create,message,plan,research,submit,read,approve};
}
