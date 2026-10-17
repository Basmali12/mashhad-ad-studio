import {internalQuery,internalMutation,type QueryCtx,type MutationCtx} from './_generated/server';
import {v,ConvexError} from 'convex/values';
async function knownVideos(ctx:QueryCtx|MutationCtx,allMedia=false){
 const ids=new Set<string>();
 for(const r of await ctx.db.query('uploads').collect())if((allMedia||r.kind==='video')&&r.storageId)ids.add(r.storageId);
 for(const r of await ctx.db.query('videoAnalyses').collect())ids.add(r.fileId);
 for(const r of await ctx.db.query('requests').collect()){if(r.videoId)ids.add(r.videoId);for(const c of r.results??[])ids.add(c.storageId);}
 for(const r of await ctx.db.query('exports').collect())if(r.fileId)ids.add(r.fileId);
 for(const r of await ctx.db.query('filmProductions').collect()){if(r.finalId)ids.add(r.finalId);for(const c of r.clips)if(c.storageId)ids.add(c.storageId);}
 for(const r of await ctx.db.query('pipelines').collect()){if(r.finalId)ids.add(r.finalId);for(const c of r.clips)if(c.storageId)ids.add(c.storageId);}
 if(allMedia){for(const r of await ctx.db.query('imageJobs').collect())if(r.fileId)ids.add(r.fileId);for(const r of await ctx.db.query('filmReferences').collect())if(r.fileId)ids.add(r.fileId);for(const r of await ctx.db.query('storyCharacters').collect())if(r.fileId)ids.add(r.fileId);}
 return ids;
}
async function busy(ctx:QueryCtx|MutationCtx){const now=Date.now();return {
 pipelines:(await ctx.db.query('pipelines').collect()).filter(j=>j.lease&&j.lease.until>now||!j.paused&&!['completed','failed','stopped','uncertain'].includes(j.stage)).length,
 films:(await ctx.db.query('filmProductions').collect()).filter(j=>j.lease&&j.lease.until>now||!j.paused&&!['completed','failed','stopped','ready','uncertain'].includes(j.stage)).length,
 exports:(await ctx.db.query('exports').collect()).filter(j=>!['completed','failed'].includes(j.status)).length,
 analyses:(await ctx.db.query('videoAnalyses').collect()).filter(j=>['queued','running'].includes(j.status)).length,
 images:(await ctx.db.query('imageJobs').collect()).filter(j=>j.lease&&j.lease.until>now||!j.paused&&!['completed','failed','unknown'].includes(j.status)).length,
 posts:(await ctx.db.query('bufferPosts').collect()).filter(j=>!['published','failed'].includes(j.stage)).length,
 };}
