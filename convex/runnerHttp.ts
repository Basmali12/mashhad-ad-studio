import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { HttpRouter } from 'convex/server';
import type { Id } from './_generated/dataModel';
// A dedicated worker capability is stored only on this Windows device. Convex keeps its hash.
export function runnerRoutes(http:HttpRouter){
 http.route({path:'/runner',method:'POST',handler:httpAction(async(ctx,request)=>{
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
 const hash=token?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(n=>n.toString(16).padStart(2,'0')).join(''):'';
 if(!process.env.WORKER_KEY_SHA256||hash!==process.env.WORKER_KEY_SHA256)return new Response('Unauthorized',{status:401});
 if(Number(request.headers.get('Content-Length')??0)>16000)return new Response('Too large',{status:413});
 try{const {op,args}=await request.json();let value:unknown;
 switch(op){
 case 'filmNext':value=await ctx.runQuery(internal.filmProduction.next,{});break;
 case 'filmGet':value=await ctx.runQuery(internal.filmProduction.get,args);break;
 case 'filmClaim':value=await ctx.runMutation(internal.filmProduction.claim,args);break;
 case 'filmHeartbeat':value=await ctx.runMutation(internal.filmProduction.heartbeat,args);break;
 case 'filmRelease':value=await ctx.runMutation(internal.filmProduction.release,args);break;
 case 'filmProgress':value=await ctx.runMutation(internal.filmProduction.progress,args);break;
 case 'filmClip':value=await ctx.runMutation(internal.filmProduction.clip,args);break;
 case 'filmUpload':value=await ctx.runMutation(internal.filmProduction.upload,args);break;
 case 'filmFinish':value=await ctx.runAction(internal.filmProduction.finish,args);break;
 case 'filmReview':value=await ctx.runAction(internal.filmReview.run,args);break;
 case 'filmReviewCapacity':value=await ctx.runQuery(internal.filmReview.capacity,args);break;
 case 'filmFile':{
 if(!await ctx.runQuery(internal.filmProduction.fileAccess,{jobId:args.jobId,storageId:args.storageId}))return new Response('Forbidden',{status:403});
 const blob=await ctx.storage.get(args.storageId);if(!blob)return new Response('Not found',{status:404});
 if(args.metadata){const meta=await ctx.runQuery(internal.runner.metadata,{storageId:args.storageId});return Response.json({size:blob.size,type:blob.type,hash:meta?.hash});}
 const offset=args.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>=blob.size)return new Response('Invalid offset',{status:400});
 return new Response(blob.slice(offset,offset+8*1024*1024),{headers:{'Content-Type':blob.type,'Cache-Control':'no-store'}});
 }
 case 'imagePresence':value=await ctx.runMutation(internal.images.presence,args);break;
 case 'imageNext':value=await ctx.runQuery(internal.images.next,{});break;
 case 'imageGet':value=await ctx.runQuery(internal.images.get,args);break;
 case 'imageClaim':value=await ctx.runMutation(internal.images.claim,args);break;
 case 'imageHeartbeat':value=await ctx.runMutation(internal.images.heartbeat,args);break;
 case 'imageRelease':value=await ctx.runMutation(internal.images.release,args);break;
 case 'imageProgress':value=await ctx.runMutation(internal.images.progress,args);break;
 case 'imageUpload':value=await ctx.runMutation(internal.images.upload,args);break;
 case 'imageFinish':value=await ctx.runAction(internal.images.finish,args);break;
 case 'imageFile':{
 if(!await ctx.runQuery(internal.images.fileAccess,{jobId:args.jobId,storageId:args.storageId}))return new Response('Forbidden',{status:403});
 const blob=await ctx.storage.get(args.storageId);if(!blob)return new Response('Not found',{status:404});
 if(args.metadata){const meta=await ctx.runQuery(internal.runner.metadata,{storageId:args.storageId});return Response.json({size:blob.size,type:blob.type,hash:meta?.hash});}
 const offset=args.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>=blob.size)return new Response('Invalid offset',{status:400});
 return new Response(blob.slice(offset,offset+8*1024*1024),{headers:{'Content-Type':blob.type,'Cache-Control':'no-store'}});
 }
 case 'pipePresence':value=await ctx.runMutation(internal.pipeline.presence,args);break;
 case 'pipeNext':value=await ctx.runQuery(internal.pipeline.next,{});break;
 case 'pipeGet':value=await ctx.runQuery(internal.pipeline.get,args);break;
 case 'pipeClaim':value=await ctx.runMutation(internal.pipeline.claim,args);break;
 case 'pipeHeartbeat':value=await ctx.runMutation(internal.pipeline.heartbeat,args);break;
 case 'pipeRelease':value=await ctx.runMutation(internal.pipeline.release,args);break;
 case 'pipeStage':value=await ctx.runMutation(internal.pipeline.stage,args);break;
 case 'pipeClip':value=await ctx.runMutation(internal.pipeline.clip,args);break;
 case 'pipeUpload':value=await ctx.runMutation(internal.pipeline.upload,args);break;
 case 'pipeFinish':value=await ctx.runAction(internal.pipeline.finish,args);break;
 case 'pipeExport':value=await ctx.runMutation(internal.pipeline.startExport,args);break;
 case 'pipeExportState':value=await ctx.runQuery(internal.pipeline.exportState,args);break;
 case 'pipeComplete':value=await ctx.runMutation(internal.pipeline.complete,args);break;
 case 'pipeFile':{
 if(!await ctx.runQuery(internal.pipeline.fileAccess,{jobId:args.jobId,storageId:args.storageId}))return new Response('Forbidden',{status:403});
 const blob=await ctx.storage.get(args.storageId);if(!blob)return new Response('Not found',{status:404});
 if(args.metadata){const meta=await ctx.runQuery(internal.runner.metadata,{storageId:args.storageId});return Response.json({size:blob.size,type:blob.type,hash:meta?.hash});}
 const offset=args.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>=blob.size)return new Response('Invalid offset',{status:400});
 return new Response(blob.slice(offset,offset+8*1024*1024),{headers:{'Content-Type':blob.type,'Cache-Control':'no-store'}});
 }
 case 'editPending':value=await ctx.runQuery(internal.editing.pending,{});break;
 case 'editClaim':value=await ctx.runMutation(internal.editing.claim,args);break;
 case 'editHeartbeat':value=await ctx.runMutation(internal.editing.heartbeat,args);break;
 case 'editProgress':value=await ctx.runMutation(internal.editing.progress,args);break;
 case 'editUpload':value=await ctx.runMutation(internal.editing.upload,args);break;
 case 'editFinish':value=await ctx.runAction(internal.editing.finish,args);break;
 case 'editFile':{
 if(!await ctx.runQuery(internal.editing.fileAccess,{exportId:args.exportId,storageId:args.storageId}))return new Response('Forbidden',{status:403});
 const blob=await ctx.storage.get(args.storageId);if(!blob)return new Response('Not found',{status:404});
 if(args.metadata){const meta=await ctx.runQuery(internal.runner.metadata,{storageId:args.storageId});return Response.json({size:blob.size,type:blob.type,hash:meta?.hash});}
 const offset=args.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>=blob.size)return new Response('Invalid offset',{status:400});
 return new Response(blob.slice(offset,offset+8*1024*1024),{headers:{'Content-Type':blob.type,'Cache-Control':'no-store'}});
 }
 case 'claim':value=await ctx.runMutation(internal.runner.claim,args);break;
 case 'heartbeat':value=await ctx.runMutation(internal.runner.heartbeat,args);break;
 case 'progress':value=await ctx.runMutation(internal.runner.progress,args);break;
 case 'get':value=await ctx.runQuery(internal.runner.get,args);break;
 case 'upload':value=await ctx.runMutation(internal.runner.beginUpload,args);break;
 case 'finish':value=await ctx.runAction(internal.runner.finishUpload,args);break;
 case 'file':{
 const allowed=await ctx.runQuery(internal.runner.fileAccess,{requestId:args.requestId as Id<'requests'>,storageId:args.storageId as Id<'_storage'>});if(!allowed)return new Response('Forbidden',{status:403});
 const blob=await ctx.storage.get(args.storageId);if(!blob)return new Response('Not found',{status:404});
 return new Response(blob,{headers:{'Content-Type':blob.type,'Cache-Control':'no-store'}});
 }
 default:return new Response('Unknown operation',{status:400});
 }
 return Response.json(value,{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Worker operation refused. Check lease, request state or file validation.'},{status:409});}
 })});
}
