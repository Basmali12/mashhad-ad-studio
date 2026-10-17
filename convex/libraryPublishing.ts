import {v,ConvexError} from 'convex/values';
import {query,mutation,action,internalMutation,internalQuery,internalAction} from './_generated/server';
import {internal} from './_generated/api';
import {requireOwner} from './access';
import {canReadFile} from './customerFiles';
import {supportedBufferChannel} from '../shared/buffer';
import {validatePublishMetadata,platformCaption,type PublishMetadata} from '../shared/library-publishing';
import type {Id} from './_generated/dataModel';
const target=v.object({id:v.string(),provider:v.union(v.literal('meta'),v.literal('buffer')),platform:v.string(),name:v.string()});
export const find=query({args:{key:v.string()},handler:async(ctx,a)=>{const u=await requireOwner(ctx),row=await ctx.db.query('libraryPublications').withIndex('by_key',q=>q.eq('key',u.subject+':'+a.key)).unique();return row?{id:row._id,status:row.status,metadata:row.metadata}:null;}});
export const resolveVideo=query({args:{jobId:v.id('pipelines')},handler:async(ctx,a)=>{const u=await requireOwner(ctx),job=await ctx.db.get(a.jobId),request=job?await ctx.db.get(job.requestId):null;if(request?.subject!==u.subject||job?.stage!=='completed'||!job.finalId)throw new ConvexError('الفيديو غير جاهز أو غير مصرح.');return {storageId:job.finalId};}});
export const prepare=action({args:{title:v.string(),context:v.string()},handler:async(ctx,a):Promise<PublishMetadata>=>{
 await requireOwner(ctx);if(a.title.length>200||a.context.length>12000)throw new ConvexError('وصف الفيديو طويل جدًا.');
 return validatePublishMetadata({title:a.title.trim().slice(0,100),description:'',hashtags:[],categoryId:'22',madeForKids:false,privacy:'public',isAiGenerated:false});
}});
export const activate=mutation({args:{key:v.string(),projectId:v.string(),videoId:v.string(),taskId:v.optional(v.string()),storageId:v.id('_storage'),dueAt:v.number(),metadata:v.any(),targets:v.array(target),confirmed:v.literal(true)},handler:async(ctx,a):Promise<Id<'libraryPublications'>>=>{if(process.env.REELS_ONLY_MODE==='true')throw new ConvexError('مسار النشر القديم متوقف؛ المواعيد والسجلات محفوظة للمراجعة.');
 const owner=await requireOwner(ctx),metadata=validatePublishMetadata(a.metadata);
 if(!/^[\w:-]{8,200}$/.test(a.key)||a.projectId.length>100||a.videoId.length>150||a.targets.length<1||a.targets.length>20||new Set(a.targets.map(t=>t.provider+':'+t.id)).size!==a.targets.length)throw new ConvexError('اختار حسابات نشر صحيحة دون تكرار.');
 const key=owner.subject+':'+a.key,old=await ctx.db.query('libraryPublications').withIndex('by_key',q=>q.eq('key',key)).unique();
 if(old&&old.status!=='cancelled'){if(old.storageId!==a.storageId||old.dueAt!==a.dueAt||JSON.stringify(old.metadata)!==JSON.stringify(metadata)||JSON.stringify(old.targets)!==JSON.stringify(a.targets))throw new ConvexError('ألغِ الموعد المحفوظ قبل تغييره.');return old._id;}
 if(!Number.isFinite(a.dueAt)||a.dueAt<Date.now()+300000||a.dueAt>Date.now()+366*86400000)throw new ConvexError('اختار موعدًا بعد خمس دقائق على الأقل وخلال سنة.');
 if(!await canReadFile(ctx,owner.subject,a.storageId))throw new ConvexError('الفيديو لا يخص حسابك.');
 const file=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',a.storageId)).unique();if(file?.kind!=='video'||file.type!=='video/mp4'||!await ctx.storage.getUrl(a.storageId))throw new ConvexError('ملف MP4 غير متاح.');
 const connection=await ctx.db.query('bufferConnections').withIndex('by_subject',q=>q.eq('subject',owner.subject)).unique();
 for(const t of a.targets){if(t.provider==='meta'){const account=await ctx.db.get(t.id as Id<'socialAccounts'>);if(!account||account.subject!==owner.subject||account.platform!==t.platform||account.name!==t.name||!account.selected)throw new ConvexError('تغير حساب Meta؛ راجع الربط.');}else{const channel=connection?.channels.find(c=>c.id===t.id);if(!channel||!supportedBufferChannel(channel)||channel.service!==t.platform||channel.name!==t.name)throw new ConvexError('تغير حساب خدمة الجدولة؛ راجع الربط.');}}
 const {confirmed,...data}=a;void confirmed;
 const record={...data,key,subject:owner.subject,metadata,status:'queued',receipts:[],createdAt:Date.now(),error:undefined};
 const id=old?old._id:await ctx.db.insert('libraryPublications',record);if(old)await ctx.db.patch(id,record);
 const schedulerId=await ctx.scheduler.runAt(a.dueAt,internal.libraryPublishing.dispatch,{id});await ctx.db.patch(id,{schedulerId});return id;
}});
export const cancel=mutation({args:{id:v.id('libraryPublications')},handler:async(ctx,a)=>{const owner=await requireOwner(ctx),row=await ctx.db.get(a.id);if(!row||row.subject!==owner.subject)throw new ConvexError('المهمة غير متاحة.');if(row.status==='cancelled')return;if(row.status!=='queued')throw new ConvexError('بدأ إرسال الفيديو؛ ما نلغي أو نكرر طلبًا غير محسوم.');if(row.schedulerId)await ctx.scheduler.cancel(row.schedulerId);await ctx.db.patch(row._id,{status:'cancelled'});}});
export const state=query({args:{id:v.id('libraryPublications')},handler:async(ctx,a)=>{const owner=await requireOwner(ctx),r=await ctx.db.get(a.id);if(!r||r.subject!==owner.subject)throw new ConvexError('المهمة غير متاحة.');const receipts=[];for(const receipt of r.receipts){const p=receipt.provider==='meta'?await ctx.db.get(receipt.postId as Id<'socialPosts'>):await ctx.db.get(receipt.postId as Id<'bufferPosts'>);receipts.push({targetId:receipt.targetId,stage:p?.stage??'missing'});}return {status:r.status,error:r.error??null,receipts,published:receipts.length===r.targets.length&&receipts.every(p=>p.stage==='published')};}});
export const job=internalQuery({args:{id:v.id('libraryPublications')},handler:async(ctx,a)=>{const r=await ctx.db.get(a.id);return r?.subject===process.env.OWNER_SUBJECT?r:null;}});
export const dispatch=internalMutation({args:{id:v.id('libraryPublications')},handler:async(ctx,a):Promise<void>=>{if(process.env.REELS_ONLY_MODE==='true')return;
 const r=await ctx.db.get(a.id);if(!r||r.status!=='queued')return;
 if(Date.now()<r.dueAt)return;
 if(r.subject!==process.env.OWNER_SUBJECT||!await canReadFile(ctx,r.subject,r.storageId)){await ctx.db.patch(r._id,{status:'failed',error:'تغيرت صلاحية الملف؛ ما بدأ نشر.'});return;}
 // Validate every destination before creating any provider job.
 const connection=await ctx.db.query('bufferConnections').withIndex('by_subject',q=>q.eq('subject',r.subject)).unique();
 for(const t of r.targets){const account=t.provider==='meta'?await ctx.db.get(t.id as Id<'socialAccounts'>):undefined,channel=t.provider==='buffer'?connection?.channels.find(c=>c.id===t.id):undefined;
  if(t.provider==='meta'?(!account||account.subject!==r.subject||account.platform!==t.platform||account.name!==t.name||!account.selected):(!channel||!supportedBufferChannel(channel)||channel.service!==t.platform||channel.name!==t.name)){await ctx.db.patch(r._id,{status:'failed',error:'حساب النشر تغير؛ راجع الحسابات قبل تفعيل موعد جديد.'});return;}}
 const receipts:{targetId:string;provider:string;postId:string}[]=[];let bufferIndex=0;
 for(const t of r.targets){const key:string=r.subject+':library-'+r._id+'-'+receipts.length,caption=platformCaption(validatePublishMetadata(r.metadata),t.platform);
  if(t.provider==='meta'){const id:Id<'socialPosts'>=await ctx.db.insert('socialPosts',{subject:r.subject,key,accountId:t.id as Id<'socialAccounts'>,platform:t.platform as 'facebook'|'instagram',metadata:r.metadata,storageId:r.storageId,caption,stage:'preparing',createdAt:Date.now()});receipts.push({targetId:t.id,provider:t.provider,postId:id});await ctx.scheduler.runAfter(0,internal.social.send,{id});}
  else{const id:Id<'bufferPosts'>=await ctx.db.insert('bufferPosts',{subject:r.subject,key,channelId:t.id,storageId:r.storageId,caption,metadata:r.metadata,revision:connection!.revision,stage:'preparing',createdAt:Date.now(),apiRequests:0,tokenRequests:0,history:[{status:'created',at:Date.now()}]});receipts.push({targetId:t.id,provider:t.provider,postId:id});await ctx.scheduler.runAfter(bufferIndex++*45000,internal.buffer.send,{id});}}
 await ctx.db.patch(r._id,{status:'submitted',receipts});await ctx.scheduler.runAfter(300000,internal.libraryPublishing.observe,{id:r._id,attempt:0});
}});
export const eraseFile=mutation({args:{storageId:v.id('_storage'),confirm:v.literal(true)},handler:async(ctx,a)=>{
 const u=await requireOwner(ctx);if(!await canReadFile(ctx,u.subject,a.storageId))throw new ConvexError('ملف الفيديو غير مصرح له.');
 for(const p of await ctx.db.query('libraryPublications').collect())if(p.storageId===a.storageId){if(p.subject!==u.subject||p.status==='queued')throw new ConvexError('ألغِ موعد النشر قبل حذف الملف.');for(const receipt of p.receipts){const row=receipt.provider==='meta'?await ctx.db.get(receipt.postId as Id<'socialPosts'>):await ctx.db.get(receipt.postId as Id<'bufferPosts'>);if(row&&!['published','failed'].includes(row.stage))throw new ConvexError('هناك نتيجة نشر غير محسومة؛ ما نحذف الملف.');}}
 for(const table of ['requests','pipelines','filmProductions','imageJobs','exports','edits'] as const)for(const row of await ctx.db.query(table).collect())if(JSON.stringify(row).includes(a.storageId))throw new ConvexError('الملف مرتبط بتوليد أو مشهد آخر؛ احذف من مصدر الفيديو أولًا.');
 const upload=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',a.storageId)).unique();if(upload?.kind!=='video')throw new ConvexError('رفض حذف ملف غير فيديو.');
 await ctx.storage.delete(a.storageId);await ctx.db.delete(upload._id);for(const row of await ctx.db.query('libraryPublications').collect())if(row.storageId===a.storageId)await ctx.db.delete(row._id);return {removed:true};
}});
export const observe=internalAction({args:{id:v.id('libraryPublications'),attempt:v.number()},handler:async(ctx,a)=>{const row=await ctx.runQuery(internal.libraryPublishing.job,{id:a.id});if(!row||row.status!=='submitted')return;
 for(const p of row.receipts){try{if(p.provider==='buffer')await ctx.runAction(internal.buffer.refreshLibraryPost,{id:p.postId as Id<'bufferPosts'>});else await ctx.runAction(internal.social.refreshLibraryPost,{id:p.postId as Id<'socialPosts'>});}catch{/* Keep unknown provider results visible; never repost. */}}
 if(a.attempt<23)await ctx.scheduler.runAfter(300000,internal.libraryPublishing.observe,{id:a.id,attempt:a.attempt+1});
}});
