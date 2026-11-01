import {ENGINE_MODEL_CATALOG} from '../../../shared/engine-catalog.ts';
import {hash} from './store.mjs';
import {cost} from './film-money.mjs';
import {selectProductionVideoRoutes} from './video-routing.mjs';

/** Swappable inference contracts, not model implementations. No SDK imports,
 * inference dependencies, implicit fallback or provider credentials here. */
export const PRODUCTION_MODEL_CONTRACTS=Object.freeze({
 'latentsync16':Object.freeze({input:'video_audio_speaker_or_alignment',output:'video_or_alignment'}),
 'flux2-klein-4b':Object.freeze({input:'text_and_references',output:'image'}),
 'qwen-image-edit-2511':Object.freeze({input:'image_and_edit',output:'image'}),
 'wan22-i2v-a14b':Object.freeze({input:'image_and_motion',output:'video'}),
 'hunyuanvideo15':Object.freeze({input:'image_and_motion',output:'video'}),
 'habibi-msa':Object.freeze({input:'exact_text_voice',output:'audio'}),
 'habibi-irq':Object.freeze({input:'exact_text_voice',output:'audio'}),
 'habibi-egy':Object.freeze({input:'exact_text_voice',output:'audio'}),
 'audar-tts-v1-flash':Object.freeze({input:'exact_text_voice',output:'audio'}),
});
export function createProductionModels({store,registry,adapters={},renderer=null,now=Date.now}){
 const trustedAdmin={isAdmin:true};
 const unavailable=blocker=>({estimatedMicroUSD:null,available:false,blockers:[blocker]});
 async function resolve(stage,p){
  if(!stage.modelId)return {adapter:renderer,definition:null};
  if(!Object.hasOwn(PRODUCTION_MODEL_CONTRACTS,stage.modelId)||!ENGINE_MODEL_CATALOG.some(m=>m.id===stage.modelId))throw Error('PRODUCTION_MODEL_UNSUPPORTED');
  const definitionId=p.modelBindings?.[stage.modelId],definition=definitionId?await store.get('engine-definition',definitionId):null;
  if(!definition||definition.modelId!==stage.modelId||!definition.version)return {adapter:null,definition:null};
  return {adapter:adapters[stage.modelId]??null,definition};
 }
 function snapshot(stage,p,definition,adapter){return hash(JSON.stringify({projectId:p.id,revision:p.revision,stageId:stage.stageId,modelId:stage.modelId??null,definitionId:definition?.id??null,settingsRevision:definition?.revision??null,modelVersion:definition?.version??null,adapterVersion:adapter?.version??null}));}
 async function quote(stage,p){
  if(stage.kind==='save')return {estimatedMicroUSD:0,available:true,blockers:[],snapshot:'local-artifact-save-v1'};
  const {adapter,definition}=await resolve(stage,p);if(!adapter?.estimate||!adapter.execute||!adapter.version)return unavailable('PRODUCTION_ADAPTER_UNAVAILABLE');
  if(definition){if(registry?.isPublishedForProduction&&!await registry.isPublishedForProduction(definition.id))return unavailable('PRODUCTION_MODEL_NOT_PUBLISHED');if(definition.publication?.approved!==true||definition.publication?.tested!==true||definition.publication?.revision!==definition.revision)return unavailable('PRODUCTION_MODEL_NOT_PUBLISHED');const inspected=await registry.dispatch(trustedAdmin,'admin.engine.status',{id:definition.id});if(inspected.runtime?.cloudStopped===false)return unavailable('PRODUCTION_MODEL_BUSY');if(!inspected.enabled||!inspected.adapterAvailable||inspected.preparationState!=='ready'||inspected.blockers.length)return unavailable('PRODUCTION_MODEL_NOT_READY');}
  const estimate=await adapter.estimate({stage,plan:p.plan,definition,customerId:p.customerId,projectId:p.id});if(estimate?.available===false)return unavailable('PRODUCTION_ADAPTER_UNAVAILABLE');if(!Number.isSafeInteger(estimate?.estimatedMicroUSD)||estimate.estimatedMicroUSD<0)return unavailable('PRODUCTION_ESTIMATE_UNAVAILABLE');
  return {estimatedMicroUSD:estimate.estimatedMicroUSD,available:true,blockers:[],snapshot:snapshot(stage,p,definition,adapter),definitionId:definition?.id??null,settingsRevision:definition?.revision??null};
 }
 async function execute(stage,p,context){
  const scope={customerId:p.customerId,projectId:p.id,attemptId:context.attempt.id};
  if(stage.kind==='save')return {...scope,cloudStopped:true,actualMicroUSD:0,definitiveNoSpend:true,result:{assetIds:[]}};
  const {adapter,definition}=await resolve(stage,p);if(!adapter?.execute)throw Object.assign(Error('PRODUCTION_ADAPTER_UNAVAILABLE'),{definitiveNoSpend:true,cloudStopped:true});
  if(definition&&registry?.isPublishedForProduction&&!await registry.isPublishedForProduction(definition.id))throw Object.assign(Error('PRODUCTION_MODEL_NOT_PUBLISHED'),{definitiveNoSpend:true,cloudStopped:true});
  if(definition&&(definition.publication?.approved!==true||definition.publication?.tested!==true||definition.publication?.revision!==definition.revision))throw Object.assign(Error('PRODUCTION_MODEL_NOT_PUBLISHED'),{definitiveNoSpend:true,cloudStopped:true});
  if(context.priced.snapshot!==snapshot(stage,p,definition,adapter))throw Object.assign(Error('PRODUCTION_CONFIG_CHANGED'),{definitiveNoSpend:true,cloudStopped:true});
  let runtime=null,ownedRunId=null,stopConfirmed=!definition,dispatchStarted=false;
  try{
   if(context.signal?.aborted)throw Object.assign(Error('PRODUCTION_CANCELLED'),{definitiveNoSpend:true});
   if(adapter.preflight){try{await adapter.preflight({scope,stage,plan:p.plan,inputs:context.dependencies,definition});}catch(cause){cause.definitiveNoSpend=true;throw cause;}}
   if(definition){
    const q=await registry.dispatch(trustedAdmin,'admin.engine.quote',{id:definition.id,action:'start'});
    // The scoped production quote was explicitly approved; a registry quote
    // cannot replace it or authorize different model/settings resources.
    if(!q.dispatchAvailable||q.settingsRevision!==context.priced.settingsRevision)throw Object.assign(Error('PRODUCTION_MODEL_NOT_READY'),{definitiveNoSpend:true,cloudStopped:true});
    if(context.signal?.aborted)throw Object.assign(Error('PRODUCTION_CANCELLED'),{definitiveNoSpend:true,cloudStopped:true});
    dispatchStarted=true;runtime=await registry.dispatch(trustedAdmin,'admin.engine.start',{id:definition.id,quoteId:q.id,requestId:context.attempt.id,approved:true});
    ownedRunId=runtime.runtime.id;await store.put('production-model-run',{id:context.attempt.id,customerId:p.customerId,projectId:p.id,engineId:definition.id,accountId:definition.accountId,runId:ownedRunId});
    if(runtime.runtime.state!=='running'){
     if(!adapter.waitReady)throw Error('PRODUCTION_MODEL_NOT_READY');
     await adapter.waitReady({definition,runId:ownedRunId,signal:context.signal,observe:()=>registry.dispatch(trustedAdmin,'admin.engine.status',{id:definition.id})});
     const observed=await registry.dispatch(trustedAdmin,'admin.engine.status',{id:definition.id});if(observed.runtime.id!==ownedRunId)throw Error('PRODUCTION_STATE_UNKNOWN');runtime=observed;
    }
    if(runtime.runtime.state!=='running'||runtime.runtime.cloudStopped)throw Error('PRODUCTION_MODEL_NOT_READY');
   }
   if(context.signal?.aborted)throw Error('PRODUCTION_CANCELLED');
   const result=await adapter.execute({scope,stage,plan:p.plan,definition,runId:ownedRunId,inputs:context.dependencies,onProgress:context.onProgress,signal:context.signal});
   if(result?.customerId!==scope.customerId||result?.projectId!==scope.projectId||result?.attemptId!==scope.attemptId||definition&&(result.engineId!==definition.id||result.accountId!==definition.accountId||result.runId!==ownedRunId))throw Error('PRODUCTION_RESULT_UNCONFIRMED');
   const hourly=definition&&adapter.metering==='registry_hourly'&&result.billingScope==='registry_hourly';
   if(definition&&!hourly&&result.billingScope!=='all_resources')throw Error('PRODUCTION_USAGE_UNCONFIRMED');
   if(definition){const stopped=await registry.dispatch(trustedAdmin,'admin.engine.stop',{id:definition.id,expectedRunId:ownedRunId,approved:true});stopConfirmed=stopped.runtime.cloudStopped===true;if(!stopConfirmed)throw Error('PRODUCTION_RESOURCES_UNCONFIRMED');}
   if(hourly){const receipt=await store.get('engine-runtime-history',ownedRunId);if(!receipt?.cloudStopped||receipt.engineId!==definition.id||receipt.accountId!==definition.accountId)throw Error('PRODUCTION_USAGE_UNCONFIRMED');if(adapter.onStopped){try{await adapter.onStopped({scope,stage,result:{...result,actualMicroUSD:cost(receipt.hourMicros,Math.max(0,receipt.stoppedAt-receipt.startedAt))},history:receipt});}catch(cause){cause.outputRecoveryRequired=true;throw cause;}}return {...result,billingScope:'all_resources',cloudStopped:true,actualMicroUSD:cost(receipt.hourMicros,Math.max(0,receipt.stoppedAt-receipt.startedAt)),customerChargeBasis:'confirmed_stop_hourly_meter',recordedProviderUSD:receipt.recordedProviderUSD??null};}
   return {...result,cloudStopped:stopConfirmed};
  }catch(cause){
   if(definition&&runtime&&!stopConfirmed){try{const stopped=await registry.dispatch(trustedAdmin,'admin.engine.stop',{id:definition.id,expectedRunId:ownedRunId,approved:true});stopConfirmed=stopped.runtime.cloudStopped===true;}catch{/* Unknown resources remain reserved in the registry. */}}
   const e=Error('PRODUCTION_STAGE_FAILED');if(adapter.billingMode==='local_server'&&['FINAL_QUALITY_REVIEW_REQUIRED','SFX_EVENT_REVIEW_REQUIRED','PRODUCTION_STORAGE_INSUFFICIENT','PRODUCTION_STORAGE_UNAVAILABLE'].includes(cause.message))e.publicCode=cause.message;e.needsReview=cause.needsReview===true;e.cloudStopped=!dispatchStarted||stopConfirmed;e.definitiveNoSpend=!dispatchStarted&&(cause.definitiveNoSpend===true||adapter.billingMode==='local_server');
   if(definition&&adapter.metering==='registry_hourly'&&ownedRunId&&stopConfirmed){const history=await store.get('engine-runtime-history',ownedRunId);if(history?.cloudStopped===true&&history.engineId===definition.id&&history.accountId===definition.accountId){const amount=cost(history.hourMicros,Math.max(0,history.stoppedAt-history.startedAt));e.failureReceipt={...scope,engineId:definition.id,accountId:definition.accountId,runId:ownedRunId,billingScope:'all_resources',cloudStopped:true,actualMicroUSD:amount,definitiveNoSpend:amount===0,outputRecoveryRequired:cause.outputRecoveryRequired===true,recordedProviderUSD:history.recordedProviderUSD??null};}}
   throw e;
  }
 }
 async function cancel(stage,p,{attempt}){
  if(!attempt||attempt.customerId!==p.customerId||attempt.projectId!==p.id)throw Error('NOT_FOUND');const {adapter,definition}=await resolve(stage,p);let run=await store.get('production-model-run',attempt.id);
  if(!run&&definition){const command=await store.get('engine-command',hash('engine-start:'+attempt.id));if(command)run={customerId:p.customerId,projectId:p.id,engineId:definition.id,accountId:definition.accountId,runId:command.runtimeId};}
  try{await adapter?.cancel?.({customerId:p.customerId,projectId:p.id,attemptId:attempt.id});}catch{if(!run)throw Error('PRODUCTION_STATE_UNKNOWN');}
  if(run){if(run.customerId!==p.customerId||run.projectId!==p.id)throw Error('NOT_FOUND');return registry.dispatch(trustedAdmin,'admin.engine.stop',{id:run.engineId,expectedRunId:run.runId,approved:true});}
  return {requested:true,confirmed:false};
 }
 async function follow(stage,p,{attempt}){
  if(!attempt||attempt.customerId!==p.customerId||attempt.projectId!==p.id)throw Error('NOT_FOUND');const {adapter,definition}=await resolve(stage,p);if(!adapter?.observeResult)throw Error('PRODUCTION_STATE_UNKNOWN');
  const run=await store.get('production-model-run',attempt.id);if(definition&&(!run||run.customerId!==p.customerId||run.projectId!==p.id||run.engineId!==definition.id||run.accountId!==definition.accountId))throw Error('PRODUCTION_STATE_UNKNOWN');
  const receipt=await adapter.observeResult({scope:{customerId:p.customerId,projectId:p.id,attemptId:attempt.id},stage,runId:run?.runId??null});
  if(definition){const history=await store.get('engine-runtime-history',run.runId);if(!history?.cloudStopped||history.engineId!==run.engineId||history.accountId!==run.accountId||receipt?.runId!==run.runId||receipt?.accountId!==run.accountId||receipt?.engineId!==run.engineId||receipt?.billingScope!=='all_resources')throw Error('PRODUCTION_STATE_UNKNOWN');}
  if(definition&&adapter.onStopped)await adapter.onStopped({scope:{customerId:p.customerId,projectId:p.id,attemptId:attempt.id},stage,result:receipt,history:await store.get('engine-runtime-history',run.runId)});
  return receipt;
 }
 return {quote,execute,cancel,follow,preparePlan:Object.values(adapters).some(a=>a.preparePlan)?async(p,context={})=>{const benchmarks=(await store.all('production-video-comparison')).filter(r=>context.customerId&&r.customerId===context.customerId&&r.qualityReview?.identity===true&&r.qualityReview.motion===true&&r.qualityReview.deformation===false).map(r=>({modelId:r.modelId,generationMode:r.sourceImageProvided?'image_to_video':'text_to_video',resolution:Math.min(r.width,r.height)>=720?'720p':'480p',durationMs:r.durationMs,customerChargeUSD:r.metrics?.customerChargeUSD,reviewed:true}));let result=selectProductionVideoRoutes(p,{benchmarks,availableModels:Object.entries(adapters).filter(([,a])=>a.selectionEnabled!==false).map(([id])=>id)});for(const adapter of Object.values(adapters))if(adapter.preparePlan)result=await adapter.preparePlan(result,context);return result;}:null,cinematicSync:!!adapters.latentsync16,finalComposer:renderer?.finalComposer===true,voiceChunking:Object.keys(adapters).some(id=>id.startsWith('habibi-')||id==='audar-tts-v1-flash'),referenceConditioningModelId:adapters['flux2-klein-4b']?'flux2-klein-4b':null,imageEditModelId:adapters['qwen-image-edit-2511']?'qwen-image-edit-2511':null,contracts:PRODUCTION_MODEL_CONTRACTS,checkedAt:now()};
}
