import {hash} from './store.mjs';
/** Adapter for the existing rental job contract. It reuses the registry lifecycle;
 * wallet lots, tariff arithmetic, rental schema and public commands stay unchanged. */
export function createRegistryRentalBridge({store,registry,legacy,now=Date.now}){
 const admin={isAdmin:true};
 const owned=async(job,scope)=>{if(!job?.genericEngineId||scope?.tenantId!==job.tenantId||scope?.rentalId!==job.rentalId||scope?.engineSlotId!==job.engineSlotId||scope?.accountId!==job.accountId)throw Error('NOT_FOUND');};
 async function update(job,state){const r=state.runtime;if(!r.id&&!job.runtimeId)return job;job.status=r.cloudStopped?'stopped':r.state==='running'?'ready':r.state==='failed'?'uncertain':'running';job.cloudStopped=r.cloudStopped===true;job.runtimeId=r.id??job.runtimeId;if(!job.events?.length){const initial=await store.get('engine-runtime-history',job.runtimeId);if(initial?.startedAt)job.events=[{kind:'phase',phase:'runtime_imports',receivedAt:initial.startedAt}];}job.error=r.error??null;if(r.cloudStopped){const history=await store.get('engine-runtime-history',job.runtimeId);job.stoppedAt=history?.stoppedAt??now();job.finishedAt=job.stoppedAt;job.cleanup={recordedCost:{usd:r.recordedProviderUSD??null}};}await store.put('job',job);return job;}
 async function invoke(action,input={},scope){
  if(action.startsWith('jobs/')){const match=/^jobs\/([A-Za-z0-9_-]+)\/(stop|reconcile)$/.exec(action),job=match?await store.get('job',match[1]):null;if(!job?.genericEngineId)return legacy.invoke(action,input,scope);await owned(job,scope);if(match[2]==='stop'){const r=await store.get('engine-runtime',job.genericEngineId);return update(job,await registry.dispatch(admin,'admin.engine.stop',{id:job.genericEngineId,approved:true,...(r?.runId?{expectedRunId:r.runId}:{})}));}return update(job,await registry.dispatch(admin,'admin.engine.status',{id:job.genericEngineId}));}
  const rental=scope?.rentalId?await store.get('rental',scope.rentalId):null,slot=scope?.engineSlotId?await store.get('film-slot',scope.engineSlotId):null;
  if(!slot?.genericEngineId)return legacy.invoke(action,input,scope);
  if(!rental||rental.customerId!==scope.tenantId||rental.engineSlotId!==slot.id||rental.accountId!==slot.accountId||scope.accountId!==slot.accountId)throw Error('NOT_FOUND');
  if(action==='quote'){if(!await registry.isPublishedForProduction(slot.genericEngineId))throw Error('SERVER_LOCKED');return registry.dispatch(admin,'admin.engine.quote',{id:slot.genericEngineId,action:'start'});}
  if(action!=='execute'||input.approvedCost!==true)throw Error('APPROVAL_REQUIRED');
  const key=hash('generic-rental-job:'+rental.id),prior=await store.get('job',key);if(prior)return prior;
  const job={id:key,action:'start',genericEngineId:slot.genericEngineId,tenantId:rental.customerId,rentalId:rental.id,engineSlotId:slot.id,accountId:slot.accountId,status:'running',cloudStopped:false,createdAt:now(),events:[]};await store.put('job',job);
  try{return update(job,await registry.startRental(slot.genericEngineId,{quoteId:input.quoteId,requestId:rental.id,approved:true},rental.id));}catch(cause){const r=await store.get('engine-runtime',slot.genericEngineId);job.status='uncertain';job.error='ENGINE_STATE_UNKNOWN';job.cloudStopped=!r||r.cloudStopped===true;if(job.cloudStopped)job.stoppedAt=now();await store.put('job',job);throw cause;}
 }
 return {invoke};
}
