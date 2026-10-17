import {ConvexError} from 'convex/values';
import {mutation,query,type QueryCtx,type MutationCtx} from './_generated/server';
export async function publishingIdentity(ctx:Pick<QueryCtx|MutationCtx,'auth'>){
 const identity=await ctx.auth.getUserIdentity(),issuer=process.env.CLERK_JWT_ISSUER_DOMAIN;
 if(!identity||!issuer||identity.issuer!==issuer||!identity.subject)throw new ConvexError('سجّل الدخول بحسابك أولًا.');
 if(process.env.PUBLISHING_SAAS_ENABLED!=='true'&&identity.subject!==process.env.OWNER_SUBJECT&&!(process.env.PUBLISHING_INVITED_SUBJECTS??'').split(',').includes(identity.subject))throw new ConvexError('دخول الزبائن غير مفعّل في هذه البيئة.');return identity;
}
export async function publishingMember(ctx:QueryCtx|MutationCtx){const identity=await publishingIdentity(ctx),user=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',identity.subject)).unique();if(!user||user.disabled)throw new ConvexError('الحساب غير مفعّل للنشر.');return identity;}
export const access=query({args:{},handler:async ctx=>{try{await publishingIdentity(ctx);return true;}catch{return false;}}});
export const register=mutation({args:{},handler:async ctx=>{const identity=await publishingIdentity(ctx),old=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',identity.subject)).unique();const email=identity.emailVerified===true&&typeof identity.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email.trim())?identity.email.trim().toLowerCase():undefined;
 if(old){if(old.disabled)throw new ConvexError('الحساب غير مفعّل للنشر.');const patch:{email?:string;name?:string}={};if(email&&email!==old.email)patch.email=email;else if(identity.email!==undefined&&old.email&&!email)patch.email=undefined;if(identity.name&&identity.name!==old.name)patch.name=identity.name.slice(0,120);if(Object.keys(patch).length)await ctx.db.patch(old._id,patch);return old._id;}
 return await ctx.db.insert('publishingUsers',{subject:identity.subject,name:(identity.name??'مستخدم').slice(0,120),...(email?{email}:{}),createdAt:Date.now(),disabled:false});}});
export const profile=query({args:{},handler:async ctx=>{const identity=await publishingMember(ctx),user=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',identity.subject)).unique();return {id:user!._id,subject:identity.subject,name:user!.name,role:identity.subject===process.env.OWNER_SUBJECT?'super-admin' as const:'customer' as const};}});
