/** Trusted backend choices. Selecting a profile never provisions, downloads or starts GPU. */
import {hash} from './store.mjs';
import {buildWanRequest} from './wan-prompt.mjs';

export const LIGHTWAN_REVISION='f4b91eba1fd7dc2eb038191e2bca7ed33423032d';
export const LIGHTX2V_COMMIT='880b7b156a4eb3ae8af8979a8d44b5e5945e17d2';
export const LIGHTWAN_I2V_WEIGHTS=Object.freeze([
 Object.freeze({sha256:'c77b92616d678fa8373462973a3d2e3ceefd2fbdb3ccf33454e74f4c79fcf07a',size:8379833592}),
 Object.freeze({sha256:'d76b53286dd9b68f5d956941037c0a6fd5a1fe0fd05eb97f8bf8abf9915da562',size:8379833592}),
]);
const PROFILES=Object.freeze({
 'original-quality':Object.freeze({id:'original-quality',label:'Original Quality',runtime:'diffusers',steps:40,precision:'bfloat16',cfg:true,qualityVerified:false}),
 accelerated:Object.freeze({id:'accelerated',label:'Accelerated',runtime:'lightx2v',steps:4,precision:'nvfp4',cfg:false,modelRevision:LIGHTWAN_REVISION,sourceCommit:LIGHTX2V_COMMIT,qualityVerified:false,requiresIndependentCommissioning:true}),
});
export function getWanExecutionProfile(id='original-quality'){
 if(!Object.hasOwn(PROFILES,id))throw Error('WAN_EXECUTION_PROFILE_INVALID');return {...PROFILES[id]};
}
export function listWanExecutionProfiles(){return Object.keys(PROFILES).map(getWanExecutionProfile);}
export function lightWanProfileFingerprint(manifest){assertLightWanManifest(manifest);return hash(JSON.stringify({profile:'accelerated',revision:manifest.revision,sourceCommit:manifest.sourceCommit,weights:LIGHTWAN_I2V_WEIGHTS}));}
export function assertLightWanManifest(manifest){
 if(!manifest||manifest.modelId!=='wan22-i2v-a14b'||manifest.version!=='2.2'||manifest.executionProfile!=='accelerated'||manifest.revision!==LIGHTWAN_REVISION||manifest.sourceCommit!==LIGHTX2V_COMMIT||manifest.repoId!=='lightx2v/LightWan2.2-A14B'||!Array.isArray(manifest.files)||!manifest.files.length||!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes<1)throw Error('LIGHTWAN_MANIFEST_INVALID');
 const targets=new Set();let total=0;
 for(const f of manifest.files){if(!f||typeof f.path!=='string'||f.path.startsWith('/')||f.path.includes('\\')||f.path.split('/').some(p=>!p||p==='.'||p==='..')||targets.has(f.path)||!Number.isSafeInteger(f.size)||f.size<=0||!/^[a-f0-9]{64}$/.test(f.sha256??''))throw Error('LIGHTWAN_MANIFEST_INVALID');targets.add(f.path);total+=f.size;}
 if(total!==manifest.totalBytes||LIGHTWAN_I2V_WEIGHTS.some(w=>manifest.files.filter(f=>f.sha256===w.sha256&&f.size===w.size&&f.repoId==='lightx2v/LightWan2.2-A14B'&&f.revision===LIGHTWAN_REVISION).length!==1))throw Error('LIGHTWAN_DISTILLED_WEIGHTS_REQUIRED');
 for(const [role,count] of Object.entries({high_noise_nvfp4:1,low_noise_nvfp4:1,text_encoder_native:1,vae_native:1,tokenizer_native:4,native_model_config:2}))if(manifest.files.filter(f=>f.role===role).length!==count)throw Error('LIGHTWAN_NATIVE_COMPONENTS_REQUIRED');
 return manifest;
}
/** Identical visual input/prompt; different trained weights, numerical format and scheduler. */
export function buildAcceleratedWanRequest(input,{manifest}={}){
 assertLightWanManifest(manifest);const original=buildWanRequest(input);
 if(original.settings.resolution!=='720p'||original.settings.num_frames!==81||original.settings.fps!==16)throw Error('LIGHTWAN_COMPARISON_FORMAT_UNSUPPORTED');
 const fingerprint=lightWanProfileFingerprint(manifest);
 const settings={...original.settings,num_inference_steps:4,guidance_scale:1,guidance_scale_2:1,dtype:'nvfp4',execution_profile:'accelerated',profile_fingerprint:fingerprint,cfg_enabled:false,denoising_schedule:'1000-750-500-250',boundary_step_index:2,sample_shift:7,sparse_attention_ratio:0.9};
 return {...original,settings,structured:{...original.structured,executionProfile:'accelerated',accelerationRevision:manifest.revision},fingerprint:hash(JSON.stringify({originalFingerprint:original.fingerprint,profileFingerprint:fingerprint,settings}))};
}
/** CPU-only experiment specification; the baseline is always reused, never re-generated. */
export function createWanComparisonPlan(baseline){
 const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 if(!baseline||typeof baseline.prompt!=='string'||!baseline.prompt.trim()||baseline.prompt.length>12000||!sha(baseline.imageSHA256)||!sha(baseline.videoSHA256)||typeof baseline.imageAssetId!=='string'||!baseline.imageAssetId||typeof baseline.videoAssetId!=='string'||!baseline.videoAssetId||!Number.isSafeInteger(baseline.seed)||baseline.seed<0||baseline.seed>2147483647||![[720,1280],[1280,720]].some(([w,h])=>w===baseline.width&&h===baseline.height)||baseline.numFrames!==81||baseline.fps!==16)throw Error('WAN_COMPARISON_BASELINE_REQUIRED');
 const shared={imageAssetId:baseline.imageAssetId,imageSHA256:baseline.imageSHA256,prompt:baseline.prompt,seed:baseline.seed,width:baseline.width,height:baseline.height,numFrames:81,fps:16,nativeDurationMs:5063,timelineDurationMs:5000};
 const plan={schema:'wan-comparison-v1',baseline:{executionProfile:'original-quality',videoAssetId:baseline.videoAssetId,videoSHA256:baseline.videoSHA256,reuseExisting:true,generate:false},shared,candidate:{executionProfile:'accelerated',modelRevision:LIGHTWAN_REVISION,sourceCommit:LIGHTX2V_COMMIT,steps:4,enableCfg:false,resources:{gpu:'RTX-PRO-6000',minVramGiB:96,cpu:4,ramGiB:128},attempts:1,automaticRetry:false},dispatchAvailable:false,approvalRequired:true,weightsReady:false,cloudValidated:false,metrics:['model_load_seconds','prompt_encode_seconds','denoising_seconds','vae_decode_seconds','mp4_encode_seconds','runtime_seconds','provider_cost_usd','peak_gpu_memory','peak_host_memory','face_continuity_review','motion_realism_review','visible_text_review'],preserveExistingOutputs:true};
 return {...plan,id:hash(JSON.stringify(plan))};
}
