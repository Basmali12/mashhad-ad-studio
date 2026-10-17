import {v} from 'convex/values';
import {internalQuery} from './_generated/server';
export const metadata=internalQuery({args:{storageId:v.id('_storage')},handler:async(ctx,a)=>{
 const doc=await ctx.db.system.get(a.storageId);
 return doc?{size:doc.size,hash:Array.from(atob(doc.sha256),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')}:null;
}});
