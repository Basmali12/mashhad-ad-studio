import {publisherTick,publicationStatus,type RunnerTransport} from '../worker/reels-publisher.ts';
import {SINGLE_TEST} from '../shared/reels-single-test.ts';
import {queueIdleDelay} from '../shared/reels-idle';
import {personalQuota} from '../shared/buffer-personal-quota.ts';
const origin=process.env.REELS_RUNNER_SITE??'',secret=process.env.REELS_RUNNER_SECRET??'';
if(process.env.REELS_WORKER_START!=='true'||secret.length<32)throw Error('Runner is not explicitly configured');const url=new URL(origin);if(url.origin!==origin||url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Runner site must be HTTPS or isolated loopback');
async function rpc(op:string,args:object={}){const response=await fetch(origin+'/reels-worker',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({op,...args}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Runner operation failed');return response.json();}
async function quota(c:{id:string;fence:string},headers:Headers,statusCode?:number){await rpc('quota',{...c,windows:personalQuota(headers),retryAfterSeconds:statusCode===429?Number(headers.get('retry-after'))||900:undefined});}
const singleTest=process.env.REELS_SINGLE_TEST_OPERATION===SINGLE_TEST.operationId;if(process.env.REELS_SINGLE_TEST_OPERATION&&!singleTest)throw Error('Invalid single test operation');
const transport:RunnerTransport={claim:()=>singleTest?rpc('claimSingleTest',{operationId:SINGLE_TEST.operationId,workerId:'single-test'}):rpc('claim',{workerId:'reels-hostinger'}),context:c=>rpc('context',c),credentials:c=>rpc('credentials',c),intent:async c=>{await rpc('intent',c);},result:async(c,r)=>{await rpc('result',{...c,...r});},credentialRejected:async c=>{await rpc('credentialRejected',c);},quota,admission:c=>rpc('admission',{...c,status:false}),defer:async(c,retryAt)=>{await rpc('defer',{...c,retryAt});}};
let running=true,idleRounds=0;process.on('SIGTERM',()=>{running=false;});process.on('SIGINT',()=>{running=false;});while(running){let worked=false;try{
 worked=await publisherTick(transport);const pending=await rpc('claimStatus',{onlyTest:singleTest?true:undefined});if(pending){worked=true;const c={id:pending.id,fence:pending.fence};
 try{const token=await rpc('statusCredentials',c),gate=await rpc('admission',{...c,status:true});
 if(!gate.allowed){await rpc('observe',{...c,providerId:pending.providerId,status:'unavailable',attempted:false,retryAt:gate.retryAt});}
 else {const result=await publicationStatus(token,pending.providerId,pending.channelId,fetch,async(h,code)=>{await quota(c,h,code);if(code===401||code===403)await rpc('credentialRejected',c);});await rpc('observe',{...c,providerId:pending.providerId,status:result.status});}
 }catch{await rpc('observe',{...c,providerId:pending.providerId,status:'unavailable'});}
 }
 }catch{console.error('Runner operation requires inspection; no automatic resend');}idleRounds=worked?0:idleRounds+1;await new Promise(resolve=>setTimeout(resolve,queueIdleDelay(idleRounds,worked)));}
