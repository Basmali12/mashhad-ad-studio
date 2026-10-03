import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireOwner } from './access';
import { runnerRoutes } from './runnerHttp';
const http=httpRouter();
runnerRoutes(http);
function headers(request:Request){const origin=request.headers.get('Origin');const allowed=(process.env.CLIENT_ORIGINS??'').split(',').map(v=>v.trim());const result=new Headers({'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});if(origin&&allowed.includes(origin)){result.set('Access-Control-Allow-Origin',origin);result.set('Access-Control-Allow-Headers','Authorization');result.set('Access-Control-Expose-Headers','Content-Length, Content-Type');result.set('Access-Control-Allow-Methods','GET, OPTIONS');}return result;}
http.route({path:'/files',method:'OPTIONS',handler:httpAction(async(_,request)=>new Response(null,{status:204,headers:headers(request)}))});
http.route({path:'/files',method:'GET',handler:httpAction(async(ctx,request)=>{
 const responseHeaders=headers(request);
 try{await requireOwner(ctx);}catch{return new Response('Unauthorized',{status:401,headers:responseHeaders});}
 try{const storageId=new URL(request.url).searchParams.get('id') as Id<'_storage'>|null;if(!storageId)return new Response('Missing file',{status:400,headers:responseHeaders});
 const file=await ctx.runQuery(internal.files.ready,{storageId});if(!file)return new Response('Not found',{status:404,headers:responseHeaders});
 if(new URL(request.url).searchParams.get('metadata')==='1')return Response.json({size:file.size,type:file.type},{headers:responseHeaders});
 const blob=await ctx.storage.get(storageId);if(!blob)return new Response('Not found',{status:404,headers:responseHeaders});
 const raw=new URL(request.url).searchParams.get('offset');const offset=raw===null?0:Number(raw);if(!Number.isSafeInteger(offset)||offset<0||offset>=blob.size)return new Response('Invalid offset',{status:416,headers:responseHeaders});
 if(raw===null&&blob.size>18*1024*1024)return new Response('Use authenticated chunk download',{status:413,headers:responseHeaders});
 const part=raw===null?blob:blob.slice(offset,Math.min(blob.size,offset+8*1024*1024));responseHeaders.set('Content-Type',file.type);responseHeaders.set('Content-Disposition','inline');return new Response(part,{headers:responseHeaders});
 }catch{return new Response('Invalid file',{status:400,headers:responseHeaders});}
})});
export default http;
