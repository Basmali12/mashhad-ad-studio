import { v, ConvexError } from 'convex/values';
import { mutation, internalQuery, internalMutation, action } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOwner } from './access';
import { kindValidator } from './validators';
import { validateFile, validateSignature } from '../shared/validation';
export const begin = mutation({args:{key:v.string(),kind:kindValidator,name:v.string(),type:v.string(),size:v.number()},handler:async(ctx,args)=>{
 await requireOwner(ctx);validateFile(args.type,args.size,args.kind);
 if(!/^(image|video):[a-f0-9]{64}$/.test(args.key)||args.name.length>255)throw new ConvexError('بيانات الملف غير صالحة.');
 const existing=await ctx.db.query('uploads').withIndex('by_key',q=>q.eq('key',args.key)).unique();
 if(existing&&(existing.kind!==args.kind||existing.size!==args.size||existing.type!==args.type))throw new ConvexError('مفتاح الرفع مستخدم لملف مختلف.');
 if(existing?.storageId)return {storageId:existing.storageId,url:null};
 if(!existing)await ctx.db.insert('uploads',{...args,createdAt:Date.now()});
 return {storageId:null,url:await ctx.storage.generateUploadUrl()};
}});
export const ticket = internalQuery({args:{key:v.string()},handler:async(ctx,{key})=>ctx.db.query('uploads').withIndex('by_key',q=>q.eq('key',key)).unique()});
export const ready = internalQuery({args:{storageId:v.id('_storage')},handler:async(ctx,{storageId})=>ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',storageId)).unique()});
export const register = internalMutation({args:{key:v.string(),storageId:v.id('_storage')},handler:async(ctx,args)=>{
 const row=await ctx.db.query('uploads').withIndex('by_key',q=>q.eq('key',args.key)).unique();if(!row)throw new ConvexError('عملية الرفع غير موجودة.');
 if(row.storageId)return row.storageId;
 const previous=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',args.storageId)).unique();if(previous)throw new ConvexError('الملف مسجل مسبقًا.');
 await ctx.db.patch(row._id,{storageId:args.storageId});return args.storageId;
}});
export const finish = action({args:{key:v.string(),storageId:v.id('_storage')},handler:async(ctx,args):Promise<Id<'_storage'>>=>{
 await requireOwner(ctx);const row=await ctx.runQuery(internal.files.ticket,{key:args.key});if(!row)throw new ConvexError('ابدأ عملية الرفع أولًا.');
 if(row.storageId)return row.storageId;
 const blob=await ctx.storage.get(args.storageId);if(!blob)throw new ConvexError('الملف غير موجود في التخزين.');
 validateFile(blob.type,blob.size,row.kind);if(blob.type!==row.type||blob.size!==row.size)throw new ConvexError('بيانات الملف لا تطابق طلب الرفع.');
 validateSignature(new Uint8Array(await blob.slice(0,32).arrayBuffer()),blob.type);
 // Bind the idempotency key to actual content, not the caller's filename.
 const metadata=await ctx.runQuery(internal.runner.metadata,{storageId:args.storageId});
 const hash=metadata?.hash;
 if(args.key!==`${row.kind}:${hash}`)throw new ConvexError('بصمة الملف غير مطابقة.');
 return ctx.runMutation(internal.files.register,args);
}});
