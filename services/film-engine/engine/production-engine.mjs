import {id,hash} from './store.mjs';
import {validateProductionPlan,stagesForPlan,validateProductionRouting} from './production-plan.mjs';
import {ENGINE_MODEL_CATALOG} from '../../../shared/engine-catalog.ts';
import {createProductionBilling} from './production-billing.mjs';
import {cost} from './film-money.mjs';
import {available} from './film-money.mjs';
import {createProductionSources} from './production-sources.mjs';
import {productionActivity} from './production-costs.mjs';

const KEY=/^[a-zA-Z0-9_-]{1,100}$/;
const stepKey=(projectId,stageId)=>hash(projectId+':'+stageId);
const error=code=>{throw Error(code);};
const string=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))error('INVALID_PRODUCTION_INPUT');return v.trim();};
const requestId=v=>{if(!KEY.test(v||''))error('INVALID_PRODUCTION_INPUT');return v;};
const jsonHash=v=>hash(JSON.stringify(v));
const phaseIncludes=(phase,kind)=>phase==='images'?['character_image','scene_image'].includes(kind):phase==='animation'?kind==='animate':phase==='audio'?['voice','voice_merge'].includes(kind):phase==='synchronization'?['align','alignment_merge','timeline_sync','lip_sync','sync'].includes(kind):true;
const progressOK=v=>v&&Number.isSafeInteger(v.completed)&&Number.isSafeInteger(v.total)&&v.total>0&&v.completed>=0&&v.completed<=v.total&&['steps','frames','samples','bytes','items'].includes(v.unit);

/** Durable orchestration only. Planner/model/renderer boundaries have no default
 * provider implementation. Opening or planning cannot enable a paid adapter.
 * `run` is a server-worker capability, never a customer-supplied operation.
 */
