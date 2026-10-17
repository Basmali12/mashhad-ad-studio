'use node';
import {TREND_INSTRUCTIONS,trendFromReport} from '../shared/trends';
import {v,ConvexError} from 'convex/values';
import {requireOwner} from './access';
import {action,internalAction} from './_generated/server';
import {api,internal} from './_generated/api';
import {ANALYSIS_MODELS,ANALYSIS_INSTRUCTIONS,parseAnalysis} from '../shared/video-analysis';
export const start=action({args:{purpose:v.optional(v.literal('trend')),key:v.string(),title:v.string(),fileId:v.id('_storage'),duration:v.number(),dialect:v.union(v.literal('العراقية'),v.literal('الفصحى')),cap:v.optional(v.number())},handler:async(ctx,a):Promise<string>=>{
 await ctx.runQuery(api.videoAnalysis.list,{});if(a.purpose==='trend')await requireOwner(ctx);
 if(!process.env.OPENROUTER_API_KEY)throw new ConvexError('أضف مفتاح OpenRouter صالحًا أولًا. لم يُحجز رصيد.');
 let accepted:boolean;
 try{const res=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},signal:AbortSignal.timeout(15000)});accepted=res.ok;}catch{throw new ConvexError('تعذر التحقق من اتصال التحليل. لم يُحجز رصيد.');}
 if(!accepted)throw new ConvexError('مفتاح OpenRouter غير مقبول. حدّث المفتاح أولًا؛ لم يُحجز رصيد.');
 return ctx.runMutation(internal.videoAnalysis.enqueue,a);
}});
export const checkConnection=action({args:{},handler:async ctx=>{
 await ctx.runQuery(api.videoAnalysis.list,{}); // Authenticated customers only; no credentials returned.
 if(!process.env.OPENROUTER_API_KEY)return {ok:false,message:'مفتاح OpenRouter غير مهيّأ.'};
 try{
 const auth=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},signal:AbortSignal.timeout(15000)});
 if(!auth.ok)return {ok:false,message:`لم يقبل OpenRouter المفتاح (HTTP ${auth.status}).`};
 const res=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(15000)});if(!res.ok)return {ok:false,message:'تعذر التحقق من توفر الموديلات.'};
 const data=await res.json() as {data:{id:string;architecture?:{input_modalities?:string[]}}[]};
 const compatible=ANALYSIS_MODELS.every(id=>data.data.some(m=>m.id===id&&m.architecture?.input_modalities?.includes('video')&&m.architecture?.input_modalities?.includes('audio')));
 return {ok:compatible,message:compatible?'الاتصال مؤكد، وموديلا Flash وPro متاحان لتحليل الفيديو والصوت. لم يُنفّذ تحليل مدفوع.':'المفتاح صالح، لكن أحد الموديلين غير متاح للفيديو والصوت؛ التحليل يحتاج مراجعة.'};
 }catch{return {ok:false,message:'تعذر الاتصال بالمزود. لم يُنفّذ تحليل أو خصم رصيد.'};}
}});
export const run=internalAction({args:{id:v.id('videoAnalyses')},handler:async(ctx,a)=>{
 const job=await ctx.runMutation(internal.videoAnalysis.claim,a);if(!job)return;
 let dispatched=false;
 try{
 const blob=await ctx.storage.get(job.fileId);if(!blob)throw new Error('الفيديو غير متاح.');
 const bytes=Buffer.from(await blob.arrayBuffer());if(blob.type==='video/mp4'?bytes.toString('ascii',4,8)!=='ftyp':bytes.readUInt32BE(0)!==0x1a45dfa3)throw new Error('صيغة الفيديو غير صالحة.');
 const video=`data:${blob.type};base64,${bytes.toString('base64')}`;
 let prior='';for(let pass=0;pass<2;pass++){
  const remaining=await ctx.runQuery(internal.videoAnalysis.snapshot,{id:job._id});
  if(!remaining||!['running','reviewing'].includes(remaining.status))return;
  if(remaining.held<=0){await ctx.runMutation(internal.videoAnalysis.checkpoint,{id:job._id,status:'needs_input',call:false,error:'اكتمل التحليل الأولي؛ لا يكفي الرصيد لمزيد من التدقيق.'});return;}
  const model=ANALYSIS_MODELS[pass];dispatched=true;
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(240000),body:JSON.stringify({model,max_tokens:job.duration>60?8192:4096,temperature:.1,provider:{allow_fallbacks:false,max_price:{prompt:pass?2.5:1,completion:pass?15:2.5}},messages:[{role:'system',content:ANALYSIS_INSTRUCTIONS+(job.purpose==='trend'?'\n'+TREND_INSTRUCTIONS:'')},{role:'user',content:[{type:'text',text:`Duration ${job.duration} seconds. Desired future spoken dialect: ${job.dialect}. Do NOT rewrite the audio transcript. ${prior?`Review the uncertain time ranges and contradictions in this first report against the original audiovisual source; return a complete corrected report, retaining verified facts: ${prior}`:'Analyze every shot.'}`},{type:'video_url',video_url:{url:video}}]}]})});
  // A failed dispatch is never retried automatically; usage may still have been billed.
  if(!res.ok)throw new Error(`مزود التحليل أعاد HTTP ${res.status}. لا إعادة إرسال تلقائية.`);
  const data=await res.json();const cost=data.usage?.cost;if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)throw new Error('لم يؤكد المزود كلفة الطلب.');
  let report;try{report=parseAnalysis(data.choices?.[0]?.message?.content??'',job.duration);if(job.purpose==='trend')trendFromReport(report);}catch{
   await ctx.runMutation(internal.videoAnalysis.checkpoint,{id:job._id,cost:cost*1e6,status:'failed',call:true,error:'وصل تقرير غير صالح؛ حُسب الاستخدام المؤكد ولم نعد المحاولة.'});return;
  }
  const needs=report.uncertainties.length>0;const terminal=!needs||pass===1;
  await ctx.runMutation(internal.videoAnalysis.checkpoint,{id:job._id,cost:cost*1e6,report:JSON.stringify(report),status:terminal?(needs?'needs_input':'completed'):'reviewing',call:true});
  dispatched=false;if(terminal)return;prior=JSON.stringify(report);
 }
 }catch(e){await ctx.runMutation(internal.videoAnalysis.checkpoint,{id:job._id,status:dispatched?'unknown':'failed',call:dispatched,error:dispatched?'تعذر حسم نتيجة أو كلفة المزود. حُفظ التقرير السابق والحجز، ولا إعادة إرسال تلقائية.':e instanceof Error?e.message:'تعذر تجهيز الفيديو.'});}
}});
