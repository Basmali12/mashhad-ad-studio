import {internal} from './_generated/api';
import {v,ConvexError} from 'convex/values';
import {query,mutation,internalQuery,internalMutation,internalAction} from './_generated/server';
import {requireOwner} from './access';
import {validBannerFile} from '../shared/site-banner';
import type {QueryCtx} from './_generated/server';
const current=(ctx:QueryCtx)=>ctx.db.query('reelsSiteBanner').withIndex('by_key',q=>q.eq('key','home')).unique();
export const state=query({args:{},handler:async ctx=>{await requireOwner(ctx);const row=await current(ctx),asset=row?.assetId?await ctx.db.get(row.assetId):null;return {revision:row?.revision??null,enabled:row?.enabled??false,assetId:row?.assetId,assetKey:asset&&!asset.deletedAt&&!asset.deletionPending?asset.key:undefined};}});
// Only the deliberately selected advert is public; no media listing or credentials.
export const active=query({args:{},handler:async ctx=>{const row=await current(ctx);if(!row?.enabled||!row.assetId)return null;const asset=await ctx.db.get(row.assetId);if(!asset||asset.deletedAt||asset.deletionPending||asset.subject!==process.env.OWNER_SUBJECT||asset.zone!==process.env.BUNNY_STORAGE_ZONE||!validBannerFile(asset.type,asset.size))return null;return {revision:row.revision};}});
export const prepareUpload=mutation({args:{size:v.number(),type:v.string()},handler:async(ctx,a)=>{const owner=await requireOwner(ctx);if(!validBannerFile(a.type,a.size))throw new ConvexError('اختَر صورة JPG أو PNG أو WebP حتى 2 MB.');return ctx.db.insert('publishingUploadTickets',{subject:owner.subject,purpose:'site-banner',...a,createdAt:Date.now(),expiresAt:Date.now()+600000});}});
export const save=mutation({args:{assetId:v.optional(v.id('mediaAssets')),enabled:v.boolean(),expectedRevision:v.union(v.string(),v.null())},handler:async(ctx,a)=>{const owner=await requireOwner(ctx),old=await current(ctx);if((old?.revision??null)!==a.expectedRevision)throw new ConvexError('الإعلان تغيّر من جلسة أخرى؛ حدّث المعاينة قبل الحفظ.');const assetId=a.assetId??old?.assetId,asset=assetId?await ctx.db.get(assetId):null;if(assetId&&(!asset||asset.subject!==owner.subject||asset.zone!==process.env.BUNNY_STORAGE_ZONE||asset.deletedAt||asset.deletionPending||!validBannerFile(asset.type,asset.size)))throw new ConvexError('صورة الإعلان غير متاحة أو لا تخص الإدارة.');if(a.enabled&&!asset)throw new ConvexError('ارفع صورة الإعلان أولاً.');const row={key:'home',assetId,enabled:a.enabled,revision:crypto.randomUUID(),updatedAt:Date.now(),updatedBy:owner.subject};if(old)await ctx.db.patch(old._id,row);else await ctx.db.insert('reelsSiteBanner',row);if(old?.assetId&&assetId&&old.assetId!==assetId){
 const previous=await ctx.db.get(old.assetId);
 if(previous&&previous.subject===owner.subject&&previous.zone===process.env.BUNNY_STORAGE_ZONE&&!previous.deletedAt&&!previous.deletionPending&&validBannerFile(previous.type,previous.size)&&!await referenced(ctx,previous._id,previous.subject,previous.key)){
  const fence=crypto.randomUUID();await ctx.db.patch(previous._id,{deletionPending:true,retentionFence:fence});
  await ctx.scheduler.runAfter(0,internal.reelsBanner.removeRetired,{assetId:previous._id,fence,attempt:0});
 }
}
await ctx.db.insert('reelsAdminAudit',{actor:owner.subject,operation:a.enabled?'banner-enabled':'banner-hidden',detail:'Home image advert; retired image cleanup after successful replacement',createdAt:Date.now()});return row.revision;}});
export const asset=internalQuery({args:{revision:v.string()},handler:async(ctx,a)=>{const row=await current(ctx);if(!row?.enabled||row.revision!==a.revision||!row.assetId)throw new ConvexError('الإعلان غير متاح.');const asset=await ctx.db.get(row.assetId);if(!asset||asset.deletedAt||asset.deletionPending||asset.subject!==process.env.OWNER_SUBJECT||!validBannerFile(asset.type,asset.size))throw new ConvexError('الصورة غير متاحة.');return {subject:asset.subject,path:asset.objectPath,sha256:asset.sha256,size:asset.size,type:asset.type,verified:true as const};}});

// This path can remove only a replaced image, never the current advert or any video.
async function referenced(ctx:QueryCtx,assetId:import('./_generated/dataModel').Id<'mediaAssets'>,subject:string,key:string){
 if(await ctx.db.query('reelsJobs').withIndex('by_asset',q=>q.eq('assetId',assetId)).first())return true;
 const rows=await ctx.db.query('publishingCollections').withIndex('by_subject',q=>q.eq('subject',subject)).take(101);
 return rows.length>100||rows.some(c=>c.libraryVideos?.some((video:{bunnyAssetId?:string})=>video.bunnyAssetId===key));
}
const retiredArgs={assetId:v.id('mediaAssets'),fence:v.string()};
export const retiredAsset=internalQuery({args:retiredArgs,handler:async(ctx,a)=>{
 const asset=await ctx.db.get(a.assetId),banner=await current(ctx);
 if(!asset||banner?.assetId===asset._id||asset.subject!==process.env.OWNER_SUBJECT||asset.zone!==process.env.BUNNY_STORAGE_ZONE||!validBannerFile(asset.type,asset.size)||!asset.deletionPending||asset.retentionFence!==a.fence||await referenced(ctx,asset._id,asset.subject,asset.key))throw new ConvexError('حذف صورة الإعلان غير مصرح.');
 return {subject:asset.subject,zone:asset.zone,path:asset.objectPath,sha256:asset.sha256,size:asset.size,type:asset.type,verified:true as const};
}});
export const retiredCompleted=internalMutation({args:retiredArgs,handler:async(ctx,a)=>{
 const asset=await ctx.db.get(a.assetId);if(!asset)return;
 if((await current(ctx))?.assetId===asset._id||!asset.deletionPending||asset.retentionFence!==a.fence||asset.subject!==process.env.OWNER_SUBJECT||!validBannerFile(asset.type,asset.size)||await referenced(ctx,asset._id,asset.subject,asset.key))throw new ConvexError('تصريح حذف الإعلان غير مطابق.');
 await ctx.db.delete(asset._id);await ctx.db.insert('reelsAdminAudit',{actor:'banner-service',subject:asset.subject,operation:'banner-retired-deleted',detail:asset.key,createdAt:Date.now()});
}});
export const removeRetired=internalAction({args:{...retiredArgs,attempt:v.number()},handler:async(ctx,a)=>{
 const {attempt,...args}=a;
 try{
  await ctx.runQuery(internal.reelsBanner.retiredAsset,args);
  const origin=process.env.REELS_STORAGE_ORIGIN,secret=process.env.REELS_STORAGE_BRIDGE_SECRET;
  if(!origin||!/^https:\/\/[^/?#]+\/reels-api$/.test(origin)||!secret||secret.length<32)throw Error('Advert cleanup unavailable');
  const response=await fetch(origin+'/api/banner-delete',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Deletion unconfirmed');
 }catch{if(attempt<3)await ctx.scheduler.runAfter(60000*5**attempt,internal.reelsBanner.removeRetired,{...args,attempt:attempt+1});}
}});
