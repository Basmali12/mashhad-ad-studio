import {mutation} from './_generated/server';
import {v,ConvexError} from 'convex/values';
import {requireOwner} from './access';
export const remove=mutation({args:{jobId:v.id('pipelines'),confirm:v.literal(true)},handler:async(ctx,a)=>{
 const owner=await requireOwner(ctx),job=await ctx.db.get(a.jobId);if(!job)return {removed:true};
 const request=await ctx.db.get(job.requestId);if(!request||request.subject!==owner.subject)throw new ConvexError('الفيديو غير مصرح له.');
 if(job.stage!=='completed'||job.lease&&job.lease.until>Date.now())throw new ConvexError('لا تحذف فيديو قيد التنفيذ.');
 const ids=new Set([job.finalId,...job.clips.map(c=>c.storageId)].filter((id):id is NonNullable<typeof id>=>!!id));
 for(const p of await ctx.db.query('libraryPublications').collect())if(ids.has(p.storageId)){if(p.subject!==owner.subject||p.status==='queued')throw new ConvexError('ألغِ موعد النشر قبل حذف الفيديو.');for(const receipt of p.receipts){const row=receipt.provider==='meta'?await ctx.db.get(receipt.postId as import('./_generated/dataModel').Id<'socialPosts'>):await ctx.db.get(receipt.postId as import('./_generated/dataModel').Id<'bufferPosts'>);if(row&&!['published','failed'].includes(row.stage))throw new ConvexError('النشر غير محسوم؛ ما نحذف مصدره.');}}
 const linked=(r:unknown)=>[...ids].some(id=>JSON.stringify(r).includes(id));
 for(const table of ['requests','pipelines','filmProductions','imageJobs','exports','edits','bufferPosts','socialPosts'] as const){for(const row of await ctx.db.query(table).collect()){
  if(!linked(row))continue;
  if((table==='bufferPosts'||table==='socialPosts')&&'stage' in row&&'subject' in row&&row.subject===owner.subject&&['published','failed'].includes(row.stage))continue;
  if(table==='requests'&&row._id===request._id||table==='pipelines'&&row._id===job._id)continue;
  if((table==='exports'||table==='edits')&&'requestId' in row&&row.requestId===request._id)continue;
  throw new ConvexError('الفيديو مستخدم بمشهد أو عملية نشر أخرى. عالج الارتباط أولًا؛ ما حذفنا الملف.');
 }}
 for(const id of ids){const file=await ctx.db.system.get(id),upload=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',id)).unique();if(upload?.subject&&upload.subject!==owner.subject)throw new ConvexError('الملف غير مصرح له.');if(file&&!(file.contentType??upload?.type)?.startsWith('video/'))throw new ConvexError('رفض حذف ملف غير فيديو.');}
 for(const id of ids){await ctx.storage.delete(id);const upload=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',id)).unique();if(upload)await ctx.db.delete(upload._id);}
 for(const row of await ctx.db.query('libraryPublications').collect())if(ids.has(row.storageId))await ctx.db.delete(row._id);
 for(const table of ['exports','edits'] as const)for(const row of await ctx.db.query(table).collect())if(row.requestId===request._id)await ctx.db.delete(row._id);
 await ctx.db.delete(job._id);await ctx.db.patch(request._id,{videoId:undefined,results:[],status:'متوقف',error:'حُذف الفيديو نهائيًا من الحافظة.',updatedAt:Date.now()});return {removed:true};
}});
