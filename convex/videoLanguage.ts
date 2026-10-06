import {v,ConvexError} from 'convex/values';
import {action,internalMutation} from './_generated/server';
import {internal} from './_generated/api';
import {ownedRequest} from './access';
import {canonical} from '../shared/editing';
import {clipPrompts,checkPlan} from '../shared/pipeline';
import {optionValidator} from './pipelineValidators';
import {walletPlan} from './walletBilling';
import {FILM_MODEL} from '../shared/film-chat';
import {productionPrompts,VIDEO_TRANSLATION_INSTRUCTIONS,type PreparedScene} from '../shared/generation-language';
import type {Doc} from './_generated/dataModel';
const args={requestId:v.id('requests'),option:optionValidator};
const snapshot=(r:Doc<'requests'>)=>canonical({form:r.form,count:r.clipCount});
export const claim=internalMutation({args,handler:async(ctx,a)=>{
 const r=await ownedRequest(ctx,a.requestId);if(r.form.productionLanguage!=='en')throw new ConvexError('هذا طلب قديم؛ احتفظ بوصفه المعتمد.');
 checkPlan(a.option,r.clipCount,r.form.duration);if(a.option.model!==r.form.model||a.option.aspect!==r.form.aspect)throw new ConvexError('إعدادات التوليد لا تطابق الطلب.');clipPrompts(r.form,r.clipCount);
 const value=snapshot(r),prior=r.promptPreparation;if(prior){if(prior.snapshot!==value)throw new ConvexError('تغير وصف الطلب؛ أنشئ طلبًا جديدًا.');if(prior.state==='completed')return null;throw new ConvexError(prior.state==='running'?'تجهيز الوصف جارٍ بالفعل؛ لا تعِد الإرسال.':'تعذر تجهيز هذا الوصف؛ أنشئ طلبًا جديدًا للمراجعة.');}
 await walletPlan(ctx,r.subject??process.env.OWNER_SUBJECT!,a.option,r.clipCount);
 const worker=await ctx.db.query('workers').withIndex('by_key',q=>q.eq('key','pipeline')).unique();if(!worker||Date.now()-worker.observedAt>3600000||!worker.options.some(o=>canonical(o)===canonical(a.option)))throw new ConvexError('انتظر تحديث خيارات التوليد.');
 if(!process.env.OPENAI_API_KEY)throw new ConvexError('تجهيز وصف الفيديو غير متاح حاليًا.');
 const input=JSON.stringify({dialect:r.form.dialect,seconds:r.form.duration/r.clipCount,scenes:[r.form.prompt,...(r.form.continuationPrompts??[]).slice(0,r.clipCount-1)],instructions:r.form.instructions,products:r.form.products,referenceGuide:r.form.placeImageGuide??'',referenceCount:r.referenceIds.length,continuation:!!r.form.continuationSourceId});
 if(input.length>60000)throw new ConvexError('الوصف طويل جدًا؛ اختصره مع الحفاظ على الحوار.');
 // Preparation is a service operating expense, never an extra customer wallet debit.
 // Reserve a conservative provider ceiling before dispatch; failures are not retried automatically.
 const reserve=Math.ceil(new TextEncoder().encode(input+VIDEO_TRANSLATION_INSTRUCTIONS).length*.2+12000*1.2+1000),key='video-language-service:'+new Date().toISOString().slice(0,10),budget=await ctx.db.query('filmBudgets').withIndex('by_key',q=>q.eq('key',key)).unique();
 if((budget?.usedMicros??0)+reserve>1_000_000)throw new ConvexError('تجهيز الفيديو غير متاح حاليًا؛ حاول لاحقًا.');
 if(budget)await ctx.db.patch(budget._id,{usedMicros:budget.usedMicros+reserve});else await ctx.db.insert('filmBudgets',{key,usedMicros:reserve});
 await ctx.db.patch(r._id,{promptPreparation:{state:'running',snapshot:value,startedAt:Date.now()}});return {input,snapshot:value,count:r.clipCount,form:r.form};
}});
export const finish=internalMutation({args:{requestId:v.id('requests'),snapshot:v.string(),scenes:v.optional(v.array(v.object({visual:v.string(),dialogue:v.string()}))),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number())},handler:async(ctx,a)=>{
 const r=await ownedRequest(ctx,a.requestId),p=r.promptPreparation;if(!p||p.state!=='running'||p.snapshot!==a.snapshot||snapshot(r)!==a.snapshot)throw new ConvexError('تغير الطلب أثناء التجهيز.');
 const prompts=a.scenes?productionPrompts(r.form,a.scenes,r.clipCount):undefined;
 await ctx.db.patch(r._id,{promptPreparation:{...p,state:prompts?'completed':'failed',prompts,inputTokens:a.inputTokens,outputTokens:a.outputTokens,error:prompts?undefined:'تعذر تأكيد تجهيز الوصف؛ لم يبدأ توليد فيديو ولا توجد إعادة تلقائية.'}});
}});
export const prepare=action({args,handler:async(ctx,a):Promise<void>=>{
 const claim=await ctx.runMutation(internal.videoLanguage.claim,a);if(!claim)return;
 let usage:{inputTokens?:number;outputTokens?:number}={};
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(60000),body:JSON.stringify({model:FILM_MODEL,store:false,reasoning:{effort:'none'},instructions:VIDEO_TRANSLATION_INSTRUCTIONS,input:claim.input,max_output_tokens:12000,text:{format:{type:'json_schema',name:'video_production_language',strict:true,schema:{type:'object',properties:{scenes:{type:'array',items:{type:'object',properties:{visual:{type:'string'},dialogue:{type:'string'}},required:['visual','dialogue'],additionalProperties:false}}},required:['scenes'],additionalProperties:false}}}})});
  if(!response.ok)throw new Error('Provider unavailable');
  const data=await response.json() as {status?:string;usage?:{input_tokens:number;output_tokens:number};output?:{content?:{type:string;text?:string}[]}[]};
  if(data.usage)usage={inputTokens:data.usage.input_tokens,outputTokens:data.usage.output_tokens};if(data.status!=='completed')throw new Error('Incomplete');
  const raw=data.output?.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('')??'',scenes=(JSON.parse(raw) as {scenes:PreparedScene[]}).scenes;productionPrompts(claim.form,scenes,claim.count);
  await ctx.runMutation(internal.videoLanguage.finish,{requestId:a.requestId,snapshot:claim.snapshot,scenes,...usage});
 }catch{await ctx.runMutation(internal.videoLanguage.finish,{requestId:a.requestId,snapshot:claim.snapshot,...usage});throw new ConvexError('تعذر تجهيز وصف الفيديو. لم يبدأ توليد أو خصم نقاط فيديو، ولم نعد الإرسال تلقائيًا.');}
}});
