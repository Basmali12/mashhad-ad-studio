import {createJob} from './reelsJobs';
import {internal} from './_generated/api';
import {v,ConvexError} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {query,mutation} from './_generated/server';
import {acceptUpload,validatePlacement} from './reelsUploadQuota';
import {bindingFor,guardChannels} from './reelsBufferBinding';
import {publishingMember} from './publishingUsers';
import {canReadFile} from './customerFiles';
import {validatePublishMetadata} from '../shared/library-publishing';
const cadence={mode:v.optional(v.union(v.literal('automatic'),v.literal('manual'))),intervalDays:v.optional(v.union(v.literal(1),v.literal(2),v.literal(3)))};
const schedule=v.object({...cadence,times:v.array(v.string()),timezone:v.literal('Asia/Baghdad'),startDate:v.optional(v.string())});
const target=v.object({id:v.string(),provider:v.union(v.literal('meta'),v.literal('buffer')),platform:v.string(),name:v.string()});
const audience=v.object({madeForKids:v.boolean(),privacy:v.union(v.literal('public'),v.literal('private'),v.literal('unlisted')),isAiGenerated:v.boolean()});
const task=v.object({id:v.string(),name:v.string(),createdAt:v.number(),...cadence,times:v.array(v.string()),timezone:v.literal('Asia/Baghdad'),startDate:v.optional(v.string()),automaticPublishing:v.optional(v.boolean()),targets:v.optional(v.array(target)),audience:v.optional(audience)});
const video=v.object({channelIds:v.optional(v.array(v.string())),id:v.string(),title:v.string(),createdAt:v.number(),bunnyAssetId:v.optional(v.string()),storageId:v.optional(v.id('_storage')),taskId:v.optional(v.string()),publishAt:v.string(),publishedAt:v.optional(v.string()),publicationId:v.optional(v.id('libraryPublications')),metadata:v.optional(v.any()),metadataReviewed:v.optional(v.boolean()),movedTo:v.optional(v.string()),publishingError:v.optional(v.string())});
export const collectionValidator=v.object({id:v.string(),name:v.string(),kind:v.optional(v.literal('library')),publishSchedule:v.optional(schedule),publishTasks:v.optional(v.array(task)),libraryVideos:v.optional(v.array(video))});
function key(id:string){return /^[\w:-]{1,150}$/.test(id);}
// Convex/JSON may reorder object keys; compare preserved history by value.
function unchanged(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a).sort(),right=Object.keys(b).sort();
 return left.length===right.length&&left.every((k,i)=>k===right[i]&&unchanged((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
export const list=query({args:{},handler:async ctx=>{const user=await publishingMember(ctx);return (await ctx.db.query('publishingCollections').withIndex('by_subject',q=>q.eq('subject',user.subject)).take(100)).map(({subject,_id,_creationTime,...row})=>{void subject;void _id;void _creationTime;return row;});}});
export const page=query({args:{paginationOpts:paginationOptsValidator},handler:async(ctx,a)=>{const user=await publishingMember(ctx),page=await ctx.db.query('publishingCollections').withIndex('by_subject',q=>q.eq('subject',user.subject)).paginate({...a.paginationOpts,numItems:Math.min(a.paginationOpts.numItems,10),maximumRowsRead:20,maximumBytesRead:262144});return {...page,page:page.page.map(({subject,_id,_creationTime,...row})=>{void subject;void _id;void _creationTime;return row;})};}});
export const get=query({args:{id:v.string()},handler:async(ctx,a)=>{const user=await publishingMember(ctx),row=await ctx.db.query('publishingCollections').withIndex('by_key',q=>q.eq('subject',user.subject).eq('id',a.id)).unique();if(!row)return null;const {subject,_id,_creationTime,...data}=row;void subject;void _id;void _creationTime;return data;}});
export const save=mutation({args:{collection:collectionValidator,expectedVersion:v.number()},handler:async(ctx,{collection:a,expectedVersion})=>{
 const user=await publishingMember(ctx);if(!key(a.id)||!a.name.trim()||a.name.length>120||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||(a.libraryVideos?.length??0)>500||(a.publishTasks?.length??0)>100||JSON.stringify(a).length>500000)throw new ConvexError('الحافظة أكبر من الحد المسموح أو بياناتها غير صالحة.');
 const old=await ctx.db.query('publishingCollections').withIndex('by_key',q=>q.eq('subject',user.subject).eq('id',a.id)).unique();if((old?.version??0)!==expectedVersion)throw new ConvexError('الحافظة تغيّرت على جهاز آخر؛ حدّثها قبل الحفظ.');
 const tasks=a.publishTasks??[];if(new Set(tasks.map(t=>t.id)).size!==tasks.length)throw new ConvexError('مهام مكررة.');
 for(const s of [...tasks,...a.publishSchedule?[a.publishSchedule]:[]])if(!s.times.length||s.times.length>10||new Set(s.times).size!==s.times.length||s.times.some(t=>!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new ConvexError('أوقات الجدولة غير صالحة.');
 const videos=a.libraryVideos??[];if(new Set(videos.map(v=>v.id)).size!==videos.length)throw new ConvexError('فيديوهات مكررة.');
 for(const item of videos){if(!key(item.id)||item.title.length>150||item.taskId&&!tasks.some(t=>t.id===item.taskId)||item.publishAt&&!Number.isFinite(Date.parse(item.publishAt)))throw new ConvexError('بيانات الفيديو غير صالحة.');
  const previous=(old?.libraryVideos as {id:string;publishedAt?:string;publicationId?:string;publishAt?:string;taskId?:string;bunnyAssetId?:string;storageId?:string;channelIds?:string[]}[]|undefined)?.find(v=>v.id===item.id);if(item.publishedAt&&item.publishedAt!==previous?.publishedAt||item.publicationId&&item.publicationId!==previous?.publicationId)throw new ConvexError('حالة النشر يثبتها محرك النشر؛ ما تتغيّر من الحافظة.');
  if(previous?.publishAt&&Date.parse(previous.publishAt)<=Date.now()&&!unchanged(previous,item))throw new ConvexError('الموعد انتهى؛ لا يمكن تعديل فيديو في وقت مضى. اختَر موعداً مستقبلياً لفيديو جديد.');
  if(previous?.bunnyAssetId&&item.bunnyAssetId!==previous.bunnyAssetId||previous?.storageId&&item.storageId!==previous.storageId)throw new ConvexError('لا تبدّل ملف فيديو محفوظ؛ أضفه كفيديو جديد.');
  if(item.bunnyAssetId){const asset=await ctx.db.query('mediaAssets').withIndex('by_key',q=>q.eq('subject',user.subject).eq('key',item.bunnyAssetId!)).unique();if(asset&&(asset.deletedAt||asset.deletionPending)&&previous&&unchanged(previous,item))continue;if(!asset||asset.deletedAt||asset.deletionPending||asset.type!=='video/mp4')throw new ConvexError('نسخة الفيديو لا تخص حسابك.');if(previous?.bunnyAssetId!==item.bunnyAssetId)await ctx.db.patch(asset._id,{retentionDeleteAt:undefined});
   if(!previous||item.publishAt!==previous.publishAt){await validatePlacement(ctx,user.subject,a.id,item.id,item.bunnyAssetId,item.publishAt,videos);if(!item.metadata||!validatePublishMetadata(item.metadata).description.trim())throw new ConvexError('اكتب عنوان ووصف الفيديو.');await acceptUpload(ctx,user.subject,asset.sha256);}
   if(previous&&(item.publishAt!==previous.publishAt||item.taskId!==previous.taskId||JSON.stringify(item.channelIds)!==JSON.stringify(previous.channelIds))){const linked=await ctx.db.query('reelsJobs').withIndex('by_asset',q=>q.eq('assetId',asset._id)).filter(q=>q.and(q.eq(q.field('subject'),user.subject),q.eq(q.field('collectionId'),a.id),q.eq(q.field('videoId'),item.id),q.eq(q.field('cancelled'),false))).first();if(linked)throw new ConvexError('ألغِ موعد الفيديو المحفوظ على السيرفر قبل تغيير ترتيبه أو وقته.');}
  }
  if(item.storageId){if(!await canReadFile(ctx,user.subject,item.storageId))throw new ConvexError('الفيديو لا يخص حسابك.');if(!previous||item.publishAt!==previous.publishAt){const stored=await ctx.db.system.get(item.storageId);if(!stored||stored.contentType!=='video/mp4')throw new ConvexError('الفيديو غير صالح.');const hash=Array.from(atob(stored.sha256),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');if(!item.metadata||!validatePublishMetadata(item.metadata).description.trim())throw new ConvexError('اكتب عنوان ووصف الفيديو.');await validatePlacement(ctx,user.subject,a.id,item.id,hash,item.publishAt,videos);await acceptUpload(ctx,user.subject,hash);}}
  if(!item.bunnyAssetId&&!item.storageId)throw new ConvexError('ارفع نسخة الفيديو أولًا.');
  if(item.channelIds&&(!previous||item.publishAt!==previous.publishAt||JSON.stringify(item.channelIds)!==JSON.stringify(previous.channelIds))){const b=await bindingFor(ctx,user.subject);if(!b)throw new ConvexError('اربط حسابات النشر أولاً.');if(!item.channelIds.length||new Set(item.channelIds).size!==item.channelIds.length)throw new ConvexError('اختَر حساب نشر واحداً على الأقل.');await guardChannels(ctx,user.subject,b.authMode,b.revision,item.channelIds,item.publishAt?Date.parse(item.publishAt):Date.now());}
  if(item.metadata)validatePublishMetadata(item.metadata);
  if(item.publicationId){const publication=await ctx.db.get(item.publicationId);if(publication?.subject!==user.subject)throw new ConvexError('سجل النشر لا يخص حسابك.');}
 }
 // Removing a schedule entry must not leave a queued or uncertain delivery behind.
 for(const removed of old?.libraryVideos??[]){if(videos.some(v=>v.id===removed.id))continue;
  if(removed.publicationId){const publicationId=typeof removed.publicationId==='string'?ctx.db.normalizeId('libraryPublications',removed.publicationId):null,publication=publicationId?await ctx.db.get(publicationId):null;if(!publication||publication.subject!==user.subject||!['published','cancelled','failed'].includes(publication.status))throw new ConvexError('سجل نشر قديم قيد التنفيذ؛ راجعه قبل الحذف من الجدول.');}
  const asset=removed.bunnyAssetId?await ctx.db.query('mediaAssets').withIndex('by_key',q=>q.eq('subject',user.subject).eq('key',removed.bunnyAssetId!)).unique():null;
  const lookup=asset?ctx.db.query('reelsJobs').withIndex('by_asset',q=>q.eq('assetId',asset._id)):ctx.db.query('reelsJobs').withIndex('by_subject',q=>q.eq('subject',user.subject));
  const jobs=await lookup.filter(q=>q.and(q.eq(q.field('subject'),user.subject),q.eq(q.field('collectionId'),a.id),q.eq(q.field('videoId'),removed.id),q.eq(q.field('cancelled'),false))).take(101);
  if(jobs.length>100)throw new ConvexError('سجلات الفيديو تحتاج مراجعة قبل حذفه من الجدول.');
  for(const job of jobs){const deliveries=await ctx.db.query('reelsDeliveries').withIndex('by_job',q=>q.eq('jobId',job._id)).take(21);if(deliveries.length>20||deliveries.some(d=>!['published','failed','dry_run','cancelled'].includes(d.phase)))throw new ConvexError('ألغِ موعد الفيديو أولاً؛ التنفيذ أو النتيجة غير المحسومة يمنعان حذفه من الجدول.');}
 }
 const data={...a,name:a.name.trim(),subject:user.subject,version:expectedVersion+1,updatedAt:Date.now()};if(old)await ctx.db.patch(old._id,data);else await ctx.db.insert('publishingCollections',data);for(const removed of (old?.libraryVideos??[]) as {id:string;bunnyAssetId?:string}[]){if(removed.bunnyAssetId&&!videos.some(v=>v.bunnyAssetId===removed.bunnyAssetId)){const asset=await ctx.db.query('mediaAssets').withIndex('by_key',q=>q.eq('subject',user.subject).eq('key',removed.bunnyAssetId!)).unique();if(asset&&!asset.deletedAt)await ctx.scheduler.runAfter(0,internal.reelsRetention.recheck,{assetId:asset._id});}}// Existing and elapsed placements are never replayed by saving another video.
 for(const item of videos){const previous=old?.libraryVideos?.find((v:{id:string})=>v.id===item.id);if(!item.bunnyAssetId||!item.publishAt||Date.parse(item.publishAt)<=Date.now()||!item.metadataReviewed||!item.channelIds?.length||previous&&unchanged(previous,item))continue;
  const binding=await bindingFor(ctx,user.subject);if(!binding)throw new ConvexError('اربط حسابات النشر أولاً.');
  await createJob(ctx,{collectionId:a.id,videoId:item.id,channelIds:item.channelIds,authMode:binding.authMode,dueAt:Date.parse(item.publishAt),dryRun:false},true);
 }
 const {subject,...result}=data;void subject;return result;
}});
