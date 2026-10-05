// Privileged CLI-only Development fixture. No anonymous customer or browser endpoint.
import {v,ConvexError} from 'convex/values';
import {internalMutation} from './_generated/server';
export const prepare=internalMutation({args:{runKey:v.string()},handler:async(ctx,a)=>{
 if(process.env.CONVEX_CLOUD_URL!=='https://capable-cuttlefish-575.convex.cloud'||!/^trial-2-[0-9-]{12,30}$/.test(a.runKey))throw new ConvexError('Development trial only');
 const worker=await ctx.db.query('workers').withIndex('by_key',q=>q.eq('key','pipeline')).unique(),option=worker?.options.find(o=>o.model==='Omni Flash'&&o.seconds===10&&o.resolution==='360p'&&o.aspect==='9:16');
 if(!worker||worker.state!=='online'||Date.now()-worker.seenAt>30000||Date.now()-worker.observedAt>3600000||!option||option.cost*2>14)throw new ConvexError('Verified online option within the approved 14-point ceiling is required');
 const rate=await ctx.db.query('pointRates').withIndex('by_key',q=>q.eq('key',`${option.model}:360p:10`)).unique();if(!rate||rate.points!==7)throw new ConvexError('Trial rate changed');
 const subjects=[a.runKey+'-a',a.runKey+'-b'];
 for(const subject of subjects){if(!await ctx.db.query('pointWallets').withIndex('by_subject',q=>q.eq('subject',subject)).unique())await ctx.db.insert('pointWallets',{subject,publicId:'MS-'+subject,name:'حساب اختبار تزامن — ليس زبونًا حقيقيًا',balance:7,enabled:true,models:[option.model],maxClips:1,createdAt:Date.now(),updatedAt:Date.now()});}
 return {subjects,issuer:process.env.CLERK_JWT_ISSUER_DOMAIN,option};
}});
