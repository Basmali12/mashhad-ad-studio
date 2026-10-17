import {v,ConvexError} from 'convex/values';import {internalQuery,internalMutation} from './_generated/server';
import {personalConnection,oauthConnection,bindingFor,pauseUnsent} from './reelsBufferBinding';
import {checkSingleTest} from './reelsSingleTest';
import {quotaDecision} from '../shared/buffer-observation';
import {personalQuota,type PersonalQuotaWindow} from '../shared/buffer-personal-quota';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
export async function budgetScope(ctx:MutationCtx,job:Doc<'reelsJobs'>){
 const b=await bindingFor(ctx,job.subject);
 if(!b||b.authMode!==job.authMode||b.revision!==job.connectionRevision||b.suspended)throw new ConvexError('ربط غير مطابق؛ لا مفتاح بديل.');
 if(job.authMode==='personal')return 'personal:'+job.subject+':'+job.connectionRevision;
 const c=await oauthConnection(ctx,job.subject);if(!c||c.revision!==job.connectionRevision)throw new ConvexError('ربط غير مطابق.');return 'oauth:'+c.clientId;
}
// One in-flight request per provider quota scope. OAuth clients share a bucket.
export const admission=internalMutation({args:{id:v.id('reelsDeliveries'),fence:v.string(),status:v.boolean()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.id),job=row?await ctx.db.get(row.jobId):null,now=Date.now();
 if(!row||!job||job.dryRun||
 (a.status?row.statusFence!==a.fence||(row.statusLeaseUntil??0)<=now||!['accepted','uncertain'].includes(row.phase):row.fence!==a.fence||row.phase!=='leased'||(row.leaseUntil??0)<=now))throw new ConvexError('تصريح طلب API غير صالح.');
 if(job.testPermitId)await checkSingleTest(ctx,job,[row.channelId],a.status?'status':'send');else if(process.env.PUBLISHING_REAL_SEND_ENABLED!=='true')throw new ConvexError('الإرسال مغلق.');
 const scope=await budgetScope(ctx,job);let budget=await ctx.db.query('reelsApiBudgets').withIndex('by_scope',q=>q.eq('scope',scope)).unique();
 if(!budget){let snapshot:{observedAt:number;windows:PersonalQuotaWindow[]}|null=job.authMode==='personal'?await ctx.db.query('publishingBufferPersonalQuotaReads').withIndex('by_revision',q=>q.eq('subject',job.subject).eq('revision',job.connectionRevision)).order('desc').first():null;
 if(job.authMode==='oauth'){const connection=await oauthConnection(ctx,job.subject),saved=connection?await ctx.db.query('publishingBufferQuota').withIndex('by_client',q=>q.eq('clientId',connection.clientId)).unique():null;if(saved)snapshot={observedAt:saved.observedAt,windows:personalQuota(new Headers({'RateLimit':saved.limits.map(l=>'"'+l.policy+'";r='+l.remaining+';t='+l.resetSeconds).join(', ')}))};}
 const id=await ctx.db.insert('reelsApiBudgets',{scope,windows:snapshot?.windows.map(w=>({windowSeconds:w.windowSeconds,remaining:w.remaining,resetAt:snapshot.observedAt+w.resetSeconds*1000}))??[],blockedUntil:0,leaseUntil:0,observedAt:snapshot?.observedAt??0});budget=(await ctx.db.get(id))!;}
 if(budget.leaseUntil>now)return {allowed:false,retryAt:budget.leaseUntil+1000};
 if(job.authMode==='personal'){
 const refreshed=await ctx.db.query('publishingBufferPersonalQuotaReads').withIndex('by_revision',q=>q.eq('subject',job.subject).eq('revision',job.connectionRevision)).order('desc').first();
 if(refreshed&&refreshed.observedAt>budget.observedAt){const windows=budget.windows.filter(w=>!refreshed.windows.some(n=>n.windowSeconds===w.windowSeconds)).concat(refreshed.windows.map(w=>{const old=budget!.windows.find(n=>n.windowSeconds===w.windowSeconds);return {windowSeconds:w.windowSeconds,remaining:old&&old.resetAt>now?Math.min(old.remaining,w.remaining):w.remaining,resetAt:refreshed.observedAt+w.resetSeconds*1000};}));await ctx.db.patch(budget._id,{windows,observedAt:refreshed.observedAt});budget={...budget,windows,observedAt:refreshed.observedAt};}
 }
 const decision=quotaDecision(budget.windows,now,budget.blockedUntil);if(!decision.allowed)return decision;
 await ctx.db.patch(budget._id,{windows:budget.windows.map(w=>({...w,remaining:Math.max(0,w.remaining-1)})),leaseUntil:now+90000,leaseId:row._id,leaseFence:a.fence});return decision;
}});
export const defer=internalMutation({args:{id:v.id('reelsDeliveries'),fence:v.string(),retryAt:v.number()},handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(!row||row.phase!=='leased'||row.fence!==a.fence||!Number.isFinite(a.retryAt)||a.retryAt<=Date.now())throw new ConvexError('تصريح تأجيل غير صالح.');await ctx.db.patch(a.id,{phase:'retry',dueAt:a.retryAt,attempts:Math.max(0,row.attempts-1),fence:undefined,leaseUntil:undefined,error:'انتظار حصة Buffer؛ لم يُرسل منشور.',updatedAt:Date.now()});}});
export const credentialRejected=internalMutation({args:{id:v.id('reelsDeliveries'),fence:v.string()},handler:async(ctx,a)=>{const row=await ctx.db.get(a.id),job=row?await ctx.db.get(row.jobId):null;if(!row||!job||(row.fence!==a.fence&&(row.statusFence!==a.fence||(row.statusLeaseUntil??0)<=Date.now())))throw new ConvexError('تصريح عامل قديم.');const b=await bindingFor(ctx,job.subject);if(!b||b.revision!==job.connectionRevision)return;await ctx.db.patch(b._id,{suspended:true});const id=ctx.db.normalizeId(b.authMode==='personal'?'publishingBufferPersonalConnections':'publishingBufferConnections',b.connectionId);if(id)await ctx.db.patch(id,{needsReconnect:true});await pauseUnsent(ctx,job.subject,'رفض Buffer المفتاح؛ يرجى مراسلة الدعم.');}});
export const status=internalQuery({args:{id:v.id('reelsDeliveries'),fence:v.string()},handler:async(ctx,a)=>{const delivery=await ctx.db.get(a.id);if(!delivery||!['accepted','uncertain'].includes(delivery.phase)||!delivery.providerId||delivery.statusFence!==a.fence||(delivery.statusLeaseUntil??0)<=Date.now())throw new ConvexError('الطلب ليس بانتظار نتيجة.');const job=await ctx.db.get(delivery.jobId),user=job?await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',job.subject)).unique():null;if(!job||!user||user.disabled)throw new ConvexError('المستخدم غير متاح.');const b=await bindingFor(ctx,job.subject),connection=job.authMode==='personal'?await personalConnection(ctx,job.subject):await oauthConnection(ctx,job.subject);if(!b||b.authMode!==job.authMode||b.revision!==job.connectionRevision||b.suspended||!connection||connection.revision!==job.connectionRevision||connection.needsReconnect)throw new ConvexError('الإيصال القديم يحتاج مراجعة الدعم؛ لا مفتاح بديل.');if(job.testPermitId)await checkSingleTest(ctx,job,[delivery.channelId],'status');else if(process.env.PUBLISHING_REAL_SEND_ENABLED!=='true')throw new ConvexError('الإرسال مغلق.');return {job,delivery};}});
export const quota=internalMutation({args:{id:v.id('reelsDeliveries'),fence:v.string(),retryAfterSeconds:v.optional(v.number()),windows:v.array(v.object({windowSeconds:v.number(),remaining:v.number(),resetSeconds:v.number(),capacity:v.optional(v.number())}))},handler:async(ctx,a)=>{
 const delivery=await ctx.db.get(a.id),job=delivery?await ctx.db.get(delivery.jobId):null;if(!job)throw new ConvexError('المهمة غير متاحة.');
 const scope=await budgetScope(ctx,job),budget=await ctx.db.query('reelsApiBudgets').withIndex('by_scope',q=>q.eq('scope',scope)).unique(),now=Date.now();
 if(!budget||budget.leaseId!==a.id||budget.leaseFence!==a.fence||budget.leaseUntil<=now)throw new ConvexError('إجابة حصة قديمة مرفوضة.');
 if(a.windows.some(w=>![900,86400,2592000].includes(w.windowSeconds)||!Number.isFinite(w.remaining)||w.remaining<0||!Number.isFinite(w.resetSeconds)||w.resetSeconds<0))throw new ConvexError('حصة غير صالحة.');
 const complete=[900,86400,2592000].every(s=>a.windows.some(w=>w.windowSeconds===s));
 // Merge a partial 429 response rather than forgetting the other windows.
 const windows=budget.windows.filter(w=>!a.windows.some(n=>n.windowSeconds===w.windowSeconds)).concat(a.windows.map(w=>({windowSeconds:w.windowSeconds,remaining:w.remaining,resetAt:now+w.resetSeconds*1000})));
 const delay=a.retryAfterSeconds&&Number.isFinite(a.retryAfterSeconds)&&a.retryAfterSeconds>0?a.retryAfterSeconds*1000+5000:0;
 await ctx.db.patch(budget._id,{windows,blockedUntil:Math.max(delay?now+delay:0,complete?0:now+900000),leaseUntil:0,leaseId:undefined,leaseFence:undefined,observedAt:now});
 if(job.authMode==='personal'&&a.windows.length)await ctx.db.insert('publishingBufferPersonalQuotaReads',{subject:job.subject,revision:job.connectionRevision,windows:a.windows,observedAt:now});
}});
export const personal=internalQuery({args:{subject:v.string(),revision:v.string()},handler:async(ctx,a)=>{const row=await personalConnection(ctx,a.subject),user=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',a.subject)).unique();if(!row||row.revision!==a.revision||row.needsReconnect||!user||user.disabled)throw new ConvexError('تغير مفتاح صاحب المهمة؛ لا fallback.');return row;}});
export const media=internalQuery({args:{subject:v.string(),jobId:v.id('reelsJobs'),assetId:v.id('mediaAssets')},handler:async(ctx,a)=>{const job=await ctx.db.get(a.jobId),asset=await ctx.db.get(a.assetId);if(!job||job.dryRun||job.cancelled||job.subject!==a.subject||job.assetId!==a.assetId||!asset||asset.subject!==a.subject||asset.deletedAt||asset.deletionPending)throw new ConvexError('تصريح الوسائط غير مطابق.');if(job.testPermitId)await checkSingleTest(ctx,job,['6acc88f8778b240e2fe3be78'],'media');return {subject:asset.subject,path:asset.objectPath,sha256:asset.sha256,size:asset.size,type:asset.type,verified:true as const};}});