export const inventory=internalQuery({args:{cursor:v.union(v.string(),v.null()),allMedia:v.optional(v.boolean())},handler:async(ctx,a)=>{
 const ids=await knownVideos(ctx,a.allMedia),p=await ctx.db.system.query('_storage').paginate({cursor:a.cursor,numItems:100});
 return {files:p.page.filter(f=>f.contentType?.startsWith('video/')||a.allMedia&&f.contentType?.startsWith('image/')||ids.has(f._id)).map(f=>({id:f._id,size:f.size,type:f.contentType??'referenced-video'})),scanned:p.page.length,cursor:p.continueCursor,done:p.isDone,busy:await busy(ctx)};
}});
export const remove=internalMutation({args:{ids:v.array(v.id('_storage')),allMedia:v.optional(v.boolean())},handler:async(ctx,a)=>{
 if(a.ids.length>100)throw new ConvexError('Batch too large');const work=await busy(ctx);if(Object.values(work).some(n=>n>0))throw new ConvexError('Active jobs still depend on video files');
 const known=await knownVideos(ctx,a.allMedia),removed=new Set<string>();let bytes=0;
 for(const id of a.ids){const f=await ctx.db.system.get(id);if(!f)continue;if(!f.contentType?.startsWith('video/')&&!(a.allMedia&&f.contentType?.startsWith('image/'))&&!known.has(id))throw new ConvexError('Refusing to delete non-video');bytes+=f.size;await ctx.storage.delete(id);removed.add(id);}
 const note='حُذف ملف الوسائط بطلب الإدارة لتحرير مساحة التخزين.';
 for(const r of await ctx.db.query('uploads').collect())if((a.allMedia||r.kind==='video')&&r.storageId&&removed.has(r.storageId))await ctx.db.delete(r._id);
 for(const r of await ctx.db.query('analysisUploads').collect())if(r.fileId&&removed.has(r.fileId))await ctx.db.delete(r._id);
 for(const r of await ctx.db.query('videoAnalyses').collect())if(removed.has(r.fileId))await ctx.db.patch(r._id,{error:note});
 for(const r of await ctx.db.query('requests').collect())if(r.videoId&&removed.has(r.videoId)||r.results?.some(c=>removed.has(c.storageId))||r.form.continuationSourceId&&removed.has(r.form.continuationSourceId))await ctx.db.patch(r._id,{videoId:r.videoId&&removed.has(r.videoId)?undefined:r.videoId,results:r.results?.filter(c=>!removed.has(c.storageId)),form:{...r.form,continuationSourceId:r.form.continuationSourceId&&removed.has(r.form.continuationSourceId)?undefined:r.form.continuationSourceId},status:'متوقف',error:note,updatedAt:Date.now()});
 for(const r of await ctx.db.query('exports').collect())if(r.fileId&&removed.has(r.fileId)||r.settings.clips.some(c=>removed.has(c.storageId)))await ctx.db.patch(r._id,{fileId:r.fileId&&removed.has(r.fileId)?undefined:r.fileId,settings:{...r.settings,clips:r.settings.clips.filter(c=>!removed.has(c.storageId))},status:'failed',error:note,updatedAt:Date.now()});
 for(const r of await ctx.db.query('pipelines').collect())if(r.finalId&&removed.has(r.finalId)||r.clips.some(c=>c.storageId&&removed.has(c.storageId)))await ctx.db.patch(r._id,{finalId:r.finalId&&removed.has(r.finalId)?undefined:r.finalId,clips:r.clips.map(c=>({...c,storageId:c.storageId&&removed.has(c.storageId)?undefined:c.storageId})),stage:'stopped',paused:true,stopRequested:true,error:note,updatedAt:Date.now()});
 for(const r of await ctx.db.query('filmProductions').collect())if(r.finalId&&removed.has(r.finalId)||r.clips.some(c=>c.storageId&&removed.has(c.storageId)))await ctx.db.patch(r._id,{finalId:r.finalId&&removed.has(r.finalId)?undefined:r.finalId,clips:r.clips.map(c=>({...c,storageId:c.storageId&&removed.has(c.storageId)?undefined:c.storageId})),stage:'stopped',paused:true,stopRequested:true,error:note,updatedAt:Date.now()});
 if(a.allMedia){
 for(const r of await ctx.db.query('filmUploads').collect())if(r.fileId&&removed.has(r.fileId))await ctx.db.delete(r._id);
 for(const r of await ctx.db.query('pipelines').collect())if(r.logoId&&removed.has(r.logoId)||r.referenceIds.some(id=>removed.has(id))||r.continuationSource&&removed.has(r.continuationSource.storageId))await ctx.db.patch(r._id,{logoId:r.logoId&&removed.has(r.logoId)?undefined:r.logoId,referenceIds:r.referenceIds.filter(id=>!removed.has(id)),continuationSource:r.continuationSource&&removed.has(r.continuationSource.storageId)?undefined:r.continuationSource,stage:'stopped',paused:true,stopRequested:true,error:note});
 for(const r of await ctx.db.query('filmProductions').collect())if(r.previousFinalId&&removed.has(r.previousFinalId)||r.references.some(c=>c.fileId&&removed.has(c.fileId))||r.clips.some(c=>c.referenceIds.some(id=>removed.has(id))||c.reviewFrames?.some(id=>removed.has(id))))await ctx.db.patch(r._id,{previousFinalId:r.previousFinalId&&removed.has(r.previousFinalId)?undefined:r.previousFinalId,references:r.references.map(c=>({...c,fileId:c.fileId&&removed.has(c.fileId)?undefined:c.fileId})),clips:r.clips.map(c=>({...c,referenceIds:c.referenceIds.filter(id=>!removed.has(id)),reviewFrames:c.reviewFrames?.filter(id=>!removed.has(id))})),stage:'stopped',paused:true,stopRequested:true,error:note});
 for(const table of ['edits','exports'] as const)for(const r of await ctx.db.query(table).collect())if(r.logoId&&removed.has(r.logoId)||r.settings.clips.some(c=>removed.has(c.storageId)))await ctx.db.patch(r._id,{logoId:r.logoId&&removed.has(r.logoId)?undefined:r.logoId,settings:{...r.settings,clips:r.settings.clips.filter(c=>!removed.has(c.storageId))}});
 for(const r of await ctx.db.query('requests').collect())if(r.logoId&&removed.has(r.logoId)||r.referenceIds.some(id=>removed.has(id)))await ctx.db.patch(r._id,{logoId:r.logoId&&removed.has(r.logoId)?undefined:r.logoId,referenceIds:r.referenceIds.filter(id=>!removed.has(id))});
 for(const r of await ctx.db.query('imageJobs').collect())if(r.fileId&&removed.has(r.fileId)||r.referenceIds.some(id=>removed.has(id)))await ctx.db.patch(r._id,{fileId:r.fileId&&removed.has(r.fileId)?undefined:r.fileId,referenceIds:r.referenceIds.filter(id=>!removed.has(id)),status:'failed',paused:true,stopRequested:true,error:note});
 for(const r of await ctx.db.query('storyCharacters').collect())if(r.fileId&&removed.has(r.fileId))await ctx.db.patch(r._id,{fileId:undefined,jobId:undefined,phase:'editing',revision:r.revision+1});
 for(const r of await ctx.db.query('filmReferences').collect())if(r.fileId&&removed.has(r.fileId)){await ctx.db.patch(r._id,{fileId:undefined,updatedAt:Date.now()});const p=await ctx.db.get(r.projectId);if(p)await ctx.db.patch(p._id,{referenceRevision:(p.referenceRevision??0)+1});}
 for(const r of await ctx.db.query('branding').collect())if(r.logoId&&removed.has(r.logoId)||r.references?.some(c=>removed.has(c.storageId)))await ctx.db.patch(r._id,{logoId:r.logoId&&removed.has(r.logoId)?undefined:r.logoId,logoEnabled:r.logoId&&removed.has(r.logoId)?false:r.logoEnabled,references:r.references?.filter(c=>!removed.has(c.storageId))});
 }
 return {removed:removed.size,bytes};
}});

export const pendingPosts=internalQuery({args:{},handler:async ctx=>(await ctx.db.query('bufferPosts').collect()).filter(p=>p.stage==='accepted').map(p=>({id:p._id,status:p.providerStatus??'',dueAt:p.dueAt??null}))});

// Explicit administrator cleanup: preserve the provider IDs and uncertainty for audit.
export const detachPendingPosts=internalMutation({args:{ids:v.array(v.id('bufferPosts'))},handler:async(ctx,a)=>{let detached=0;for(const id of a.ids){const p=await ctx.db.get(id);if(!p||p.stage!=='accepted')continue;const note='أوقفت المتابعة المحلية وحُذف ملف المصدر بطلب الإدارة. تعذر التحقق من حالة المنشور أو إلغائه في Buffer؛ راجعه هناك.';await ctx.db.patch(id,{stage:'failed',providerStatus:'cleanup-detached-unverified',providerError:note,history:[...(p.history??[]),{status:'cleanup-detached-unverified',at:Date.now()}]});detached++;}return {detached};}});
