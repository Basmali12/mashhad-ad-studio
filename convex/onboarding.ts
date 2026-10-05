import {v,ConvexError} from 'convex/values';
import {query,mutation} from './_generated/server';
import {requireSigned} from './access';
import {requireWalletAdmin} from './adminGate';
const key='new-customer-points';
const defaultPoints=10;
const models=['Omni Flash','Veo 3.1 Fast','Veo 3.1 Quality','Nano Banana Pro','Nano Banana 2','Nano Banana 2 Lite'];
export const settings=query({args:{},handler:async ctx=>{
 await requireWalletAdmin(ctx);
 const config=await ctx.db.query('signupSettings').withIndex('by_key',q=>q.eq('key',key)).unique();
 return {points:config?.points??defaultPoints};
}});
export const save=mutation({args:{points:v.number()},handler:async(ctx,a)=>{
 const admin=await requireWalletAdmin(ctx);
 if(!Number.isSafeInteger(a.points)||a.points<0||a.points>1000000)throw new ConvexError('أدخل عددًا صحيحًا من 0 إلى 1000000 نقطة.');
 const config=await ctx.db.query('signupSettings').withIndex('by_key',q=>q.eq('key',key)).unique();
 const value={points:a.points,updatedAt:Date.now(),actor:admin.subject};
 if(config)await ctx.db.patch(config._id,value);else await ctx.db.insert('signupSettings',{key,...value});
}});
export const enter=mutation({args:{},handler:async ctx=>{
 const identity=await requireSigned(ctx),now=Date.now();
 let wallet=await ctx.db.query('pointWallets').withIndex('by_subject',q=>q.eq('subject',identity.subject)).unique();
 if(wallet?.onboardedAt)return wallet._id;
 if(wallet){
  const history=await ctx.db.query('pointLedger').withIndex('by_wallet',q=>q.eq('walletId',wallet!._id)).first();
  // Only untouched legacy self-registration is upgraded. Admin decisions and existing balances stay intact.
  if(identity.subject===process.env.OWNER_SUBJECT||history||wallet.balance!==0||wallet.enabled||wallet.models.length){
   await ctx.db.patch(wallet._id,{onboardedAt:now});return wallet._id;
  }
 }
 const config=await ctx.db.query('signupSettings').withIndex('by_key',q=>q.eq('key',key)).unique(),points=config?.points??defaultPoints;
 if(!wallet){
  const name=(identity.name??identity.nickname??'مستخدم مشهد').slice(0,120);
  const id=await ctx.db.insert('pointWallets',{subject:identity.subject,publicId:'pending',name,balance:0,enabled:false,models:[],maxClips:1,createdAt:now,updatedAt:now});
  wallet=(await ctx.db.get(id))!;
 }
 await ctx.db.patch(wallet._id,{publicId:`MS-${wallet._id}`,balance:points,enabled:true,models,maxClips:1,onboardedAt:now,updatedAt:now});
 if(points>0)await ctx.db.insert('pointLedger',{key:`welcome-${wallet._id}`,walletId:wallet._id,kind:'credit',amount:points,balanceAfter:points,note:'رصيد تجريبي للحساب الجديد — مرة واحدة',actor:'signup',createdAt:now});
 return wallet._id;
}});
