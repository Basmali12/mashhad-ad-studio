import {v,ConvexError} from 'convex/values';
import {mutation,query,internalMutation,internalQuery,internalAction} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {internal} from './_generated/api';
import {requireCustomer,ownedRequest} from './access';
import {assertFileOwner} from './customerFiles';
import {editValidator,exportStatus,mediaValidator} from './editValidators';
import {validateEdit,canonical,editDimensions,type EditSettings} from '../shared/editing';
import {validateFile,validateSignature} from '../shared/validation';
const selection={requestId:v.id('requests'),settings:editValidator,logoId:v.optional(v.id('_storage'))};
async function check(ctx:MutationCtx,a:{requestId:Id<'requests'>;settings:EditSettings;logoId?:Id<'_storage'>}){
 validateEdit(a.settings);const r=await ownedRequest(ctx,a.requestId);
 const sources=new Set([r.videoId,...(r.results??[]).map(c=>c.storageId)]);
 for(const c of a.settings.clips){if(!sources.has(c.storageId as Id<'_storage'>))throw new ConvexError('المقطع غير مرتبط بالطلب.');const known=r.results?.find(v=>v.storageId===c.storageId);if(known&&c.end>known.duration+.04)throw new ConvexError('نهاية القص تتجاوز المقطع.');}
 if(a.settings.logo.enabled&&!a.logoId)throw new ConvexError('اختر شعارًا شفافًا أو عطّل الشعار.');
 if(a.logoId){await assertFileOwner(ctx,r.subject??process.env.OWNER_SUBJECT!,a.logoId);const file=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',a.logoId)).unique();if(!file||file.kind!=='image'||a.settings.logo.enabled&&!['image/png','image/webp'].includes(file.type))throw new ConvexError('الشعار يجب أن يكون PNG أو WebP محفوظًا.');}
 return r;
}
export const state=query({args:{requestId:v.id('requests')},handler:async(ctx,a)=>{await ownedRequest(ctx,a.requestId);return {edit:await ctx.db.query('edits').withIndex('by_request',q=>q.eq('requestId',a.requestId)).unique(),exports:await ctx.db.query('exports').withIndex('by_request',q=>q.eq('requestId',a.requestId)).order('desc').collect()};}});
export const save=mutation({args:selection,handler:async(ctx,a)=>{await requireCustomer(ctx);await check(ctx,a);const r=await ctx.db.query('edits').withIndex('by_request',q=>q.eq('requestId',a.requestId)).unique();if(r)await ctx.db.patch(r._id,{...a,updatedAt:Date.now()});else await ctx.db.insert('edits',{...a,updatedAt:Date.now()});}});
export const enqueue=mutation({args:{...selection,key:v.string()},handler:async(ctx,a)=>{
 await ownedRequest(ctx,a.requestId);if(!/^[a-zA-Z0-9-]{8,100}$/.test(a.key))throw new ConvexError('Invalid key');
 const existing=await ctx.db.query('exports').withIndex('by_key',q=>q.eq('key',a.key)).unique();if(existing){if(existing.requestId!==a.requestId||canonical(existing.settings)!==canonical(a.settings)||existing.logoId!==a.logoId)throw new ConvexError('Key conflict');return existing._id;}
 const r=await check(ctx,a);const active=await ctx.db.query('exports').withIndex('by_request',q=>q.eq('requestId',a.requestId)).collect();
 if(active.some(e=>!['completed','failed'].includes(e.status)))throw new ConvexError('هناك تصدير قيد التنفيذ لهذا الطلب.');
 return ctx.db.insert('exports',{...a,texts:{name:r.form.name,address:r.form.address,phone:r.form.phone},status:'queued',history:[{status:'queued',at:Date.now()}],createdAt:Date.now(),updatedAt:Date.now()});
}});
const identity={exportId:v.id('exports'),workerId:v.string(),fence:v.string()};
async function locked(ctx:MutationCtx,a:{exportId:Id<'exports'>;workerId:string;fence:string}){const r=await ctx.db.get(a.exportId);if(!r||r.lease?.workerId!==a.workerId||r.lease.fence!==a.fence||r.lease.until<Date.now())throw new ConvexError('Montage lease lost');return r;}
export const pending=internalQuery({args:{},handler:async ctx=>(await ctx.db.query('exports').withIndex('by_status',q=>q.eq('status','queued')).collect()).find(e=>!e.key.startsWith('pipeline-'))?._id??null});
export const retry=mutation({args:{exportId:v.id('exports')},handler:async(ctx,a)=>{const e=await ctx.db.get(a.exportId);if(e)await ownedRequest(ctx,e.requestId);else await requireCustomer(ctx);if(!e||e.key.startsWith('pipeline-'))throw new ConvexError('استعمل استئناف الطلب في التشغيل الكامل.');if(e.status!=='failed')return;if(e.lease&&e.lease.until>Date.now())throw new ConvexError('المونتاج ما زال متصلًا.');await ctx.db.patch(e._id,{status:'queued',error:undefined,percent:undefined,updatedAt:Date.now()});}});
export const claim=internalMutation({args:identity,handler:async(ctx,a)=>{const r=await ctx.db.get(a.exportId);if(!r||r.status==='completed')throw new ConvexError('Export cannot run');const other=(await ctx.db.query('exports').collect()).some(e=>e._id!==r._id&&e.lease&&e.lease.until>Date.now());if(other)throw new ConvexError('Another montage job is running');if(r.lease&&r.lease.until>Date.now()&&(r.lease.workerId!==a.workerId||r.lease.fence!==a.fence))throw new ConvexError('Another editor owns export');await ctx.db.patch(r._id,{lease:{workerId:a.workerId,fence:a.fence,until:Date.now()+60000},startedAt:r.startedAt??Date.now(),endedAt:undefined,error:undefined});return r;}});
export const heartbeat=internalMutation({args:identity,handler:async(ctx,a)=>{await locked(ctx,a);await ctx.db.patch(a.exportId,{lease:{workerId:a.workerId,fence:a.fence,until:Date.now()+60000}});}});
export const progress=internalMutation({args:{...identity,status:exportStatus,percent:v.optional(v.number()),error:v.optional(v.string())},handler:async(ctx,a)=>{const r=await locked(ctx,a);if(r.status==='completed'||a.status==='completed')throw new ConvexError('Completion requires verified file');if(a.percent!==undefined&&(!Number.isFinite(a.percent)||a.percent<0||a.percent>100))throw new ConvexError('Invalid progress');if((a.error?.length??0)>1200)throw new ConvexError('Invalid error');await ctx.db.patch(a.exportId,{status:a.status,history:a.status===r.status?r.history:[...(r.history??[]),{status:a.status,at:Date.now()}].slice(-200),percent:a.percent,error:a.error,updatedAt:Date.now(),...(a.status==='failed'?{endedAt:Date.now(),lease:{...r.lease!,until:0}}:{})});}});
export const fileAccess=internalQuery({args:{exportId:v.id('exports'),storageId:v.id('_storage')},handler:async(ctx,a)=>{const r=await ctx.db.get(a.exportId);return !!r&&(r.logoId===a.storageId||r.settings.clips.some(c=>c.storageId===a.storageId)||r.fileId===a.storageId);}});
export const upload=internalMutation({args:{...identity,key:v.string(),size:v.number()},handler:async(ctx,a)=>{await locked(ctx,a);validateFile('video/mp4',a.size,'video');if(!/^video:[a-f0-9]{64}$/.test(a.key))throw new ConvexError('Invalid key');const f=await ctx.db.query('uploads').withIndex('by_key',q=>q.eq('key',a.key)).unique();if(f&&f.size!==a.size)throw new ConvexError('Size mismatch');if(f?.storageId)return {storageId:f.storageId,url:null};if(!f)await ctx.db.insert('uploads',{key:a.key,size:a.size,kind:'video',type:'video/mp4',name:`export-${a.exportId}.mp4`,createdAt:Date.now()});return {storageId:null,url:await ctx.storage.generateUploadUrl()};}});
export const finish=internalAction({args:{...identity,key:v.string(),storageId:v.id('_storage'),media:mediaValidator},handler:async(ctx,a):Promise<void>=>{
 const f=await ctx.runQuery(internal.files.ticket,{key:a.key}),blob=await ctx.storage.get(a.storageId);if(!f||!blob||blob.size!==f.size||blob.type!=='video/mp4')throw new ConvexError('File mismatch');validateFile(blob.type,blob.size,'video');validateSignature(new Uint8Array(await blob.slice(0,32).arrayBuffer()),blob.type);
 const m=await ctx.runQuery(internal.runner.metadata,{storageId:a.storageId});if(!m||a.key!==`video:${m.hash}`)throw new ConvexError('Hash mismatch');const storageId=await ctx.runMutation(internal.files.register,{key:a.key,storageId:a.storageId});await ctx.runMutation(internal.editing.complete,{...a,storageId});
}});
export const complete=internalMutation({args:{...identity,key:v.string(),storageId:v.id('_storage'),media:mediaValidator},handler:async(ctx,a)=>{
 const r=await locked(ctx,a),f=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',a.storageId)).unique();if(r.status!=='uploading'||f?.key!==a.key||f.kind!=='video')throw new ConvexError('Unverified export');
 if(!Number.isFinite(a.media.duration)||Math.abs(a.media.duration-r.settings.duration)>.12||a.media.width!==editDimensions(r.settings).width||a.media.height!==editDimensions(r.settings).height||a.media.size!==f.size)throw new ConvexError('Output metadata mismatch');
 if(a.media.sources.length!==r.settings.clips.length||a.media.sources.some((s,i)=>s.storageId!==r.settings.clips[i].storageId||!Number.isFinite(s.duration)||s.duration<r.settings.clips[i].end-.04||![s.width,s.height].every(n=>Number.isSafeInteger(n)&&n>0)))throw new ConvexError('Source metadata mismatch');
 await ctx.db.patch(a.exportId,{status:'completed',history:[...(r.history??[]),{status:'completed' as const,at:Date.now()}].slice(-200),percent:100,fileId:a.storageId,media:a.media,error:undefined,updatedAt:Date.now(),endedAt:Date.now(),lease:{...r.lease!,until:0}});
}});
