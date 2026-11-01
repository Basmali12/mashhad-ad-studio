import fs from 'node:fs';
import {URL} from 'node:url';
import {createVideoComparisonHooks} from './video-comparison-hooks.mjs';
import {createWanServices} from './wan-integration.mjs';
import {createFluxImageAssets} from './flux-image-assets.mjs';
import {createImageQuality} from './image-quality.mjs';
import {createWanVideoAssets} from './wan-video-assets.mjs';
import {createHunyuanModalTransport} from './hunyuan-modal-transport.mjs';
import {createVideoComparisons} from './video-comparison.mjs';
import {prepareWanStoryboard} from './wan-shot-plan.mjs';
import {buildHunyuanRequest,HUNYUAN_MODEL_ID} from './hunyuan-prompt.mjs';
export const HUNYUAN_MANIFEST=Object.freeze(JSON.parse(fs.readFileSync(new URL('./hunyuan/model-manifest.json',import.meta.url),'utf8')));

/** Separate original-model profile; no implicit Wan fallback, external API or quantization. */
export function createHunyuanServices({store,now=Date.now,allowPaid=false,licenseAccepted=false,images=createFluxImageAssets({store,now}),quality=createImageQuality({store,assets:images,now}),comparisons=createVideoComparisons({store,now}),transport=createHunyuanModalTransport({store,allowPaid,licenseAccepted}),videos=createWanVideoAssets({store,now,imageQuality:quality,modelProfile:{modelId:HUNYUAN_MODEL_ID,version:HUNYUAN_MANIFEST.version,revision:HUNYUAN_MANIFEST.revision,fps:24,maxFrames:121}})}){
 const adapterVersion='mashhad-hunyuan15-v1',profile={manifest:HUNYUAN_MANIFEST,adapterVersion,windowSeconds:5400,validateResources:e=>e.gpu==='RTX-PRO-6000'&&e.cpu>=4&&e.cpu<=8&&e.ramGiB>=128&&e.ramGiB<=256&&e.minVramGiB===96};
 const modelProfile={manifest:HUNYUAN_MANIFEST,requestEntity:'hunyuan-video-request',adapterVersion,profile};
 async function requestFor({scope,stage,plan,inputs=[]}){
  if(stage.kind!=='animate')throw Error('INVALID_HUNYUAN_STAGE');const shot=plan.shots.find(s=>s.id===stage.subjectId);if(!shot)throw Error('INVALID_HUNYUAN_STAGE');let source=null;
  if(shot.generationMode!=='text_to_video'){const sourceAssetId=inputs.find(i=>i.stageId==='scene_image:'+shot.id)?.result?.assetIds?.[0];if(!sourceAssetId)throw Error('HUNYUAN_SOURCE_IMAGE_REQUIRED');source=await quality.getAnimationInput({customerId:scope.customerId,projectId:scope.projectId,assetId:sourceAssetId,characterIds:shot.characterIds,includeBytes:true});}
  return {shot,source,request:buildHunyuanRequest({scope,shot,plan,sourceAsset:source,seed:plan.seed??42})};
 }
 const service=createWanServices({store,now,allowPaid:allowPaid&&licenseAccepted,images,quality,videos,transport,modelProfile,requestFactory:requestFor,planPreparer:p=>prepareWanStoryboard(p,{modelId:HUNYUAN_MODEL_ID,idPrefix:'hy',maxTimelineMs:5000}),
  ...createVideoComparisonHooks({store,comparisons,requestEntity:'hunyuan-video-request'})
 });
 service.productionAdapter.selectionEnabled=allowPaid&&licenseAccepted;return {...service,comparisons};
}
