/** Local Wan backend integration. A distinct native LightX2V transport must be commissioned. */
import fs from 'node:fs';
import {URL} from 'node:url';
import {createFluxImageAssets} from './flux-image-assets.mjs';
import {createImageQuality} from './image-quality.mjs';
import {createWanVideoAssets} from './wan-video-assets.mjs';
import {assertLightWanManifest,buildAcceleratedWanRequest,lightWanProfileFingerprint,LIGHTWAN_REVISION,LIGHTX2V_COMMIT} from './wan-execution-profiles.mjs';

function readManifest(){return JSON.parse(fs.readFileSync(new URL('./wan/accelerated-manifest.json',import.meta.url),'utf8'));}
const unavailable=()=>{throw Object.assign(Error('LIGHTWAN_NOT_COMMISSIONED'),{definitiveNoSpend:true});};
function closedTransport(manifest){return {executionProfile:'accelerated',modelRevision:manifest.revision,sourceCommit:manifest.sourceCommit,
 async inspect({definition:d}){return {accountId:d.accountId,volume:d.volume,weightPath:d.weightPath,revision:manifest.revision,files:[],deploymentReady:false,blockers:['LIGHTWAN_NOT_COMMISSIONED']};},
 ...Object.fromEntries(['prepareQuote','prepare','observePreparation','cancelPreparation','start','observe','stop','generate','observeResult'].map(name=>[name,unavailable]))};}
export function createAcceleratedWanServices(options,{createCoreServices,manifest=readManifest()}={}){
 assertLightWanManifest(manifest);
 if(typeof createCoreServices!=='function'||options.transport!==undefined||options.modelProfile!=null||options.requestFactory!=null)throw Error('LIGHTWAN_SEPARATE_TRANSPORT_REQUIRED');
 const {store,now=Date.now}=options,images=options.images??createFluxImageAssets({store,now}),quality=options.quality??createImageQuality({store,assets:images,now});
 const supplied=options.acceleratedTransport;
 if(supplied&&(supplied.executionProfile!=='accelerated'||supplied.modelRevision!==LIGHTWAN_REVISION||supplied.sourceCommit!==LIGHTX2V_COMMIT))throw Error('LIGHTWAN_TRANSPORT_PROFILE_MISMATCH');
 const transport=supplied??closedTransport(manifest);
 const profileFingerprint=lightWanProfileFingerprint(manifest);
 const validateResources=e=>e?.gpu==='RTX-PRO-6000'&&e.cpu===4&&e.ramGiB===128&&e.minVramGiB===96;
 const admission=async input=>{
  if(!supplied||options.allowPaid!==true||supplied.commissioned!==true||input.approved!==true)unavailable();
  const d=input.definition;if(!validateResources(d))throw Error('LIGHTWAN_RESOURCE_PROFILE_MISMATCH');
  const proof=await transport.inspect({definition:d});
  if(!proof||proof.accountId!==d.accountId||proof.volume!==d.volume||proof.weightPath!==d.weightPath||proof.revision!==manifest.revision||proof.deploymentReady!==true||!Array.isArray(proof.files)||manifest.files.some(f=>!proof.files.some(p=>p.path===f.path&&p.size===f.size&&p.sha256===f.sha256&&p.verified===true)))throw Error('LIGHTWAN_WEIGHTS_NOT_READY');
 };
 const wrapped={...transport,
  async start(input){await admission(input);return transport.start({...input,executionProfile:'accelerated',accelerationRevision:manifest.revision,profileFingerprint});},
  async generate(input){await admission(input);return transport.generate({...input,executionProfile:'accelerated',accelerationRevision:manifest.revision,sourceCommit:manifest.sourceCommit,profileFingerprint,steps:4,enableCfg:false});},
 };
 const requestFactory=async({scope,stage,plan,inputs=[]})=>{
  if(stage.kind!=='animate')throw Error('INVALID_WAN_STAGE');
  const shot=plan.shots.find(s=>s.id===stage.subjectId),sourceAssetId=inputs.find(i=>i.stageId==='scene_image:'+stage.subjectId)?.result?.assetIds?.[0];
  if(!shot||!sourceAssetId)throw Error('WAN_SOURCE_IMAGE_REQUIRED');
  const source=await quality.getAnimationInput({customerId:scope.customerId,projectId:scope.projectId,assetId:sourceAssetId,characterIds:shot.characterIds,includeBytes:true});
  return {request:buildAcceleratedWanRequest({scope,shot,plan,sourceAsset:source,seed:plan.seed??42},{manifest}),source,shot};
 };
 const videos=options.videos??createWanVideoAssets({store,imageQuality:quality,now,modelProfile:{modelId:manifest.modelId,version:manifest.version,revision:manifest.revision,fps:16,maxFrames:81}});
 const modelProfile={manifest,requestEntity:'wan-accelerated-video-request',adapterVersion:'mashhad-lightwan-nvfp4-i2v-v1',profile:{manifest,adapterVersion:'mashhad-lightwan-nvfp4-i2v-v1',windowSeconds:1200,validateResources}};
 const core=createCoreServices({...options,images,quality,videos,modelProfile,requestFactory,transport:wrapped});
 if(!supplied)core.productionAdapter={...core.productionAdapter,execute:unavailable};
 return {...core,executionProfile:'accelerated',profileFingerprint,accelerationManifest:manifest,commissioned:supplied?.commissioned===true};
}
