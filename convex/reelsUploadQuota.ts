import {ConvexError} from 'convex/values';
import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {subscriptionDay,subscriptionDays} from '../shared/reels-plans';
type Ctx=MutationCtx|QueryCtx;
export async function activeUploadSubscription(ctx:Ctx,subject:string){
 const rows=await ctx.db.query('reelsSubscriptions').withIndex('by_subject',q=>q.eq('subject',subject)).order('desc').collect();
 const sub=rows.find(s=>s.enabled&&s.startsAt<=Date.now()&&s.expiresAt>Date.now());if(!sub)throw new ConvexError('اختَر باقة وفعّل اشتراكك عبر واتساب قبل رفع الفيديو.');return sub;
}
export async function uploadBalance(ctx:Ctx,sub:Doc<'reelsSubscriptions'>){
 const usage=await ctx.db.query('reelsUploadUsage').withIndex('by_subscription',q=>q.eq('subscriptionId',sub._id)).collect();
 const reservations=await ctx.db.query('reelsReservations').withIndex('by_subscription',q=>q.eq('subscriptionId',sub._id)).collect();
 const keys=new Set([...usage.map(r=>r.assetKey),...reservations.filter(r=>r.status!=='refunded').map(r=>r.assetKey)]);
 const pending=await ctx.db.query('publishingUploadTickets').withIndex('by_pending',q=>q.eq('subscriptionId',sub._id).eq('assetKey',undefined).gt('expiresAt',Date.now())).collect();
 return {uploaded:usage.length,uploading:pending.length,consumed:keys.size,remaining:Math.max(0,sub.videoLimit-keys.size-pending.length)};
}
export async function acceptUpload(ctx:MutationCtx,subject:string,assetKey:string,ticket?:Doc<'publishingUploadTickets'>|null){
 const sub=await activeUploadSubscription(ctx,subject);
 if(ticket?.subscriptionId!==undefined&&ticket.subscriptionId!==sub._id)throw new ConvexError('تغير الاشتراك أثناء الرفع؛ راجع الدعم.');
 const old=await ctx.db.query('reelsUploadUsage').withIndex('by_asset',q=>q.eq('subscriptionId',sub._id).eq('assetKey',assetKey)).unique();if(old)return;
 const balance=await uploadBalance(ctx,sub),reserved=await ctx.db.query('reelsReservations').withIndex('by_video',q=>q.eq('subscriptionId',sub._id).eq('assetKey',assetKey)).unique();
 const holdsOwnSlot=ticket?.subscriptionId===sub._id&&!ticket.assetKey&&ticket.expiresAt>Date.now();
 if(!holdsOwnSlot&&reserved?.status!=='reserved'&&reserved?.status!=='charged'&&balance.remaining<1)throw new ConvexError('انتهت حصة الفيديوهات.');
 await ctx.db.insert('reelsUploadUsage',{subject,subscriptionId:sub._id,assetKey,acceptedAt:Date.now()});
}
export async function validatePlacement(ctx:MutationCtx,subject:string,collectionId:string,videoId:string,assetKey:string,publishAt:string,candidates:{id:string;movedTo?:string;bunnyAssetId?:string;publishAt:string}[]){
 const sub=await activeUploadSubscription(ctx,subject);
 const at=publishAt?Date.parse(publishAt):Date.now();if(!Number.isFinite(at))throw new ConvexError('موعد غير صالح.');const day=subscriptionDay(at);
 if(publishAt&&(!Number.isFinite(at)||at<=Date.now()||at>=sub.expiresAt||!subscriptionDays(sub.startsAt).some(d=>d.date===day)))throw new ConvexError('اختَر وقتاً مستقبلياً ضمن أيام الاشتراك الثلاثين.');
 const collections=await ctx.db.query('publishingCollections').withIndex('by_subject',q=>q.eq('subject',subject)).collect();
 const others=collections.filter(c=>c.id!==collectionId).flatMap(c=>c.libraryVideos??[]);
 const own=candidates;
 const rows=[...others,...own.filter(v=>v.id!==videoId)].filter(v=>!v.movedTo);
 if(rows.some(v=>v.bunnyAssetId===assetKey))throw new ConvexError('الفيديو موجود في الجدول؛ عدّل موعده بدلاً من إضافته مرة ثانية.');
 if(publishAt&&rows.some(v=>v.publishAt&&Date.parse(v.publishAt)===at))throw new ConvexError('هذا الوقت محجوز لفيديو آخر.');
 if(publishAt&&rows.filter(v=>v.publishAt&&subscriptionDay(Date.parse(v.publishAt))===day).length>=2)throw new ConvexError('الحد الأقصى فيديوان لكل يوم.');
}
