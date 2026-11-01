import fs from 'node:fs';
import {URL} from 'node:url';
import {Buffer} from 'node:buffer';
import {setTimeout} from 'node:timers';
import {hash} from './store.mjs';
import {cost} from './film-money.mjs';
import {GPUS,PRICING} from './config.mjs';
import {buildFluxRequest} from './flux-prompt.mjs';
import {createFluxModalTransport} from './flux-modal-transport.mjs';
import {createFluxImageAssets} from './flux-image-assets.mjs';

export const FLUX_MANIFEST=Object.freeze(JSON.parse(fs.readFileSync(new URL('./flux/model-manifest.json',import.meta.url),'utf8')));
export const FLUX_MANIFEST_DIGEST=hash(JSON.stringify(FLUX_MANIFEST.files.map(({path,size,sha256})=>({path,size,sha256}))));
/** Pinned software profile. Readiness/paid authority remain separate facts. */
export function createFluxRegistryAdapter({transport,allowPaid=false,modelProfile=null}){
 const manifest=modelProfile?.manifest??FLUX_MANIFEST;
 const profile=definition=>definition.modelId===manifest.modelId&&definition.version===manifest.version?{
  installed:true,requiresDeployment:true,paidEnabled:allowPaid,softwareVersion:modelProfile?.adapterVersion??'mashhad-flux-adapter-v1',manifest,
  expectedBytes:manifest.totalBytes,resourcesVerified:false,
  validateResources:modelProfile?.validateResources??(e=>['L40S','RTX-PRO-6000'].includes(e.gpu)&&e.cpu>=4&&e.cpu<=8&&e.ramGiB>=32&&e.ramGiB<=128&&e.minVramGiB>=24&&e.minVramGiB<=(e.gpu==='L40S'?48:96)),
 }:null;
 const requireProfile=e=>{const p=profile(e);if(!p)throw Error('FLUX_PROFILE_MISMATCH');return p;};
 return {profile,async inspectFiles(e){const p=requireProfile(e);const r=await transport.inspect({definition:e,profile:p});if(r?.accountId!==e.accountId||r.volume!==e.volume||r.weightPath!==e.weightPath||r.revision!==p.manifest.revision)return {files:[]};return r;},
  async prepareQuote(e){return transport.prepareQuote({definition:e,profile:requireProfile(e)});},
  async prepare(e,{quoteId,requestId,approved}){return transport.prepare({definition:e,profile:requireProfile(e),quoteId,requestId,approved});},
  async observePreparation(e,operationId){return transport.observePreparation({definition:e,operationId,profile:requireProfile(e)});},
  async stopPreparation(e,operationId){return transport.cancelPreparation({definition:e,operationId,approved:true});},
  estimateStart(e){const seconds=modelProfile?.windowSeconds??3000;return {resourceWindowUSD:(GPUS[e.gpu].rate+e.cpu*PRICING.cpu+e.ramGiB*PRICING.ram)*seconds,windowSeconds:seconds,expectedSeconds:null,customerRateUSD:e.hourMicros/1e6,recordedUSD:null,note:'نافذة موارد تحفظية تشمل الإقلاع والاستدلال والخمول، وليست زمناً مقاساً أو سقف فاتورة. البناء والتخزين والشبكة إضافية عند انطباقها.'};},
  async start(e,r){const output=await transport.start({definition:e,profile:requireProfile(e),runId:r.runId,requestId:r.runId,approved:true});return observation(output,e,r);},
  async observe(e,r){return observation(await transport.observe({definition:e,runId:r.runId}),e,r);},
  async stop(e,r){return observation(await transport.stop({definition:e,runId:r.runId,approved:true}),e,r);}
 };
}
export function createFluxServices({store,allowPaid=false,transport=createFluxModalTransport({store,allowPaid}),images=createFluxImageAssets({store}),now=Date.now}){
 return {registryAdapter:createFluxRegistryAdapter({transport,allowPaid}),productionAdapter:createFluxProductionAdapter({store,transport,images,now}),images,transport};
}
function observation(value,e,r){
 if(value?.accountId!==e.accountId||value?.engineId!==e.id||value?.runId!==r.runId)throw Error('FLUX_SCOPE_MISMATCH');
 return {ready:value.ready===true,cloudStopped:value.cloudStopped===true,activeTasks:value.activeTasks,admissionClosed:value.admissionClosed===true,startSettled:value.startSettled===true,recordedProviderUSD:value.recordedProviderUSD??null};
}

