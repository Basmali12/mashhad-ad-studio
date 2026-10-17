import type {HttpRouter} from 'convex/server';
import {httpAction} from './_generated/server';
import {internal} from './_generated/api';
export function publishingBufferRoutes(http:HttpRouter){http.route({path:'/publishing-buffer/callback',method:'GET',handler:httpAction(async(ctx,request)=>{
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 if(!state||state.length>200||code&&code.length>4096)return new Response('Invalid authorization response',{status:400,headers});
 const back=await ctx.runAction(internal.publishingBuffer.callback,{state,code:code??undefined});return back?new Response(null,{status:303,headers:{...headers,Location:back}}):new Response('Authorization expired or staging unavailable',{status:400,headers});
})});}
