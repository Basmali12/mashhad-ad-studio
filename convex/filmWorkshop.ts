import {ConvexError,v} from 'convex/values';
import {mutation,query,internalQuery,internalMutation,action} from './_generated/server';
import {internal} from './_generated/api';
import {owned,enqueue} from './films';
import {filmSettings,filmPlan} from './filmValidators';
import {previousPlans,validatePlan} from '../shared/film-plan';
import {validateFile,validateSignature} from '../shared/validation';
export const state=query({args:{projectId:v.id('filmProjects')},handler:async(ctx,a)=>{
 const project=await owned(ctx,a.projectId),references=await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',a.projectId)).collect(),episodes=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',a.projectId)).collect();
 return {project,references,episodes:episodes.map(e=>({...e,stale:e.referenceRevision!==(project.referenceRevision??0)||e.brief!==project.brief||(e.previousPlans??'[]')!==previousPlans(episodes,e.episode)})),settings:project.settings??{style:'كارتوني',dialect:'العراقية',episodes:2,seconds:60}};
}});
export const settings=mutation({args:{projectId:v.id('filmProjects'),settings:filmSettings},handler:async(ctx,a)=>{
 const p=await owned(ctx,a.projectId),s=a.settings;
 if(!['واقعي','كارتوني','أنمي','ثلاثي الأبعاد'].includes(s.style)||!s.dialect.trim()||s.dialect.length>80||!Number.isInteger(s.episodes)||s.episodes<1||s.episodes>6||!Number.isInteger(s.seconds)||s.seconds<10||s.seconds>300)throw new ConvexError('تحقق من الأسلوب واللهجة وعدد الحلقات (1–6) ومدتها (10–300 ثانية).');
 if(JSON.stringify(p.settings)!==JSON.stringify(s))await ctx.db.patch(p._id,{settings:s,referenceRevision:(p.referenceRevision??0)+1,updatedAt:Date.now()});
}});
export const reference=mutation({args:{projectId:v.id('filmProjects'),key:v.string(),kind:v.union(v.literal('character'),v.literal('place')),name:v.string(),description:v.string(),fileId:v.optional(v.id('_storage'))},handler:async(ctx,a)=>{
 const p=await owned(ctx,a.projectId);if(!a.name.trim()||a.name.length>100||a.description.length>1800||!a.key||a.key.length>100)throw new ConvexError('الاسم مطلوب؛ الوصف حتى 1800 حرف.');
 if(a.fileId){const file=await ctx.db.query('filmUploads').withIndex('by_file',q=>q.eq('fileId',a.fileId)).unique();if(!file||file.projectId!==p._id)throw new ConvexError('الصورة لا تخص هذا الفيلم.');}
 const key=`${p._id}:${a.key}`,old=await ctx.db.query('filmReferences').withIndex('by_key',q=>q.eq('key',key)).unique();
 const values={projectId:p._id,key,kind:a.kind,name:a.name.trim(),description:a.description.trim(),...(a.fileId?{fileId:a.fileId}:{}),updatedAt:Date.now()};
 if(old&&old.kind!==a.kind)throw new ConvexError('نوع المرجع لا يمكن تغييره.');
 if(old&&old.name===values.name&&old.description===values.description&&old.fileId===a.fileId)return old._id;
 if(!old&&(await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',p._id)).collect()).length>=24)throw new ConvexError('الحد 24 شخصية ومكانًا لكل فيلم.');
 const id=old?old._id:await ctx.db.insert('filmReferences',values);if(old)await ctx.db.patch(id,{...values,fileId:a.fileId});
 await ctx.db.patch(p._id,{referenceRevision:(p.referenceRevision??0)+1,updatedAt:Date.now()});return id;
}});
export const draft=mutation({args:{projectId:v.id('filmProjects'),episode:v.number(),key:v.string()},handler:async(ctx,a)=>{
 const p=await owned(ctx,a.projectId),s=p.settings;if(!s||!Number.isInteger(a.episode)||a.episode<1||a.episode>s.episodes||!p.brief)throw new ConvexError('احفظ إعدادات الفيلم واتفق على القصة في المناقشة أولًا.');
 const refs=await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();if(!refs.some(r=>r.kind==='character')||!refs.some(r=>r.kind==='place'))throw new ConvexError('أضف شخصية ومكانًا على الأقل قبل تخطيط الحلقة.');
 const episodes=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();
 const latest=episodes.filter(e=>!episodes.some(o=>o.episode===e.episode&&o.version>e.version));
 if(a.episode>1&&!latest.some(e=>e.episode===a.episode-1&&e.approved&&e.referenceRevision===(p.referenceRevision??0)&&e.brief===p.brief&&(e.previousPlans??'[]')===previousPlans(episodes,e.episode)))throw new ConvexError('اعتمد الحلقة السابقة حسب المراجع والاتفاق الحاليين أولًا.');
 const snapshot=JSON.stringify({agreement:p.brief,settings:s,episode:a.episode,requestedSeconds:s.seconds,references:refs.map(r=>({_id:r._id,kind:r.kind,name:r.name,description:r.description,hasImage:!!r.fileId})),previousEpisodes:latest.filter(e=>e.episode<a.episode).map(e=>({episode:e.episode,plan:e.plan}))});
 return enqueue(ctx,{projectId:p._id,key:`plan:${a.key}`,text:`تخطيط الحلقة ${a.episode}`},{episode:a.episode,seconds:s.seconds,snapshot,revision:p.referenceRevision??0,brief:p.brief,previousPlans:previousPlans(episodes,a.episode)});
}});
export const save=mutation({args:{projectId:v.id('filmProjects'),episodeId:v.id('filmEpisodes'),plan:filmPlan,approve:v.boolean()},handler:async(ctx,a)=>{
 const p=await owned(ctx,a.projectId),old=await ctx.db.get(a.episodeId);if(!old||old.projectId!==p._id)throw new ConvexError('الحلقة غير متاحة.');
 const all=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();if(all.some(e=>e.episode===old.episode&&e.version>old.version))throw new ConvexError('توجد نسخة أحدث؛ أعد تحميل الحلقة قبل الحفظ.');
 const refs=await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();try{validatePlan(a.plan,p.settings?.seconds??60,refs);}catch(e){throw new ConvexError((e as Error).message);}
 if(a.approve&&old.episode>1&&!all.some(e=>e.episode===old.episode-1&&!all.some(o=>o.episode===e.episode&&o.version>e.version)&&e.approved&&e.referenceRevision===(p.referenceRevision??0)&&e.brief===p.brief&&(e.previousPlans??'[]')===previousPlans(all,e.episode)))throw new ConvexError('اعتمد النسخة الحالية من الحلقة السابقة أولًا.');
 if(a.approve&&(old.previousPlans??'[]')!==previousPlans(all,old.episode))throw new ConvexError('تغيرت الحلقة السابقة؛ راجع استمرارية هذه الحلقة قبل الاعتماد.');
 if(a.approve&&(old.referenceRevision!==(p.referenceRevision??0)||old.brief!==p.brief))throw new ConvexError('تغيرت المراجع أو الاتفاق؛ أنشئ مسودة مراجعة جديدة قبل الاعتماد.');
 return ctx.db.insert('filmEpisodes',{projectId:p._id,previousPlans:previousPlans(all,old.episode),episode:old.episode,version:old.version+1,plan:a.plan,referenceRevision:p.referenceRevision??0,brief:p.brief,approved:a.approve,createdAt:Date.now()});
}});
// A user-written first draft also permits testing with saved videos, without an AI call.
export const manual=mutation({args:{projectId:v.id('filmProjects'),episode:v.number(),plan:filmPlan},handler:async(ctx,a)=>{const p=await owned(ctx,a.projectId);if(!p.settings||!Number.isInteger(a.episode)||a.episode<1||a.episode>p.settings.episodes)throw new ConvexError('احفظ إعدادات الحلقة أولًا.');const all=await ctx.db.query('filmEpisodes').withIndex('by_project',q=>q.eq('projectId',p._id)).collect(),prior=all.find(e=>e.episode===a.episode);if(prior){if(JSON.stringify(prior.plan)===JSON.stringify(a.plan))return prior._id;throw new ConvexError('توجد مسودة؛ عدّلها من الحلقات.');}if(a.episode>1&&!all.some(e=>e.episode===a.episode-1&&e.approved&&!all.some(o=>o.episode===e.episode&&o.version>e.version)&&e.referenceRevision===(p.referenceRevision??0)&&e.brief===p.brief&&(e.previousPlans??'[]')===previousPlans(all,e.episode)))throw new ConvexError('اعتمد الحلقة السابقة أولًا.');const refs=await ctx.db.query('filmReferences').withIndex('by_project',q=>q.eq('projectId',p._id)).collect();validatePlan(a.plan,p.settings.seconds,refs);return ctx.db.insert('filmEpisodes',{projectId:p._id,episode:a.episode,version:1,plan:a.plan,approved:false,brief:p.brief,referenceRevision:p.referenceRevision??0,previousPlans:previousPlans(all,a.episode),createdAt:Date.now()});}});
export const begin=mutation({args:{projectId:v.id('filmProjects'),key:v.string(),type:v.string(),size:v.number()},handler:async(ctx,a)=>{
 await owned(ctx,a.projectId);validateFile(a.type,a.size,'image');if(!/^[a-f0-9]{64}$/.test(a.key))throw new ConvexError('معرّف الصورة غير صالح.');
 const key=`${a.projectId}:${a.key}`,prior=await ctx.db.query('filmUploads').withIndex('by_key',q=>q.eq('key',key)).unique();if(prior&&(prior.type!==a.type||prior.size!==a.size))throw new ConvexError('ملف مختلف بنفس المعرف.');
 if(!prior)await ctx.db.insert('filmUploads',{projectId:a.projectId,key,type:a.type,size:a.size});
 return {fileId:prior?.fileId,url:prior?.fileId?null:await ctx.storage.generateUploadUrl()};
}});
export const ticket=internalQuery({args:{projectId:v.id('filmProjects'),key:v.string()},handler:async(ctx,a)=>{await owned(ctx,a.projectId);return ctx.db.query('filmUploads').withIndex('by_key',q=>q.eq('key',`${a.projectId}:${a.key}`)).unique();}});
export const register=internalMutation({args:{projectId:v.id('filmProjects'),key:v.string(),fileId:v.id('_storage')},handler:async(ctx,a)=>{
 await owned(ctx,a.projectId);const row=await ctx.db.query('filmUploads').withIndex('by_key',q=>q.eq('key',`${a.projectId}:${a.key}`)).unique();if(!row)throw new ConvexError('ابدأ الرفع أولًا.');if(row.fileId){if(row.fileId!==a.fileId)throw new ConvexError('الصورة مسجلة بالفعل.');return row.fileId;}
 const meta=await ctx.db.system.get(a.fileId);if(!meta||meta.size!==row.size||(meta.contentType!==undefined&&meta.contentType!==row.type)||Array.from(atob(meta.sha256),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')!==a.key)throw new ConvexError('الملف لا يطابق تصريح الرفع.');
 // Signature is checked in finish before this internal registration; public registration is not exposed.
 await ctx.db.patch(row._id,{fileId:a.fileId});return a.fileId;
}});
export const finish=action({args:{projectId:v.id('filmProjects'),key:v.string(),fileId:v.id('_storage')},handler:async(ctx,a):Promise<void>=>{
 const row=await ctx.runQuery(internal.filmWorkshop.ticket,{projectId:a.projectId,key:a.key});if(!row)throw new ConvexError('الرفع غير متاح.');if(row.fileId){if(row.fileId!==a.fileId)throw new ConvexError('ملف مختلف.');return;}
 const blob=await ctx.storage.get(a.fileId);if(!blob||blob.size!==row.size||blob.type!==row.type)throw new ConvexError('نوع الصورة أو حجمها غير صالح.');validateSignature(new Uint8Array(await blob.slice(0,64).arrayBuffer()),row.type);
 await ctx.runMutation(internal.filmWorkshop.register,a);
}});
export const file=internalQuery({args:{projectId:v.id('filmProjects'),fileId:v.id('_storage')},handler:async(ctx,a)=>{await owned(ctx,a.projectId);const row=await ctx.db.query('filmUploads').withIndex('by_file',q=>q.eq('fileId',a.fileId)).unique();return row?.projectId===a.projectId?{size:row.size,type:row.type}:null;}});
