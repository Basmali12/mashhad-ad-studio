import {ConvexError} from 'convex/values';
import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {owns} from './access';
export async function canReadFile(ctx:QueryCtx|MutationCtx,subject:string,id:Id<'_storage'>){
 const file=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',id)).unique();if(!file)return false;
 if(file.subject)return file.subject===subject;
 const requests=await ctx.db.query('requests').collect(),exports=await ctx.db.query('exports').collect();
 const linked=requests.filter(r=>r.videoId===id||r.logoId===id||r.referenceIds.includes(id)||r.results?.some(p=>p.storageId===id)||exports.some(e=>e.requestId===r._id&&e.fileId===id));
 const images=(await ctx.db.query('imageJobs').collect()).filter(j=>j.fileId===id);
 const films=(await ctx.db.query('filmProductions').collect()).filter(j=>j.finalId===id||j.clips.some(c=>c.storageId===id));
 if(linked.length||images.length||films.length)return linked.some(r=>owns(subject,r))||images.some(j=>j.subject===subject)||films.some(j=>j.subject===subject);
 return subject===process.env.OWNER_SUBJECT;
}
export async function assertFileOwner(ctx:QueryCtx|MutationCtx,subject:string,id:Id<'_storage'>){if(!await canReadFile(ctx,subject,id))throw new ConvexError('الملف غير موجود أو غير مصرح له.');}
