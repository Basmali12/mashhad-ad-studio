import {v,ConvexError} from 'convex/values';
import {action} from './_generated/server';
import {requireOwner} from './access';
import {validateChatRequest,callSeriesAssistant} from '../shared/series-chat';
export const reply=action({args:{request:v.any()},handler:async(ctx,args)=>{
 await requireOwner(ctx);
 const key=process.env.OPENROUTER_API_KEY?.trim();if(!key)throw new ConvexError('مفتاح الدردشة غير متاح.');
 try{return await callSeriesAssistant(validateChatRequest(args.request),key,fetch,'openrouter');}
 catch(e){throw new ConvexError(e instanceof Error?e.message:'تعذر إكمال رد المساعد.');}
}});
