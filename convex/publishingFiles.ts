import {v,ConvexError} from 'convex/values';
import {mutation,action,query} from './_generated/server';
import {internal} from './_generated/api';
import {requireOwner} from './access';
import {canReadFile} from './customerFiles';
import {validateFile,validateSignature} from '../shared/validation';
import type {Id} from './_generated/dataModel';
export const begin=mutation({args:{key:v.string(),name:v.string(),type:v.string(),size:v.number()},handler:async(ctx,a)=>{
 const owner=await requireOwner(ctx);validateFile(a.type,a.size,'video');if(!/^video:[a-f0-9]{64}$/.test(a.key)||a.name.length>255)throw new ConvexError('بيانات الرفع غير صالحة.');
 const key=owner.subject===process.env.OWNER_SUBJECT?a.key:owner.subject+':'+a.key;
 const old=await ctx.db.query('uploads').withIndex('by_key',q=>q.eq('key',key)).unique();
 if(old&&(old.type!==a.type||old.size!==a.size||old.kind!=='video'))throw new ConvexError('تغير الملف المرتبط بالبصمة.');
 if(old?.storageId){if(!await canReadFile(ctx,owner.subject,old.storageId))throw new ConvexError('الملف غير مصرح.');return {storageId:old.storageId,url:null};}
 if(!old)await ctx.db.insert('uploads',{...a,key,subject:owner.subject,kind:'video',createdAt:Date.now()});return {storageId:null,url:await ctx.storage.generateUploadUrl()};
}});
export const finish=action({args:{key:v.string(),storageId:v.id('_storage')},handler:async(ctx,a):Promise<Id<'_storage'>>=>{
 const owner=await requireOwner(ctx),key=owner.subject===process.env.OWNER_SUBJECT?a.key:owner.subject+':'+a.key,row=await ctx.runQuery(internal.files.ticket,{key});
 if(!row||row.subject!==owner.subject)throw new ConvexError('طلب الرفع لا يخص حسابك.');if(row.storageId)return row.storageId;
 const blob=await ctx.storage.get(a.storageId);if(!blob||blob.type!==row.type||blob.size!==row.size)throw new ConvexError('بيانات الملف غير مطابقة.');validateFile(blob.type,blob.size,'video');validateSignature(new Uint8Array(await blob.slice(0,32).arrayBuffer()),blob.type);
 const meta=await ctx.runQuery(internal.fileMetadata.metadata,{storageId:a.storageId});if(!meta||a.key!=='video:'+meta.hash)throw new ConvexError('بصمة الملف غير مطابقة.');return await ctx.runMutation(internal.files.register,{key,storageId:a.storageId});
}});
export const descriptor=query({args:{storageId:v.id('_storage')},handler:async(ctx,a)=>{const owner=await requireOwner(ctx);if(!await canReadFile(ctx,owner.subject,a.storageId))throw new ConvexError('الملف غير مصرح.');const row=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',a.storageId)).unique();return {storageId:a.storageId,url:await ctx.storage.getUrl(a.storageId),type:row?.type,size:row?.size};}});
// Read-only compatibility with historical records; never calls a generator or worker.
export const historicalVideo=query({args:{jobId:v.id('pipelines')},handler:async(ctx,a)=>{const owner=await requireOwner(ctx),job=await ctx.db.get(a.jobId),request=job?await ctx.db.get(job.requestId):null;if(request?.subject!==owner.subject||!job?.finalId||job.stage!=='completed'||!await canReadFile(ctx,owner.subject,job.finalId))throw new ConvexError('الفيديو التاريخي غير جاهز أو غير مصرح.');return {storageId:job.finalId,url:await ctx.storage.getUrl(job.finalId)};}});
