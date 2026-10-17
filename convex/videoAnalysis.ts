import {requireOwner} from './access';
import {v,ConvexError} from 'convex/values';
import {mutation,query,internalMutation,internalQuery} from './_generated/server';
import {internal} from './_generated/api';
import {signed} from './films';
export const list=query({args:{},handler:async ctx=>{const subject=await signed(ctx);return {configured:!!process.env.OPENROUTER_API_KEY,items:await ctx.db.query('videoAnalyses').withIndex('by_subject',q=>q.eq('subject',subject)).order('desc').take(40)};}});
export const upload=mutation({args:{hash:v.string(),size:v.number(),type:v.string()},handler:async(ctx,a)=>{const subject=await signed(ctx);if(!/^[a-f0-9]{64}$/.test(a.hash)||!Number.isSafeInteger(a.size)||a.size<12||!['video/mp4','video/webm'].includes(a.type))throw new ConvexError('ملف غير صالح.');const old=await ctx.db.query('analysisUploads').withIndex('by_hash',q=>q.eq('subject',subject).eq('hash',a.hash)).unique();if(old&&(old.type!==a.type||old.size!==a.size))throw new ConvexError('الملف لا يطابق تصريح الرفع.');if(!old)await ctx.db.insert('analysisUploads',{subject,...a});return {fileId:old?.fileId,url:old?.fileId?null:await ctx.storage.generateUploadUrl()};}});
export const enqueue=internalMutation({args:{purpose:v.optional(v.literal('trend')),key:v.string(),title:v.string(),fileId:v.id('_storage'),duration:v.number(),dialect:v.union(v.literal('العراقية'),v.literal('الفصحى')),cap:v.optional(v.number())},handler:async(ctx,a)=>{
 const subject=await signed(ctx);if(a.purpose==='trend')await requireOwner(ctx);const prior=await ctx.db.query('videoAnalyses').withIndex('by_key',q=>q.eq('key',`${subject}:${a.key}`)).unique();if(prior){if(prior.fileId!==a.fileId||prior.title!==a.title||prior.duration!==a.duration||prior.dialect!==a.dialect||prior.purpose!==a.purpose)throw new ConvexError('هذا الطلب محفوظ بإعدادات مختلفة.');return prior._id;}
 if(!process.env.OPENROUTER_API_KEY)throw new ConvexError('خدمة التحليل غير مفعّلة.');
 if(a.key.length>100||!a.title.trim()||a.title.length>120||!Number.isFinite(a.duration)||a.duration<=0)throw new ConvexError('تحقق من الاسم ومدة الفيديو والرصيد.');
 const meta=await ctx.db.system.get(a.fileId);const owner=await ctx.db.query('analysisUploads').withIndex('by_file',q=>q.eq('fileId',a.fileId)).unique();
 if(!owner||owner.subject!==subject||!meta||!['video/mp4','video/webm'].includes(owner.type)||(meta.contentType!==undefined&&meta.contentType!==owner.type))throw new ConvexError('الفيديو غير متاح أو صيغته غير صالحة.');
 const jobs=await ctx.db.query('videoAnalyses').withIndex('by_subject',q=>q.eq('subject',subject)).take(40);if(jobs.length>=40||jobs.some(j=>['queued','running','reviewing','unknown'].includes(j.status)))throw new ConvexError('انتظر حسم التحليل الحالي قبل طلب جديد.');
 const w=await ctx.db.query('aiWallets').withIndex('by_subject',q=>q.eq('subject',subject)).unique();if(!w||w.balanceMicros-w.heldMicros<=0)throw new ConvexError('اشحن رصيد عقل القصة حتى يبدأ التحليل.');
 // Derive authorization from the existing wallet atomically. Legacy client caps are ignored.
 const cap=w.balanceMicros-w.heldMicros;
 const id=await ctx.db.insert('videoAnalyses',{...a,cap,key:`${subject}:${a.key}`,subject,walletId:w._id,status:'queued',spent:0,held:cap,calls:0,createdAt:Date.now(),updatedAt:Date.now()});
 await ctx.db.patch(w._id,{heldMicros:w.heldMicros+cap,updatedAt:Date.now()});await ctx.db.insert('aiLedger',{key:`analysis-reserve-${id}`,walletId:w._id,kind:'reserve',amountMicros:0,balanceAfter:w.balanceMicros,heldAfter:w.heldMicros+cap,note:'تخصيص الرصيد المتاح للتحليل؛ تخصم الكلفة المؤكدة فقط',actor:subject,createdAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.videoAnalysisRun.run,{id});return id;
}});
export const register=mutation({args:{fileId:v.id('_storage'),hash:v.string()},handler:async(ctx,a)=>{const subject=await signed(ctx),meta=await ctx.db.system.get(a.fileId),ticket=await ctx.db.query('analysisUploads').withIndex('by_hash',q=>q.eq('subject',subject).eq('hash',a.hash)).unique();if(!ticket||!meta||meta.size!==ticket.size||(meta.contentType!==undefined&&meta.contentType!==ticket.type)||Array.from(atob(meta.sha256),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')!==a.hash)throw new ConvexError('الملف لا يطابق تصريح الرفع.');if(ticket.fileId){if(ticket.fileId!==a.fileId)throw new ConvexError('فيديو مختلف.');return;}await ctx.db.patch(ticket._id,{fileId:a.fileId});}});
export const claim=internalMutation({args:{id:v.id('videoAnalyses')},handler:async(ctx,a)=>{const j=await ctx.db.get(a.id);if(j?.status!=='queued')return null;await ctx.db.patch(a.id,{status:'running',updatedAt:Date.now()});return j;}});
export const checkpoint=internalMutation({args:{id:v.id('videoAnalyses'),report:v.optional(v.string()),cost:v.optional(v.number()),status:v.string(),error:v.optional(v.string()),call:v.boolean()},handler:async(ctx,a)=>{
 const j=await ctx.db.get(a.id);if(!j||['completed','failed','needs_input','unknown'].includes(j.status))return;
 const w=await ctx.db.get(j.walletId);if(!w)throw new Error('Missing wallet');
 const known=a.cost!==undefined;const cost=known?Math.ceil(a.cost!):0;if(cost<0||!Number.isFinite(cost))throw new Error('Invalid provider usage');
 // Never debit beyond the authorized wallet amount; retain the full provider cost for audit.
 const charged=Math.min(cost,j.held),overrun=cost>j.held;
 const status=overrun?(a.report?'needs_input':'failed'):a.status;
 const terminal=['completed','failed','needs_input'].includes(status);const release=terminal?j.held:charged;
 await ctx.db.patch(w._id,{balanceMicros:w.balanceMicros-charged,spentMicros:w.spentMicros+charged,heldMicros:w.heldMicros-release,updatedAt:Date.now()});
 await ctx.db.insert('aiLedger',{key:`analysis-${j._id}-${j.calls}-${a.status}`,walletId:w._id,kind:'settle',amountMicros:-charged,balanceAfter:w.balanceMicros-charged,heldAfter:w.heldMicros-release,note:terminal?'تسوية تحليل الفيديو وإعادة الحجز المتبقي':'استخدام مرحلة تحليل الفيديو؛ المتبقي محجوز',actor:j.subject,createdAt:Date.now()});
 await ctx.db.patch(j._id,{status,spent:j.spent+charged,providerSpent:(j.providerSpent??j.spent)+cost,held:j.held-release,calls:j.calls+(a.call?1:0),...(a.report?{report:a.report}:{}),...(overrun?{error:'تجاوزت كلفة المزود الرصيد المخصص. توقف التدقيق؛ خُصم ضمن الرصيد فقط ولم يصبح سالبًا.'}:a.error?{error:a.error}:{}),updatedAt:Date.now()});
}});
export const snapshot=internalQuery({args:{id:v.id('videoAnalyses')},handler:(ctx,a)=>ctx.db.get(a.id)});
