import {v,ConvexError} from 'convex/values';
import {query,action} from './_generated/server';
import {api} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {requireOwner} from './access';
import {personalFlow,personalFlowConnected} from './personalFlow';
import {videoOptions} from '../shared/chat-video';
import {defaultTemplate,type FlowOption} from '../shared/pipeline';
const proposal=v.object({prompt:v.string(),durationSeconds:v.number(),aspect:v.union(v.literal('16:9'),v.literal('9:16')),continuationPrompts:v.array(v.string())});
export const quote=query({args:{proposal},handler:async(ctx,a)=>{
 const u=await requireOwner(ctx);if(!personalFlowConnected(u.subject)||!personalFlow(u.subject))throw new ConvexError('اربط حساب Flow الشخصي أولًا.');
 const w=await ctx.db.query('workers').withIndex('by_key',q=>q.eq('key','pipeline')).unique();if(w?.state!=='online'||Date.now()-w.seenAt>60000||Date.now()-w.observedAt>3600000)throw new ConvexError('خدمة توليد الفيديو غير متصلة؛ لم يبدأ التوليد ولم تُخصم نقاط.');
 const option=videoOptions(a.proposal,w.options)[0];if(!option)throw new ConvexError('المدة وعدد برومبتات المشاهد لا يطابقان قدرات Flow الحالية بدقة 720p. اطلب تصحيح الخطة؛ لم يبدأ توليد.');
 return {option,count:a.proposal.durationSeconds/option.seconds,credits:option.cost*a.proposal.durationSeconds/option.seconds,observedAt:w.observedAt};
}});
type Quote={option:FlowOption;count:number;credits:number;observedAt:number};
export const authorize=action({args:{key:v.string(),proposal,referenceIds:v.array(v.id('_storage')),approvedCredits:v.number()},handler:async(ctx,a):Promise<{requestId:Id<'requests'>;jobId:Id<'pipelines'>}>=>{
 await requireOwner(ctx);if(!/^[\w-]{8,100}$/.test(a.key)||a.referenceIds.length>8)throw new ConvexError('طلب الفيديو غير صالح.');
 // Reuse the original request after interruptions. Never create a new attempt on retry.
 const existing=await ctx.runQuery(api.requests.list,{}),old=existing.find(r=>r.key==='chat-video-'+a.key);
 if(old){const jobs=await ctx.runQuery(api.pipeline.state,{requestId:old._id});const job=jobs.find(j=>j.key===a.key);if(job){if(old.form.prompt!==a.proposal.prompt||old.form.duration!==a.proposal.durationSeconds||old.form.aspect!==a.proposal.aspect||JSON.stringify(old.form.continuationPrompts??[])!==JSON.stringify(a.proposal.continuationPrompts)||JSON.stringify(old.referenceIds)!==JSON.stringify(a.referenceIds))throw new ConvexError('تغيّر الطلب المحفوظ؛ لن يُرسل توليد جديد.');return {requestId:old._id,jobId:job._id};}}
 const q:Quote=await ctx.runQuery(api.privateStudioVideos.quote,{proposal:a.proposal});if(q.credits!==a.approvedCredits)throw new ConvexError('تغيرت الكلفة؛ راجع السعر الجديد ووافق عليه أولًا.');
 const form={name:a.proposal.prompt.slice(0,120),address:'مشروع شخصي',phone:'غير مستخدم',products:'مشهد قصصي دون إعلان',prompt:a.proposal.prompt,continuationPrompts:a.proposal.continuationPrompts,instructions:'لا تضف كتابة أو شعارًا. حافظ على ملامح الشخصيات والصور المرجعية.',model:q.option.model,aspect:a.proposal.aspect,duration:a.proposal.durationSeconds,dialect:'العراقية'};
 const requestId:Id<'requests'>=await ctx.runMutation(api.requests.save,{key:'chat-video-'+a.key,form,clipCount:q.count,referenceIds:a.referenceIds,submit:true});
 const template=defaultTemplate(form);template.text.name=false;template.text.address=false;template.text.phone=false;
 const jobId:Id<'pipelines'>=await ctx.runMutation(api.pipeline.authorize,{requestId,key:a.key,option:q.option,count:q.count,template});return {requestId,jobId};
}});
export const status=query({args:{jobId:v.id('pipelines')},handler:async(ctx,a)=>{const u=await requireOwner(ctx),job=await ctx.db.get(a.jobId);if(!job)throw new ConvexError('الفيديو غير موجود.');const request=await ctx.db.get(job.requestId);if(request?.subject!==u.subject)throw new ConvexError('الفيديو غير مصرح له.');return {storageId:job.stage==='completed'?job.finalId??null:null,stage:job.stage,error:job.error??null,url:job.stage==='completed'&&job.finalId?await ctx.storage.getUrl(job.finalId):null};}});
