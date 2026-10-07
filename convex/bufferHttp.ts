import {httpAction} from './_generated/server';
import type {HttpRouter} from 'convex/server';
import {internal} from './_generated/api';
export function bufferRoutes(http:HttpRouter){http.route({path:'/buffer/callback',method:'GET',handler:httpAction(async(ctx,r)=>{const url=new URL(r.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');if(!state||state.length>200||code&&code.length>4096)return new Response('Invalid OAuth response',{status:400});const back=await ctx.runAction(internal.buffer.callback,{state,code:code??undefined});return new Response(null,{status:303,headers:{Location:back,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});})});}
