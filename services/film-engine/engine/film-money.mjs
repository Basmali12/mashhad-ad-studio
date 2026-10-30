// USD in integer microdollars. No floating point accumulation and no monthly rollover.
import {createHash} from 'node:crypto';
export const DAY=86400000, CREDIT_LIFETIME=30*DAY, STOP_GUARD_SECONDS=60;
export function money(value,{allowZero=false}={}){
 const s=String(value);if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(s))throw Error('INVALID_MONEY');
 const [whole,fraction='']=s.split('.');const n=Number(whole)*1000000+Number(fraction.padEnd(6,'0'));
 if(!Number.isSafeInteger(n)||(allowZero?n<0:n<=0))throw Error('INVALID_MONEY');return n;
}
export function cost(hourMicros,milliseconds){
 if(!Number.isSafeInteger(hourMicros)||hourMicros<=0||!Number.isSafeInteger(milliseconds)||milliseconds<0)throw Error('INVALID_METER');
 const n=(BigInt(hourMicros)*BigInt(milliseconds)+3599999n)/3600000n;
 if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('METER_OVERFLOW');return Number(n);
}
export function minimumCredit(hourMicros){return Math.max(10000,cost(hourMicros,240000));}
export function available(lots,at){return lots.filter(l=>l.expiresAt>at).reduce((n,l)=>n+l.remaining,0);}
export function debit(lots,amount,at){
 if(!Number.isSafeInteger(amount)||amount<0)throw Error('INVALID_METER');
 let remaining=amount;const entries=[];
 for(const lot of lots.filter(l=>l.expiresAt>at&&l.remaining>0).sort((a,b)=>a.expiresAt-b.expiresAt||a.createdAt-b.createdAt)){
  const take=Math.min(lot.remaining,remaining);if(!take)break;
  lot.remaining-=take;remaining-=take;entries.push({lotId:lot.id,micros:take});
 }
 return {entries,captured:amount-remaining,uncovered:remaining};
}

// Keep the original reservation/audit. Completed usage releases only its estimate.
// Unknown, queued and interrupted calls retain their reservation; this is not an invoice.
export function textBudgetExposure(reservations,calls){
 return reservations.reduce((total,r)=>{
  const matching=calls.filter(c=>c.projectId===r.projectId&&typeof c.id==='string'&&c.id.startsWith(r.id+'-')&&/^\d+$/.test(c.id.slice(r.id.length+1)));
  const known=matching.filter(c=>['completed','failed'].includes(c.status)&&Number.isFinite(c.usage?.computedUSD)&&c.usage.computedUSD>=0);
  const count=Number.isSafeInteger(r.calls)&&r.calls>0?r.calls:1;
  if(known.length>count)return total+r.reservedMicroUSD; // Inconsistent receipt: do not release.
  return total+Math.ceil(r.reservedMicroUSD*(count-known.length)/count)+known.reduce((sum,c)=>sum+Math.ceil(c.usage.computedUSD*1e6),0);
 },0);
}

