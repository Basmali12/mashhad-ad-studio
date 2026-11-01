import fs from 'node:fs';
import {URL} from 'node:url';
import {hash} from './store.mjs';
import {createFluxRegistryAdapter,createFluxProductionAdapter} from './flux-integration.mjs';
import {createFluxImageAssets} from './flux-image-assets.mjs';
import {createQwenModalTransport} from './qwen-modal-transport.mjs';
import {createImageQuality} from './image-quality.mjs';
import {QWEN_MODEL_ID,buildQwenRequest} from './qwen-prompt.mjs';

export const QWEN_MANIFEST=Object.freeze(JSON.parse(fs.readFileSync(new URL('./qwen/model-manifest.json',import.meta.url),'utf8')));
/** Trusted server router; neither a client profile nor a model name can select credentials. */
export function createImageAdapterRouter(adapters){
 const choose=e=>adapters.find(a=>a.profile(e));
 const methods=['inspectFiles','prepareQuote','prepare','observePreparation','stopPreparation','estimateStart','start','observe','stop'];
 return {profile:e=>choose(e)?.profile(e)??null,...Object.fromEntries(methods.map(method=>[method,(e,...args)=>{const a=choose(e);if(!a?.[method])throw Error('ENGINE_ADAPTER_UNAVAILABLE');return a[method](e,...args);}]))};
}
export function createQwenServices({store,allowPaid=false,transport=createQwenModalTransport({store,allowPaid}),now=Date.now,images=createFluxImageAssets({store,now,modelProfile:{modelId:QWEN_MODEL_ID,version:QWEN_MANIFEST.version,revision:QWEN_MANIFEST.revision}}),quality=createImageQuality({store,assets:images,now})}){
 const modelProfile={manifest:QWEN_MANIFEST,requestEntity:'qwen-image-request',adapterVersion:'mashhad-qwen-edit-2511-v1',windowSeconds:5400,
  // Deliberately conservative and unmeasured. No implicit quantization or fallback to a smaller GPU.
  validateResources:e=>e.gpu==='RTX-PRO-6000'&&e.cpu>=4&&e.cpu<=8&&e.ramGiB>=128&&e.ramGiB<=256&&e.minVramGiB>=96&&e.minVramGiB<=96};
 async function requestFor({scope,stage,plan,inputs=[]}){
  const character=stage.kind==='character_image'?plan.characters.find(c=>c.id===stage.subjectId):null,shot=stage.kind==='scene_image'?plan.shots.find(s=>s.id===stage.subjectId):null;
  if(!character&&!shot)throw Error('INVALID_QWEN_STAGE');
  const characters=character?[{...character,angle:character.angles[stage.angleIndex??0]}]:plan.characters.filter(c=>shot.characterIds.includes(c.id));
  const referenceIds=[],referenceBindings=[];
  const add=(assetId,characterId=null)=>{if(!assetId)return;if(!referenceIds.includes(assetId))referenceIds.push(assetId);if(!referenceBindings.some(r=>r.assetId===assetId&&r.characterId===characterId))referenceBindings.push({assetId,characterId});};
  for(const c of characters){
   const approved=await quality.selectCharacterReferences({customerId:scope.customerId,projectId:scope.projectId,characterId:c.id});
   const primary=(approved.find(r=>['mainface','front'].includes(r.angle))??approved[0])?.assetId??c.referenceIds[0]??inputs.find(i=>i.stageId==='character_image:'+c.id+':0')?.result?.assetIds?.[0];
   if(!primary)throw Error('QWEN_IDENTITY_REFERENCE_REQUIRED');add(primary,c.id);
  }
  for(const r of character?.referenceIds??shot?.referenceIds??[])add(r,character?.id??null);
  if(!referenceIds.length||referenceIds.length>3)throw Error('QWEN_REFERENCE_CAPACITY');
  const angle=character?.angles[stage.angleIndex??0]??null;
  const request=buildQwenRequest({scope,characters,referenceIds,referenceBindings,orientation:plan.orientation,seed:plan.seed??42,
   scene:{description:(shot?.motionPlan?shot.prompt+' Opening still image only: '+shot.motionPlan.start+'. Show the state before movement begins.':shot?.prompt)??`Create the ${angle} reference view of the same character.`,place:shot?.location??character?.environment??'neutral reference studio',time:shot?.time,era:shot?.era,lighting:shot?.lighting,camera:[shot?.framing,shot?.cameraAngle??shot?.cameraMotion??angle].filter(Boolean).join('; ')||'front portrait',style:shot?.visualStyle??character?.visualStyle??plan.visualStyle,action:shot?.motionPlan?.start??shot?.characterMotion??character?.pose??'natural reference pose',characterEdits:shot?.characterEdits??[]},allowText:shot?.allowText===true,requestedText:shot?.requestedText??null});
  const references=[];for(const assetId of request.referenceIds){
   const loaded=await images.loadReference({customerId:scope.customerId,projectId:scope.projectId,assetId}),row=await store.get('production-asset',assetId),review=await quality.get({customerId:scope.customerId,projectId:scope.projectId,assetId});
   if(review?.status==='failed')throw Error('IMAGE_QUALITY_FAILED');
   for(const binding of referenceBindings.filter(r=>r.assetId===assetId&&r.characterId))if(row?.characterId&&row.characterId!==binding.characterId||row?.shotId&&!plan.shots.find(s=>s.id===row.shotId)?.characterIds.includes(binding.characterId))throw Error('QWEN_IDENTITY_REFERENCE_MISMATCH');
   references.push({assetId,mime:loaded.mime,bytes:loaded.bytes,sha256:hash(loaded.bytes)});
  }
  return {request,references,character,shot,angle};
 }
 const productionAdapter=createFluxProductionAdapter({store,transport,images,now,modelProfile,requestFactory:requestFor,afterSave:async({record,saved})=>quality.assess({customerId:record.customerId,projectId:record.projectId,assetId:saved.assetId,expectedWidth:record.settings.width,expectedHeight:record.settings.height,requirements:{allowText:record.structured.allowText,referenceBindings:record.structured.referenceBindings}})});
 return {registryAdapter:createFluxRegistryAdapter({transport,allowPaid,modelProfile}),productionAdapter,images,quality,transport};
}
