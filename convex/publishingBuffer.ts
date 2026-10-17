import {v,ConvexError} from 'convex/values';
import {query,mutation,action,internalQuery,internalMutation,internalAction,type ActionCtx} from './_generated/server';
import {api,internal} from './_generated/api';
import {publishingMember} from './publishingUsers';
import {publishingBufferChannel,publishingBufferLimit} from './publishingBufferValidators';
import {sealToken,openToken,stateHash} from '../shared/meta';
import {base64url,pkceChallenge,bufferAccountQuery,bufferChannelsQuery,bufferRateLimits,connectedBufferChannel,type BufferChannel} from '../shared/buffer';
import {accountAvatar} from '../shared/account-avatar';
import {oauthConnection,lockState,assertCanStart,commitBinding,guardChannels,supportMessage,bindingFor,pauseUnsent} from './reelsBufferBinding';
const scopes=['account:read','posts:read','posts:write','offline_access'];
function config(){
 if(process.env.PUBLISHING_BUFFER_OAUTH_ENABLED!=='true')throw new ConvexError('ربط Buffer التجريبي ينتظر عنوان HTTPS وبيانات App Client منفصلة؛ الربط الحي محفوظ.');
 const clientId=process.env.PUBLISHING_BUFFER_CLIENT_ID,secret=process.env.PUBLISHING_BUFFER_CLIENT_SECRET,key=process.env.PUBLISHING_BUFFER_TOKEN_KEY,redirect=process.env.PUBLISHING_BUFFER_REDIRECT_URI;
 const origins=(process.env.PUBLISHING_BUFFER_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!clientId||!secret||!key||!redirect||!origins.length)throw new ConvexError('إعداد OAuth التجريبي غير مكتمل.');
 const uri=new URL(redirect);if(uri.protocol!=='https:'||uri.username||uri.password||uri.search||uri.hash||uri.pathname!=='/publishing-buffer/callback')throw new ConvexError('عنوان OAuth غير مطابق.');
 for(const origin of origins){const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:')throw new ConvexError('عنوان العودة غير مطابق.');}
 return {clientId,secret,key,redirect,origins};
}
async function member(ctx:ActionCtx){return await ctx.runQuery(api.publishingUsers.profile,{});}
export const state=query({args:{},handler:async ctx=>{
 const u=await publishingMember(ctx);let c:ReturnType<typeof config>|undefined;try{c=config();}catch{/* Disabled until staging callback and credentials exist. */}
 const row=await oauthConnection(ctx,u.subject);
 const active=!!c&&row?.clientId===c.clientId;const quota=c?await ctx.db.query('publishingBufferQuota').withIndex('by_client',q=>q.eq('clientId',c.clientId)).unique():null;
 return {configured:!!c,connected:!!row&&active,needsReconnect:!!row&&(!active||row.needsReconnect),channels:active?row?.channels??[]:[],selectedChannelIds:active?row?.selectedChannelIds??[]:[],quota:quota?{limits:quota.limits,observedAt:quota.observedAt,sharedAcrossCustomers:true}:null,...await lockState(ctx,u.subject)};
}});
export const storeAuth=internalMutation({args:{subject:v.string(),hash:v.string(),origin:v.string(),verifier:v.string(),clientId:v.string()},handler:async(ctx,a)=>{
 const u=await publishingMember(ctx);await assertCanStart(ctx,a.subject);if(u.subject!==a.subject)throw new ConvexError('الحساب غير مطابق.');
 for(const old of await ctx.db.query('publishingBufferAuth').withIndex('by_subject',q=>q.eq('subject',a.subject)).collect())await ctx.db.delete(old._id);
 await ctx.db.insert('publishingBufferAuth',{...a,expiresAt:Date.now()+600000});
}});
export const takeAuth=internalMutation({args:{hash:v.string()},handler:async(ctx,a)=>{const row=await ctx.db.query('publishingBufferAuth').withIndex('by_hash',q=>q.eq('hash',a.hash)).unique();if(!row)return null;await ctx.db.delete(row._id);const user=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',row.subject)).unique();return row.expiresAt>Date.now()&&user&&!user.disabled?row:null;}});
export const begin=action({args:{origin:v.string()},handler:async(ctx,a):Promise<string>=>{
 const u=await member(ctx),c=config();await ctx.runQuery(internal.reelsBufferBinding.beforeConnect,{subject:u.subject});if(!c.origins.includes(a.origin))throw new ConvexError('عنوان العودة غير مسموح.');
 const state=base64url(crypto.getRandomValues(new Uint8Array(32))),verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
 await ctx.runMutation(internal.publishingBuffer.storeAuth,{subject:u.subject,hash:await stateHash(state),origin:a.origin,verifier:await sealToken(verifier,c.key,u.subject),clientId:c.clientId});
 const url=new URL('https://auth.buffer.com/auth');for(const [k,value] of Object.entries({client_id:c.clientId,redirect_uri:c.redirect,response_type:'code',scope:scopes.join(' '),state,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256',prompt:'consent'}))url.searchParams.set(k,value);return url.href;
}});
export const recordQuota=internalMutation({args:{clientId:v.string(),limits:v.array(publishingBufferLimit)},handler:async(ctx,a)=>{if(!a.limits.length)return;const old=await ctx.db.query('publishingBufferQuota').withIndex('by_client',q=>q.eq('clientId',a.clientId)).unique();const values={...a,observedAt:Date.now()};if(old)await ctx.db.patch(old._id,values);else await ctx.db.insert('publishingBufferQuota',values);}});
async function request(ctx:ActionCtx,url:string,init:RequestInit){
 const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});const c=config();
 await ctx.runMutation(internal.publishingBuffer.recordQuota,{clientId:c.clientId,limits:bufferRateLimits(response.headers.get('ratelimit'))});
 if(response.status===429)throw new ConvexError('وصل التطبيق إلى حد الطلبات المشترك؛ انتظر تجدد الحصة.');
 if(!response.ok)throw new ConvexError('تعذر التحقق من تفويض Buffer.');
 const body=await response.json();if(body.errors)throw new ConvexError('رفض Buffer طلب القراءة.');return body;
}
async function exchange(ctx:ActionCtx,fields:Record<string,string>){
 const c=config(),t=await request(ctx,'https://auth.buffer.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:c.clientId,client_secret:c.secret})});
 const granted=typeof t.scope==='string'?t.scope.split(/\s+/):[];
 if(typeof t.access_token!=='string'||!t.access_token||typeof t.refresh_token!=='string'||!t.refresh_token||typeof t.expires_in!=='number'||!Number.isFinite(t.expires_in)||t.expires_in<=0||scopes.some(s=>!granted.includes(s)))throw new ConvexError('التفويض لا يحتوي الصلاحيات اللازمة للنشر المجدول.');
 return {access:t.access_token as string,refresh:t.refresh_token as string,expires:Date.now()+t.expires_in*1000,scopes:granted};
}
async function graph(ctx:ActionCtx,token:string,document:string,variables:unknown={}){const body=await request(ctx,'https://api.buffer.com',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:document,variables})});if(!body.data)throw new ConvexError('استجابة Buffer غير مكتملة.');return body.data;}
async function readChannels(ctx:ActionCtx,token:string):Promise<{accountId:string;channels:BufferChannel[]}>{
 const account=(await graph(ctx,token,bufferAccountQuery)).account;if(typeof account?.id!=='string'||!Array.isArray(account.organizations)||account.organizations.length>50)throw new ConvexError('حساب Buffer غير مطابق.');const channels:BufferChannel[]=[];
 for(const org of account.organizations){if(typeof org.id!=='string')throw new ConvexError('منظمة Buffer غير مطابقة.');const data=await graph(ctx,token,bufferChannelsQuery,{input:{organizationId:org.id}});if(!Array.isArray(data.channels)||data.channels.length>500)throw new ConvexError('قنوات Buffer غير مطابقة.');
  for(const row of data.channels){if(typeof row.id!=='string'||typeof row.name!=='string'||typeof row.service!=='string'||typeof row.type!=='string'||row.organizationId!==org.id||typeof row.isDisconnected!=='boolean'||typeof row.isLocked!=='boolean')throw new ConvexError('قناة Buffer غير مطابقة.');if(connectedBufferChannel(row)){if(channels.some(c=>c.id===row.id))throw new ConvexError('قناة مكررة.');channels.push({id:row.id,name:row.name,service:row.service,type:row.type,organizationId:org.id,isDisconnected:row.isDisconnected,isLocked:row.isLocked,avatar:accountAvatar(row.avatar)});}}
 }return {accountId:account.id,channels};
}
export const save=internalMutation({args:{subject:v.string(),clientId:v.string(),accountId:v.string(),access:v.string(),refresh:v.string(),expires:v.number(),scopes:v.array(v.string()),channels:v.array(publishingBufferChannel)},handler:async(ctx,a)=>{
 await assertCanStart(ctx,a.subject);const user=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',a.subject)).unique();if(!user||user.disabled)throw new ConvexError('الحساب غير مفعّل.');
 const collisions=await ctx.db.query('publishingBufferConnections').withIndex('by_account',q=>q.eq('clientId',a.clientId).eq('accountId',a.accountId)).collect();if(collisions.some(r=>r.subject!==a.subject))throw new ConvexError('حساب Buffer مرتبط بمستخدم آخر؛ استخدم حسابًا مستقلًا.');
 const old=await oauthConnection(ctx,a.subject);if(old?.refreshLock)throw new ConvexError('انتظر اكتمال تحديث التفويض.');
 const values={...a,revision:crypto.randomUUID(),selectedChannelIds:[] as string[],needsReconnect:false,connectedAt:Date.now(),refreshLock:undefined};const id=await ctx.db.insert('publishingBufferConnections',values);const ids=await commitBinding(ctx,{subject:a.subject,authMode:'oauth',accountId:a.accountId,revision:values.revision,connectionId:id,channels:a.channels});await ctx.db.patch(id,{selectedChannelIds:ids});
}});
export const callback=internalAction({args:{state:v.string(),code:v.optional(v.string())},handler:async(ctx,a):Promise<string|null>=>{
 let c:ReturnType<typeof config>;try{c=config();}catch{return null;}const session=await ctx.runMutation(internal.publishingBuffer.takeAuth,{hash:await stateHash(a.state)});if(!session||session.clientId!==c.clientId||!c.origins.includes(session.origin))return null;
 const back=new URL(session.origin);back.searchParams.set('buffer',a.code?'failed':'cancelled');if(!a.code)return back.href;
 try{const t=await exchange(ctx,{grant_type:'authorization_code',code:a.code,redirect_uri:c.redirect,code_verifier:await openToken(session.verifier,c.key,session.subject)}),data=await readChannels(ctx,t.access);
 await ctx.runMutation(internal.publishingBuffer.save,{subject:session.subject,clientId:c.clientId,...data,access:await sealToken(t.access,c.key,session.subject),refresh:await sealToken(t.refresh,c.key,session.subject),expires:t.expires,scopes:t.scopes});back.searchParams.set('buffer','connected');}catch{/* Never forward credentials or provider responses to the UI. */}return back.href;
}});
export const connection=internalQuery({args:{subject:v.string()},handler:async(ctx,a)=>{const user=await ctx.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject',a.subject)).unique();if(!user||user.disabled)throw new ConvexError('الحساب غير مفعّل.');return oauthConnection(ctx,a.subject);}});
export const lock=internalMutation({args:{subject:v.string(),revision:v.string(),fence:v.string()},handler:async(ctx,a)=>{const row=await oauthConnection(ctx,a.subject);if(!row||row.revision!==a.revision||row.refreshLock||row.needsReconnect)return false;await ctx.db.patch(row._id,{refreshLock:{fence:a.fence,until:Date.now()+45000}});return true;}});
export const finishRefresh=internalMutation({args:{subject:v.string(),revision:v.string(),fence:v.string(),access:v.string(),refresh:v.string(),expires:v.number()},handler:async(ctx,a)=>{const row=await oauthConnection(ctx,a.subject);if(!row||row.revision!==a.revision||row.refreshLock?.fence!==a.fence)throw new ConvexError('تغير الربط.');const {subject:_,revision:__,fence:___,...values}=a;void _;void __;void ___;await ctx.db.patch(row._id,{...values,refreshLock:undefined});}});
export const refreshFailed=internalMutation({args:{subject:v.string(),revision:v.string()},handler:async(ctx,a)=>{const row=await oauthConnection(ctx,a.subject);if(row?.revision===a.revision){await ctx.db.patch(row._id,{needsReconnect:true,refreshLock:undefined});const b=await bindingFor(ctx,a.subject);if(b?.revision===a.revision){await ctx.db.patch(b._id,{suspended:true});await pauseUnsent(ctx,a.subject,'انتهى تفويض Buffer؛ يرجى مراسلة الدعم.');}}}});
export const accessToken=internalAction({args:{subject:v.string()},handler:async(ctx,a):Promise<{token:string;revision:string}>=>{
 const c=config(),row=await ctx.runQuery(internal.publishingBuffer.connection,a);if(!row||row.clientId!==c.clientId||row.needsReconnect)throw new ConvexError('أعد ربط حسابك في Buffer.');
 if(row.refreshLock)throw new ConvexError('التفويض قيد التحديث أو يحتاج إعادة ربط؛ لا تعاد محاولة الرمز القديم.');
 if(row.expires>Date.now()+60000)return {token:await openToken(row.access,c.key,a.subject),revision:row.revision};
 const fence=crypto.randomUUID();if(!await ctx.runMutation(internal.publishingBuffer.lock,{...a,revision:row.revision,fence}))throw new ConvexError('جارٍ تحديث التفويض.');
 try{const t=await exchange(ctx,{grant_type:'refresh_token',refresh_token:await openToken(row.refresh,c.key,a.subject)});await ctx.runMutation(internal.publishingBuffer.finishRefresh,{...a,revision:row.revision,fence,access:await sealToken(t.access,c.key,a.subject),refresh:await sealToken(t.refresh,c.key,a.subject),expires:t.expires});return {token:t.access,revision:row.revision};}
 catch{await ctx.runMutation(internal.publishingBuffer.refreshFailed,{...a,revision:row.revision});throw new ConvexError('تعذر تأكيد تجديد التفويض؛ أعد الربط دون إعادة استخدام الرمز القديم.');}
}});
export const updateChannels=internalMutation({args:{subject:v.string(),revision:v.string(),accountId:v.string(),channels:v.array(publishingBufferChannel)},handler:async(ctx,a)=>{const row=await oauthConnection(ctx,a.subject);if(!row||row.revision!==a.revision||row.accountId!==a.accountId)throw new ConvexError('تغير حساب Buffer.');await ctx.db.patch(row._id,{channels:a.channels,selectedChannelIds:row.selectedChannelIds.filter(id=>a.channels.some(c=>c.id===id&&!c.isDisconnected&&!c.isLocked))});}});
export const sync=action({args:{},handler:async(ctx):Promise<void>=>{const u=await member(ctx),access=await ctx.runAction(internal.publishingBuffer.accessToken,{subject:u.subject}),data=await readChannels(ctx,access.token);await ctx.runMutation(internal.publishingBuffer.updateChannels,{subject:u.subject,revision:access.revision,...data});}});
export const select=mutation({args:{ids:v.array(v.string())},handler:async(ctx,a)=>{const u=await publishingMember(ctx),row=await oauthConnection(ctx,u.subject);if(row)await guardChannels(ctx,u.subject,'oauth',row.revision,a.ids);if(!row||row.needsReconnect||new Set(a.ids).size!==a.ids.length||a.ids.some(id=>!row.channels.some(c=>c.id===id&&!c.isDisconnected&&!c.isLocked)))throw new ConvexError('اختر قنوات حسابك المتاحة فقط.');await ctx.db.patch(row._id,{selectedChannelIds:a.ids});}});
export const disconnect=mutation({args:{},handler:async ctx=>{await publishingMember(ctx);throw new ConvexError(supportMessage);}});