// Server-derived owner, atomic holds and idempotent usage settlement. No historical rebilling.
export function createAIWallet(store,{now=Date.now}={}){
 const key=(kind,requestId)=>createHash('sha256').update('customer-ai-v1:'+kind+':'+requestId).digest('hex');
 const lotsFor=async customerId=>(await store.all('film-credit')).filter(l=>l.customerId===customerId);
 const pending=r=>['reserved','submitted','uncertain'].includes(r.state);
 async function requireFunds(customerId){
  if((await store.all('film-ai-charge')).some(r=>r.customerId===customerId&&r.uncoveredMicroUSD>0)||available(await lotsFor(customerId),now())<=0)throw Error('AI_INSUFFICIENT_CREDIT');
 }
 async function reserve(input,inTransaction=false){
  const work=async()=>{
   const {kind,requestId,projectId,estimatedMicroUSD,pricing}=input;
   if(!['text-call','film-image-preview'].includes(kind)||!Number.isSafeInteger(estimatedMicroUSD)||estimatedMicroUSD<=0)throw Error('INVALID_AI_RESERVATION');
   const p=await store.get('film-project',projectId);if(!p?.customerId)throw Error('AI_OWNER_REQUIRED');
   const chargeId=key(kind,requestId),old=await store.get('film-ai-charge',chargeId);
   if(old){if(old.customerId!==p.customerId||old.projectId!==projectId)throw Error('AI_CHARGE_SCOPE_CHANGED');return old;}
   await requireFunds(p.customerId);const lots=await lotsFor(p.customerId),d=debit(lots,estimatedMicroUSD,now());
   if(d.uncovered)throw Error('AI_INSUFFICIENT_CREDIT');
   for(const lot of lots)await store.put('film-credit',lot);
   const r={id:chargeId,version:1,kind,requestId,projectId,customerId:p.customerId,state:'reserved',heldMicroUSD:estimatedMicroUSD,entries:d.entries,pricing,createdAt:now(),amountMicroUSD:null,source:'OpenAI usage at published rates; no markup; not invoice'};
   await store.put('film-ai-charge',r);await store.put('film-ledger',{id:chargeId+'-hold',customerId:p.customerId,projectId,type:'ai_hold',microUSD:-estimatedMicroUSD,chargeId,createdAt:now()});return r;
  };return inTransaction?work():store.transaction(work);
 }
 async function sent(chargeId){return store.transaction(async()=>{const r=await store.get('film-ai-charge',chargeId);if(!r||r.state!=='reserved')throw Error('AI_RESERVATION_NOT_READY');r.state='submitted';r.submittedAt=now();await store.put('film-ai-charge',r);});}
 async function settle(chargeId,computedUSD,{zeroReason}={}){return store.transaction(async()=>{
  const r=await store.get('film-ai-charge',chargeId);if(!r||r.state==='settled')return r;
  if(!Number.isFinite(computedUSD)||computedUSD<0){r.state='uncertain';await store.put('film-ai-charge',r);return r;}
  const actual=Math.ceil(computedUSD*1e6);if(!Number.isSafeInteger(actual))throw Error('INVALID_AI_USAGE');
  let refund=Math.max(0,r.heldMicroUSD-actual),extra=Math.max(0,actual-r.heldMicroUSD),capturedExtra=0,uncovered=0;
  const lots=await lotsFor(r.customerId),byId=new Map(lots.map(l=>[l.id,l]));
  for(const entry of [...r.entries].reverse()){const amount=Math.min(refund,entry.micros);if(!amount)continue;const lot=byId.get(entry.lotId);if(!lot)throw Error('AI_REFUND_LOT_MISSING');lot.remaining+=amount;refund-=amount;}
  if(extra){const d=debit(lots,extra,now());capturedExtra=d.captured;uncovered=d.uncovered;}
  for(const lot of lots)await store.put('film-credit',lot);
  const adjustment=Math.max(0,r.heldMicroUSD-actual)-capturedExtra;
  await store.put('film-ledger',{id:r.id+'-settled',customerId:r.customerId,projectId:r.projectId,type:'ai_settlement',microUSD:adjustment,chargeId:r.id,usageMicroUSD:actual,uncoveredMicroUSD:uncovered,createdAt:now()});
  Object.assign(r,{state:'settled',amountMicroUSD:actual,computedUSD,uncoveredMicroUSD:uncovered,settledAt:now(),...(zeroReason?{zeroReason}:{})});await store.put('film-ai-charge',r);return r;
 });}
 async function recover({releaseUnsent=false}={}){for(const r of await store.all('film-ai-charge'))if(pending(r)){
  const call=await store.get(r.kind,r.requestId),usd=r.kind==='text-call'?call?.usage?.computedUSD:call?.computedUSD;
  if(call?.projectId===r.projectId&&Number.isFinite(usd)&&['completed','failed'].includes(call.status))await settle(r.id,usd);
  else if(releaseUnsent&&r.state==='reserved'&&!r.submittedAt)await settle(r.id,0,{zeroReason:'not_submitted_before_restart'});
 }}
 async function reserved(customerId){return (await store.all('film-ai-charge')).filter(r=>r.customerId===customerId&&pending(r)).reduce((n,r)=>n+r.heldMicroUSD,0);}
 async function collectOutstanding(customerId,inTransaction=false){
  const work=async()=>{const lots=await lotsFor(customerId);for(const r of (await store.all('film-ai-charge')).filter(r=>r.version===1&&r.customerId===customerId&&r.state==='settled'&&r.uncoveredMicroUSD>0).sort((a,b)=>a.settledAt-b.settledAt)){
   const d=debit(lots,r.uncoveredMicroUSD,now());if(!d.captured)break;r.uncoveredMicroUSD-=d.captured;r.recoveredMicroUSD=(r.recoveredMicroUSD||0)+d.captured;
   await store.put('film-ai-charge',r);await store.put('film-ledger',{id:r.id+'-recovered-'+r.recoveredMicroUSD,customerId,projectId:r.projectId,type:'ai_usage_recovery',microUSD:-d.captured,chargeId:r.id,createdAt:now()});
  }for(const lot of lots)await store.put('film-credit',lot);};return inTransaction?work():store.transaction(work);
 }
 return {requireFunds,reserve,sent,settle,recover,reserved,collectOutstanding};
}
