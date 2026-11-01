import {ENGINE_MODEL_CATALOG} from '../../../shared/engine-catalog.ts';
import {id,hash} from './store.mjs';
import {engineSoftwarePolicy,engineRuntimeDefaults} from './engine-policy.mjs';
import {money,cost} from './film-money.mjs';

const GPUS={'RTX-PRO-6000':96,L40S:48};
const KEY=/^[a-zA-Z0-9_-]{1,100}$/;
const fail=()=>{throw Error('INVALID_ENGINE_CONFIG');};
const integer=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail();return v;};
const text=(v,max=120)=>{if(typeof v!=='string'||!v.trim()||v.length>max||[...v].some(c=>c.charCodeAt(0)<32||c==='<'||c==='>'))fail();return v.trim();};
const pathOK=p=>typeof p==='string'&&p.length<500&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(s=>!s||s==='.'||s==='..');
const live=r=>r&&r.cloudStopped!==true;
const normalizeProgress=p=>p&&Number.isSafeInteger(p.completedBytes)&&Number.isSafeInteger(p.totalBytes)&&p.totalBytes>0?{...p,completed:p.completedBytes,total:p.totalBytes,unit:'bytes'}:p??null;
const safeError='ENGINE_STATE_UNKNOWN';
const safePreparationError=e=>/^(?:FLUX_PREPARATION_FAILED|SPEECH_(?:CODEC_AUTHORIZATION_REQUIRED|COMPONENT_ACCESS_DENIED|COMPONENT_NOT_FOUND|COMPONENT_ACCESS_UNAVAILABLE))$/.test(e??'')?e:null;

/** Trusted adapters are server code only; FLUX is installed behind explicit execution gates.
 * profile() supplies a pinned manifest; inspectFiles/start/observe/stop must be
 * scoped to this account and engine. No HTTP field can enable an adapter.
 */
