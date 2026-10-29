import {AsyncLocalStorage} from 'node:async_hooks';
import {fail} from './errors.mjs';
const scope=new AsyncLocalStorage();
export const withNetwork=(services,fn)=>scope.run(services,fn);
export async function providerFetch(url,options={}){
 const parsed=new URL(url);fail(parsed.protocol==='https:'&&!parsed.username&&!parsed.password,'UNSAFE_PROVIDER_ORIGIN',503);
 const response=await (scope.getStore()?.fetchImpl||globalThis.fetch)(url,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
 fail(Number(response.headers.get('content-length')||0)<=16*1024*1024,'PROVIDER_RESPONSE_TOO_LARGE',502);
 // Read boundedly before exposing JSON; no raw provider body is ever logged.
 if(!response.body)return response;
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;fail(bytes<=16*1024*1024,'PROVIDER_RESPONSE_TOO_LARGE',502);chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 return new Response(Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
}
