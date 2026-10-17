import {ConvexError} from 'convex/values';
import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {legacyFileOwner} from './legacyFileOwnership';
export async function canReadFile(ctx:QueryCtx|MutationCtx,subject:string,id:Id<'_storage'>){
 const file=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',id)).unique();if(!file)return false;
 if(file.subject)return file.subject===subject;
 return legacyFileOwner(ctx,subject,id);
}
export async function assertFileOwner(ctx:QueryCtx|MutationCtx,subject:string,id:Id<'_storage'>){if(!await canReadFile(ctx,subject,id))throw new ConvexError('الملف غير موجود أو غير مصرح له.');}