export function createEngineRegistry({store,now=Date.now,adapter=null,catalog=ENGINE_MODEL_CATALOG,allowPaid=false,licenseOptions={}}){
 const modelFor=e=>catalog.find(m=>m.id===e.modelId);
 const profileFor=e=>adapter?.profile?.(e)??null;
 // Legacy `activated` describes the retired model's weights, not token validity.
 const account=async e=>{const a=await store.get('account',e.accountId);if(!a||a.unlinked)throw Error('NOT_FOUND');return a;};
 const get=async key=>{if(!KEY.test(key||''))throw Error('NOT_FOUND');const e=await store.get('engine-definition',key);if(!e)throw Error('NOT_FOUND');return e;};
 const current=async e=>await store.get('engine-runtime',e.id);
 const persistRuntime=async r=>{await store.put('engine-runtime',r);await store.put('engine-runtime-history',{...r,id:r.runId,engineId:r.engineId});};
 function manifest(e){
  const p=profileFor(e),m=p?.manifest;
  if(!m||m.modelId!==e.modelId||m.version!==e.version||!m.revision||typeof m.revision!=='string'||!Array.isArray(m.files)||!m.files.length)return null;
  if(!m.files.every(f=>pathOK(f.path)&&Number.isSafeInteger(f.size)&&f.size>0&&/^[a-f0-9]{64}$/.test(f.sha256||''))||new Set(m.files.map(f=>f.path)).size!==m.files.length)return null;
  return m;
 }
 const fingerprint=e=>hash(JSON.stringify({id:e.id,accountId:e.accountId,revision:e.revision,model:e.modelId,version:e.version,gpu:e.gpu,cpu:e.cpu,ramGiB:e.ramGiB,minVramGiB:e.minVramGiB,volume:e.volume,path:e.weightPath,manifest:manifest(e)}));
 async function blockers(e){
  const b=[],p=profileFor(e),m=manifest(e);
  if(!modelFor(e)?.enabled&&!p?.installed)b.push('MODEL_DISABLED');
  if(!p||!adapter)b.push('ENGINE_ADAPTER_UNAVAILABLE');
  if(!m)b.push('ENGINE_MANIFEST_REQUIRED');
  if(e.minVramGiB===null||e.minVramGiB>GPUS[e.gpu]||!p?.validateResources?.(e))b.push('RESOURCE_COMPATIBILITY_UNVERIFIED');
  const inspection=await store.get('engine-inspection',e.id);
  if(!inspection?.ready||inspection.fingerprint!==fingerprint(e))b.push('ENGINE_NOT_READY');
  if(p?.requiresDeployment&&!inspection?.deploymentReady)b.push('ENGINE_DEPLOYMENT_REQUIRED');
  if(!allowPaid)b.push('PAID_DISABLED');
  if(p?.paidEnabled===false&&!b.includes('PAID_DISABLED'))b.push('PAID_DISABLED');
  return b;
 }
 function meter(r){
  if(!r)return {state:'stopped',cloudStopped:true,elapsedSeconds:0,estimatedCustomerUSD:0,recordedProviderUSD:null,error:null,requiresReconcile:false};
  const elapsed=Math.max(0,(r.stoppedAt??now())-r.startedAt);
  return {id:r.runId,state:r.state,cloudStopped:r.cloudStopped===true,elapsedSeconds:elapsed/1000,estimatedCustomerUSD:cost(r.hourMicros,Math.floor(elapsed))/1e6,recordedProviderUSD:r.recordedProviderUSD??null,error:r.error??null,requiresReconcile:r.requiresReconcile===true};
 }
 async function dto(e,observedRuntime){
  const m=modelFor(e),b=await blockers(e),inspection=await store.get('engine-inspection',e.id),p=profileFor(e),preparation=await store.get('engine-preparation',e.id);
  const software=engineSoftwarePolicy(e.modelId,manifest(e),licenseOptions);
  return {modelRevision:manifest(e)?.revision??null,softwareVersion:p?.softwareVersion??null,dependencies:software.dependencies,license:software.license,publication:e.publication?{approved:e.publication.approved===true,tested:e.publication.tested===true,revision:e.publication.revision}:null,id:e.id,name:e.name,modelId:e.modelId,modelName:m.name,version:e.version,kind:m.kind,variant:m.variant,accountId:e.accountId,gpu:e.gpu,cpu:e.cpu,ramGiB:e.ramGiB,minVramGiB:e.minVramGiB,volume:e.volume,weightPath:e.weightPath,preparationState:!manifest(e)?'needs_manifest':inspection?.ready&&inspection.fingerprint===fingerprint(e)?'ready':preparation&&!preparation.cloudStopped&&preparation.settingsRevision===e.revision?'preparing':'needs_preparation',deploymentState:inspection?.deploymentReady?'deployed':'unpublished',enabled:m.enabled===true||p?.installed===true,softwareInstalled:p?.installed===true,expectedBytes:p?.expectedBytes??null,preparation:preparation?{status:preparation.status,progress:preparation.progress??null,error:preparation.error??null,cloudStopped:preparation.cloudStopped===true}:null,adapterAvailable:!!p,hourPriceUSD:e.hourMicros/1e6,revision:e.revision,runtime:meter(observedRuntime??await current(e),e),blockers:b};
 }
 async function inspect(e){
  await account(e);const m=manifest(e);
  if(!m||!adapter?.inspectFiles)return dto(e);
  // A storage listing alone is insufficient: require the exact pinned content.
  const result=await adapter.inspectFiles(e,m);
  const ready=result?.accountId===e.accountId&&result?.volume===e.volume&&result?.weightPath===e.weightPath&&result?.revision===m.revision&&m.files.every(f=>result.files?.some(g=>g.path===f.path&&g.size===f.size&&g.sha256===f.sha256&&g.verified===true));
  return store.transaction(async()=>{
   const fresh=await get(e.id);await account(fresh);
   if(fingerprint(fresh)!==fingerprint(e))throw Error('ENGINE_CONFIG_CHANGED');
   await store.put('engine-inspection',{id:e.id,fingerprint:fingerprint(e),ready,deploymentReady:result?.deploymentReady===true,checkedAt:now()});return dto(fresh);
  });
 }
 async function capacity(e,excludeRentalId=null,excludeTestId=null){
  const cap=(await store.get('film-capacity',e.accountId))?.maxConcurrent??1;
  const runtimes=(await store.all('engine-runtime')).filter(r=>r.accountId===e.accountId&&live(r));
  const rentals=(await store.all('rental')).filter(r=>r.accountId===e.accountId&&r.state!=='closed'&&r.id!==excludeRentalId&&!runtimes.some(rt=>rt.rentalId===r.id));
  const jobs=(await store.all('job')).filter(j=>(j.accountId===e.accountId||j.sourceId===e.accountId)&&(!excludeRentalId||j.rentalId!==excludeRentalId)&&j.cloudStopped!==true&&['start','generate','prepare'].includes(j.action)&&(!j.rentalId||!rentals.some(r=>r.id===j.rentalId)&&!runtimes.some(r=>r.rentalId===j.rentalId)));
  const preparations=(await store.all('engine-preparation')).filter(p=>p.accountId===e.accountId&&p.cloudStopped===false);
  const tests=(await store.all('engine-test')).filter(t=>t.accountId===e.accountId&&t.id!==excludeTestId&&t.cloudStopped!==true&&['queued','running','uncertain'].includes(t.status)&&!runtimes.some(r=>r.commandRequestId===t.id));
  if(runtimes.length+rentals.length+jobs.length+preparations.length+tests.length>=cap)throw Error('ENGINE_BUSY');
 }
 async function save(input){
  const allowed=['id','modelId','accountId','name','version','gpu','cpu','ramGiB','minVramGiB','volume','hourPriceUSD'];if(Object.keys(input).some(k=>!allowed.includes(k)))fail();
  const m=catalog.find(x=>x.id===input.modelId);if(!m||!KEY.test(input.accountId||'')||!Object.hasOwn(GPUS,input.gpu))fail();
  const version=input.version==null||input.version===''?m.version:text(input.version,100),volume=input.volume?text(input.volume,100):'mashhad-models-'+input.accountId.slice(0,12);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(volume))fail();
  return store.transaction(async()=>{
   const old=input.id?await get(input.id):null;if(live(old&&await current(old))||old&&(await store.get('engine-preparation',old.id))?.cloudStopped===false)throw Error('ENGINE_BUSY');
   if(old&&(await store.all('engine-test')).some(t=>t.engineId===old.id&&t.cloudStopped!==true))throw Error('ENGINE_BUSY');
   const engineId=old?.id??id();const e={id:engineId,name:text(input.name),modelId:m.id,accountId:input.accountId,version,gpu:input.gpu,cpu:integer(input.cpu,1,64),ramGiB:integer(input.ramGiB,1,1024),minVramGiB:input.minVramGiB==null?null:integer(input.minVramGiB,1,192),volume,weightPath:`models/${m.id}/${engineId}`,hourMicros:money(input.hourPriceUSD),revision:(old?.revision??0)+1};
   await account(e);await store.put('engine-definition',e);await store.delete('engine-inspection',e.id);await store.audit('engine_definition_saved',e.id);return dto(e);
  });
 }
 async function quote(e,action){
  if(!['start','prepare'].includes(action))fail();await account(e);
  if(action==='prepare'&&adapter?.prepareQuote&&profileFor(e)){
   const planned=await adapter.prepareQuote(e),blockers=[...(planned.blockers??[])];if(!allowPaid||profileFor(e)?.paidEnabled===false)blockers.push('PAID_DISABLED');
   const q={id:id(),engineId:e.id,action,expiresAt:now()+300000,settingsRevision:e.revision,fingerprint:fingerprint(e),providerQuoteId:planned.id,estimate:planned.estimate,expectedBytes:planned.expectedBytes,missingBytes:planned.missingBytes,fileCount:planned.fileCount,missingFiles:planned.missingFiles?.map(f=>({path:f.path,size:f.size})),dispatchAvailable:planned.dispatchAvailable===true&&!blockers.length,blockers};
   await store.put('engine-quote',q);const {fingerprint:ignored,providerQuoteId:ignored2,...visible}=q;void ignored;void ignored2;return visible;
  }
  const b=await blockers(e);if(action==='prepare')b.push('PREPARATION_ADAPTER_UNAVAILABLE');
  const q={id:id(),engineId:e.id,action,expiresAt:now()+300000,settingsRevision:e.revision,fingerprint:fingerprint(e),estimate:adapter?.estimateStart&&action==='start'?adapter.estimateStart(e):{resourceWindowUSD:null,expectedSeconds:null,windowSeconds:null,customerRateUSD:e.hourMicros/1e6,recordedUSD:null,note:'لا توجد نافذة موارد معتمدة لهذا المحرك بعد. التقدير ليس سقف فاتورة.'},dispatchAvailable:!b.length,blockers:b};
  await store.put('engine-quote',q);const {fingerprint:unused,...publicQuote}=q;void unused;return publicQuote;
 }
 async function applyObservation(e,r,observation,{startFinished=false,stopFinished=false}={}){
  // Ignore stale observations; provider confirmation alone ends the meter.
  return store.transaction(async()=>{
   const latest=await current(e);if(latest?.runId!==r.runId||!live(latest))return dto(e);
   if(startFinished||observation?.startSettled===true&&observation?.admissionClosed===true)latest.startInFlight=false;
   if(stopFinished){latest.stopInFlight=false;latest.stopNeedsFollowUp=!!r.startInFlight;}
   // Empty containers are not proof of stop while an admission/start can still
   // allocate. The adapter must confirm that this run's admission is closed.
   if(!latest.startInFlight&&observation?.admissionClosed===true&&observation?.cloudStopped===true&&observation?.activeTasks===0){latest.state='stopped';latest.cloudStopped=true;latest.stoppedAt=now();latest.requiresReconcile=false;latest.error=null;}
   else if(latest.stopRequestedAt==null&&observation?.ready===true){latest.state='running';latest.requiresReconcile=false;latest.error=null;}
   if(Number.isFinite(observation?.recordedProviderUSD)&&observation.recordedProviderUSD>=0)latest.recordedProviderUSD=observation.recordedProviderUSD;
   await persistRuntime(latest);return dto(e);
  });
 }
 async function markUncertain(e,r,{startFinished=false,stopFinished=false}={}){
  return store.transaction(async()=>{const latest=await current(e);if(latest?.runId===r.runId&&live(latest)){if(startFinished)latest.startInFlight=false;if(stopFinished){latest.stopInFlight=false;latest.stopNeedsFollowUp=!!r.startInFlight;}latest.state='failed';latest.error=safeError;latest.requiresReconcile=true;await persistRuntime(latest);}return dto(e);});
 }
 async function start(e,input,{rentalId=null}={}){
  if(input.approved!==true)throw Error('ENGINE_APPROVAL_REQUIRED');if(!KEY.test(input.requestId||''))fail();
  const requestKey=hash('engine-start:'+input.requestId),binding=hash(JSON.stringify([e.id,input.quoteId]));
  const reservation=await store.transaction(async()=>{
   const previous=await store.get('engine-command',requestKey);if(previous){if(previous.binding!==binding)throw Error('IDEMPOTENCY_CONFLICT');const r=await store.get('engine-runtime-history',previous.runtimeId);if(!r)throw Error('ENGINE_STATE_UNKNOWN');return {prior:true,r};}
   const fresh=await get(e.id);e=fresh;await account(e);
   const q=await store.get('engine-quote',input.quoteId);if(!q||q.usedBy||q.engineId!==e.id||q.action!=='start'||q.expiresAt<=now())throw Error('ENGINE_QUOTE_EXPIRED');
   if(q.settingsRevision!==e.revision||q.fingerprint!==fingerprint(e))throw Error('ENGINE_CONFIG_CHANGED');
   const b=await blockers(e);if(b.length)throw Error(b.includes('ENGINE_ADAPTER_UNAVAILABLE')?'ENGINE_ADAPTER_UNAVAILABLE':'ENGINE_NOT_READY');
   if(live(await current(e)))throw Error('ENGINE_BUSY');if(rentalId){const rental=await store.get('rental',rentalId),slot=rental?await store.get('film-slot',rental.engineSlotId):null;if(!rental||rental.accountId!==e.accountId||slot?.genericEngineId!==e.id||!['reserved','preparing'].includes(rental.state))throw Error('FORBIDDEN');}const test=await store.get('engine-test',input.requestId);await capacity(e,rentalId,test?.engineId===e.id?test.id:null);
   const r={id:e.id,runId:id(),engineId:e.id,accountId:e.accountId,rentalId,commandRequestId:input.requestId,state:'starting',startInFlight:true,cloudStopped:false,startedAt:now(),hourMicros:e.hourMicros,requiresReconcile:true,error:null};
   q.usedBy=requestKey;await store.put('engine-quote',q);await persistRuntime(r);await store.put('engine-command',{id:requestKey,binding,runtimeId:r.runId});await store.audit('engine_start_requested',e.id);return {prior:false,r};
  });
  if(reservation.prior)return dto(e,reservation.r);
  try{return await applyObservation(e,reservation.r,await adapter.start(e,reservation.r),{startFinished:true});}catch{return markUncertain(e,reservation.r,{startFinished:true});}
 }
 async function stop(e,input){
  if(input.approved!==true)throw Error('ENGINE_APPROVAL_REQUIRED');
  const preparation=await store.get('engine-preparation',e.id);if(preparation?.cloudStopped===false){if(!preparation.operationId||!adapter?.stopPreparation)throw Error('ENGINE_STATE_UNKNOWN');const result=await adapter.stopPreparation(e,preparation.operationId);await store.transaction(async()=>{await store.put('engine-preparation',{...preparation,status:result.status??'uncertain',cloudStopped:result.cloudStopped===true});});if(result.cloudStopped!==true)throw Error('ENGINE_STATE_UNKNOWN');}
  const result=await store.transaction(async()=>{const r=await current(e);if(input.expectedRunId&&r?.runId!==input.expectedRunId)throw Error('ENGINE_STATE_UNKNOWN');if(!live(r)||r.stopInFlight||r.stopRequestedAt!=null&&!((r.stopNeedsFollowUp||r.requiresReconcile)&&!r.startInFlight))return {dispatch:false,r};r.state='stopping';r.stopRequestedAt=now();r.stopInFlight=true;r.stopNeedsFollowUp=false;await persistRuntime(r);await store.audit('engine_stop_requested',e.id);return {dispatch:true,r};});
  if(!result.dispatch)return dto(e);
  if(!adapter?.stop)return markUncertain(e,result.r,{stopFinished:true});
  try{return await applyObservation(e,result.r,await adapter.stop(e,result.r),{stopFinished:true});}catch{return markUncertain(e,result.r,{stopFinished:true});}
 }
 async function status(e){const r=await current(e);if(!live(r)||!adapter?.observe)return dto(e);try{return await applyObservation(e,r,await adapter.observe(e,r));}catch{return markUncertain(e,r);}}
 async function prepare(e,input){
  if(input.approved!==true)throw Error('ENGINE_APPROVAL_REQUIRED');if(!allowPaid||profileFor(e)?.paidEnabled===false)throw Error('PAID_DISABLED');if(!adapter?.prepare)throw Error('ENGINE_ADAPTER_UNAVAILABLE');if(!KEY.test(input.requestId||''))fail();
  const key=hash('engine-prepare:'+input.requestId),binding=hash(JSON.stringify([e.id,input.quoteId]));
  const claim=await store.transaction(async()=>{const previous=await store.get('engine-command',key);if(previous){if(previous.binding!==binding)throw Error('IDEMPOTENCY_CONFLICT');return {prior:true};}
   const fresh=await get(e.id),q=await store.get('engine-quote',input.quoteId);if(!q||q.usedBy||q.engineId!==e.id||q.action!=='prepare'||q.expiresAt<=now())throw Error('ENGINE_QUOTE_EXPIRED');if(fresh.revision!==e.revision||q.fingerprint!==fingerprint(fresh)||!q.dispatchAvailable)throw Error('ENGINE_CONFIG_CHANGED');await account(fresh);await capacity(fresh);if((await store.get('engine-preparation',e.id))?.cloudStopped===false)throw Error('ENGINE_BUSY');
   q.usedBy=key;await store.put('engine-quote',q);await store.put('engine-command',{id:key,binding,engineId:e.id});await store.put('engine-preparation',{id:e.id,accountId:e.accountId,requestId:input.requestId,settingsRevision:e.revision,status:'dispatching',cloudStopped:false,createdAt:now()});return {prior:false,q};
  });if(claim.prior)return dto(e);
  try{const result=await adapter.prepare(e,{quoteId:claim.q.providerQuoteId,requestId:input.requestId,approved:true});await store.transaction(async()=>{const saved=await store.get('engine-preparation',e.id);await store.put('engine-preparation',{...saved,operationId:result.operationId,status:result.status,cloudStopped:result.cloudStopped===true,progress:normalizeProgress(result.progress),error:safePreparationError(result.error)});});}catch(cause){await store.transaction(async()=>{const saved=await store.get('engine-preparation',e.id);await store.put('engine-preparation',{...saved,...(cause.operationId?{operationId:cause.operationId}:{}),status:'uncertain',cloudStopped:false,error:'ENGINE_STATE_UNKNOWN'});});}return dto(e);
 }
 async function preparationStatus(e){const preparation=await store.get('engine-preparation',e.id);if(!preparation)return;if(preparation.cloudStopped){if(preparation.status==='completed'){const i=await store.get('engine-inspection',e.id);if(!i?.ready||i.fingerprint!==fingerprint(e))try{await inspect(e);}catch{/* Read failed; never restart a completed preparation. */}}return;}if(!preparation.operationId||!adapter?.observePreparation)return;
  try{const result=await adapter.observePreparation(e,preparation.operationId);await store.transaction(async()=>{const fresh=await get(e.id);if(fresh.revision!==preparation.settingsRevision)throw Error('ENGINE_CONFIG_CHANGED');await store.put('engine-preparation',{...preparation,status:result.status,cloudStopped:result.cloudStopped===true,progress:normalizeProgress(result.progress),error:safePreparationError(result.error)});});if(result.status==='completed'&&result.cloudStopped===true)await inspect(e);}catch{/* Keep the same uncertain operation; status never resubmits preparation. */}
 }
 async function describe(key){const e=await get(key),a=await account(e),p=profileFor(e),m=manifest(e),inspection=await store.get('engine-inspection',e.id),software=engineSoftwarePolicy(e.modelId,m,licenseOptions);return {...e,fingerprint:hash(JSON.stringify({configuration:fingerprint(e),accountWorkspace:a.workspace??null,credentialsDigest:hash(JSON.stringify(a.credentials??null))})),manifestRevision:m?.revision??null,manifest:m,softwareVersion:p?.softwareVersion??null,...software,inspection:{filesReady:inspection?.ready===true&&inspection.fingerprint===fingerprint(e),environmentReady:inspection?.deploymentReady===true&&inspection.fingerprint===fingerprint(e)},runtimeStopped:!live(await current(e))&&(await store.get('engine-preparation',e.id))?.cloudStopped!==false,profile:p};}
 return {describe,async startRental(key,input,rentalId){return start(await get(key),input,{rentalId});},async dispatch(actor,operation,input={}){
  if(actor?.isAdmin!==true)throw Error('FORBIDDEN');
  if(operation==='admin.engine.models')return catalog.map(m=>({...m,runtimeProfile:{...engineRuntimeDefaults(m.id),version:m.version}}));
  if(operation==='admin.engine.list')return Promise.all((await store.all('engine-definition')).map(e=>dto(e)));
  if(operation==='admin.engine.save')return save(input);
  const e=await get(input.id);
  if(operation==='admin.engine.inspect')return inspect(e);
  if(operation==='admin.engine.quote')return quote(e,input.action);
  if(operation==='admin.engine.start')return start(e,input);
  if(operation==='admin.engine.prepare')return prepare(e,input);
  if(operation==='admin.engine.stop')return stop(e,input);
  if(operation==='admin.engine.status'){await preparationStatus(e);return status(e);}
  throw Error('INVALID_INPUT');
 }};
}
