import fs from 'node:fs';
import {URL} from 'node:url';
import {Buffer} from 'node:buffer';
import {setTimeout as wait} from 'node:timers/promises';
import {hash} from './store.mjs';
import {cost} from './film-money.mjs';
import {createFluxRegistryAdapter} from './flux-integration.mjs';
import {createFluxImageAssets} from './flux-image-assets.mjs';
import {createImageQuality} from './image-quality.mjs';
import {createWanModalTransport} from './wan-modal-transport.mjs';
import {createWanVideoAssets} from './wan-video-assets.mjs';
import {prepareWanStoryboard} from './wan-shot-plan.mjs';
import {buildWanRequest} from './wan-prompt.mjs';
import {getWanExecutionProfile} from './wan-execution-profiles.mjs';
import {createAcceleratedWanServices} from './wan-accelerated-integration.mjs';
export const WAN_MANIFEST=Object.freeze(JSON.parse(fs.readFileSync(new URL('./wan/model-manifest.json',import.meta.url),'utf8')));

export function createWanServices(options={}){
 const profile=getWanExecutionProfile(options.executionProfile??'original-quality');
 if(profile.id==='accelerated')return createAcceleratedWanServices(options,{createCoreServices:createWanCoreServices});
 return {...createWanCoreServices(options),executionProfile:'original-quality'};
}
export function createWanCoreServices({store,now=Date.now,allowPaid=false,modelProfile=null,requestFactory=null,planPreparer=null,afterSave=null,onStopped=null,images=createFluxImageAssets({store,now}),quality=createImageQuality({store,assets:images,now}),transport=createWanModalTransport({store,allowPaid}),videos=createWanVideoAssets({store,imageQuality:quality,now})}){
 const manifest=modelProfile?.manifest??WAN_MANIFEST,modelId=manifest.modelId,requestEntity=modelProfile?.requestEntity??'wan-video-request';
 const profile=modelProfile?.profile??{manifest,adapterVersion:'mashhad-wan22-i2v-v1',windowSeconds:5400,validateResources:e=>e.gpu==='RTX-PRO-6000'&&e.cpu>=4&&e.cpu<=8&&e.ramGiB>=128&&e.ramGiB<=256&&e.minVramGiB===96};
 async function requestFor({scope,stage,plan,inputs=[]}){
  if(requestFactory)return requestFactory({scope,stage,plan,inputs});
  if(stage.kind!=='animate')throw Error('INVALID_WAN_STAGE');const shot=plan.shots.find(s=>s.id===stage.subjectId),sourceAssetId=inputs.find(i=>i.stageId==='scene_image:'+stage.subjectId)?.result?.assetIds?.[0];if(!shot||!sourceAssetId)throw Error('WAN_SOURCE_IMAGE_REQUIRED');
  const source=await quality.getAnimationInput({customerId:scope.customerId,projectId:scope.projectId,assetId:sourceAssetId,characterIds:shot.characterIds,includeBytes:true});
  const request=buildWanRequest({scope,shot,plan,sourceAsset:source,seed:plan.seed??42});return {request,source,shot};
 }
 async function save(record,generated){
  const scope=generated?.scope??generated;if(scope?.customerId!==record.customerId||scope.projectId!==record.projectId||(scope.attemptId??scope.requestId)!==record.id||(generated.runId??scope.runId)!==record.runId||generated.modelRevision!==manifest.revision||scope.accountId&&scope.accountId!==record.accountId||scope.engineId&&scope.engineId!==record.definitionId)throw Error('WAN_SCOPE_MISMATCH');
  const bytes=Buffer.isBuffer(generated.mp4Bytes)?generated.mp4Bytes:typeof generated.videoBase64==='string'?Buffer.from(generated.videoBase64,'base64'):null;if(!bytes||bytes.length>64*1024*1024||generated.sha256&&hash(bytes)!==generated.sha256)throw Error('WAN_VIDEO_INVALID');
  const asset=await videos.commit({customerId:record.customerId,projectId:record.projectId,attemptId:record.id,stageId:record.stageId,shotId:record.shotId,sourceAssetId:record.sourceAssetId,bytes,request:{modelId,version:manifest.version,revision:manifest.revision,prompt:record.prompt,settings:record.settings},expectedWidth:record.settings.width,expectedHeight:record.settings.height,expectedFrames:record.settings.num_frames,expectedDurationMs:record.nativeDurationMs,timelineStartMs:record.structured.timelineStartMs,timelineEndMs:record.structured.timelineEndMs});
  if(afterSave)await afterSave({record,saved:asset,generated});
  await store.put(requestEntity,{...record,state:'completed',assetId:asset.assetId,finishedAt:now()});return asset;
 }
 const productionAdapter={version:modelProfile?.adapterVersion??'mashhad-wan-production-v1',metering:'registry_hourly',requestFor,onStopped,preparePlan:planPreparer??(p=>prepareWanStoryboard(p)),
  async estimate({stage,definition,plan}){if(stage.kind!=='animate'||definition?.modelId!==modelId||definition.version!==manifest.version)return {available:false,estimatedMicroUSD:null};try{const shot=plan.shots.find(s=>s.id===stage.subjectId);if(!shot||shot.endMs-shot.startMs>5000||!shot.motionPlan)return {available:false,estimatedMicroUSD:null};return {estimatedMicroUSD:cost(definition.hourMicros,profile.windowSeconds*1000)};}catch{return {available:false,estimatedMicroUSD:null};}},
  async preflight(input){await requestFor(input);},
  async execute({scope,stage,plan,definition,runId,inputs,onProgress,signal}){
   if(signal?.aborted)throw Object.assign(Error('WAN_CANCELLED'),{definitiveNoSpend:true});const {request,source,shot}=await requestFor({scope,stage,plan,inputs});
   const record={id:scope.attemptId,...scope,stageId:stage.stageId,shotId:shot.id,definitionId:definition.id,accountId:definition.accountId,runId,sourceAssetId:request.sourceAssetId,sourceSHA256:request.sourceSHA256,modelId,version:manifest.version,revision:manifest.revision,prompt:request.prompt,structured:request.structured,settings:request.settings,nativeDurationMs:request.nativeDurationMs,fingerprint:request.fingerprint,state:'running',createdAt:now()};await store.put(requestEntity,record);
   let received=false;try{const generated=await transport.generate({definition,runId,requestId:scope.attemptId,scope,approved:true,request:{mode:request.mode,prompt:request.prompt,width:request.settings.width,height:request.settings.height,seed:request.settings.seed,num_frames:request.settings.num_frames,fps:request.settings.fps,reference_images:source?[{assetId:source.assetId,mime:source.mime,sha256:source.sha256,base64:source.bytes.toString('base64')}]:[]},onProgress});received=true;const asset=await save(record,generated);return {...scope,engineId:definition.id,accountId:definition.accountId,runId,billingScope:'registry_hourly',actualMicroUSD:null,result:{assetIds:[asset.assetId]}};}
   catch{await store.put(requestEntity,{...record,state:received?'awaiting_local_commit':'uncertain',error:'WAN_RESULT_UNCONFIRMED'});throw Object.assign(Error('WAN_RESULT_UNCONFIRMED'),{outputRecoveryRequired:received});}
  },
  async waitReady({runId,observe,signal}){const deadline=Date.now()+1800000;while(Date.now()<deadline){if(signal?.aborted)throw Error('WAN_CANCELLED');const r=await observe();if(r.runtime.id!==runId||r.runtime.state==='failed'||r.runtime.cloudStopped)throw Error('WAN_STATE_UNKNOWN');if(r.runtime.state==='running')return;await wait(1000);}throw Error('WAN_START_TIMEOUT');},
  async observeResult({scope,runId}){let record=await store.get(requestEntity,scope.attemptId);if(!record||record.customerId!==scope.customerId||record.projectId!==scope.projectId||record.runId!==runId)throw Error('WAN_RESULT_UNCONFIRMED');const d=await store.get('engine-definition',record.definitionId),history=await store.get('engine-runtime-history',runId);if(!d||!history?.cloudStopped||history.engineId!==d.id||history.accountId!==record.accountId)throw Error('WAN_RESULT_UNCONFIRMED');if(record.state!=='completed'){await save(record,await transport.observeResult({definition:d,runId,requestId:scope.attemptId,scope}));record=await store.get(requestEntity,scope.attemptId);}return {...scope,engineId:d.id,accountId:d.accountId,runId,billingScope:'all_resources',cloudStopped:true,actualMicroUSD:cost(history.hourMicros,Math.max(0,history.stoppedAt-history.startedAt)),result:{assetIds:[record.assetId]}};},
  async cancel({attemptId,customerId,projectId}){const r=await store.get(requestEntity,attemptId);if(r&&r.customerId===customerId&&r.projectId===projectId)await transport.cancelGeneration?.({requestId:attemptId,definitionId:r.definitionId,runId:r.runId});}
 };
 return {registryAdapter:createFluxRegistryAdapter({transport,allowPaid,modelProfile:profile}),productionAdapter,videos,quality,transport};
}
