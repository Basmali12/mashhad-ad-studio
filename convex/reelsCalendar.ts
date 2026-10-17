import {v,ConvexError} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {query} from './_generated/server';
import {publishingMember} from './publishingUsers';
export const start=query({args:{},handler:async ctx=>{const user=await publishingMember(ctx);const first=await ctx.db.query('reelsJobs').withIndex('by_subject_due',q=>q.eq('subject',user.subject)).order('asc').first();return first?.dueAt??null;}});
export const page=query({args:{start:v.string(),paginationOpts:paginationOptsValidator},handler:async(ctx,a)=>{
 const user=await publishingMember(ctx),from=Date.parse(a.start+'T00:00:00+03:00');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(a.start)||!Number.isFinite(from)||new Date(from+3*3600000).toISOString().slice(0,10)!==a.start)throw new ConvexError('تاريخ التقويم غير صحيح.');
 const result=await ctx.db.query('reelsJobs').withIndex('by_subject_due',q=>q.eq('subject',user.subject).gte('dueAt',from).lt('dueAt',from+30*86400000)).order('asc').paginate({...a.paginationOpts,numItems:Math.min(25,Math.max(1,a.paginationOpts.numItems)),maximumRowsRead:50,maximumBytesRead:256*1024});
 return {...result,page:await Promise.all(result.page.map(async job=>({_id:job._id,createdAt:job.createdAt,collectionId:job.collectionId,videoId:job.videoId,dueAt:job.dueAt,dryRun:job.dryRun,cancelled:job.cancelled,deliveries:(await ctx.db.query('reelsDeliveries').withIndex('by_job',q=>q.eq('jobId',job._id)).take(20)).map(d=>({platform:d.platform,phase:d.phase}))})))};
}});
