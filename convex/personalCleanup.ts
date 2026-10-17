import {v,ConvexError} from 'convex/values';
import {internalMutation,internalQuery} from './_generated/server';
function owner(){const id=process.env.OWNER_SUBJECT;if(!id||process.env.PERSONAL_STUDIO_ONLY!=='true')throw new ConvexError('Personal-only migration is not enabled');return id;}
export const inventory=internalQuery({args:{},handler:async ctx=>{
 const keep=owner(),wallets=(await ctx.db.query('pointWallets').collect()).filter(r=>r.subject!==keep),profiles=(await ctx.db.query('flowAccounts').collect()).filter(r=>r.subject!==keep);
 return {oldWallets:wallets.length,oldFlowProfiles:profiles.length,ownerWallets:(await ctx.db.query('pointWallets').collect()).filter(r=>r.subject===keep).length};
}});
export const removeAccounts=internalMutation({args:{confirmation:v.literal('REMOVE_LEGACY_ACCOUNTS')},handler:async ctx=>{
 const keep=owner();let removed=0;
 for(const wallet of (await ctx.db.query('pointWallets').collect()).filter(r=>r.subject!==keep)){
  for(const row of await ctx.db.query('pointLedger').withIndex('by_wallet',q=>q.eq('walletId',wallet._id)).collect()){await ctx.db.delete(row._id);removed++;}
  await ctx.db.delete(wallet._id);removed++;
 }
 for(const wallet of (await ctx.db.query('aiWallets').collect()).filter(r=>r.subject!==keep)){
  for(const row of await ctx.db.query('aiLedger').withIndex('by_wallet',q=>q.eq('walletId',wallet._id)).collect()){await ctx.db.delete(row._id);removed++;}
  await ctx.db.delete(wallet._id);removed++;
 }
 for(const table of ['flowAccounts','flowBalances','adminGates'] as const)for(const row of await ctx.db.query(table).collect())if(row.subject!==keep){await ctx.db.delete(row._id);removed++;}
 return {removed};
}});
