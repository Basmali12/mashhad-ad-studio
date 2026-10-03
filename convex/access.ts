import { ConvexError } from 'convex/values';
import type { QueryCtx, MutationCtx, ActionCtx } from './_generated/server';
import { query } from './_generated/server';
export async function requireOwner(ctx: Pick<QueryCtx | MutationCtx | ActionCtx,'auth'>) {
 const identity = await ctx.auth.getUserIdentity();
 const subject = process.env.OWNER_SUBJECT;
 if (!subject || !identity || identity.subject !== subject || identity.issuer !== process.env.CLERK_JWT_ISSUER_DOMAIN) throw new ConvexError('الوصول متاح للمالك المصرح له فقط.');
 return identity;
}
export const allowed = query({args:{},handler:async(ctx)=>{try{await requireOwner(ctx);return true;}catch{return false;}}});
