import {sealToken,openToken} from '../shared/meta';
import {bufferAccountQuery,bufferChannelsQuery,bufferRateLimits,supportedBufferChannel,connectedBufferChannel,type BufferChannel} from '../shared/buffer';
import {accountAvatar} from '../shared/account-avatar';

// Connection inspection performs reads only, with no posting operation or owner fallback.
// personalKeysApproved is the operator's runtime authorization, not a claim of provider policy approval.
export interface PreparedPersonalConnection {
 subject:string; encryptedKey:string; accountId:string; organizations:{id:string}[]; channels:BufferChannel[];
 selectedChannelIds:string[]; writePermission:'unverified';
 limits:ReturnType<typeof bufferRateLimits>;
}
export interface PersonalPreparationPolicy {environment:'test'|'production'|'restricted-production';personalKeysApproved:boolean}
export class PersonalPreparationError extends Error {
 constructor(public code:'disabled'|'invalid_key'|'provider_unavailable'|'rate_limited'|'invalid_response'|'wrong_owner'|'invalid_selection',public retryAfterSeconds?:number){super('تعذر تجهيز الربط: '+code);}
}
function identifier(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=200;}
async function limitedJson(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw new PersonalPreparationError('invalid_response');
 const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1024*1024){await reader.cancel();throw new PersonalPreparationError('invalid_response');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const joined=new Uint8Array(total);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(joined));}catch{throw new PersonalPreparationError('invalid_response');}
}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new PersonalPreparationError('invalid_response');return value as Record<string,unknown>;}
export async function preparePersonalConnection(subject:string,key:string,encryptionKey:string,policy:PersonalPreparationPolicy,fetcher:typeof fetch=fetch,observe?:(headers:Headers)=>Promise<void>):Promise<PreparedPersonalConnection>{
 if(!['test','restricted-production','production'].includes(policy.environment)||policy.personalKeysApproved!==true)throw new PersonalPreparationError('disabled');
 if(!identifier(subject)||typeof key!=='string'||key.trim()!==key||key.length<16||key.length>4096||/\s/.test(key)||Array.from(key).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))throw new PersonalPreparationError('invalid_key');
 let limits:ReturnType<typeof bufferRateLimits>=[];
 async function query(document:string,variables:unknown={}){
  let response:Response;
  try{response=await fetcher('https://api.buffer.com',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({query:document,variables}),signal:AbortSignal.timeout(30000)});}catch{throw new PersonalPreparationError('provider_unavailable');}
  limits=bufferRateLimits(response.headers.get('ratelimit'));
  await observe?.(response.headers);
  if(response.status===429){const retry=Number(response.headers.get('retry-after'));throw new PersonalPreparationError('rate_limited',Number.isFinite(retry)&&retry>0?retry:undefined);}
  if(response.status===401||response.status===403)throw new PersonalPreparationError('invalid_key');
  if(!response.ok)throw new PersonalPreparationError('provider_unavailable');
  const body=record(await limitedJson(response));if(body.errors||!body.data)throw new PersonalPreparationError('invalid_response');return record(body.data);
 }
 const account=record((await query(bufferAccountQuery)).account);
 if(!identifier(account.id)||!Array.isArray(account.organizations)||account.organizations.length>50)throw new PersonalPreparationError('invalid_response');
 const channels:BufferChannel[]=[];
 for(const organization of account.organizations){const org=record(organization);if(!identifier(org.id))throw new PersonalPreparationError('invalid_response');
  const data=await query(bufferChannelsQuery,{input:{organizationId:org.id}});
  if(!Array.isArray(data.channels)||data.channels.length>500)throw new PersonalPreparationError('invalid_response');
  for(const raw of data.channels){const row=record(raw);
   if(!identifier(row.id)||!identifier(row.name)||!identifier(row.service)||!identifier(row.type)||row.organizationId!==org.id||typeof row.isDisconnected!=='boolean'||typeof row.isLocked!=='boolean')throw new PersonalPreparationError('invalid_response');
   const avatar=accountAvatar(row.avatar as string|undefined);
   // Buffer's name is often the handle. Prefer TikTok's real display name when supplied.
   const displayName=typeof row.displayName==='string'?row.displayName.trim():'';
   const name=row.service==='tiktok'&&identifier(displayName)?displayName:row.name;
   const channel:BufferChannel={id:row.id,name,service:row.service,type:row.type,organizationId:org.id,isDisconnected:row.isDisconnected,isLocked:row.isLocked,...(avatar?{avatar}:{})};
   if(connectedBufferChannel(channel)){if(channels.some(c=>c.id===channel.id))throw new PersonalPreparationError('invalid_response');channels.push(channel);}
  }
 }
 return {subject,encryptedKey:await sealToken(key,encryptionKey,subject),accountId:account.id,organizations:account.organizations.map(org=>({id:record(org).id as string})),channels,selectedChannelIds:[],limits,writePermission:'unverified'};
}
export async function personalCredentialForOwner(subject:string,connection:PreparedPersonalConnection,encryptionKey:string){
 if(subject!==connection.subject)throw new PersonalPreparationError('wrong_owner');return openToken(connection.encryptedKey,encryptionKey,subject);
}
export function selectPersonalChannels(subject:string,connection:PreparedPersonalConnection,ids:string[]){
 if(subject!==connection.subject)throw new PersonalPreparationError('wrong_owner');
 if(!Array.isArray(ids)||ids.length>connection.channels.length||new Set(ids).size!==ids.length||ids.some(id=>!connection.channels.some(c=>c.id===id&&supportedBufferChannel(c))))throw new PersonalPreparationError('invalid_selection');
 return {...connection,selectedChannelIds:[...ids]};
}
export function personalConnectionView(subject:string,connection:PreparedPersonalConnection){
 if(subject!==connection.subject)throw new PersonalPreparationError('wrong_owner');
 return {accountId:connection.accountId,channels:connection.channels,selectedChannelIds:connection.selectedChannelIds,writePermission:connection.writePermission,limits:connection.limits};
}
