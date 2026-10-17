import {bufferCreateQuery,bufferVideoInput,type BufferChannel} from '../shared/buffer';
import {platformCaption,type PublishMetadata} from '../shared/library-publishing';
export interface DeliveryContext {scheduledAt?:number;dryRun:boolean;channel:BufferChannel;metadata:PublishMetadata}
export interface RunnerTransport {
 claim():Promise<{id:string;fence:string}|null>;
 context(claim:{id:string;fence:string}):Promise<DeliveryContext>;
 credentials(claim:{id:string;fence:string}):Promise<{token:string;mediaUrl:string}>;
 intent(claim:{id:string;fence:string}):Promise<void>;
 result(claim:{id:string;fence:string},result:{phase:'dry_run'|'accepted'|'published'|'failed'|'uncertain'|'retry';providerId?:string;error?:string;retryAfterSeconds?:number}):Promise<void>;
 credentialRejected?(claim:{id:string;fence:string}):Promise<void>;
 quota?(claim:{id:string;fence:string},headers:Headers,statusCode?:number):Promise<void>;
 admission?(claim:{id:string;fence:string}):Promise<{allowed:boolean;retryAt:number}>;
 defer?(claim:{id:string;fence:string},retryAt:number):Promise<void>;
}
// Hostinger adapter is injectable; production service remains stopped/unconfigured until release approval.
export async function publisherTick(transport:RunnerTransport,fetcher:typeof fetch=fetch){
 const claim=await transport.claim();if(!claim)return false;let intent=false;
 try{const c=await transport.context(claim);if(c.dryRun){bufferVideoInput(c.channel,'https://example.invalid/test-only.mp4',platformCaption(c.metadata,c.channel.service),undefined,c.metadata);await transport.result(claim,{phase:'dry_run'});return true;}
 const auth=await transport.credentials(claim),url=new URL(auth.mediaUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid provider media URL');
 const permitted=async()=>{if(!transport.admission)return true;const decision=await transport.admission(claim);if(decision.allowed)return true;if(!transport.defer)throw Error('Quota defer unavailable');await transport.defer(claim,decision.retryAt);return false;};
 if(!await permitted())return true;
 // Quota/channel preflight occurs before the durable intent; only an explicit 429 here is retryable.
 const preflight=await fetcher('https://api.buffer.com',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({query:'query Channel($input: ChannelInput!){channel(input:$input){id isDisconnected isLocked}}',variables:{input:{id:c.channel.id}}}),signal:AbortSignal.timeout(30000)});
 await transport.quota?.(claim,preflight.headers,preflight.status);if(preflight.status===401||preflight.status===403){if(transport.credentialRejected)await transport.credentialRejected(claim);else await transport.result(claim,{phase:'failed',error:'مفتاح Buffer غير صالح؛ يرجى مراسلة الدعم.'});return true;}if(preflight.status===429){const delay=Number(preflight.headers.get('retry-after'));if(transport.defer){await transport.defer(claim,Date.now()+(Number.isFinite(delay)&&delay>0?delay:900)*1000+5000);return true;}await transport.result(claim,Number.isFinite(delay)&&delay>0&&delay<=86400?{phase:'retry',retryAfterSeconds:delay}:{phase:'failed',error:'Quota unavailable'});return true;}const before=await preflight.json();if(!preflight.ok||before.errors||before.data?.channel?.id!==c.channel.id||before.data.channel.isDisconnected!==false||before.data.channel.isLocked!==false)throw Error('Channel unavailable');
 if(!await permitted())return true;
 const scheduledAt=c.scheduledAt&&c.scheduledAt>Date.now()?c.scheduledAt:undefined;
 const input=bufferVideoInput(c.channel,auth.mediaUrl,platformCaption(c.metadata,c.channel.service),scheduledAt,c.metadata);await transport.intent(claim);intent=true;
 const response=await fetcher('https://api.buffer.com',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({query:bufferCreateQuery,variables:{input}}),signal:AbortSignal.timeout(45000)});
 await transport.quota?.(claim,response.headers,response.status);if(response.status===401||response.status===403){await transport.result(claim,{phase:'uncertain',error:'رفض التفويض بعد بدء الطلب؛ مراجعة الدعم مطلوبة.'});await transport.credentialRejected?.(claim);return true;}const body=await response.json(),post=body.data?.createPost?.post;if(!response.ok||body.errors||!post?.id){await transport.result(claim,{phase:'uncertain',providerId:typeof post?.id==='string'?post.id:undefined,error:'Provider result requires reconciliation; do not resend'});return true;}
 await transport.result(claim,{phase:post.status==='sent'?'published':post.status==='error'?'failed':'accepted',providerId:post.id});
 }catch{await transport.result(claim,{phase:intent?'uncertain':'failed',error:intent?'Send result uncertain; do not resend':'Preflight failed; no publication was sent'});}return true;
}
export async function publicationStatus(token:string,providerId:string,channelId:string,fetcher:typeof fetch=fetch,onHeaders?:(headers:Headers,statusCode:number)=>Promise<void>){const response=await fetcher('https://api.buffer.com',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:'query Status($input: PostInput!){post(input:$input){id channelId status}}',variables:{input:{id:providerId}}}),signal:AbortSignal.timeout(30000)});await onHeaders?.(response.headers,response.status);if(!response.ok)throw Error('Status unavailable');const body=await response.json(),post=body.data?.post;if(body.errors||post?.id!==providerId||post.channelId!==channelId)throw Error('Receipt mismatch');return {status:post.status==='sent'?'sent' as const:post.status==='error'?'error' as const:'pending' as const,headers:response.headers};}
