import {ConvexError} from 'convex/values';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import type {FlowOption} from '../shared/pipeline';
export async function walletPlan(ctx:MutationCtx,subject:string,option:FlowOption,count:number){
 const wallet=await ctx.db.query('pointWallets').withIndex('by_subject',q=>q.eq('subject',subject)).unique();
 if(!wallet||wallet.balance<=0)throw new ConvexError('رصيدك غير كافٍ؛ اشحن حسابك عبر واتساب.');
 if(!wallet.enabled||!wallet.models.includes(option.model)||count>wallet.maxClips)throw new ConvexError('خطة التوليد غير مسموحة لمحفظتك؛ تواصل مع الإدارة عبر واتساب.');
 const rate=await ctx.db.query('pointRates').withIndex('by_key',q=>q.eq('key',`${option.model}:${option.resolution}:${option.seconds}`)).unique();
 if(!rate)throw new ConvexError('سعر هذه الخطة غير متاح؛ تواصل مع الإدارة.');
 if(wallet.balance<rate.points*count)throw new ConvexError('رصيدك غير كافٍ لهذه المقاطع؛ اشحن حسابك عبر واتساب.');
 return {walletId:wallet._id,unitPoints:rate.points};
}
export async function chargeClip(ctx:MutationCtx,job:Doc<'pipelines'>,index:number){
 if(!job.billing)throw new ConvexError('التفويض القديم لا يحتوي خطة نقاط؛ لا يبدأ توليد مدفوع جديد.');
 const wallet=await ctx.db.get(job.billing.walletId),amount=job.billing.unitPoints;
 if(!wallet||wallet.balance<=0||wallet.balance<amount)throw new ConvexError('رصيدك غير كافٍ؛ اشحن حسابك عبر واتساب.');
 if(!wallet.enabled||!wallet.models.includes(job.option.model)||job.clips.length>wallet.maxClips)throw new ConvexError('صلاحية المحفظة لا تسمح بتوليد المقطع.');
 const key=`clip-${job._id}-${index}`;
 if(await ctx.db.query('pointLedger').withIndex('by_key',q=>q.eq('key',key)).unique())throw new ConvexError('المقطع محسوب سابقًا؛ لا يُرسل توليد مكرر.');
 const balance=wallet.balance-amount,now=Date.now();
 await ctx.db.patch(wallet._id,{balance,updatedAt:now});
 await ctx.db.insert('pointLedger',{key,walletId:wallet._id,kind:'debit',amount:-amount,balanceAfter:balance,note:`بدء مقطع ${index+1}/${job.clips.length} للطلب ${job.requestId} — نقاط مشهد، ليست إثبات استهلاك Flow`,actor:wallet.subject,createdAt:now});
}
