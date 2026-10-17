import {v,ConvexError} from 'convex/values';
import {mutation,query,internalMutation,internalQuery} from './_generated/server';
import {internal} from './_generated/api';
import {signed} from './films';
import {containsFilmSecret} from '../shared/film-safety';
import {STORY_SEARCH_CAP} from '../shared/story-search';
import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
async function own(ctx:MutationCtx|QueryCtx,id:Id<'storyProjects'>){const subject=await signed(ctx),p=await ctx.db.get(id);if(!p||p.subject!==subject)throw new ConvexError('القصة غير متاحة.');return p;}
export const list=query({args:{projectId:v.id('storyProjects')},handler:async(ctx,a)=>{await own(ctx,a.projectId);const rows=await ctx.db.query('storySearches').withIndex('by_project',q=>q.eq('projectId',a.projectId)).order('desc').take(40);return {configured:!!process.env.OPENAI_API_KEY,cap:STORY_SEARCH_CAP,items:rows.map(j=>({ ...j,context:undefined }))};}});
export const search=mutation({args:{projectId:v.id('storyProjects'),key:v.string(),query:v.string()},handler:async(ctx,a)=>{
 const p=await own(ctx,a.projectId),query=a.query.trim(),key=`${p.subject}:${a.key}`;
 if(!/^[\w-]{8,100}$/.test(a.key)||!query||query.length>500||containsFilmSecret(query))throw new ConvexError('اكتب عبارة بحث حتى 500 حرف دون مفاتيح خدمات.');
 const old=await ctx.db.query('storySearches').withIndex('by_key',q=>q.eq('key',key)).unique();if(old){if(old.projectId!==p._id||old.query!==query)throw new ConvexError('الطلب محفوظ بمحتوى مختلف.');return old._id;}
 if(!process.env.OPENAI_API_KEY)throw new ConvexError('خدمة البحث غير مفعّلة.');
 const jobs=await ctx.db.query('storySearches').withIndex('by_subject',q=>q.eq('subject',p.subject)).collect();if(jobs.some(j=>['queued','running','unknown'].includes(j.status)))throw new ConvexError('انتظر حسم البحث السابق؛ لا إعادة تلقائية.');if(jobs.filter(j=>j.createdAt>Date.now()-86400000).length>=5||jobs.filter(j=>j.projectId===p._id).length>=40)throw new ConvexError('وصلت حد البحث: 5 طلبات خلال 24 ساعة و40 لكل قصة.');
 const wallet=await ctx.db.query('aiWallets').withIndex('by_subject',q=>q.eq('subject',p.subject)).unique();if(!wallet||wallet.balanceMicros-wallet.heldMicros<STORY_SEARCH_CAP)throw new ConvexError('اشحن رصيد عقل القصة؛ الحجز الاحتياطي للبحث $0.10.');
 const chars=await ctx.db.query('storyCharacters').withIndex('by_project',q=>q.eq('projectId',p._id)).collect(),film=await ctx.db.get(p.filmId),episodes=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p.filmId)).collect();
 const analysis=p.analysisId?await ctx.db.get(p.analysisId):null;
 const context=JSON.stringify({title:film!.title,agreement:film!.brief,referenceDescription:analysis?.report?JSON.parse(analysis.report).summary:null,characters:chars.filter(c=>c.phase==='approved').map(c=>({name:c.name,role:c.role})),episodes:episodes.filter(e=>e.approved&&!episodes.some(o=>o.episode===e.episode&&o.version>e.version)).slice(-6).map(e=>({episode:e.episode,synopsis:e.plan.synopsis,ending:e.plan.ending}))}).slice(0,10000);
 const id=await ctx.db.insert('storySearches',{projectId:p._id,subject:p.subject,key,query,context,walletId:wallet._id,held:STORY_SEARCH_CAP,status:'queued',createdAt:Date.now()});
 await ctx.db.patch(wallet._id,{heldMicros:wallet.heldMicros+STORY_SEARCH_CAP});await ctx.db.insert('aiLedger',{key:`story-search-reserve-${id}`,walletId:wallet._id,kind:'reserve',amountMicros:0,balanceAfter:wallet.balanceMicros,heldAfter:wallet.heldMicros+STORY_SEARCH_CAP,note:'حجز بحث مصادر القصة؛ المتبقي يعود بعد تسوية الاستخدام',actor:p.subject,createdAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.storyResearchRun.run,{id});await ctx.scheduler.runAfter(180000,internal.storyResearch.timeout,{id});return id;
}});
export const claim=internalMutation({args:{id:v.id('storySearches')},handler:async(ctx,a)=>{const j=await ctx.db.get(a.id);if(j?.status!=='queued')return null;await ctx.db.patch(j._id,{status:'running'});return j;}});
export const timeout=internalMutation({args:{id:v.id('storySearches')},handler:async(ctx,a)=>{const j=await ctx.db.get(a.id);if(j&&['queued','running'].includes(j.status))await ctx.db.patch(j._id,{status:'unknown',error:'انتهت مهلة المتابعة؛ الحجز محفوظ حتى حسم الاستخدام، ولا يعاد البحث تلقائيًا.'});}});
export const snapshot=internalQuery({args:{id:v.id('storySearches')},handler:(ctx,a)=>ctx.db.get(a.id)});
export const finish=internalMutation({args:{id:v.id('storySearches'),cost:v.optional(v.number()),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number()),cachedTokens:v.optional(v.number()),searchCalls:v.optional(v.number()),result:v.optional(v.string()),sources:v.optional(v.array(v.object({url:v.string(),title:v.string()}))),error:v.optional(v.string())},handler:async(ctx,a)=>{
 const j=await ctx.db.get(a.id);if(!j||['completed','failed'].includes(j.status))return;
 if(a.cost===undefined){await ctx.db.patch(j._id,{status:'unknown',error:a.error??'الاستخدام غير محسوم؛ لا إعادة تلقائية.'});return;}
 if(!Number.isSafeInteger(a.cost)||a.cost<0||a.cost>STORY_SEARCH_CAP)throw new Error('Invalid search usage');const w=await ctx.db.get(j.walletId);if(!w)throw new Error('Missing wallet');
 await ctx.db.patch(w._id,{balanceMicros:w.balanceMicros-a.cost,spentMicros:w.spentMicros+a.cost,heldMicros:w.heldMicros-j.held,updatedAt:Date.now()});await ctx.db.insert('aiLedger',{key:`story-search-settle-${j._id}`,walletId:w._id,kind:'settle',amountMicros:-a.cost,balanceAfter:w.balanceMicros-a.cost,heldAfter:w.heldMicros-j.held,note:'تسوية البحث حسب استخدام API والتسعير المنشور وإعادة الحجز المتبقي؛ ليست فاتورة المزود',actor:j.subject,createdAt:Date.now()});
 const {id,...values}=a;void id;await ctx.db.patch(j._id,{...values,held:0,status:a.result&&!a.error?'completed':'failed'});
}});
export const nextEpisode=mutation({args:{projectId:v.id('storyProjects'),revision:v.number(),agreement:v.string(),sourceId:v.optional(v.id('storySearches'))},handler:async(ctx,a)=>{
 const p=await own(ctx,a.projectId),agreement=a.agreement.trim();if((p.settingsRevision??0)!==a.revision)throw new ConvexError('تغيّرت الحلقة؛ أعد فتح القصة.');if(!agreement||agreement.length>3000||containsFilmSecret(agreement))throw new ConvexError('راجع اتفاق التكملة حتى 3000 حرف.');
 if(a.sourceId){const search=await ctx.db.get(a.sourceId);if(search?.projectId!==p._id||search.status!=='completed')throw new ConvexError('مصدر البحث لا يخص هذه القصة أو لم يكتمل.');}
 const turns=await ctx.db.query('filmTurns').withIndex('by_project',q=>q.eq('projectId',p.filmId)).collect();if(turns.some(t=>['queued','running','unknown'].includes(t.status)))throw new ConvexError('انتظر حسم المحادثة الجارية قبل التكملة.');const current=p.currentEpisode??1;if(current>=6)throw new ConvexError('الحد الحالي 6 حلقات للقصة.');
 const episodes=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p.filmId)).collect(),prior=episodes.filter(e=>e.episode===current).sort((a,b)=>b.version-a.version)[0],jobs=await ctx.db.query('filmProductions').withIndex('by_project',q=>q.eq('projectId',p.filmId)).collect();if(!prior?.approved||!jobs.some(j=>j.episodeId===prior._id&&j.stage==='completed'&&j.finalId))throw new ConvexError('أكمل إنتاج الحلقة الحالية قبل بدء التكملة.');
 const film=(await ctx.db.get(p.filmId))!;await ctx.db.patch(p._id,{currentEpisode:current+1,settingsRevision:a.revision+1});await ctx.db.patch(film._id,{brief:agreement,settings:{...film.settings!,episodes:current+1},referenceRevision:(film.referenceRevision??0)+1,updatedAt:Date.now()});
 await ctx.db.insert('filmTurns',{projectId:film._id,key:`story-next-${p._id}-${current+1}`,userText:`اتفاق الحلقة ${current+1}: ${agreement}`,reply:a.sourceId?'تكملة جديدة وافق عليها المستخدم بعد مراجعة مصادر محتملة؛ ليست نقلًا للقصة الأصلية.':'تكملة أصلية وافق عليها المستخدم.',subject:p.subject,reserveMicros:0,dailyKey:'manual',costMicros:0,status:'completed',createdAt:Date.now(),updatedAt:Date.now()});return current+1;
}});
