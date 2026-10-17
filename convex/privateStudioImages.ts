import {v,ConvexError} from 'convex/values';
import {query,mutation} from './_generated/server';
import {requireOwner} from './access';
import {authorizeImage} from './images';
import {personalFlowConnected,personalFlow} from './personalFlow';
import {strongestFreeImageOption} from '../shared/free-image-model';
export const authorize=mutation({args:{key:v.string(),prompt:v.string(),sourceJobId:v.optional(v.id('imageJobs')),sourceStorageId:v.optional(v.id('_storage'))},handler:async(ctx,args)=>{
 const owner=await requireOwner(ctx);
 if(!personalFlowConnected(owner.subject)||!personalFlow(owner.subject))throw new ConvexError('اربط حساب Flow الخاص بالمالك أولًا.');
 const worker=await ctx.db.query('workers').withIndex('by_key',q=>q.eq('key','pipeline')).unique();
 if(worker?.state!=='online'||Date.now()-worker.seenAt>60000||!worker.imageObservedAt||Date.now()-worker.imageObservedAt>3600000)throw new ConvexError('اتصال Flow أو أسعار الصور تحتاج تحديثًا.');
 const option=strongestFreeImageOption(worker.imageOptions);
 if(!option)throw new ConvexError('موديل صور مجاني غير متاح حاليًا؛ لن نستخدم موديلًا مدفوعًا.');
 const references=[];
 if(args.sourceStorageId)references.push(args.sourceStorageId);
 if(args.sourceJobId){const source=await ctx.db.get(args.sourceJobId);if(!source||source.subject!==owner.subject||source.status!=='completed'||!source.fileId)throw new ConvexError('الصورة الأصلية غير متاحة للتعديل.');references.push(source.fileId);}
 return authorizeImage(ctx,{key:args.key,prompt:args.prompt,referenceIds:references,option},true);
}});
export const status=query({args:{jobId:v.id('imageJobs')},handler:async(ctx,args)=>{const owner=await requireOwner(ctx),job=await ctx.db.get(args.jobId);if(!job||job.subject!==owner.subject)throw new ConvexError('الصورة غير مصرح لها.');return {status:job.status,error:job.error??null,url:job.status==='completed'&&job.fileId?await ctx.storage.getUrl(job.fileId):null,type:job.fileType??null};}});
export const balance=query({args:{},handler:async ctx=>{
 const owner=await requireOwner(ctx),row=await ctx.db.query('flowBalances').withIndex('by_subject',q=>q.eq('subject',owner.subject)).unique();
 return row?{credits:row.credits??null,at:row.at??null,error:row.error??null,pending:row.requestedAt>(row.at??0)}:null;
}});
export const health=query({args:{},handler:async ctx=>{
 await requireOwner(ctx);
 const worker=await ctx.db.query('workers').withIndex('by_key',q=>q.eq('key','pipeline')).unique();
 const pipelines=await ctx.db.query('pipelines').collect(),images=await ctx.db.query('imageJobs').collect(),films=await ctx.db.query('filmProductions').collect();
 return {online:worker?.state==='online'&&Date.now()-worker.seenAt<60000,state:worker?.state??'offline',freeLiteAvailable:!!strongestFreeImageOption(worker?.imageOptions),freeImageModel:strongestFreeImageOption(worker?.imageOptions)?.model??null,imageOptionsAt:worker?.imageObservedAt??null,pendingJobs:pipelines.filter(j=>!j.paused&&!j.stopRequested&&!['completed','failed','stopped'].includes(j.stage)).length+images.filter(j=>!j.paused&&!j.stopRequested&&!['completed','failed','stopped','uncertain','login'].includes(j.status)).length+films.filter(j=>!j.paused&&!j.stopRequested&&!['completed','ready','failed','stopped'].includes(j.stage)).length};
}});
export const refreshBalance=mutation({args:{},handler:async ctx=>{
 const owner=await requireOwner(ctx);if(!personalFlowConnected(owner.subject))throw new ConvexError('متصفح حساب Flow الخاص غير متصل.');
 const worker=await ctx.db.query('workers').withIndex('by_key',q=>q.eq('key','pipeline')).unique();if(!worker||!['online','inspecting'].includes(worker.state)||Date.now()-worker.seenAt>60000)throw new ConvexError('خدمة المتصفح على السيرفر غير متصلة حاليًا.');
 const row=await ctx.db.query('flowBalances').withIndex('by_subject',q=>q.eq('subject',owner.subject)).unique(),now=Date.now();
 if(row&&now-row.requestedAt<20000)return;
 if(row)await ctx.db.patch(row._id,{requestedAt:now});else await ctx.db.insert('flowBalances',{subject:owner.subject,requestedAt:now});
}});