/** Image identity references are actual owned files, not just prompt labels. */
export function createFluxProductionAdapter({store,transport,images,now=Date.now,modelProfile=null,requestFactory=null,afterSave=null}){
 const manifest=modelProfile?.manifest??FLUX_MANIFEST,modelId=manifest.modelId,requestEntity=modelProfile?.requestEntity??'flux-image-request';
 async function saveGenerated(record,generated){
  const scope=generated?.scope??generated,runId=generated?.runId??scope?.runId;
  if(scope?.customerId!==record.customerId||scope.projectId!==record.projectId||(scope.attemptId??scope.requestId)!==record.id||runId!==record.runId||generated.modelRevision!==manifest.revision||scope.engineId&&scope.engineId!==record.definitionId||scope.accountId&&scope.accountId!==record.accountId)throw Error('FLUX_SCOPE_MISMATCH');
  const bytes=Buffer.isBuffer(generated.imageBytes)?generated.imageBytes:typeof generated.imageBase64==='string'?Buffer.from(generated.imageBase64,'base64'):null;if(!bytes||bytes.length>4000000||generated.sha256&&generated.sha256!==hash(bytes))throw Error('FLUX_IMAGE_OUTPUT_INVALID');
  const saved=await images.commit({customerId:record.customerId,projectId:record.projectId,attemptId:record.id,stageId:record.stageId,...(record.characterId?{characterId:record.characterId,angle:record.angle}:{}),...(record.shotId?{shotId:record.shotId}:{}),bytes,request:{modelId:modelId,modelVersion:manifest.version,revision:manifest.revision,prompt:record.prompt,settings:record.settings,referenceIds:record.referenceIds},expectedWidth:record.settings.width,expectedHeight:record.settings.height});
  if(afterSave)await afterSave({record,saved});
  await store.put(requestEntity,{...record,state:'completed',assetId:saved.assetId,finishedAt:now()});return saved;
 }
 async function requestFor({scope,stage,plan,inputs}){
  if(requestFactory)return requestFactory({scope,stage,plan,inputs});
  const character=stage.kind==='character_image'?plan.characters.find(c=>c.id===stage.subjectId):null,shot=stage.kind==='scene_image'?plan.shots.find(s=>s.id===stage.subjectId):null;
  if(!character&&!shot)throw Error('INVALID_FLUX_STAGE');
  const referenceIds=[];const add=id=>{if(id&&!referenceIds.includes(id))referenceIds.push(id);};
  if(character){for(const r of character.referenceIds)add(r);for(const dep of inputs??[])if(dep.stageId.startsWith('character_image:'))for(const r of dep.result?.assetIds??[])add(r);}
  else {
   for(const r of shot.referenceIds)add(r);
   // One primary identity per visible character first; additional camera
   // references never silently replace a character's identity reference.
   for(const characterId of shot.characterIds){const rows=(await store.all('production-character-reference')).filter(r=>r.projectId===scope.projectId&&r.customerId===scope.customerId&&r.characterId===characterId);const primary=rows.find(r=>['mainface','front','face'].includes(r.angle))??rows[0],dependency=(inputs??[]).find(d=>d.stageId==='character_image:'+characterId+':0')??(inputs??[]).find(d=>d.stageId.startsWith('character_image:'+characterId+':'));add(primary?.assetId??dependency?.result?.assetIds?.[0]);}
  }
  if(referenceIds.length>4)throw Error('FLUX_TOO_MANY_REFERENCES');
  if(shot?.characterIds.length&&shot.characterIds.some(c=>!(inputs??[]).some(i=>i.stageId.startsWith('character_image:'+c+':')&&i.result?.assetIds?.length)))throw Error('FLUX_CHARACTER_REFERENCE_REQUIRED');
  const angle=character?.angles[stage.angleIndex??0]??null;
  const sceneDescription=shot?[shot.prompt,...plan.characters.filter(c=>shot.characterIds.includes(c.id)).map(c=>`${c.name}: ${c.description}; face ${c.face}; body ${c.body}; outfit ${c.wardrobe}; props ${c.props.map(p=>p.description).join(', ')}.`)].join('\n'):null;
  if(!['portrait','landscape'].includes(plan.orientation))throw Error('FLUX_ORIENTATION_REQUIRED');
  const request=buildFluxRequest({scope,subject:character?{...character,description:[character.description,character.ageStage].filter(Boolean).join('. '),angle}:null,scene:{place:shot?.location??character?.environment??'Character reference studio',description:sceneDescription,time:shot?.time??null,era:shot?.era??null},camera:{angle:shot?.cameraAngle??shot?.cameraMotion??angle,framing:shot?.framing??(character&&/body/i.test(angle??'')?'full body':character?'portrait':null),lighting:shot?.lighting??'Cinematic lighting appropriate to the specified place and time'},style:shot?.visualStyle??character?.visualStyle??plan.visualStyle??'Photorealistic cinematic photography',expression:character?.expression??null,pose:shot?.motionPlan?.start??shot?.characterMotion??character?.pose??null,orientation:plan.orientation,referenceIds,seed:plan.seed??42,allowText:shot?.allowText===true,requestedText:shot?.requestedText??null});
  const references=[];for(const ref of request.referenceIds){const loaded=await images.loadReference({customerId:scope.customerId,projectId:scope.projectId,assetId:ref});references.push({assetId:ref,mime:loaded.mime??loaded.metadata?.mime,bytes:loaded.bytes,sha256:hash(loaded.bytes)});}
  return {request,references,character,shot,angle};
 }
 return {version:modelProfile?.adapterVersion??'mashhad-flux-production-v1',metering:'registry_hourly',async estimate({stage,definition,plan}){
  if(!definition||definition.modelId!==modelId||definition.version!==manifest.version||!['character_image','scene_image'].includes(stage.kind))return {available:false,estimatedMicroUSD:null};
  if(!['portrait','landscape'].includes(plan?.orientation))return {available:false,estimatedMicroUSD:null};
  // Conservative startup/inference/teardown window, not a measured prediction
  // or supplier invoice. Final customer usage comes from confirmed-stop meter.
  return {estimatedMicroUSD:cost(definition.hourMicros,(modelProfile?.windowSeconds??3000)*1000)};
 },async preflight({scope,stage,plan,inputs}){await requestFor({scope,stage,plan,inputs});},async execute({scope,stage,plan,definition,runId,inputs,onProgress,signal}){
  if(signal?.aborted)throw Object.assign(Error('FLUX_CANCELLED'),{definitiveNoSpend:true});
  const {request,references,character,shot,angle}=await requestFor({scope,stage,plan,inputs});
  const privateRequest={id:scope.attemptId,customerId:scope.customerId,projectId:scope.projectId,stageId:stage.stageId,definitionId:definition.id,accountId:definition.accountId,runId,modelId:modelId,modelVersion:manifest.version,modelRevision:manifest.revision,prompt:request.prompt,structured:request.structured,settings:request.settings,referenceIds:request.referenceIds,fingerprint:request.fingerprint,...(character?{characterId:character.id,angle}:{}),...(shot?{shotId:shot.id}:{}),state:'running',createdAt:now()};
  await store.put(requestEntity,privateRequest);
  let receivedOutput=false;try{
   const generated=await transport.generate({definition,runId,requestId:scope.attemptId,approved:true,scope,request:{mode:request.mode,prompt:request.prompt,width:request.settings.width,height:request.settings.height,seed:request.settings.seed,reference_images:references.map(r=>({assetId:r.assetId,mime:r.mime,sha256:r.sha256,base64:r.bytes.toString('base64')}))},onProgress});
   receivedOutput=true;
   const saved=await saveGenerated(privateRequest,generated);
   return {...scope,engineId:definition.id,accountId:definition.accountId,runId,billingScope:'registry_hourly',actualMicroUSD:null,result:{assetIds:[saved.assetId]}};
  }catch(cause){const pending=receivedOutput&&(/FLUX_IMAGE_PREVIEW_/.test(cause.message)||['EACCES','EPERM','ENOSPC','EBUSY'].includes(cause.code));await store.put(requestEntity,{...privateRequest,state:pending?'awaiting_local_commit':'uncertain',error:'FLUX_IMAGE_EXECUTION_UNCONFIRMED',finishedAt:now()});const e=Error('FLUX_IMAGE_EXECUTION_UNCONFIRMED');e.outputRecoveryRequired=pending;throw e;}
 },async waitReady({runId,observe,signal}){const deadline=Date.now()+900000;while(Date.now()<deadline){if(signal?.aborted)throw Error('FLUX_CANCELLED');const observed=await observe();if(observed.runtime.id!==runId||observed.runtime.state==='failed'||observed.runtime.cloudStopped)throw Error('FLUX_STATE_UNKNOWN');if(observed.runtime.state==='running')return;await new Promise(resolve=>setTimeout(resolve,1000));}throw Error('FLUX_START_TIMEOUT');},async cancel({attemptId,customerId,projectId}){const r=await store.get(requestEntity,attemptId);if(!r||r.customerId!==customerId||r.projectId!==projectId)return;await transport.cancelGeneration?.({requestId:attemptId,definitionId:r.definitionId,runId:r.runId});},async observeResult({scope,runId}){
  let record=await store.get(requestEntity,scope.attemptId);if(!record||record.customerId!==scope.customerId||record.projectId!==scope.projectId||record.runId!==runId)throw Error('FLUX_IMAGE_EXECUTION_UNCONFIRMED');
  const d=await store.get('engine-definition',record.definitionId),history=await store.get('engine-runtime-history',runId);if(!d||!history?.cloudStopped||history.accountId!==record.accountId||history.engineId!==d.id)throw Error('FLUX_IMAGE_EXECUTION_UNCONFIRMED');
  if(record.state!=='completed'){const generated=await transport.observeResult({definition:d,runId,requestId:scope.attemptId,scope});await saveGenerated(record,generated);record=await store.get(requestEntity,scope.attemptId);}
  return {...scope,engineId:d.id,accountId:d.accountId,runId,billingScope:'all_resources',cloudStopped:true,actualMicroUSD:cost(history.hourMicros,Math.max(0,history.stoppedAt-history.startedAt)),result:{assetIds:[record.assetId]}};
 },requestFor};
}
