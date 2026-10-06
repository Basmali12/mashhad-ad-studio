import {discussionLanguage,assertIraqiDialogue} from '../shared/iraqi-dialect';
import {containsFilmSecret,filmInputIssue} from '../shared/film-safety';
import {filmPlan,filmSettings} from './filmValidators';
import {PLAN_INSTRUCTIONS,planSchema,validatePlan,validateEpisodeSegments,type FilmPlan} from '../shared/film-plan';
import {ConvexError, v} from 'convex/values';
import {mutation, query, internalMutation, internalQuery, internalAction, type QueryCtx, type MutationCtx} from './_generated/server';
import {internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {FILM_MODEL, FILM_INSTRUCTIONS, FILM_OUTPUT_LIMIT, FILM_PROJECT_BUDGET, FILM_DAILY_BUDGET, filmReserve, filmUsage, parseFilmReply, parseFilmProposal} from '../shared/film-chat';

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
 return (await ctx.db.query('filmProjects').withIndex('by_subject',q=>q.eq('subject',subject)).order('desc').take(50)).map(project=>({...project,canRename:true}));
}});
export const state = query({args:{projectId:v.id('filmProjects')},handler:async(ctx,a)=>{
 const project=await owned(ctx,a.projectId);
 const turns=await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',a.projectId)).order('asc').take(100);
 return {canRename:true,project,turns:turns.map(t=>({ _id:t._id,episode:t.planRequest?.episode,userText:t.userText,reply:t.reply,brief:t.brief,status:t.status,error:t.error,costMicros:t.costMicros,createdAt:t.createdAt})),configured:!!process.env.OPENAI_API_KEY};
}});
export const create = mutation({args:{key:v.string(),title:v.string()},handler:async(ctx,a)=>{
 const subject=await signed(ctx),title=a.title.trim();
 if(!title||title.length>120||a.key.length>100)throw new ConvexError('أدخل اسمًا للفيلم حتى 120 حرفًا.');
 const key=`${subject}:${a.key}`,prior=await ctx.db.query('filmProjects').withIndex('by_key',q=>q.eq('key',key)).unique();
 if(prior)return prior._id;
 if((await ctx.db.query('filmProjects').withIndex('by_subject',q=>q.eq('subject',subject)).take(50)).length>=50)throw new ConvexError('وصلت إلى حد مشاريع المناقشة.');
 return ctx.db.insert('filmProjects',{subject,key,title,brief:'',budgetMicros:FILM_PROJECT_BUDGET,spentMicros:0,heldMicros:0,createdAt:Date.now(),updatedAt:Date.now()});
}});
export const rename=mutation({args:{projectId:v.id('filmProjects'),title:v.string(),expectedTitle:v.string()},handler:async(ctx,a)=>{
 const project=await owned(ctx,a.projectId),title=a.title.trim();
 if(!title||title.length>120||containsFilmSecret(title))throw new ConvexError('أدخل اسم جلسة صالحًا حتى 120 حرفًا دون مفاتيح خدمات.');
 if(project.title===title)return project._id;
 if(project.title!==a.expectedTitle)throw new ConvexError('تغيّر اسم الجلسة؛ أعد فتح التعديل قبل الحفظ.');
 await ctx.db.patch(project._id,{title,updatedAt:Date.now()});return project._id;
}});
export async function enqueue(ctx:MutationCtx,a:{projectId:Id<'filmProjects'>;key:string;text:string},planRequest?:{previousPlans?:string;episode:number;seconds:number;snapshot:string;revision:number;brief:string}){
 const p=await owned(ctx,a.projectId),text=a.text.trim();
 if(!text||text.length>4000||a.key.length>100)throw new ConvexError('الرسالة مطلوبة وحتى 4000 حرف.');
 const scopeIssue=filmInputIssue(text);if(scopeIssue)throw new ConvexError(scopeIssue);
 if(planRequest&&containsFilmSecret(planRequest.snapshot))throw new ConvexError('لا تضع مفاتيح خدمات في المراجع.');
 const key=`${p._id}:${a.key}`,prior=await ctx.db.query('filmTurns').withIndex('by_key',q=>q.eq('key',key)).unique();
 if(prior){if(prior.userText!==text)throw new ConvexError('هذا الإرسال محفوظ بنص مختلف.');if(planRequest&&(!prior.planRequest||prior.planRequest.seconds!==planRequest.seconds||JSON.stringify(JSON.parse(prior.planRequest.snapshot).planContext)!==planRequest.snapshot))throw new ConvexError('تغير تخطيط الحلقة؛ استخدم طلبًا جديدًا بعد مراجعة الإعدادات.');return prior._id;}
 if(!process.env.OPENAI_API_KEY)throw new ConvexError('مساعد المناقشة غير متاح حاليًا.');
 const turns=await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();
 if(turns.some(t=>['queued','running'].includes(t.status)))throw new ConvexError('انتظر الرد الحالي قبل رسالة جديدة.');
 if(turns.length>=100)throw new ConvexError('وصل النقاش إلى حد الرسائل لهذا المشروع.');
 const context=JSON.stringify([...turns.filter(t=>t.status==='completed').flatMap(t=>[{role:'user',content:t.userText},{role:'assistant',content:JSON.stringify({reply:t.reply,brief:t.brief})}]),{role:'user',content:text}]);
 if(new TextEncoder().encode(context+(planRequest?.snapshot??'')).length>60_000)throw new ConvexError('وصل النقاش إلى حد السياق؛ احتفظ بالمشروع وابدأ نقاشًا جديدًا.');
 const reserve=filmReserve(context+(planRequest?.snapshot??'')+(planRequest?PLAN_INSTRUCTIONS:''))+(planRequest?16000:0);
 const aiWallet=await ctx.db.query('aiWallets').withIndex('by_subject',q=>q.eq('subject',p.subject)).unique();
 if(!aiWallet||aiWallet.balanceMicros-aiWallet.heldMicros<reserve)throw new ConvexError('رصيد المناقشة لا يكفي لهذا الطلب. اشحن محفظة الذكاء الاصطناعي عبر الإدارة.');
 const date=new Date().toISOString().slice(0,10),dailyKey=`global:${date}`;
 const daily=await ctx.db.query('filmBudgets').withIndex('by_key',q=>q.eq('key',dailyKey)).unique();
 if((daily?.usedMicros??0)+reserve>FILM_DAILY_BUDGET)throw new ConvexError('وصل مساعد المناقشة إلى حد الصرف اليومي.');
 if(daily)await ctx.db.patch(daily._id,{usedMicros:daily.usedMicros+reserve});else await ctx.db.insert('filmBudgets',{key:dailyKey,usedMicros:reserve});
 if(planRequest)planRequest={...planRequest,snapshot:JSON.stringify({storyContext:JSON.parse(context),planContext:JSON.parse(planRequest.snapshot)})};
 const id=await ctx.db.insert('filmTurns',{projectId:p._id,subject:p.subject,aiWalletId:aiWallet._id,key,...(planRequest?{planRequest}:{}),userText:text,status:'queued',reserveMicros:reserve,dailyKey,createdAt:Date.now(),updatedAt:Date.now()});
 await ctx.db.patch(aiWallet._id,{heldMicros:aiWallet.heldMicros+reserve,updatedAt:Date.now()});
 await ctx.db.insert('aiLedger',{key:'reserve-'+id,walletId:aiWallet._id,kind:'reserve',amountMicros:0,balanceAfter:aiWallet.balanceMicros,heldAfter:aiWallet.heldMicros+reserve,note:'حجز مؤقت للمناقشة أو تخطيط الحلقة',actor:p.subject,createdAt:Date.now()});
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
export const language = internalQuery({args:{projectId:v.id('filmProjects')},handler:async(ctx,a)=>{const p=await ctx.db.get(a.projectId);if(p?.settings?.dialect)return p.settings.dialect;const b=p?await ctx.db.query('branding').withIndex('by_key',q=>q.eq('key',p.subject===process.env.OWNER_SUBJECT?'owner':p.subject)).unique():null;return b?.generationLanguage?.language==='en'?'English':b?.generationLanguage?.dialect??'العراقية';}});
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
export const finish = internalMutation({args:{turnId:v.id('filmTurns'),status:v.union(v.literal('completed'),v.literal('failed'),v.literal('unknown')),reply:v.optional(v.string()),brief:v.optional(v.string()),error:v.optional(v.string()),costMicros:v.optional(v.number()),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number()),responseId:v.optional(v.string()),plan:v.optional(filmPlan),proposal:v.optional(filmSettings)},handler:async(ctx,a)=>{
 const turn=await ctx.db.get(a.turnId);if(!turn||turn.status!=='running')return;
 const p=await ctx.db.get(turn.projectId);if(!p)throw new Error('Missing project');
 const known=a.costMicros!==undefined;
 if(known&&(!Number.isSafeInteger(a.costMicros)||a.costMicros!<0))throw new Error('Invalid cost');
 const daily=await ctx.db.query('filmBudgets').withIndex('by_key',q=>q.eq('key',turn.dailyKey)).unique();
 if(known&&turn.aiWalletId){const w=await ctx.db.get(turn.aiWalletId);if(!w)throw new Error('Missing AI wallet');const balance=w.balanceMicros-a.costMicros!,held=w.heldMicros-turn.reserveMicros;if(held<0||!Number.isSafeInteger(balance))throw new Error('Invalid wallet settlement');await ctx.db.patch(w._id,{balanceMicros:balance,heldMicros:held,spentMicros:w.spentMicros+a.costMicros!,updatedAt:Date.now()});await ctx.db.insert('aiLedger',{key:'settle-'+turn._id,walletId:w._id,kind:'settle',amountMicros:-a.costMicros!,balanceAfter:balance,heldAfter:held,note:'تسوية الاستخدام المسجل للمناقشة أو التخطيط',actor:turn.subject,createdAt:Date.now()});}
 if(known){await ctx.db.patch(p._id,{heldMicros:p.heldMicros-turn.reserveMicros,spentMicros:p.spentMicros+a.costMicros!,brief:a.brief??p.brief,...(a.proposal?{settings:a.proposal,referenceRevision:(p.referenceRevision??0)+(JSON.stringify(a.proposal)!==JSON.stringify(p.settings)?1:0)}:{}),updatedAt:Date.now()});if(daily)await ctx.db.patch(daily._id,{usedMicros:daily.usedMicros-turn.reserveMicros+a.costMicros!});}
 else await ctx.db.patch(p._id,{updatedAt:Date.now()}); // Unknown provider usage remains reserved, never presented as actual spend.
 if(a.plan&&turn.planRequest){const pr=turn.planRequest;const refs=await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();validatePlan(a.plan,pr.seconds,refs);const old=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();await ctx.db.insert('filmEpisodes',{projectId:p._id,previousPlans:pr.previousPlans??'[]',episode:pr.episode,version:1+Math.max(0,...old.filter(e=>e.episode===pr.episode).map(e=>e.version)),plan:a.plan,referenceRevision:pr.revision,brief:pr.brief,approved:false,createdAt:Date.now()});}
 const {turnId,plan:discardedPlan,proposal:discardedProposal,...values}=a;void discardedPlan;void discardedProposal;await ctx.db.patch(turnId,{...values,updatedAt:Date.now()});
}});
export const respond = internalAction({args:{turnId:v.id('filmTurns')},handler:async(ctx,a)=>{
 const turn=await ctx.runMutation(internal.films.claim,a);if(!turn)return;
 let settled=false,dispatched=false;
 try{
  const history=await ctx.runQuery(internal.films.context,{projectId:turn.projectId});
  const dialect=await ctx.runQuery(internal.films.language,{projectId:turn.projectId});
  const planContext=turn.planRequest?JSON.parse(turn.planRequest.snapshot).planContext as {settings?:{dialect:string};clipSeconds?:number;references:{_id:string;kind:string;name:string;fileId?:Id<'_storage'>}[]}:null;
  const outputSchema=structuredClone(planSchema);
  if(planContext){Object.assign(outputSchema.properties.scenes.items.properties.cast.items,{enum:planContext.references.filter(r=>r.kind==='character').map(r=>r._id)});Object.assign(outputSchema.properties.scenes.items.properties.place,{enum:planContext.references.filter(r=>r.kind==='place').map(r=>r._id)});}
  const planInput:({type:'input_text';text:string}|{type:'input_image';image_url:string;detail:'low'})[]=[{type:'input_text',text:turn.planRequest?.snapshot??''}];
  if(planContext){const images=await ctx.runQuery(internal.films.planningImages,{turnId:turn._id});for(const image of images)planInput.push({type:'input_text',text:`مرجع ${image.kind}: ${image.name}؛ المعرّف ${image.id}`},{type:'input_image',image_url:image.url,detail:'low'});}
  dispatched=true;
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(60_000),body:JSON.stringify({model:FILM_MODEL,instructions:turn.planRequest?PLAN_INSTRUCTIONS:FILM_INSTRUCTIONS+'\n'+discussionLanguage(dialect),input:turn.planRequest?[{role:'user',content:planInput}]:[...history,{role:'user',content:turn.userText}],max_output_tokens:turn.planRequest?5000:FILM_OUTPUT_LIMIT,reasoning:{effort:'none'},store:false,text:{format:{type:'json_schema',name:'film_discussion',strict:true,schema:turn.planRequest?outputSchema:{type:'object',properties:{reply:{type:'string'},brief:{type:'string'},proposal:{anyOf:[{type:'null'},{type:'object',properties:{style:{type:'string'},dialect:{type:'string'},episodes:{type:'integer'},seconds:{type:'integer'}},required:['style','dialect','episodes','seconds'],additionalProperties:false}]}},required:['reply','brief','proposal'],additionalProperties:false}}}})});
  if(!response.ok){const status=response.status;await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:status>=500?'unknown':'failed',...(status<500?{costMicros:0}:{}),error:status===401?'تعذر اتصال المساعد؛ يلزم مراجعة إعداد الحساب.':status===429?'المساعد غير متاح بسبب حد الاستخدام أو الرصيد. لم نعد الإرسال.':'تعذر رد المساعد. لم نعد الإرسال تلقائيًا.'});settled=true;return;}
  const data=await response.json() as {id?:string;status?:string;usage?:{input_tokens:number;output_tokens:number};output?:{content?:{type:string;text?:string}[]}[]};
  const usage=data.usage?{costMicros:filmUsage(data.usage.input_tokens,data.usage.output_tokens),inputTokens:data.usage.input_tokens,outputTokens:data.usage.output_tokens}:{};
  try{if(data.status!=='completed')throw new Error('Incomplete');const raw=data.output?.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('')??'';if(turn.planRequest&&planContext){validatePlan(JSON.parse(raw) as FilmPlan,turn.planRequest.seconds,planContext.references);for(const scene of (JSON.parse(raw) as FilmPlan).scenes)assertIraqiDialogue(scene.dialogue,planContext.settings?.dialect??dialect);if(planContext.clipSeconds)validateEpisodeSegments(JSON.parse(raw) as FilmPlan,turn.planRequest.seconds,planContext.clipSeconds);}const parsed=turn.planRequest?{reply:'حُفظت مسودة سيناريو الحلقة؛ راجعها في تبويبة الحلقات قبل الاعتماد.',plan:JSON.parse(raw) as FilmPlan}:{...parseFilmReply(raw),proposal:parseFilmProposal(raw)};await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:'completed',...parsed,...usage,responseId:data.id});}
  catch(e){const message=e instanceof Error?e.message:'';const safe=['الحوار يحتوي مفردات من لهجة أخرى؛ راجع صياغته باللهجة العراقية.','الخطة غير صالحة؛ يجب أن تحتوي من 1 إلى 40 مشهدًا.','تحقق من مدة المشهد وشخصياته ومكانه المسجل.','مجموع مدد المشاهد يجب أن يساوي مدة الحلقة المطلوبة.','الخطة تحتوي بيانات غير مناسبة.'];await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:'failed',...usage,responseId:data.id,error:safe.includes(message)?message+' لم نعد التخطيط تلقائيًا.':'لم يصل رد صالح للعرض. حُفظ النقاش؛ لا توجد إعادة إرسال تلقائية.'});}
  settled=true;
 }catch{if(!settled)await ctx.runMutation(internal.films.finish,{turnId:turn._id,status:dispatched?'unknown':'failed',...(dispatched?{}:{costMicros:0}),error:dispatched?'تعذر تأكيد نتيجة الاتصال. لا تعِد إرسال الرسالة نفسها؛ قد تكون كلفة المناقشة حُسبت.':'تعذر تجهيز صور الحلقة؛ لم يُرسل طلب للمساعد وأُعيد الحجز.'});}
}});

// Internal-only lookup of the owned planning snapshot's images.
export const planningImages=internalQuery({args:{turnId:v.id('filmTurns')},handler:async(ctx,a)=>{
 const turn=await ctx.db.get(a.turnId);if(!turn?.planRequest)return [];
 const project=await ctx.db.get(turn.projectId);if(!project||project.subject!==turn.subject)throw new Error('Invalid project');
 const snapshot=JSON.parse(turn.planRequest.snapshot).planContext as {references:{_id:Id<'filmReferences'>;fileId?:Id<'_storage'>}[]};
 const images=[];for(const item of snapshot.references){if(!item.fileId)continue;const ref=await ctx.db.get(item._id),upload=await ctx.db.query('filmUploads').withIndex('by_file',q=>q.eq('fileId',item.fileId!)).unique();
 if(!ref||ref.projectId!==project._id||!upload||upload.projectId!==project._id)throw new Error('Invalid image reference');
 const url=await ctx.storage.getUrl(item.fileId);if(!url)throw new Error('Missing image');images.push({id:ref._id,name:ref.name,kind:ref.kind,url});}return images;
}});
