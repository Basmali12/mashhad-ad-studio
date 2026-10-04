import {ConvexError} from 'convex/values';
import {query,mutation,internalMutation,type QueryCtx,type MutationCtx} from './_generated/server';
import {requireOwner} from './access';
export async function requireWalletAdmin(ctx:QueryCtx|MutationCtx){
 const identity=await requireOwner(ctx);
 const gate=await ctx.db.query('adminGates').withIndex('by_subject',q=>q.eq('subject',identity.subject)).unique();
 if(!process.env.ADMIN_CODE_VERIFIER||!gate||gate.expiresAt<=Date.now()||gate.version!==(process.env.ADMIN_CODE_VERSION??'1'))throw new ConvexError('افتح لوحة الأدمن برمز الدخول.');
 return identity;
}
export const status=query({args:{},handler:async ctx=>{await requireOwner(ctx);try{await requireWalletAdmin(ctx);const i=await requireOwner(ctx);const gate=await ctx.db.query('adminGates').withIndex('by_subject',q=>q.eq('subject',i.subject)).unique();return {expiresAt:gate!.expiresAt};}catch{return {expiresAt:0};}}});
export const begin=internalMutation({args:{},handler:async ctx=>{
 const i=await requireOwner(ctx),now=Date.now(),old=await ctx.db.query('adminGates').withIndex('by_subject',q=>q.eq('subject',i.subject)).unique();
 if(!process.env.ADMIN_CODE_VERIFIER)throw new ConvexError('رمز الدخول غير مهيأ.');
 if(old&&old.lockedUntil>now)throw new ConvexError('محاولات كثيرة؛ حاول لاحقًا.');
 const attempts=old&&now-old.windowStart<300000?old.attempts+1:1;
 if(attempts>5)return false;
 const value={subject:i.subject,expiresAt:0,attempts,windowStart:attempts===1?now:old!.windowStart,lockedUntil:attempts===5?now+300000:0,version:process.env.ADMIN_CODE_VERSION??'1'};
 if(old)await ctx.db.patch(old._id,value);else await ctx.db.insert('adminGates',value);
 return true;
}});
export const finish=internalMutation({args:{},handler:async ctx=>{const i=await requireOwner(ctx),old=await ctx.db.query('adminGates').withIndex('by_subject',q=>q.eq('subject',i.subject)).unique();if(!old)throw new ConvexError('تعذر فتح الجلسة.');await ctx.db.patch(old._id,{expiresAt:Date.now()+1800000,attempts:0,lockedUntil:0,version:process.env.ADMIN_CODE_VERSION??'1'});}});
export const lock=mutation({args:{},handler:async ctx=>{const i=await requireOwner(ctx),old=await ctx.db.query('adminGates').withIndex('by_subject',q=>q.eq('subject',i.subject)).unique();if(old)await ctx.db.patch(old._id,{expiresAt:0});}});
