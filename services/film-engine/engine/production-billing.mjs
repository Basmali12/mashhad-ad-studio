// Production-stage accounting shares the existing wallet lots and integer arithmetic.
// Persisted unknown holds survive restarts; this module never calls a provider.
import {createHash} from 'node:crypto';
import {available,debit} from './film-money.mjs';

const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const stageId=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,180}$/.test(value);
const micros=value=>Number.isSafeInteger(value)&&value>=0;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const add=(a,b)=>{const result=a+b;if(!Number.isSafeInteger(result))throw Error('PRODUCTION_METER_OVERFLOW');return result;};
const pending=value=>['reserved','submitted','uncertain'].includes(value.state);

export function createProductionBilling({store,now=Date.now}) {
 if(!store||typeof store.transaction!=='function')throw Error('PRODUCTION_STORE_REQUIRED');
 const lotsFor=async customerId=>(await store.all('film-credit')).filter(lot=>lot.customerId===customerId);
 const getCharge=async chargeId=>{
  if(!safeId(chargeId))throw Error('PRODUCTION_CHARGE_NOT_FOUND');
  const charge=await store.get('production-charge',chargeId);
  if(!charge||charge.version!==1)throw Error('PRODUCTION_CHARGE_NOT_FOUND');
  return charge;
 };
 async function reserve(input,inTransaction=false) {
  const work=async()=>{
   const {customerId,projectId,attemptId,estimatedMicroUSD,approved,quoteId}=input||{};
   if(approved!==true)throw Error('PRODUCTION_APPROVAL_REQUIRED');
   if(![customerId,projectId,attemptId,quoteId].every(safeId)||!micros(estimatedMicroUSD))throw Error('INVALID_PRODUCTION_RESERVATION');
   const project=await store.get('production-project',projectId),attempt=await store.get('production-attempt',attemptId),quote=await store.get('production-quote',quoteId);
   if(!project||project.customerId!==customerId||!attempt||attempt.customerId!==customerId||attempt.projectId!==projectId)throw Error('PRODUCTION_CHARGE_SCOPE_CHANGED');
   if(attempt.quoteId!==quoteId||attempt.estimatedMicroUSD!==estimatedMicroUSD||!stageId(attempt.stageId))throw Error('PRODUCTION_CHARGE_SCOPE_CHANGED');
   if(!quote||quote.customerId!==customerId||quote.projectId!==projectId||quote.approved!==true)throw Error('PRODUCTION_APPROVAL_REQUIRED');
   if(!Array.isArray(quote.stages)||!micros(quote.estimatedMicroUSD))throw Error('INVALID_PRODUCTION_QUOTE');
   const stage=quote.stages.filter(value=>value.id===attempt.stageId);
   if(stage.length!==1||stage[0].estimatedMicroUSD!==estimatedMicroUSD)throw Error('PRODUCTION_QUOTE_CHANGED');
   const chargeId=digest(['production-charge-v1',attemptId]);
   const fingerprint=digest([customerId,projectId,attemptId,quoteId,attempt.stageId,estimatedMicroUSD]);
   const old=await store.get('production-charge',chargeId);
   if(old){if(old.fingerprint!==fingerprint||old.customerId!==customerId||old.projectId!==projectId)throw Error('PRODUCTION_CHARGE_SCOPE_CHANGED');return old;}
   const executionExpiresAt=quote.executionExpiresAt??quote.expiresAt;
   if(!Number.isSafeInteger(executionExpiresAt)||executionExpiresAt<=now())throw Error('PRODUCTION_QUOTE_EXPIRED');
   const charges=await store.all('production-charge');
   const used=charges.filter(value=>value.quoteId===quoteId).reduce((sum,value)=>add(sum,value.heldMicroUSD),0);
   if(add(used,estimatedMicroUSD)>quote.estimatedMicroUSD||charges.some(value=>value.quoteId===quoteId&&value.stageId===attempt.stageId))throw Error('PRODUCTION_QUOTE_ALREADY_USED');
   if(charges.some(value=>value.customerId===customerId&&value.uncoveredMicroUSD>0)||(await store.all('film-ai-charge')).some(value=>value.customerId===customerId&&value.uncoveredMicroUSD>0))throw Error('PRODUCTION_OUTSTANDING_BALANCE');
   const lots=await lotsFor(customerId);
   if(available(lots,now())<estimatedMicroUSD)throw Error('PRODUCTION_INSUFFICIENT_CREDIT');
   const captured=debit(lots,estimatedMicroUSD,now());
   if(captured.uncovered)throw Error('PRODUCTION_INSUFFICIENT_CREDIT');
   for(const lot of lots)await store.put('film-credit',lot);
   const charge={id:chargeId,version:1,fingerprint,customerId,projectId,attemptId,stageId:attempt.stageId,quoteId,state:'reserved',heldMicroUSD:estimatedMicroUSD,entries:captured.entries,amountMicroUSD:null,uncoveredMicroUSD:0,createdAt:now()};
   await store.put('production-charge',charge);
   await store.put('film-ledger',{id:chargeId+'-hold',customerId,projectId,attemptId,quoteId,chargeId,type:'production_hold',microUSD:-estimatedMicroUSD,createdAt:now()});
   return charge;
  };
  return inTransaction?work():store.transaction(work);
 }
 async function submitted(chargeId) {
  return store.transaction(async()=>{
   const charge=await getCharge(chargeId);
   if(charge.state==='reserved'){charge.state='submitted';charge.submittedAt=now();await store.put('production-charge',charge);}
   return charge;
  });
 }
 async function uncertain(chargeId) {
  return store.transaction(async()=>{
   const charge=await getCharge(chargeId);
   if(pending(charge)){charge.state='uncertain';charge.uncertainAt=now();await store.put('production-charge',charge);}
   return charge;
  });
 }
 async function settle(chargeId,actualMicroUSD,{definitiveNoSpend=false}={}) {
  return store.transaction(async()=>{
   const charge=await getCharge(chargeId);
   if(actualMicroUSD!==null&&actualMicroUSD!==undefined&&!micros(actualMicroUSD))throw Error('INVALID_PRODUCTION_USAGE');
   if(definitiveNoSpend&&actualMicroUSD!==0)throw Error('INVALID_PRODUCTION_USAGE');
   if(charge.state==='settled'){
    if(actualMicroUSD===null||actualMicroUSD===undefined||actualMicroUSD===charge.amountMicroUSD)return charge;
    throw Error('PRODUCTION_SETTLEMENT_CONFLICT');
   }
   if(actualMicroUSD===null||actualMicroUSD===undefined||actualMicroUSD===0&&!definitiveNoSpend){charge.state='uncertain';charge.uncertainAt=now();await store.put('production-charge',charge);return charge;}
   const actual=actualMicroUSD,refundable=Math.max(0,charge.heldMicroUSD-actual),extra=Math.max(0,actual-charge.heldMicroUSD);
   const lots=await lotsFor(charge.customerId),byId=new Map(lots.map(value=>[value.id,value]));
   let refund=refundable;
   for(const entry of [...charge.entries].reverse()){
    const amount=Math.min(refund,entry.micros);if(!amount)continue;
    const lot=byId.get(entry.lotId);if(!lot)throw Error('PRODUCTION_REFUND_LOT_MISSING');
    lot.remaining=add(lot.remaining,amount);refund-=amount;
   }
   if(refund)throw Error('PRODUCTION_REFUND_INCOMPLETE');
   const overage=extra?debit(lots,extra,now()):{captured:0,uncovered:0,entries:[]};
   for(const lot of lots)await store.put('film-credit',lot);
   await store.put('film-ledger',{id:charge.id+'-settled',customerId:charge.customerId,projectId:charge.projectId,attemptId:charge.attemptId,quoteId:charge.quoteId,chargeId:charge.id,type:'production_settlement',microUSD:refundable-overage.captured,usageMicroUSD:actual,uncoveredMicroUSD:overage.uncovered,createdAt:now()});
   Object.assign(charge,{state:'settled',amountMicroUSD:actual,capturedMicroUSD:actual-overage.uncovered,uncoveredMicroUSD:overage.uncovered,refundedMicroUSD:refundable,extraEntries:overage.entries,settledAt:now(),...(definitiveNoSpend?{definitiveNoSpend:true}:{})});
   await store.put('production-charge',charge);return charge;
  });
 }
 return {reserve,submitted,settle,uncertain};
}
