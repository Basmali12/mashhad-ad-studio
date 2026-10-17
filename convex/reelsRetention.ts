import {v,ConvexError} from 'convex/values';
import {internalMutation,internalQuery,internalAction,type MutationCtx,type QueryCtx} from './_generated/server';
import {internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
export const RETENTION_MS=48*60*60*1000;
// Bounded, fail-closed reads. Historical receipts and quota usage are never removed.
async function deadline(ctx:QueryCtx|MutationCtx,id:Id<'mediaAssets'>){
 const asset=await ctx.db.get(id);if(!asset||asset.deletedAt||asset.type!=='video/mp4'||asset.originalStorageId)return null;
 const jobs=await ctx.db.query('reelsJobs').withIndex('by_asset',q=>q.eq('assetId',id)).take(101);
 if(!jobs.length||jobs.length>100)return null;let last=0;
 const complete=new Set<string>();
 for(const job of jobs){
  if(job.subject!==asset.subject)return null;
  const rows=await ctx.db.query('reelsDeliveries').withIndex('by_job',q=>q.eq('jobId',job._id)).take(21);
  if(rows.length>20)return null;
  if(job.dryRun){if(rows.some(r=>!['dry_run','cancelled'].includes(r.phase)))return null;continue;}
  if(job.cancelled&&rows.every(r=>r.phase==='cancelled'))continue;
  if(!rows.length||rows.some(r=>r.subject!==asset.subject||r.phase!=='published'||!r.providerId)||new Set(rows.map(r=>r.channelId)).size!==rows.length)return null;
  last=Math.max(last,...rows.map(r=>r.updatedAt));complete.add(JSON.stringify([job.collectionId,job.videoId]));
 }
 if(!last)return null;
 // A second, unsent use of the same hash must not lose its source file.
 const collections=await ctx.db.query('publishingCollections').withIndex('by_subject',q=>q.eq('subject',asset.subject)).take(101);
 if(collections.length>100)return null;
 for(const c of collections)for(const video of (c.libraryVideos??[]) as {id:string;bunnyAssetId?:string}[]){
  if(video.bunnyAssetId===asset.key&&!complete.has(JSON.stringify([c.id,video.id])))return null;
 }
 return last+RETENTION_MS;
}
export async function scheduleRetention(ctx:MutationCtx,id:Id<'mediaAssets'>){
 const asset=await ctx.db.get(id);if(!asset||asset.deletedAt||asset.deletionPending)return;
 const at=await deadline(ctx,id);if(at===null)return;
 if(asset.retentionDeleteAt===at)return;
 await ctx.db.patch(id,{retentionDeleteAt:at});
 await ctx.scheduler.runAt(Math.max(Date.now(),at),internal.reelsRetention.purge,{assetId:id});
}
export const recheck=internalMutation({args:{assetId:v.id('mediaAssets')},handler:async(ctx,a)=>scheduleRetention(ctx,a.assetId)});
export const claim=internalMutation({args:{assetId:v.id('mediaAssets')},handler:async(ctx,a)=>{
 if(process.env.REELS_RETENTION_ENABLED!=='true')return null;
 const asset=await ctx.db.get(a.assetId);if(!asset||asset.deletedAt||!asset.retentionDeleteAt)return null;
 const at=await deadline(ctx,a.assetId);if(at===null||at>Date.now())return null;
 if(asset.deletionPending&&!asset.retentionFence)return null;
 const fence=asset.retentionFence??crypto.randomUUID();
 await ctx.db.patch(asset._id,{deletionPending:true,retentionFence:fence});return {fence};
}});
export const authorized=internalQuery({args:{assetId:v.id('mediaAssets'),fence:v.string()},handler:async(ctx,a)=>{
 const asset=await ctx.db.get(a.assetId),at=await deadline(ctx,a.assetId);
 if(process.env.REELS_RETENTION_ENABLED!=='true'||!asset||!asset.deletionPending||asset.retentionFence!==a.fence||at===null||at>Date.now())throw new ConvexError('حذف غير مصرح.');
 return {zone:asset.zone,subject:asset.subject,path:asset.objectPath,sha256:asset.sha256,size:asset.size,type:asset.type,verified:true as const};
}});
export const completed=internalMutation({args:{assetId:v.id('mediaAssets'),fence:v.string()},handler:async(ctx,a)=>{
 const asset=await ctx.db.get(a.assetId);if(asset?.deletedAt&&asset.retentionFence===a.fence)return;
 if(!asset||asset.retentionFence!==a.fence||!asset.deletionPending)throw new ConvexError('تصريح حذف غير مطابق.');
 await ctx.db.patch(asset._id,{deletedAt:Date.now(),deletionPending:false,retentionNextAttemptAt:undefined});
 await ctx.db.insert('reelsAdminAudit',{actor:'retention-service',subject:asset.subject,operation:'media-retention-deleted',detail:asset.key,createdAt:Date.now()});
}});
export const retry=internalMutation({args:{assetId:v.id('mediaAssets')},handler:async(ctx,a)=>{
 const asset=await ctx.db.get(a.assetId);if(!asset||asset.deletedAt)return;
 await ctx.db.patch(a.assetId,{retentionNextAttemptAt:Date.now()+3600000});
}});
export const sweep=internalMutation({args:{},handler:async(ctx)=>{
 if(process.env.REELS_RETENTION_ENABLED!=='true')return;
 const rows=await ctx.db.query('mediaAssets').withIndex('by_retention_retry',q=>q.gt('retentionNextAttemptAt',0).lte('retentionNextAttemptAt',Date.now())).take(25);
 for(const a of rows){await ctx.db.patch(a._id,{retentionNextAttemptAt:Date.now()+3600000});await ctx.scheduler.runAfter(0,internal.reelsRetention.purge,{assetId:a._id});}
}});
export const purge=internalAction({args:{assetId:v.id('mediaAssets')},handler:async(ctx,a)=>{
 const claim=await ctx.runMutation(internal.reelsRetention.claim,a);if(!claim)return;
 try{
  const origin=process.env.REELS_STORAGE_ORIGIN,secret=process.env.REELS_STORAGE_BRIDGE_SECRET;
  if(!origin||!/^https:\/\/[^/?#]+\/reels-api$/.test(origin)||!secret||secret.length<32)throw Error('Retention service unavailable');
  const response=await fetch(origin+'/api/retention-delete',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({...a,...claim}),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Deletion unconfirmed');
 }catch{await ctx.runMutation(internal.reelsRetention.retry,a);}
}});
