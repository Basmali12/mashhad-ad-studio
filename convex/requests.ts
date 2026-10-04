import { v, ConvexError } from 'convex/values';
import { query, mutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireOwner } from './access';
import { formValidator, statusValidator } from './validators';
import { validateForm } from '../shared/validation';
async function asset(ctx:MutationCtx,id:Id<'_storage'>,kind:'image'|'video') {
 const file = await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',id)).unique();
 if(!file || file.kind!==kind) throw new ConvexError('الملف لم يكتمل رفعه أو نوعه غير مناسب.');
}
export const list = query({args:{},handler:async(ctx)=>{await requireOwner(ctx);return ctx.db.query('requests').order('desc').collect();}});
export const save = mutation({args:{key:v.string(),form:formValidator,clipCount:v.number(),logoId:v.optional(v.id('_storage')),referenceIds:v.array(v.id('_storage')),submit:v.boolean(),createdAt:v.optional(v.number())},handler:async(ctx,args)=>{
 await requireOwner(ctx);validateForm(args.form,args.clipCount);
 if(!args.key || args.key.length>100 || args.referenceIds.length>8) throw new ConvexError('بيانات الطلب غير صالحة.');
 const existing = await ctx.db.query('requests').withIndex('by_key',q=>q.eq('key',args.key)).unique();
 // A queued request is immutable: retries return the same ID, including concurrent calls.
 if(existing && existing.status!=='مسودة') return existing._id;
 if(args.form.continuationSourceId){const source=ctx.db.system.normalizeId('_storage',args.form.continuationSourceId);if(!source)throw new ConvexError('معرّف فيديو التكملة غير صالح.');await asset(ctx,source,'video');}
 if(args.logoId) await asset(ctx,args.logoId,'image');
 for(const id of args.referenceIds) await asset(ctx,id,'image');
 const now=Date.now();const data={form:args.form,clipCount:args.clipCount,logoId:args.logoId,referenceIds:args.referenceIds,updatedAt:now,status:args.submit?'بانتظار التشغيل' as const:'مسودة' as const};
 if(existing){await ctx.db.patch(existing._id,data);return existing._id;}
 const createdAt=args.createdAt && Number.isFinite(args.createdAt) && args.createdAt>0 && args.createdAt<=now ? args.createdAt:now;
 return ctx.db.insert('requests',{...data,key:args.key,createdAt});
}});
export const attachManualVideo = mutation({args:{requestId:v.id('requests'),storageId:v.id('_storage')},handler:async(ctx,args)=>{
 await requireOwner(ctx);const request=await ctx.db.get(args.requestId);if(!request)throw new ConvexError('الطلب غير موجود.');await asset(ctx,args.storageId,'video');
 if(request.runner&&!['prepared','uploaded'].includes(request.runner.phase))throw new ConvexError('برنامج التشغيل يتابع هذا الطلب. لا تستبدل نتيجته أثناء التنفيذ.');
 await ctx.db.patch(args.requestId,{videoId:args.storageId,videoSource:'manual',status:'مكتمل',updatedAt:Date.now(),error:undefined,externalVideoUrl:undefined});
}});
// Future runner calls this with the owner's validated JWT. No anonymous webhook or deploy key in the client.
export const updateResult = mutation({args:{requestId:v.id('requests'),status:statusValidator,externalTaskId:v.optional(v.string()),error:v.optional(v.string()),videoId:v.optional(v.id('_storage')),externalVideoUrl:v.optional(v.string()),estimatedPoints:v.optional(v.number()),actualPoints:v.optional(v.number())},handler:async(ctx,args)=>{
 await requireOwner(ctx);const request=await ctx.db.get(args.requestId);if(!request)throw new ConvexError('الطلب غير موجود.');
 if(args.videoId)await asset(ctx,args.videoId,'video');
 if(args.status==='مكتمل'&&!args.videoId&&!request.videoId)throw new ConvexError('لا يمكن إكمال الطلب دون ملف فيديو محفوظ.');
 for(const n of [args.estimatedPoints,args.actualPoints])if(n!==undefined&&(!Number.isFinite(n)||n<0))throw new ConvexError('النقاط يجب أن تكون قيمة غير سالبة.');
 if((args.error?.length??0)>2000||(args.externalTaskId?.length??0)>500)throw new ConvexError('الرسالة أو معرّف المهمة طويل جدًا.');
 if(args.externalVideoUrl){const url=new URL(args.externalVideoUrl);if(url.protocol!=='https:'||url.username||url.password||args.externalVideoUrl.length>2000)throw new ConvexError('رابط الفيديو غير صالح.');}
 const {requestId,...updates}=args;
 await ctx.db.patch(requestId,{...updates,...(args.videoId?{videoSource:'runner' as const}:{}),updatedAt:Date.now()});
}});
