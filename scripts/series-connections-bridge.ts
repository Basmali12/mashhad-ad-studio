import {invokeStudio,studioOwnerIdentity} from './publishing-bridge';
export async function seriesConnectionsOperation(data:unknown){
 const value=data as {op?:string;provider?:string;accountId?:string};
 const identity=await studioOwnerIdentity();
 async function call(name:string,args:object){const result=await invokeStudio(['run',name,JSON.stringify(args),'--identity',identity]);return result?JSON.parse(result):null;}
 if(value?.op==='history'){const [meta,buffer]=await Promise.all([call('social:state',{}),call('buffer:state',{})]);return {posts:[...meta.posts.map((p:{_id:string;platform:string;stage:string;createdAt:number;providerId?:string})=>({id:p._id,platform:p.platform,stage:p.stage,createdAt:p.createdAt,providerId:p.providerId})),...buffer.posts.map((p:{_id:string;channelId:string;stage:string;createdAt:number;providerId?:string;caption?:string})=>({id:p._id,platform:buffer.channels.find((c:{id:string})=>c.id===p.channelId)?.service??'buffer',stage:p.stage,createdAt:p.createdAt,providerId:p.providerId,caption:p.caption}))].sort((a,b)=>b.createdAt-a.createdAt)};}
 if(value?.op==='state'){const [meta,buffer,youtube]=await Promise.all([call('social:state',{}),call('buffer:state',{}),call('youtube:state',{})]);return {meta:{configured:meta.configured,accounts:meta.accounts},buffer:{configured:buffer.configured,connected:buffer.connected,channels:buffer.channels},youtube};}
 if(value?.op==='select'&&typeof value.accountId==='string'&&/^[a-zA-Z0-9]{16,100}$/.test(value.accountId)){await call('social:select',{id:value.accountId});return {ok:true};}
 if(value?.op==='syncBuffer'){await call('buffer:sync',{});return {ok:true};}
 if(value?.op==='syncProfiles'&&(value.provider==='facebook'||value.provider==='instagram')){await call('social:syncProfiles',{platform:value.provider});return {ok:true};}
 if(value?.op==='begin'){
  const origin='https://iraqaistudio.com';
  if(value.provider==='facebook'||value.provider==='instagram')return {url:await call('social:begin',{platform:value.provider,origin})};
  if(value.provider==='buffer')return {url:await call('buffer:begin',{origin})};
  if(value.provider==='youtube')return {url:await call('youtube:begin',{origin})};
 }
 throw new Error('طلب الربط غير صالح.');
}
