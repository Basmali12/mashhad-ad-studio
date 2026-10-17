import {v,ConvexError} from 'convex/values';
import {query,internalMutation} from './_generated/server';
import {requireOwner} from './access';
import {canReadFile} from './customerFiles';
import {acceptUpload} from './reelsUploadQuota';
import {publishingMember} from './publishingUsers';
// Metadata only; no public Bunny URL, key, uploads or deletion side effects.
export const state=query({args:{},handler:async(ctx)=>{const owner=process.env.PUBLISHING_SAAS_ENABLED==='true'?await publishingMember(ctx):await requireOwner(ctx);return (await ctx.db.query('mediaAssets').withIndex('by_subject',q=>q.eq('subject',owner.subject)).collect()).map(a=>({id:a._id,key:a.key,size:a.size,type:a.type,verifiedAt:a.verifiedAt,deletedAt:a.deletedAt}));}});
export const recordVerified=internalMutation({args:{ticketFence:v.optional(v.string()),subject:v.string(),key:v.string(),objectPath:v.string(),sha256:v.string(),size:v.number(),type:v.string(),originalStorageId:v.optional(v.id('_storage')),ticketId:v.optional(v.id('publishingUploadTickets'))},handler:async(ctx,a)=>{
 const zone=process.env.BUNNY_STORAGE_ZONE;if(!zone||!/^[-a-zA-Z0-9]{1,64}$/.test(zone))throw new ConvexError('منطقة التخزين غير مهيأة.');
 const ownerHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(a.subject)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(!a.objectPath.startsWith('media/'+ownerHash+'/'))throw new ConvexError('مسار الملف لا يخص الحساب.');
 const ticket=a.ticketId?await ctx.db.get(a.ticketId):null;
 if(ticket){const member=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',a.subject)).unique();if(!member||member.disabled)throw new ConvexError('الحساب غير مفعّل للنشر.');}
 if(a.subject!==process.env.OWNER_SUBJECT&&(process.env.PUBLISHING_SAAS_ENABLED!=='true'&&!(process.env.PUBLISHING_INVITED_SUBJECTS??'').split(',').includes(a.subject)||!ticket))throw new ConvexError('طلب الرفع لا يخص حسابًا مصرحًا.');
 if(ticket?.uploadFence&&ticket.uploadFence!==a.ticketFence)throw new ConvexError('تصريح الرفع غير مطابق.');
 if(a.ticketId&&(!ticket||ticket.subject!==a.subject||ticket.expiresAt<Date.now()||ticket.size!==a.size||ticket.type!==a.type||ticket.assetKey&&ticket.assetKey!==a.key))throw new ConvexError('طلب الرفع منتهي أو بياناته مختلفة.');
 if(!/^media\/[a-f0-9]{64}\/[a-f0-9]{64}\.(mp4|jpg|png|webp)$/.test(a.objectPath)||!/^[a-f0-9]{64}$/.test(a.sha256)||a.key!==a.sha256||!a.objectPath.split('/')[2].startsWith(a.sha256+'.')||!Number.isSafeInteger(a.size)||a.size<=0||a.size>1024*1024*1024||!['video/mp4','image/jpeg','image/png','image/webp'].includes(a.type))throw new ConvexError('بيانات النسخة غير صالحة.');
 if(a.originalStorageId){if(!await canReadFile(ctx,a.subject,a.originalStorageId))throw new ConvexError('الأصل لا يخص المالك.');const original=await ctx.db.system.get(a.originalStorageId);if(!original||original.size!==a.size||Array.from(atob(original.sha256),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')!==a.sha256)throw new ConvexError('النسخة لا تطابق الأصل.');}
 const old=await ctx.db.query('mediaAssets').withIndex('by_key',q=>q.eq('subject',a.subject).eq('key',a.key)).unique();if(old?.deletedAt||old?.deletionPending)throw new ConvexError('النسخة محذوفة أو قيد الحذف؛ راجع الدعم.');
 if(old&&(old.zone!==zone||old.objectPath!==a.objectPath||old.size!==a.size||old.type!==a.type))throw new ConvexError('تغيرت هوية النسخة.');
 if(ticket&&a.type==='video/mp4')await acceptUpload(ctx,a.subject,a.key,ticket);
 if(a.ticketId)await ctx.db.patch(a.ticketId,{assetKey:a.key});const {ticketId,ticketFence,...data}=a;void ticketId;void ticketFence;
 return old?old._id:await ctx.db.insert('mediaAssets',{...data,zone,createdAt:Date.now(),verifiedAt:Date.now()});
}});
