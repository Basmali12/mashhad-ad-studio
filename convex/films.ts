import {filmPlan} from './filmValidators';
import {PLAN_INSTRUCTIONS,planSchema,validatePlan,type FilmPlan} from '../shared/film-plan';
import {ConvexError, v} from 'convex/values';
import {mutation, query, internalMutation, internalQuery, internalAction, type QueryCtx, type MutationCtx} from './_generated/server';
import {internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {FILM_MODEL, FILM_INSTRUCTIONS, FILM_OUTPUT_LIMIT, FILM_PROJECT_BUDGET, FILM_DAILY_BUDGET, filmReserve, filmUsage, parseFilmReply} from '../shared/film-chat';

export async function signed(ctx: Pick<QueryCtx | MutationCtx, 'auth'|'db'>) {
 const identity = await ctx.auth.getUserIdentity();
 if (!identity || identity.issuer !== process.env.CLERK_JWT_ISSUER_DOMAIN) throw new ConvexError('سجّل الدخول أولًا.');
 const wallet = await ctx.db.query('pointWallets').withIndex('by_subject', q=>q.eq('subject',identity.subject)).unique();
 if (identity.subject !== process.env.OWNER_SUBJECT && !wallet?.enabled) throw new ConvexError('الحساب غير مخوّل.');
 return identity.subject;
}
export async function owned(ctx: QueryCtx | MutationCtx, id: Id<'filmProjects'>) {
 const subject = await signed(ctx), project = await ctx.db.get(id);
 if (!project || project.subject !== subject) throw new ConvexError('المشروع غير متاح.');
 return project;
}
export const list = query({args:{},handler:async ctx=>{
 const subject=await signed(ctx);
 return ctx.db.query('filmProjects').withIndex('by_subject',q=>q.eq('subject',subject)).order('desc').take(50);
}});
export const state = query({args:{projectId:v.id('filmProjects')},handler:async(ctx,a)=>{
 const project=await owned(ctx,a.projectId);
 const turns=await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',a.projectId)).order('asc').take(100);
 return {project,turns:turns.map(t=>({ _id:t._id,episode:t.planRequest?.episode,userText:t.userText,reply:t.reply,brief:t.brief,status:t.status,error:t.error,costMicros:t.costMicros,createdAt:t.createdAt})),configured:!!process.env.OPENAI_API_KEY};
}});
export const create = mutation({args:{key:v.string(),title:v.string()},handler:async(ctx,a)=>{
 const subject=await signed(ctx),title=a.title.trim();
 if(!title||title.length>120||a.key.length>100)throw new ConvexError('أدخل اسمًا للفيلم حتى 120 حرفًا.');
 const key=`${subject}:${a.key}`,prior=await ctx.db.query('filmProjects').withIndex('by_key',q=>q.eq('key',key)).unique();
 if(prior)return prior._id;
 if((await ctx.db.query('filmProjects').withIndex('by_subject',q=>q.eq('subject',subject)).take(50)).length>=50)throw new ConvexError('وصلت إلى حد مشاريع المناقشة.');
 return ctx.db.insert('filmProjects',{subject,key,title,brief:'',budgetMicros:FILM_PROJECT_BUDGET,spentMicros:0,heldMicros:0,createdAt:Date.now(),updatedAt:Date.now()});
}});
export async function enqueue(ctx:MutationCtx,a:{projectId:Id<'filmProjects'>;key:string;text:string},planRequest?:{previousPlans?:string;episode:number;seconds:number;snapshot:string;revision:number;brief:string}){
 const p=await owned(ctx,a.projectId),text=a.text.trim();
 if(!text||text.length>4000||a.key.length>100)throw new ConvexError('الرسالة مطلوبة وحتى 4000 حرف.');
 if(/sk-[a-zA-Z0-9_-]{12,}/.test(text))throw new ConvexError('لا تضع مفاتيح خدمات في المناقشة.');
 const key=`${p._id}:${a.key}`,prior=await ctx.db.query('filmTurns').withIndex('by_key',q=>q.eq('key',key)).unique();
 if(prior){if(prior.userText!==text)throw new ConvexError('هذا الإرسال محفوظ بنص مختلف.');return prior._id;}
 if(!process.env.OPENAI_API_KEY)throw new ConvexError('مساعد المناقشة غير متاح حاليًا.');
 const turns=await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();
 if(turns.some(t=>['queued','running'].includes(t.status)))throw new ConvexError('انتظر الرد الحالي قبل رسالة جديدة.');
 if(turns.length>=100)throw new ConvexError('وصل النقاش إلى حد الرسائل لهذا المشروع.');
 const context=JSON.stringify([...turns.filter(t=>t.status==='completed').flatMap(t=>[{role:'user',content:t.userText},{role:'assistant',content:JSON.stringify({reply:t.reply,brief:t.brief})}]),{role:'user',content:text}]);
 if(new TextEncoder().encode(context+(planRequest?.snapshot??'')).length>60_000)throw new ConvexError('وصل النقاش إلى حد السياق؛ احتفظ بالمشروع وابدأ نقاشًا جديدًا.');
 const reserve=filmReserve(context+(planRequest?.snapshot??'')+(planRequest?PLAN_INSTRUCTIONS:''))+(planRequest?6000:0);
 if(p.spentMicros+p.heldMicros+reserve>p.budgetMicros)throw new ConvexError('وصلت إلى حد كلفة مناقشة هذا الفيلم.');
 const date=new Date().toISOString().slice(0,10),dailyKey=`global:${date}`;
 const daily=await ctx.db.query('filmBudgets').withIndex('by_key',q=>q.eq('key',dailyKey)).unique();
 if((daily?.usedMicros??0)+reserve>FILM_DAILY_BUDGET)throw new ConvexError('وصل مساعد المناقشة إلى حد الصرف اليومي.');
 if(daily)await ctx.db.patch(daily._id,{usedMicros:daily.usedMicros+reserve});else await ctx.db.insert('filmBudgets',{key:dailyKey,usedMicros:reserve});
 if(planRequest)planRequest={...planRequest,snapshot:JSON.stringify({storyContext:JSON.parse(context),planContext:JSON.parse(planRequest.snapshot)})};
 const id=await ctx.db.insert('filmTurns',{projectId:p._id,subject:p.subject,key,...(planRequest?{planRequest}:{}),userText:text,status:'queued',reserveMicros:reserve,dailyKey,createdAt:Date.now(),updatedAt:Date.now()});
 await ctx.db.patch(p._id,{heldMicros:p.heldMicros+reserve,updatedAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.films.respond,{turnId:id});
 return id;
}
export const send = mutation({args:{projectId:v.id('filmProjects'),key:v.string(),text:v.string()},handler:(ctx,a)=>enqueue(ctx,a)});
export const claim = internalMutation({args:{turnId:v.id('filmTurns')},handler:async(ctx,a)=>{
 const turn=await ctx.db.get(a.turnId);if(!turn||turn.status!=='queued')return null;
 await ctx.db.patch(turn._id,{status:'running',updatedAt:Date.now()});
 return turn;
}});
export const context = internalQuery({args:{projectId:v.id('filmProjects')},handler:async(ctx,a)=>{
 return (await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',a.projectId)).order('asc').take(100)).filter(t=>t.status==='completed').flatMap(t=>[{role:'user' as const,content:t.userText},{role:'assistant' as const,content:JSON.stringify({reply:t.reply,brief:t.brief})}]);
}});
export const checkPending = mutation({args:{projectId:v.id('filmProjects')},handler:async(ctx,a)=>{
 await owned(ctx,a.projectId);
 const turns=await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',a.projectId)).collect();
 for(const turn of turns){if(['queued','running'].includes(turn.status)&&Date.now()-turn.updatedAt>180_000)await ctx.db.patch(turn._id,{status:'unknown',error:'تعذر تأكيد الرد السابق. بقيت كلفته محجوزة دون إعادة إرسال تلقائية.',updatedAt:Date.now()});}
}});
export const checkModel = internalAction({args:{},handler:async()=>{
 if(!process.env.OPENAI_API_KEY)return {available:false,status:0};
 const r=await fetch(`https://api.openai.com/v1/models/${FILM_MODEL}`,{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(15000)});
 return {available:r.ok,status:r.status,model:FILM_MODEL};
}});
export const finish = internalMutation({args:{turnId:v.id('filmTurns'),status:v.union(v.literal('completed'),v.literal('failed'),v.literal('unknown')),reply:v.optional(v.string()),brief:v.optional(v.string()),error:v.optional(v.string()),costMicros:v.optional(v.number()),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number()),responseId:v.optional(v.string()),plan:v.optional(filmPlan)},handler:async(ctx,a)=>{
 const turn=await ctx.db.get(a.turnId);if(!turn||turn.status!=='running')return;
 const p=await ctx.db.get(turn.projectId);if(!p)throw new Error('Missing project');
 const known=a.costMicros!==undefined;
 if(known&&(!Number.isSafeInteger(a.costMicros)||a.costMicros!<0))throw new Error('Invalid cost');
 const daily=await ctx.db.query('filmBudgets').withIndex('by_key',q=>q.eq('key',turn.dailyKey)).unique();
 if(known){await ctx.db.patch(p._id,{heldMicros:p.heldMicros-turn.reserveMicros,spentMicros:p.spentMicros+a.costMicros!,brief:a.brief??p.brief,updatedAt:Date.now()});if(daily)await ctx.db.patch(daily._id,{usedMicros:daily.usedMicros-turn.reserveMicros+a.costMicros!});}
 else await ctx.db.patch(p._id,{updatedAt:Date.now()}); // Unknown provider usage remains reserved, never presented as actual spend.
 if(a.plan&&turn.planRequest){const pr=turn.planRequest;const refs=await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();validatePlan(a.plan,pr.seconds,refs);const old=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();await ctx.db.insert('filmEpisodes',{projectId:p._id,previousPlans:pr.previousPlans??'[]',episode:pr.episode,version:1+Math.max(0,...old.filter(e=>e.episode===pr.episode).map(e=>e.version)),plan:a.plan,referenceRevision:pr.revision,brief:pr.brief,approved:false,createdAt:Date.now()});}
 const {turnId,plan:discardedPlan,...values}=a;void discardedPlan;await ctx.db.patch(turnId,{...values,updatedAt:Date.now()});
}});
export const respond = internalAction({args:{turnId:v.id('filmTurns')},handler:async(ctx,a)=>{
 const turn=await ctx.runMutation(internal.films.claim,a);if(!turn)return;
 let settled=false;
 try{
  const history=await ctx.runQuery(internal.films.context,{projectId:turn.projectId});
  const planContext=turn.planRequest?JSON.parse(turn.planRequest.snapshot).planContext as {references:{_id:string;kind:string}[]}:null;
  const outputSchema=structuredClone(planSchema);
  if(planContext){Object.assign(outputSchema.properties.scenes.items.properties.cast.items,{enum:planContext.references.filter(r=>r.kind==='character').map(r=>r._id)});Object.assign(outputSchema.properties.scenes.items.properties.place,{enum:planContext.references.filter(r=>r.kind==='place').map(r=>r._id)});}
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(60_000),body:JSON.stringify({model:FILM_MODEL,instructions:turn.planRequest?PLAN_INSTRUCTIONS:FILM_INSTRUCTIONS,input:turn.planRequest?[{role:'user',content:turn.planRequest.snapshot}]:[...history,{role:'user',content:turn.userText}],max_output_tokens:turn.planRequest?5000:FILM_OUTPUT_LIMIT,reasoning:{effort:'none'},store:false,text:{format:{type:'json_schema',name:'film_discussion',strict:true,schema:turn.planRequest?outputSchema:{type:'object',properties:{reply:{type:'string'},brief:{type:'string'}},required:['reply','brief'],additionalProperties:false}}}})});
  if(!response.ok){const status=response.status;await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:status>=500?'unknown':'failed',...(status<500?{costMicros:0}:{}),error:status===401?'تعذر اتصال المساعد؛ يلزم مراجعة إعداد الحساب.':status===429?'المساعد غير متاح بسبب حد الاستخدام أو الرصيد. لم نعد الإرسال.':'تعذر رد المساعد. لم نعد الإرسال تلقائيًا.'});settled=true;return;}
  const data=await response.json() as {id?:string;status?:string;usage?:{input_tokens:number;output_tokens:number};output?:{content?:{type:string;text?:string}[]}[]};
  const usage=data.usage?{costMicros:filmUsage(data.usage.input_tokens,data.usage.output_tokens),inputTokens:data.usage.input_tokens,outputTokens:data.usage.output_tokens}:{};
  try{if(data.status!=='completed')throw new Error('Incomplete');const raw=data.output?.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('')??'';if(turn.planRequest&&planContext)validatePlan(JSON.parse(raw) as FilmPlan,turn.planRequest.seconds,planContext.references);const parsed=turn.planRequest?{reply:'حُفظت مسودة سيناريو الحلقة؛ راجعها في تبويبة الحلقات قبل الاعتماد.',plan:JSON.parse(raw) as FilmPlan}:parseFilmReply(raw);await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:'completed',...parsed,...usage,responseId:data.id});}
  catch(e){const message=e instanceof Error?e.message:'';const safe=['الخطة غير صالحة؛ يجب أن تحتوي من 1 إلى 12 مشهدًا.','تحقق من مدة المشهد وشخصياته ومكانه المسجل.','مجموع مدد المشاهد يجب أن يساوي مدة الحلقة المطلوبة.','الخطة تحتوي بيانات غير مناسبة.'];await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:'failed',...usage,responseId:data.id,error:safe.includes(message)?message+' لم نعد التخطيط تلقائيًا.':'لم يصل رد صالح للعرض. حُفظ النقاش؛ لا توجد إعادة إرسال تلقائية.'});}
  settled=true;
 }catch{if(!settled)await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:'unknown',error:'تعذر تأكيد نتيجة الاتصال. لا تعِد إرسال الرسالة نفسها؛ قد تكون كلفة المناقشة حُسبت.'});}
}});
