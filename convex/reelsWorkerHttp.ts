import type {HttpRouter} from 'convex/server';import {httpAction} from './_generated/server';import {internal} from './_generated/api';import type {Id} from './_generated/dataModel';
async function authorized(request:Request){const secret=process.env.REELS_RUNNER_SECRET,value=request.headers.get('Authorization');if(process.env.REELS_RUNNER_ENABLED!=='true'||!secret||secret.length<32||!value?.startsWith('Bearer '))return false;const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.slice(7)))]);const aa=new Uint8Array(a),bb=new Uint8Array(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;}
export function reelsWorkerRoutes(http:HttpRouter){http.route({path:'/reels-worker',method:'POST',handler:httpAction(async(ctx,request)=>{const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};if(!await authorized(request))return new Response('Unauthorized',{status:401,headers});try{if(Number(request.headers.get('Content-Length')??0)>16384)throw Error();const text=await request.text();if(text.length>16384)throw Error();const {op,...args}=JSON.parse(text);let result:unknown;
 if(op==='claim')result=await ctx.runMutation(internal.reelsJobs.claim,{workerId:String(args.workerId).slice(0,100)});
 else if(op==='claimSingleTest')result=await ctx.runMutation(internal.reelsSingleTest.claim,{operationId:args.operationId,workerId:String(args.workerId).slice(0,100)});
 else if(op==='context'){const c=await ctx.runQuery(internal.reelsJobs.context,{id:args.id as Id<'reelsDeliveries'>,fence:args.fence});result={dryRun:c.job.dryRun,channel:c.channel,metadata:c.job.metadata,...(!c.job.dryRun&&!c.job.testPermitId?{scheduledAt:c.job.dueAt}:{})};}
 else if(op==='credentials')result=await ctx.runAction(internal.reelsWorker.credentials,{id:args.id,fence:args.fence});
 else if(op==='intent')result=await ctx.runMutation(internal.reelsJobs.intent,{id:args.id,fence:args.fence});
 else if(op==='result')result=await ctx.runMutation(internal.reelsJobs.result,args);
 else if(op==='observe')result=await ctx.runMutation(internal.reelsJobs.observe,args);
 else if(op==='claimStatus')result=await ctx.runMutation(internal.reelsJobs.observation,{onlyTest:args.onlyTest});
 else if(op==='statusCredentials')result=await ctx.runAction(internal.reelsWorker.statusCredentials,{id:args.id,fence:args.fence});
 else if(op==='quota')result=await ctx.runMutation(internal.reelsWorkerState.quota,{id:args.id,fence:args.fence,windows:args.windows,retryAfterSeconds:args.retryAfterSeconds});
 else if(op==='admission')result=await ctx.runMutation(internal.reelsWorkerState.admission,args);
 else if(op==='defer')result=await ctx.runMutation(internal.reelsWorkerState.defer,args);
 else if(op==='credentialRejected')result=await ctx.runMutation(internal.reelsWorkerState.credentialRejected,{id:args.id,fence:args.fence});
 else if(op==='media')result=await ctx.runQuery(internal.reelsWorkerState.media,args);
 else throw Error();return Response.json(result,{headers});}catch{return new Response('Worker operation rejected',{status:400,headers});}})});}
