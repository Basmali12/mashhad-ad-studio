import { v, ConvexError } from 'convex/values';
import { internalMutation, internalQuery, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { statusValidator } from './validators';
import { validateFile, validateSignature } from '../shared/validation';
const identity={requestId:v.id('requests'),workerId:v.string(),fence:v.string()};
async function locked(ctx:MutationCtx,args:{requestId:Id<'requests'>;workerId:string;fence:string}){
 const row=await ctx.db.get(args.requestId);
 if(!row?.runner||row.runner.workerId!==args.workerId||row.runner.fence!==args.fence||row.runner.leaseUntil<Date.now())throw new ConvexError('Worker lease lost. Stop without submitting.');
 return row;
}
export const claim=internalMutation({args:{requestId:v.id('requests'),workerId:v.string(),fence:v.string(),allowCompleted:v.optional(v.boolean())},handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.requestId);if(!row)throw new ConvexError('Request missing');
 if(row.status==='مسودة'||(row.status==='مكتمل'&&!(args.allowCompleted&&row.runner?.phase==='uploaded'&&row.runner.workerId===args.workerId)))throw new ConvexError('Request is not runnable');
 if(row.runner&&row.runner.leaseUntil>Date.now()&&(row.runner.workerId!==args.workerId||row.runner.fence!==args.fence))throw new ConvexError('Another worker owns this request');
 // Expired leases never erase submission intent. A replacement may only monitor/re-upload.
 const runner={...row.runner,workerId:args.workerId,fence:args.fence,leaseUntil:Date.now()+60000,phase:row.runner?.phase??'prepared'};
 await ctx.db.patch(row._id,{runner,updatedAt:Date.now()});return {...row,runner};
}});
export const heartbeat=internalMutation({args:identity,handler:async(ctx,args)=>{const row=await locked(ctx,args);await ctx.db.patch(row._id,{runner:{...row.runner!,leaseUntil:Date.now()+60000}});return true;}});
export const progress=internalMutation({args:{...identity,status:statusValidator,phase:v.union(v.literal('prepared'),v.literal('intent'),v.literal('submitted'),v.literal('unknown'),v.literal('downloaded'),v.literal('uploaded')),projectPath:v.optional(v.string()),taskId:v.optional(v.string()),error:v.optional(v.string()),estimatedPoints:v.optional(v.number()),actualPoints:v.optional(v.number()),clipSeconds:v.optional(v.number()),requiredClips:v.optional(v.number())},handler:async(ctx,args)=>{
 const row=await locked(ctx,args);
 if(row.runner!.phase==='uploaded')throw new ConvexError('Completed results are immutable to progress updates.');
 const allowed:Record<string,string[]>={prepared:['prepared','intent'],intent:['intent','submitted','unknown'],submitted:['submitted','downloaded'],unknown:['unknown','submitted','downloaded'],downloaded:['downloaded','uploaded'],uploaded:['uploaded']};
 if(!allowed[row.runner!.phase].includes(args.phase))throw new ConvexError('Unsafe runner transition');
 if(args.status==='مكتمل')throw new ConvexError('Use verified result upload to complete');
 if(args.phase==='intent'&&(row.runner!.phase!=='prepared'||row.status!=='بانتظار التشغيل'))throw new ConvexError('Generation already attempted or request paused');
 if(args.phase==='intent'){
 const attempted=(await ctx.db.query('requests').collect()).some(r=>r.runner&&r.runner.phase!=='prepared');
 if(attempted)throw new ConvexError('The single authorized trial has already been attempted. No second generation.');
 }
 if(args.projectPath&&!/^(?:\/fx\/tools\/flow)?\/project\/[a-zA-Z0-9-]+$/.test(args.projectPath))throw new ConvexError('Invalid project path');
 for(const n of [args.estimatedPoints,args.actualPoints,args.clipSeconds,args.requiredClips])if(n!==undefined&&(!Number.isFinite(n)||n<0))throw new ConvexError('Invalid numeric value');
 if((args.error?.length??0)>1200||(args.taskId?.length??0)>200)throw new ConvexError('Invalid diagnostic');
 await ctx.db.patch(row._id,{status:args.status,error:args.error,updatedAt:Date.now(),...(args.estimatedPoints!==undefined?{estimatedPoints:args.estimatedPoints}:{}),...(args.actualPoints!==undefined?{actualPoints:args.actualPoints}:{}),...(args.taskId?{externalTaskId:args.taskId}:{}),runner:{...row.runner!,phase:args.phase,projectPath:args.projectPath??row.runner!.projectPath,clipSeconds:args.clipSeconds??row.runner!.clipSeconds,requiredClips:args.requiredClips??row.runner!.requiredClips,leaseUntil:Date.now()+60000}});return true;
}});
export const get=internalQuery({args:{requestId:v.id('requests')},handler:async(ctx,args)=>ctx.db.get(args.requestId)});
export const fileAccess=internalQuery({args:{requestId:v.id('requests'),storageId:v.id('_storage')},handler:async(ctx,args)=>{const row=await ctx.db.get(args.requestId);return !!row&&(row.logoId===args.storageId||row.referenceIds.includes(args.storageId)||row.videoId===args.storageId||row.results?.some(r=>r.storageId===args.storageId));}});
export const beginUpload=internalMutation({args:{...identity,key:v.string(),name:v.string(),size:v.number()},handler:async(ctx,args)=>{
 await locked(ctx,args);validateFile('video/mp4',args.size,'video');if(!/^video:[a-f0-9]{64}$/.test(args.key)||args.name.length>200)throw new ConvexError('Invalid video');
 const row=await ctx.db.query('uploads').withIndex('by_key',q=>q.eq('key',args.key)).unique();
 if(row?.storageId)return {storageId:row.storageId,url:null};
 if(!row)await ctx.db.insert('uploads',{key:args.key,name:args.name,size:args.size,type:'video/mp4',kind:'video',createdAt:Date.now()});
 return {storageId:null,url:await ctx.storage.generateUploadUrl()};
}});
export const finishUpload=internalAction({args:{...identity,key:v.string(),storageId:v.id('_storage'),assetId:v.string(),duration:v.number(),width:v.number(),height:v.number()},handler:async(ctx,args):Promise<boolean>=>{
 const ticket=await ctx.runQuery(internal.files.ticket,{key:args.key});if(!ticket)throw new ConvexError('Upload missing');
 const blob=await ctx.storage.get(args.storageId);if(!blob)throw new ConvexError('File missing');validateFile(blob.type,blob.size,'video');
 if(blob.size!==ticket.size||blob.type!=='video/mp4')throw new ConvexError('File differs from ticket');validateSignature(new Uint8Array(await blob.slice(0,32).arrayBuffer()),blob.type);
 const meta=await ctx.runQuery(internal.runner.metadata,{storageId:args.storageId});if(!meta||args.key!==`video:${meta.hash}`)throw new ConvexError('Hash mismatch');
 const storageId=await ctx.runMutation(internal.files.register,{key:args.key,storageId:args.storageId});
 await ctx.runMutation(internal.runner.result,{...args,storageId});return true;
}});
export const metadata=internalQuery({args:{storageId:v.id('_storage')},handler:async(ctx,args)=>{const doc=await ctx.db.system.get(args.storageId);return doc?{size:doc.size,hash:Array.from(atob(doc.sha256),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')}:null;}});
export const result=internalMutation({args:{...identity,key:v.string(),storageId:v.id('_storage'),assetId:v.string(),duration:v.number(),width:v.number(),height:v.number()},handler:async(ctx,args)=>{
 const row=await locked(ctx,args);if(!['submitted','unknown','downloaded','uploaded'].includes(row.runner!.phase))throw new ConvexError('No submitted job');
 if(!args.assetId||args.assetId.length>200||!Number.isFinite(args.duration)||args.duration<=0||args.duration>600||![args.width,args.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=8192))throw new ConvexError('Invalid media metadata');
 const file=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',args.storageId)).unique();if(!file||file.key!==args.key||file.kind!=='video')throw new ConvexError('Unverified video');
 const results=row.results??[];const existing=results.find(r=>r.assetId===args.assetId);if(existing&&existing.storageId!==args.storageId)throw new ConvexError('Asset identity conflict');
 if(!existing)results.push({assetId:args.assetId,storageId:args.storageId,duration:args.duration,width:args.width,height:args.height});
 const complete=results.length>=Math.max(row.clipCount,row.runner!.requiredClips??row.clipCount);
 await ctx.db.patch(row._id,{results,videoId:results[0].storageId,videoSource:'runner',status:complete?'مكتمل':'قيد التنزيل',error:complete?undefined:'حُفظ مقطع حقيقي؛ بقية المقاطع لم تُولّد. لا دمج في هذه المرحلة.',updatedAt:Date.now(),runner:{...row.runner!,phase:complete?'uploaded':'downloaded'}});return true;
}});