export function createProductionEngine({store,models,artifacts,planner=null,now=Date.now,allowExecution=false,referenceCheck=async()=>false}){
 const billing=createProductionBilling({store,now}),sources=createProductionSources({store,now});
 const active=new Set(),executionSignals=new Map();let closed=false;
 const owned=async(customerId,key)=>{requestId(key);const p=await store.get('production-project',key);if(!p||p.customerId!==customerId)error('NOT_FOUND');return p;};
 const steps=async p=>(await store.all('production-stage')).filter(s=>s.projectId===p.id&&!s.retired).sort((a,b)=>a.order-b.order);
 const putStep=async s=>store.put('production-stage',s);
 async function dto(p){const stages=await steps(p);const result={activity:productionActivity(p,stages),measuredDurationMs:p.measuredDurationMs??null,id:p.id,title:p.title,story:p.story.length<=30000?p.story:p.story.slice(0,4000),storyTruncated:p.story.length>30000,source:p.source??null,pinned:p.pinned===true,archived:p.archived===true,updatedAt:p.updatedAt,createdAt:p.createdAt,referenceIds:p.referenceIds??[],durationMs:p.durationMs,state:p.state,cancelRequested:p.cancelRequested===true,completedPhases:p.completedPhases??[],revision:p.revision,characters:p.plan?.characters??[],narrators:p.plan?.narrators??[],timeline:p.plan?{chapters:p.plan.chapters,scenes:p.plan.scenes,shots:p.plan.shots,utterances:p.plan.utterances}:null,stages:stages.map(s=>({id:s.stageId,kind:s.kind,state:s.state,attempts:s.attempts??0,progress:s.progress??null,error:s.error??null,result:s.result?{assetIds:s.result.assetIds??[]}:null})),result:p.result??null,error:p.error??null};

 return result;}
 async function references(customerId,values){if(!Array.isArray(values)||values.length>100||new Set(values).size!==values.length)error('INVALID_PRODUCTION_INPUT');for(const ref of values)if(!KEY.test(ref)||!await referenceCheck(customerId,ref))error('REFERENCE_NOT_OWNED');}
 async function create(customerId,input){
  const title=string(input.title,120),resolved=input.sourceId?await sources.resolve(customerId,input.sourceId):null,story=resolved?.text??input.story,durationMs=input.durationMs,refs=input.referenceIds??[];if(input.sourceId&&input.story!==undefined)error('INVALID_PRODUCTION_INPUT');string(story,resolved?1000000:30000);requestId(input.requestId);
  if(!KEY.test(customerId)||!Number.isSafeInteger(durationMs)||durationMs<10000||durationMs>3600000)error('INVALID_PRODUCTION_INPUT');await references(customerId,refs);
  return store.transaction(async()=>{const key=hash('production-create:'+customerId+':'+input.requestId),fingerprint=jsonHash([title,story,durationMs,refs]),old=await store.get('production-intent',key);if(old){if(old.fingerprint!==fingerprint)error('IDEMPOTENCY_CONFLICT');return dto(await owned(customerId,old.projectId));}
   const p={id:id(),customerId,title,story,source:resolved?.source??null,durationMs,referenceIds:refs,state:'draft',revision:1,createdAt:now(),updatedAt:now()};await store.put('production-project',p);await store.put('production-intent',{id:key,projectId:p.id,customerId,fingerprint});
   for(const [order,kind] of ['analyze','plan'].entries())await putStep({id:stepKey(p.id,kind),projectId:p.id,customerId,stageId:kind,kind,state:'draft',deps:kind==='plan'?['analyze']:[],order,attempts:0});return dto(p);
  });
 }
 async function planningStep(p,kind,fn){
  const s=await store.transaction(async()=>{const fresh=await owned(p.customerId,p.id);if(fresh.cancelRequested)error('PRODUCTION_CANCELLED');const s=await store.get('production-stage',stepKey(p.id,kind));if(s.state==='completed')return s;if(s.state==='running')error('PRODUCTION_BUSY');s.state='running';s.attempts++;s.error=null;await putStep(s);return s;});
  if(s.state==='completed')return s.result;
  try{const result=await fn();if(JSON.stringify(result).length>2000000)error('INVALID_PRODUCTION_PLAN');await store.transaction(async()=>{const fresh=await owned(p.customerId,p.id);if(fresh.cancelRequested)error('PRODUCTION_CANCELLED');s.state='completed';s.result=result;await putStep(s);});return result;
  }catch{await store.transaction(async()=>{s.state='failed';s.error='PRODUCTION_PLANNING_FAILED';await putStep(s);const fresh=await owned(p.customerId,p.id);fresh.state=fresh.cancelRequested?'cancelled':'failed';fresh.error=s.error;await store.put('production-project',fresh);});throw Error('PRODUCTION_PLANNING_FAILED');}
 }
 async function plan(customerId,input){
  let p=await owned(customerId,input.id);if(p.plan)return dto(p);
  if(!planner||planner.billingMode!=='none'||!planner.analyze||!planner.plan)error('PRODUCTION_PLANNER_UNAVAILABLE');
  // Only an explicitly non-billable local planner can use this seam. Future
  // paid text planning must use an approved accounting stage, not this call.
  const voiceProfiles=(await store.all('voice-profile')).filter(v=>v.customerId===customerId&&v.projectId===p.id&&v.approved).map(v=>({id:v.id,characterId:v.characterId,narratorId:v.narratorId,name:v.name,gender:v.gender,tone:v.tone,modelId:v.modelId,locale:v.locale}));
  const analysis=await planningStep(p,'analyze',()=>planner.analyze({story:p.story,durationMs:p.durationMs,referenceIds:p.referenceIds}));
  const config=await store.get('production-settings','models'),raw=await planningStep(p,'plan',async()=>{
   const raw=await planner.plan({story:p.story,durationMs:p.durationMs,referenceIds:p.referenceIds,analysis,voiceProfiles,modelSettings:config?.modelSettings??{}});
   const preferred=(await store.get('film-preferences',customerId))?.orientation;
   let checked=validateProductionPlan({...raw,orientation:preferred??raw.orientation??null,story:p.story,durationMs:p.durationMs},{modelSettings:config?.modelSettings??{}});if(models.preparePlan)checked=validateProductionPlan(await models.preparePlan(checked,{customerId}),{modelSettings:config?.modelSettings??{}});await references(customerId,checked.referenceIds);if(checked.referenceIds.some(r=>!p.referenceIds.includes(r)))error('REFERENCE_NOT_OWNED');return checked;
  });
  const normalized=validateProductionPlan({...raw,story:p.story,durationMs:p.durationMs},{modelSettings:config?.modelSettings??{}});await references(customerId,normalized.referenceIds);
  if(normalized.referenceIds.some(r=>!p.referenceIds.includes(r)))error('REFERENCE_NOT_OWNED');
  return store.transaction(async()=>{p=await owned(customerId,p.id);if(p.cancelRequested)error('PRODUCTION_CANCELLED');if(p.plan)return dto(p);
   p.plan=normalized;p.state='planned';p.error=null;p.revision++;p.modelBindings=config?.bindings??{};p.updatedAt=now();
   for(const [order,descriptor] of stagesForPlan(normalized,{referenceConditioningModelId:models.referenceConditioningModelId,imageEditModelId:models.imageEditModelId??null,voiceChunking:models.voiceChunking===true,cinematicSync:models.cinematicSync===true,finalComposer:models.finalComposer===true}).entries()){const old=await store.get('production-stage',stepKey(p.id,descriptor.id));await putStep({...descriptor,id:stepKey(p.id,descriptor.id),stageId:descriptor.id,projectId:p.id,customerId,order,state:['analyze','plan'].includes(descriptor.kind)?'completed':'planned',attempts:old?.attempts??0,result:old?.result??null});}
   for(const c of normalized.characters)await store.put('production-character',{id:stepKey(p.id,c.id),projectId:p.id,customerId,characterId:c.id,version:1,...c,id:stepKey(p.id,c.id)});
   await store.put('production-project',p);return dto(p);
  });
 }
 async function quote(customerId,input){
  const p=await owned(customerId,input.id);if(!p.plan||p.cancelRequested||['queued','running','completed'].includes(p.state))error('PRODUCTION_NOT_PLANNED');
  if(input.phase!==undefined&&!['images','animation','audio','synchronization'].includes(input.phase))error('INVALID_PRODUCTION_INPUT');const unfinished=(await steps(p)).filter(s=>s.state!=='completed'&&(!input.phase||phaseIncludes(input.phase,s.kind))),quoted=[];if(!unfinished.length)error('PRODUCTION_PHASE_COMPLETE');
  for(const s of unfinished){const estimate=await models.quote(s,p);if(estimate.available&&(!Number.isSafeInteger(estimate.estimatedMicroUSD)||estimate.estimatedMicroUSD<0)||!estimate.available&&estimate.estimatedMicroUSD!==null&&(!Number.isSafeInteger(estimate.estimatedMicroUSD)||estimate.estimatedMicroUSD<0))error('PRODUCTION_ESTIMATE_UNAVAILABLE');quoted.push({id:s.stageId,kind:s.kind,...estimate});}
  const blockers=quoted.flatMap(s=>s.blockers??[]);if(input.phase==='animation'&&(await steps(p)).some(s=>['character_image','scene_image'].includes(s.kind)&&s.state!=='completed'))blockers.push('PRODUCTION_IMAGE_PHASE_REQUIRED');if(!allowExecution)blockers.push('PRODUCTION_EXECUTION_DISABLED');
  const walletAvailable=available((await store.all('film-credit')).filter(v=>v.customerId===customerId),now());
  const q={id:id(),customerId,projectId:p.id,phase:input.phase??'film',planRevision:p.revision,planFingerprint:jsonHash(p.plan),expiresAt:now()+300000,estimatedMicroUSD:quoted.some(s=>s.estimatedMicroUSD===null)?null:quoted.reduce((n,s)=>n+s.estimatedMicroUSD,0),availableMicroUSD:walletAvailable,canAfford:quoted.every(s=>Number.isSafeInteger(s.estimatedMicroUSD))&&walletAvailable>=quoted.reduce((n,s)=>n+s.estimatedMicroUSD,0),stages:quoted,dispatchAvailable:!blockers.length&&quoted.every(s=>s.available),blockers,approved:false};
  if(q.estimatedMicroUSD!==null&&!Number.isSafeInteger(q.estimatedMicroUSD))error('PRODUCTION_ESTIMATE_UNAVAILABLE');
  await store.transaction(async()=>{const fresh=await owned(customerId,p.id);if(fresh.revision!==p.revision||['queued','running','completed','cancelled'].includes(fresh.state))error('PRODUCTION_CONFIG_CHANGED');await store.put('production-quote',q);fresh.state='awaiting_approval';await store.put('production-project',fresh);});return publicQuote(q);
 }
 function publicQuote(q){const {customerId:ignored,planFingerprint:ignored2,approved:ignored3,...result}=q;void ignored;void ignored2;void ignored3;return {...result,stages:result.stages.map(({id,kind,estimatedMicroUSD,available,blockers})=>({id,kind,estimatedMicroUSD,available,blockers}))};}
 async function approve(customerId,input,retry=false){
  if(input.approved!==true)error('PRODUCTION_APPROVAL_REQUIRED');requestId(input.requestId);
  return store.transaction(async()=>{const p=await owned(customerId,input.id),key=hash('production-approve:'+customerId+':'+input.requestId),fingerprint=jsonHash([p.id,input.quoteId,retry?input.stageId:null,input.spendLimitMicroUSD??null]),old=await store.get('production-intent',key);
   if(old){if(old.fingerprint!==fingerprint)error('IDEMPOTENCY_CONFLICT');return dto(p);}
   const q=await store.get('production-quote',input.quoteId);if(!q||q.customerId!==customerId||q.projectId!==p.id||q.approved||q.expiresAt<=now())error('PRODUCTION_QUOTE_EXPIRED');
   if(!allowExecution||!q.dispatchAvailable)error('PRODUCTION_EXECUTION_DISABLED');if(p.cancelRequested||q.planRevision!==p.revision||q.planFingerprint!==jsonHash(p.plan))error('PRODUCTION_CONFIG_CHANGED');
   const ceiling=input.spendLimitMicroUSD??q.estimatedMicroUSD;if(!Number.isSafeInteger(ceiling)||ceiling<q.estimatedMicroUSD||ceiling<0)error('PRODUCTION_SPEND_LIMIT_REQUIRED');if(available((await store.all('film-credit')).filter(v=>v.customerId===customerId),now())<q.estimatedMicroUSD)error('PRODUCTION_INSUFFICIENT_CREDIT');q.spendLimitMicroUSD=ceiling;
   const list=await steps(p),failed=list.filter(s=>['failed','needs_review'].includes(s.state));if(failed.length&&!retry)error('PRODUCTION_RETRY_REQUIRED');
   if(retry){const s=list.find(s=>s.stageId===input.stageId);if(!s||!['failed','needs_review'].includes(s.state)||s.requiresReconcile||failed.length!==1)error('PRODUCTION_RETRY_UNSAFE');}
   if(list.some(s=>s.state==='running'))error('PRODUCTION_BUSY');
   for(const s of list)if(s.state!=='completed'&&q.stages.some(t=>t.id===s.stageId)){if(s.requiresReconcile)error('PRODUCTION_RETRY_UNSAFE');s.state='queued';s.error=null;await putStep(s);}
   q.approved=true;q.approvedAt=now();q.executionExpiresAt=now()+86400000;p.approvedQuoteId=q.id;p.approvedPhase=q.phase??'film';p.state='queued';p.error=null;await store.put('production-quote',q);await store.put('production-project',p);await store.put('production-intent',{id:key,fingerprint,projectId:p.id,customerId});await store.audit('production_approved',p.id);return dto(p);
  });
 }
 async function completeReceipt(customerId,p,s,a,receipt,deps){
  if(receipt?.customerId!==customerId||receipt?.projectId!==p.id||receipt?.attemptId!==a.id||receipt.cloudStopped!==true||!Number.isSafeInteger(receipt.actualMicroUSD)||receipt.actualMicroUSD<0)error('PRODUCTION_RESULT_UNCONFIRMED');
  if(receipt.actualMicroUSD===0&&receipt.definitiveNoSpend!==true)error('PRODUCTION_USAGE_UNCONFIRMED');
  const result=receipt.result??{};if(!Array.isArray(result.assetIds)||result.assetIds.length>100||result.assetIds.some(x=>!KEY.test(x))||Object.keys(result).some(k=>k!=='assetIds'))error('INVALID_PRODUCTION_RESULT');
  for(const assetId of result.assetIds){const asset=await store.get('production-asset',assetId);if(!asset||asset.customerId!==customerId||asset.projectId!==p.id)error('PRODUCTION_ASSET_SCOPE');}
  if(s.kind==='save'){
   const merged=deps.find(d=>d.stageId==='merge')?.result?.assetIds?.[0];if(!merged||!artifacts)error('PRODUCTION_ARTIFACT_UNAVAILABLE');
   result.final=await artifacts.commitFinal({projectId:p.id,customerId,sourceAssetId:merged,expectedDurationMs:(await owned(customerId,p.id)).measuredDurationMs??p.durationMs,hasAudio:p.plan.utterances.length>0,attemptId:a.id});if(result.final?.mediaReady===false)error('PRODUCTION_MEDIA_INDEX_PENDING');
  }
  await billing.settle(a.chargeId,receipt.actualMicroUSD,{definitiveNoSpend:receipt.definitiveNoSpend===true});
  await store.transaction(async()=>{const latest=await owned(customerId,p.id),stage=await store.get('production-stage',s.id);if(stage.attemptId!==a.id)error('PRODUCTION_STATE_UNKNOWN');stage.state='completed';stage.result=result;stage.requiresReconcile=false;stage.error=null;a.status='completed';a.finishedAt=now();await store.put('production-attempt',a);await putStep(stage);if(s.kind==='save')latest.result=result.final;latest.updatedAt=now();if(latest.cancelRequested)latest.state='cancelled';else if((await steps(latest)).every(x=>x.state==='completed'))latest.state='completed';else if(['images','animation','audio','synchronization'].includes(latest.approvedPhase)&&(await steps(latest)).filter(x=>phaseIncludes(latest.approvedPhase,x.kind)).every(x=>x.state==='completed')){latest.state='planned';latest.completedPhases=[...new Set([...(latest.completedPhases??[]),latest.approvedPhase])];}else latest.state='queued';latest.error=null;await store.put('production-project',latest);});
 }
 async function run(customerId,projectId,{maxStages=Infinity}={}){
  if(closed||!allowExecution)error('PRODUCTION_EXECUTION_DISABLED');if(active.has(projectId))error('PRODUCTION_BUSY');active.add(projectId);
  try{let completed=0;
   while(!closed&&completed<maxStages){
    let admission;try{admission=await store.transaction(async()=>{
     const p=await owned(customerId,projectId);if(closed||p.cancelRequested||!['queued','running'].includes(p.state))return null;
     const all=await steps(p),s=all.find(s=>s.state==='queued'&&s.deps.every(d=>all.find(x=>x.stageId===d)?.state==='completed'));
     if(!s){if(all.every(s=>s.state==='completed')){p.state='completed';p.updatedAt=now();await store.put('production-project',p);}return null;}
     const q=await store.get('production-quote',p.approvedQuoteId),priced=q?.stages.find(x=>x.id===s.stageId);if(!q?.approved||q.planRevision!==p.revision||!priced)error('PRODUCTION_CONFIG_CHANGED');
     if((await store.all('production-attempt')).some(a=>a.projectId===p.id&&a.status==='running'))error('PRODUCTION_BUSY');
     const a={id:id(),customerId,projectId:p.id,stageId:s.stageId,quoteId:q.id,estimatedMicroUSD:priced.estimatedMicroUSD,status:'queued',createdAt:now()};await store.put('production-attempt',a);
     const charge=await billing.reserve({customerId,projectId:p.id,attemptId:a.id,quoteId:q.id,estimatedMicroUSD:a.estimatedMicroUSD,approved:true},true);
     a.status='running';a.chargeId=charge.id;s.state='running';s.attempts++;s.attemptId=a.id;p.state='running';await store.put('production-attempt',a);await putStep(s);await store.put('production-project',p);return {p,s,a,priced};
    });}catch(cause){
     if(cause.message==='PRODUCTION_BUSY')throw cause;
     await store.transaction(async()=>{const p=await owned(customerId,projectId),list=await steps(p),s=list.find(s=>s.state==='queued'&&s.deps.every(d=>list.find(x=>x.stageId===d)?.state==='completed'));if(s){s.state='failed';s.error=cause.message==='PRODUCTION_INSUFFICIENT_CREDIT'?'PRODUCTION_INSUFFICIENT_CREDIT':'PRODUCTION_APPROVAL_REQUIRED';s.requiresReconcile=false;await putStep(s);}p.state='failed';p.error=s?.error??'PRODUCTION_STAGE_FAILED';await store.put('production-project',p);});break;
    }
    if(!admission)break;const {p,s,a,priced}=admission,controller=new AbortController();executionSignals.set(p.id,controller);
    await billing.submitted(a.chargeId);
    let receipt=null;try{
     const onProgress=async progress=>{if(!progressOK(progress))error('INVALID_PRODUCTION_PROGRESS');const normalized={completed:progress.completed,total:progress.total,unit:progress.unit};await store.transaction(async()=>{const latest=await store.get('production-stage',s.id);if(latest?.attemptId!==a.id||latest.state!=='running')return;if(latest.progress&&latest.progress.unit===normalized.unit&&(latest.progress.total!==normalized.total||latest.progress.completed>normalized.completed))error('INVALID_PRODUCTION_PROGRESS');latest.progress=normalized;await putStep(latest);});};
     const deps=await Promise.all(s.deps.map(d=>store.get('production-stage',stepKey(p.id,d))));
     if((await owned(customerId,p.id)).cancelRequested)controller.abort();
     receipt=await models.execute(s,p,{attempt:a,priced,dependencies:deps.map(d=>({stageId:d.stageId,result:d.result})),onProgress,signal:controller.signal});
     await completeReceipt(customerId,p,s,a,receipt,deps);completed++;
    }catch(cause){
     if(!receipt&&cause.failureReceipt){const proposed=cause.failureReceipt,history=await store.get('engine-runtime-history',proposed.runId),binding=await store.get('production-model-run',a.id);if(history?.cloudStopped===true&&binding?.customerId===customerId&&binding.projectId===p.id&&binding.runId===proposed.runId&&binding.engineId===history.engineId&&binding.accountId===history.accountId&&proposed.engineId===history.engineId&&proposed.accountId===history.accountId&&proposed.actualMicroUSD===cost(history.hourMicros,Math.max(0,history.stoppedAt-history.startedAt)))receipt=proposed;}
     const known=receipt?.customerId===customerId&&receipt?.projectId===p.id&&receipt?.attemptId===a.id&&receipt?.cloudStopped===true&&Number.isSafeInteger(receipt?.actualMicroUSD)&&receipt.actualMicroUSD>=0&&(receipt.actualMicroUSD>0||receipt.definitiveNoSpend===true),noSpend=cause.definitiveNoSpend===true&&cause.cloudStopped===true;
     if(known)await billing.settle(a.chargeId,receipt.actualMicroUSD,{definitiveNoSpend:receipt.definitiveNoSpend===true});else if(noSpend)await billing.settle(a.chargeId,0,{definitiveNoSpend:true});else await billing.uncertain(a.chargeId);
     await store.transaction(async()=>{const latest=await owned(customerId,p.id),stage=await store.get('production-stage',s.id);stage.state=cause.needsReview&&(known||noSpend)?'needs_review':'failed';stage.error=cause.publicCode??(cause.needsReview?'PRODUCTION_SYNC_NEEDS_REVIEW':'PRODUCTION_STAGE_FAILED');stage.requiresReconcile=!(known||noSpend)||receipt?.outputRecoveryRequired===true;a.status=stage.requiresReconcile?'uncertain':'failed';a.finishedAt=now();await store.put('production-attempt',a);await putStep(stage);latest.state=latest.cancelRequested&&(known||noSpend)?'cancelled':cause.needsReview&&(known||noSpend)?'needs_review':'failed';latest.error=known||noSpend?stage.error:'PRODUCTION_STATE_UNKNOWN';await store.put('production-project',latest);});break;
    }
   }
   return dto(await owned(customerId,projectId));
  }finally{executionSignals.delete(projectId);active.delete(projectId);}
 }
 async function reconcile(customerId,projectId,stageId){
  const p=await owned(customerId,projectId),s=await store.get('production-stage',stepKey(projectId,stageId));if(!s||s.customerId!==customerId||!s.requiresReconcile)error('PRODUCTION_RETRY_UNSAFE');
  const a=await store.get('production-attempt',s.attemptId);if(!a||a.customerId!==customerId||a.projectId!==projectId||!models.follow)error('PRODUCTION_STATE_UNKNOWN');
  await store.transaction(async()=>{const fresh=await store.get('production-stage',s.id);if(fresh.attemptId!==a.id||!fresh.requiresReconcile||fresh.state==='running')error('PRODUCTION_BUSY');fresh.state='running';a.status='running';await putStep(fresh);await store.put('production-attempt',a);});
  try{const receipt=await models.follow(s,p,{attempt:a});if(!receipt)error('PRODUCTION_STATE_UNKNOWN');const deps=await Promise.all(s.deps.map(d=>store.get('production-stage',stepKey(p.id,d))));await completeReceipt(customerId,p,s,a,receipt,deps);return dto(await owned(customerId,p.id));}
  catch(cause){await store.transaction(async()=>{const fresh=await store.get('production-stage',s.id);if(fresh.attemptId===a.id&&fresh.state==='running'){fresh.state='failed';fresh.requiresReconcile=true;a.status='uncertain';await putStep(fresh);await store.put('production-attempt',a);}});throw cause;}
 }
 async function recover({localProcessStoppedConfirmed=false}={}){
  for(const snapshot of await store.all('production-attempt')){
   if(!['running','uncertain'].includes(snapshot.status))continue;
   const localStage=await store.get('production-stage',stepKey(snapshot.projectId,snapshot.stageId)),charge=await store.get('production-charge',snapshot.chargeId);
   const local=localProcessStoppedConfirmed===true&&localStage&&!localStage.modelId&&['sync','effects','merge','quality','save','voice_merge','alignment_merge','timeline_sync'].includes(localStage.kind)&&!await store.get('production-model-run',snapshot.id)&&charge?.customerId===snapshot.customerId&&charge.projectId===snapshot.projectId&&charge.heldMicroUSD===0;
   if(local)await billing.settle(snapshot.chargeId,0,{definitiveNoSpend:true});
   await store.transaction(async()=>{const a=await store.get('production-attempt',snapshot.id);if(!a||!['running','uncertain'].includes(a.status)||!local&&a.status!=='running')return;const p=await owned(a.customerId,a.projectId),s=await store.get('production-stage',stepKey(p.id,a.stageId));if(s.attemptId!==a.id)return;a.status=local?'failed':'uncertain';if(local)a.finishedAt=now();await store.put('production-attempt',a);s.state='failed';s.requiresReconcile=!local;s.error=local?'PRODUCTION_LOCAL_INTERRUPTED':'PRODUCTION_STATE_UNKNOWN';await putStep(s);p.state='failed';p.error=s.error;await store.put('production-project',p);});
  }
 }
 async function cancel(customerId,input){if(input.approved!==true)error('PRODUCTION_APPROVAL_REQUIRED');const pending=await store.transaction(async()=>{const p=await owned(customerId,input.id);if(p.state==='completed')return {p,running:[]};p.cancelRequested=true;const list=await steps(p),running=list.filter(s=>s.state==='running'||s.requiresReconcile);p.state=running.some(s=>s.state==='running')?'running':running.length?'failed':'cancelled';for(const s of list)if(!s.requiresReconcile&&!['completed','running'].includes(s.state)){s.state='cancelled';await putStep(s);}await store.put('production-project',p);return {p,running};});executionSignals.get(input.id)?.abort();for(const s of pending.running)try{await models.cancel?.(s,pending.p,{attempt:await store.get('production-attempt',s.attemptId)});}catch{/* Keep runtime/holds unconfirmed; cancellation is not a stop receipt. */}return dto(await owned(customerId,input.id));}
 // Server-only adoption of an explicitly approved director revision. This is not
 // a dispatch operation and cannot authorize or repeat a paid model stage.
 async function adoptPlan(customerId,input,inTransaction=false){
  const work=async()=>{
   const p=await owned(customerId,input.id);requestId(input.requestId);const key=hash('director-plan-adoption:'+customerId+':'+input.requestId),old=await store.get('production-plan-adoption',key),fingerprint=jsonHash(input);
   if(old){if(old.fingerprint!==fingerprint)error('IDEMPOTENCY_CONFLICT');return dto(p);}
   const existing=await steps(p);if(active.has(p.id)||['queued','running'].includes(p.state)||existing.some(s=>s.state==='running'||s.requiresReconcile))error('PRODUCTION_BUSY');
   if(input.expectedRevision!==p.revision)error('PRODUCTION_CONFIG_CHANGED');
   const config=await store.get('production-settings','models');let normalized=validateProductionPlan({...input.plan,story:p.story},{modelSettings:config?.modelSettings??{}});
   if(models.preparePlan)normalized=validateProductionPlan(await models.preparePlan(normalized,{customerId,projectId:p.id}),{modelSettings:config?.modelSettings??{}});
   await references(customerId,normalized.referenceIds);if(normalized.referenceIds.some(r=>!p.referenceIds.includes(r)))error('REFERENCE_NOT_OWNED');
   const visual=c=>c?Object.fromEntries(Object.entries(c).filter(([k])=>k!=='voice')):null;
   const content=(s,plan)=>{if(!plan)return null;const shot=plan.shots.find(x=>x.id===s.subjectId),u=plan.utterances.find(x=>x.id===s.subjectId);if(['analyze','plan'].includes(s.kind))return s.kind;if(s.kind==='character_image')return [s,visual(plan.characters.find(c=>c.id===s.subjectId)),plan.orientation];if(s.kind==='timeline_sync')return [s,plan.shots.map(x=>({id:x.id,startMs:x.startMs,endMs:x.endMs,audioCue:x.audioCue})),plan.utterances];if(['voice','voice_merge','align','alignment_merge'].includes(s.kind))return [s,u,u?.narratorId?plan.narrators.find(n=>n.id===u.narratorId)?.voice:plan.characters.find(c=>c.id===u?.characterId)?.voice];if(['scene_image','animate','sync','effects','lip_sync'].includes(s.kind))return [s,['scene_image','animate'].includes(s.kind)&&shot?Object.fromEntries(Object.entries(shot).filter(([k])=>!['audioCue','requires_lip_sync'].includes(k))):shot,shot?.characterIds.map(id=>visual(plan.characters.find(c=>c.id===id))),plan.orientation];if(s.kind==='merge')return [s,plan.chapters.find(c=>c.id===s.subjectId)??null,plan.durationMs];return [s,plan.durationMs];};
   const descriptors=stagesForPlan(normalized,{referenceConditioningModelId:models.referenceConditioningModelId,imageEditModelId:models.imageEditModelId??null,voiceChunking:models.voiceChunking===true,cinematicSync:models.cinematicSync===true,finalComposer:models.finalComposer===true}),keep=new Set(),priorById=new Map(existing.map(s=>[s.stageId,s]));
   for(const [order,d] of descriptors.entries()){
    const prior=priorById.get(d.id),priorDescriptor=prior?Object.fromEntries(Object.keys(d).map(k=>[k,k==='id'?prior.stageId:prior[k]])):null;
    const unchanged=prior&&jsonHash(content(priorDescriptor,p.plan))===jsonHash(content(d,normalized))&&d.deps.every(dep=>keep.has(dep));
    if(prior)await store.put('production-stage-history',{...prior,id:hash(p.id+':'+p.revision+':'+prior.stageId),originalId:prior.id,planRevision:p.revision});
    const completed=['analyze','plan'].includes(d.kind)||unchanged&&prior.state==='completed';if(completed)keep.add(d.id);
    await putStep({...d,...(unchanged?prior:{}),id:stepKey(p.id,d.id),stageId:d.id,projectId:p.id,customerId,order,retired:false,state:completed?'completed':'planned',attempts:prior?.attempts??0,...(!unchanged?{result:['analyze','plan'].includes(d.kind)?{directorApproved:true}:null,error:null,requiresReconcile:false,attemptId:null}: {})});
   }
   for(const s of existing.filter(s=>!descriptors.some(d=>d.id===s.stageId))){await store.put('production-stage-history',{...s,id:hash(p.id+':'+p.revision+':'+s.stageId),originalId:s.id,planRevision:p.revision});await putStep({...s,retired:true});}
   for(const c of normalized.characters)await store.put('production-character',{...c,id:stepKey(p.id,c.id),projectId:p.id,customerId,characterId:c.id,version:p.revision+1});
   if(p.plan)await store.put('production-plan-revision',{id:hash(p.id+':'+p.revision),projectId:p.id,customerId,revision:p.revision,plan:p.plan,result:p.result??null});
   p.plan=normalized;p.durationMs=normalized.durationMs;const retainedTimeline=keep.has('timeline_sync')?await store.get('production-cinematic-timeline',p.id):null;p.revision++;if(retainedTimeline?.customerId===customerId&&retainedTimeline.planRevision===p.revision-1){await store.put('production-cinematic-timeline',{...retainedTimeline,planRevision:p.revision});p.measuredDurationMs=retainedTimeline.timeline.durationMs;}else delete p.measuredDurationMs;p.modelBindings=config?.bindings??{};p.state='planned';p.result=null;p.error=null;p.cancelRequested=false;p.approvedQuoteId=null;p.approvedPhase=null;p.completedPhases=[];p.updatedAt=now();await store.put('production-project',p);await store.put('production-plan-adoption',{id:key,projectId:p.id,customerId,fingerprint});return dto(p);
  };return inTransaction?work():store.transaction(work);
 }
 async function replaceSource(customerId,input,inTransaction=false){const resolved=await sources.resolve(customerId,input.sourceId);const work=async()=>{const p=await owned(customerId,input.id);requestId(input.requestId);if(input.approved!==true)error('PRODUCTION_APPROVAL_REQUIRED');const k=hash('production-source-replace:'+customerId+':'+input.requestId),old=await store.get('production-source-revision',k);if(old){if(old.projectId!==p.id||old.sourceId!==input.sourceId)error('IDEMPOTENCY_CONFLICT');return dto(p);}const existing=await steps(p);if(active.has(p.id)||['queued','running','completed'].includes(p.state)||existing.some(s=>s.attempts>0||s.requiresReconcile))error('PRODUCTION_BUSY');await store.put('production-source-revision',{id:k,customerId,projectId:p.id,sourceId:input.sourceId,previousSource:p.source??null,previousStory:p.story,previousRevision:p.revision,createdAt:now()});p.story=resolved.text;p.source=resolved.source;p.plan=null;p.state='draft';p.approvedQuoteId=null;p.cancelRequested=false;p.revision++;p.updatedAt=now();for(const step of existing)await putStep({...step,retired:true});for(const [order,kind] of ['analyze','plan'].entries())await putStep({id:stepKey(p.id,kind),projectId:p.id,customerId,stageId:kind,kind,state:'draft',deps:kind==='plan'?['analyze']:[],order,attempts:0});await store.put('production-project',p);return dto(p);};return inTransaction?work():store.transaction(work);}
 async function organize(customerId,input){return store.transaction(async()=>{const p=await owned(customerId,input.id);if(input.action==='rename')p.title=string(input.name,120);else if(['pin','unpin'].includes(input.action))p.pinned=input.action==='pin';else if(['archive','restore'].includes(input.action)){if(input.action==='archive'&&['queued','running'].includes(p.state))error('PRODUCTION_BUSY');p.archived=input.action==='archive';}else error('INVALID_PRODUCTION_INPUT');p.updatedAt=now();await store.put('production-project',p);return dto(p);});}
 async function attachReferences(customerId,{id:projectId,referenceIds}){await references(customerId,referenceIds);return store.transaction(async()=>{const p=await owned(customerId,projectId);if(referenceIds.every(ref=>p.referenceIds?.includes(ref)))return dto(p);if(p.plan||['queued','running','completed'].includes(p.state)||(await steps(p)).some(s=>s.attempts>0))error('PRODUCTION_BUSY');p.referenceIds=[...new Set([...(p.referenceIds??[]),...referenceIds])];p.revision++;p.updatedAt=now();await store.put('production-project',p);return dto(p);});}
 return {create,plan,quote,adoptPlan,replaceSource,attachReferences,async describePlan(customerId,raw){const p=await owned(customerId,raw.id),config=await store.get('production-settings','models');let value=validateProductionPlan(raw.plan);if(models.preparePlan)value=validateProductionPlan(await models.preparePlan(value,{customerId,projectId:p.id}));const descriptors=stagesForPlan(value,{referenceConditioningModelId:models.referenceConditioningModelId,imageEditModelId:models.imageEditModelId??null,voiceChunking:models.voiceChunking===true,cinematicSync:models.cinematicSync===true,finalComposer:models.finalComposer===true});return {modelIds:[...new Set(descriptors.map(s=>s.modelId).filter(Boolean))],bindings:config?.bindings??p.modelBindings??{}};},approve:(c,i)=>approve(c,i),retry:(c,i)=>approve(c,i,true),run,recover,reconcile,cancel,get:async(c,key)=>dto(await owned(c,key)),list:async(c,{archived=false}={})=>(await store.all('production-project')).filter(p=>p.customerId===c&&!p.adminCommissioning&&Boolean(p.archived)===archived).sort((a,b)=>Number(b.pinned===true)-Number(a.pinned===true)||(b.updatedAt??0)-(a.updatedAt??0)).slice(0,200).map(p=>({id:p.id,title:p.title,state:p.state,durationMs:p.durationMs,pinned:p.pinned===true,archived:p.archived===true,createdAt:p.createdAt,updatedAt:p.updatedAt,result:p.result??null})),close(){closed=true;},
  async configure(actor,{bindings={},modelSettings={}}){if(actor?.isAdmin!==true)error('FORBIDDEN');const routes=validateProductionRouting(modelSettings);if(!bindings||typeof bindings!=='object'||Array.isArray(bindings)||Object.keys(bindings).some(k=>!ENGINE_MODEL_CATALOG.some(m=>m.id===k)))error('INVALID_MODEL_ROUTING');for(const [modelId,definitionId] of Object.entries(bindings)){const d=await store.get('engine-definition',definitionId);if(!d||d.modelId!==modelId)error('INVALID_MODEL_ROUTING');}await store.put('production-settings',{id:'models',bindings,modelSettings:routes,updatedAt:now()});return {saved:true};},
  async dispatch(customerId,operation,input={}){if(operation.startsWith('production.source.'))return sources.dispatch(customerId,operation,input);if(operation==='production.organize')return organize(customerId,input);if(operation==='production.create')return create(customerId,input);if(operation==='production.list')return this.list(customerId,input);if(operation==='production.get')return this.get(customerId,input.id);if(operation==='production.plan')return plan(customerId,input);if(operation==='production.quote')return quote(customerId,input);if(operation==='production.approve')return approve(customerId,input);if(operation==='production.retry')return approve(customerId,input,true);if(operation==='production.cancel')return cancel(customerId,input);throw Error('INVALID_INPUT');}
 };
}
