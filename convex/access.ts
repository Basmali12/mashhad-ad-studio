import { ConvexError } from 'convex/values';
import type { QueryCtx, MutationCtx, ActionCtx } from './_generated/server';
import { query, internalQuery } from './_generated/server';
import type { Id } from './_generated/dataModel';
export async function requireOwner(ctx: Pick<QueryCtx | MutationCtx | ActionCtx,'auth'>) {
 const identity = await ctx.auth.getUserIdentity();
 const subject = process.env.OWNER_SUBJECT;
 if (!subject || !identity || identity.subject !== subject || identity.issuer !== process.env.CLERK_JWT_ISSUER_DOMAIN) throw new ConvexError('الوصول متاح للمالك المصرح له فقط.');
 return identity;
}
export const allowed = query({args:{},handler:async(ctx)=>{try{await requireOwner(ctx);return true;}catch{return false;}}});
export async function requireSigned(ctx: Pick<QueryCtx | MutationCtx | ActionCtx,'auth'>) {
 const identity=await ctx.auth.getUserIdentity();
 if(!process.env.OWNER_SUBJECT||!process.env.CLERK_JWT_ISSUER_DOMAIN||!identity||identity.issuer!==process.env.CLERK_JWT_ISSUER_DOMAIN)throw new ConvexError('الوصول متاح للمستخدم المصرح له فقط.');
 return identity;
}
export async function requireCustomer(ctx:QueryCtx|MutationCtx) {
 const identity=await requireSigned(ctx);
 if(identity.subject!==process.env.OWNER_SUBJECT){const wallet=await ctx.db.query('pointWallets').withIndex('by_subject',q=>q.eq('subject',identity.subject)).unique();if(!wallet?.enabled)throw new ConvexError('الوصول متاح للمستخدم المصرح له فقط؛ فعّل حسابك من الأدمن.');}
 return identity;
}
export function owns(subject:string,row:{subject?:string}){return (row.subject??process.env.OWNER_SUBJECT)===subject;}
export async function ownedRequest(ctx:QueryCtx|MutationCtx,id:Id<'requests'>){const identity=await requireCustomer(ctx),row=await ctx.db.get(id);if(!row||!owns(identity.subject,row))throw new ConvexError('الطلب غير موجود أو غير مصرح له.');return row;}
export const customerAllowed=internalQuery({args:{},handler:async ctx=>{await requireCustomer(ctx);return true;}});
export const customer=query({args:{},handler:async ctx=>{try{await requireCustomer(ctx);return true;}catch{return false;}}});
