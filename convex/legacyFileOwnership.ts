import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {owns} from './access';
// Historical ownership adapter. Only reads archived tables, no Flow functions.
export async function legacyFileOwner(ctx:QueryCtx|MutationCtx,subject:string,id:Id<'_storage'>){
 const requests=await ctx.db.query('requests').collect(),exports=await ctx.db.query('exports').collect();
 const linked=requests.filter(r=>r.videoId===id||r.logoId===id||r.referenceIds.includes(id)||r.results?.some(p=>p.storageId===id)||exports.some(e=>e.requestId===r._id&&e.fileId===id));
 const images=(await ctx.db.query('imageJobs').collect()).filter(j=>j.fileId===id),films=(await ctx.db.query('filmProductions').collect()).filter(j=>j.finalId===id||j.clips.some(c=>c.storageId===id));
 if(linked.length||images.length||films.length)return linked.some(r=>owns(subject,r))||images.some(j=>j.subject===subject)||films.some(j=>j.subject===subject);
 return subject===process.env.OWNER_SUBJECT;
}
