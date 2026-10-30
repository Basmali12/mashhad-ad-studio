// USD in integer microdollars. No floating point accumulation and no monthly rollover.
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
