import {ConvexError} from 'convex/values';
import type {QueryCtx} from './_generated/server';
import {subscriptionDay} from '../shared/reels-plans';
type Video={id:string;bunnyAssetId?:string;publishAt?:string;publishedAt?:string;publicationId?:string};
export async function assertScheduleMutable(ctx:QueryCtx,subject:string,collectionId:string,video:Video){
 if(video.publishedAt)throw new ConvexError('الفيديو منشور؛ التعديل والحذف مقفولان حتى الحذف التلقائي.');
 if(video.publicationId){const id=ctx.db.normalizeId('libraryPublications',video.publicationId),record=id?await ctx.db.get(id):null;if(record?.subject===subject&&record.status==='published')throw new ConvexError('الفيديو منشور؛ التعديل والحذف مقفولان حتى الحذف التلقائي.');}
 const asset=video.bunnyAssetId?await ctx.db.query('mediaAssets').withIndex('by_key',q=>q.eq('subject',subject).eq('key',video.bunnyAssetId!)).unique():null;
 const lookup=asset?ctx.db.query('reelsJobs').withIndex('by_asset',q=>q.eq('assetId',asset._id)):ctx.db.query('reelsJobs').withIndex('by_subject',q=>q.eq('subject',subject));
 const jobs=await lookup.filter(q=>q.and(q.eq(q.field('subject'),subject),q.eq(q.field('collectionId'),collectionId),q.eq(q.field('videoId'),video.id),q.eq(q.field('dryRun'),false))).take(101);
 if(jobs.length>100)throw new ConvexError('سجل الفيديو يحتاج مراجعة؛ لا يمكن تغييره.');
 for(const job of jobs){const rows=await ctx.db.query('reelsDeliveries').withIndex('by_job',q=>q.eq('jobId',job._id)).take(21);if(rows.length>20||rows.some(r=>r.phase==='published'))throw new ConvexError('الفيديو منشور؛ التعديل والحذف مقفولان حتى الحذف التلقائي.');}
 if(video.publishAt&&Number.isFinite(Date.parse(video.publishAt))&&subscriptionDay(Date.parse(video.publishAt))<subscriptionDay(Date.now()))throw new ConvexError('هذا اليوم منتهي؛ الجدول مقفول للمعاينة والتحميل فقط.');
}
