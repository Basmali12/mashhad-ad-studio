'use node';
import {scryptSync,timingSafeEqual} from 'node:crypto';
import {v,ConvexError} from 'convex/values';
import {action} from './_generated/server';
import {internal} from './_generated/api';
import {requireOwner} from './access';
export const unlock=action({args:{code:v.string()},handler:async(ctx,{code})=>{
 await requireOwner(ctx);
 if(!code||code.length>128)throw new ConvexError('رمز الدخول غير صحيح.');
 if(!await ctx.runMutation(internal.adminGate.begin,{}))throw new ConvexError('محاولات كثيرة؛ حاول لاحقًا.');
 const [salt,hash]= (process.env.ADMIN_CODE_VERIFIER??'').split(':');
 if(!/^[a-f0-9]{32}$/.test(salt??'')||!/^[a-f0-9]{128}$/.test(hash??''))throw new ConvexError('رمز الدخول غير مهيأ.');
 const expected=Buffer.from(hash,'hex'),actual=scryptSync(code,salt,64);
 if(!timingSafeEqual(actual,expected))throw new ConvexError('رمز الدخول غير صحيح.');
 await ctx.runMutation(internal.adminGate.finish,{});
 return true;
}});
