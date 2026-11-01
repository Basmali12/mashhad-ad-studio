import {URL} from 'node:url';
import fs from 'node:fs';
import {hash} from './store.mjs';
import {modelLicenseEligibility,modelDependencyLicensesReviewed} from './model-licenses.mjs';

const packages={ 'flux2-klein-4b':'flux','qwen-image-edit-2511':'qwen','wan22-i2v-a14b':'wan',hunyuanvideo15:'hunyuan',latentsync16:'latentsync','habibi-irq':'speech','habibi-egy':'speech','habibi-msa':'speech','audar-tts-v1-flash':'speech'};
/** Server-owned policy/pins. No browser flag can replace a non-commercial face licence. */
export function engineSoftwarePolicy(modelId,manifest,{hunyuanLicenseAccepted=false,audarLicenseAccepted=false,audarCodecLicenseAccepted=false}={}){
 const pkg=packages[modelId];if(!pkg||!manifest)return {dependencies:[],dependenciesFingerprint:null,license:{allowed:false,blockers:['ENGINE_MANIFEST_REQUIRED'],evidenceDigest:null}};
 const dependencies=['cpu','gpu'].map(kind=>{const file=`${pkg}/requirements-${kind}.lock`;try{return {file,sha256:hash(fs.readFileSync(new URL('./'+file,import.meta.url))),pins:fs.readFileSync(new URL('./'+file,import.meta.url),'utf8').split(/\r?\n/).filter(v=>v&&!v.startsWith('#'))};}catch{return null;}}).filter(Boolean);
 const eligibility=modelLicenseEligibility(modelId,manifest,{hunyuanLicenseAccepted,audarLicenseAccepted,audarCodecLicenseAccepted});
 const b=[...eligibility.commercial.blockers];if(dependencies.length!==2)b.push('ENGINE_DEPENDENCIES_UNVERIFIED');if(!modelDependencyLicensesReviewed(dependencies))b.push('ENGINE_DEPENDENCY_LICENSE_REVIEW_REQUIRED');
 const evidence={modelId,revision:manifest.revision,license:manifest.license??null,codecLicense:manifest.codecLicense??null,eligibility};
 return {dependencies,dependenciesFingerprint:dependencies.length===2?hash(JSON.stringify(dependencies)):null,license:{allowed:b.length===0,blockers:[...new Set(b)],identifier:manifest.license??null,eligibility,evidence,evidenceDigest:hash(JSON.stringify(evidence))}};
}
export function engineRuntimeDefaults(modelId){
 if(modelId==='flux2-klein-4b')return {gpu:'L40S',cpu:4,ramGiB:64,minVramGiB:24,verified:false};
 if(['qwen-image-edit-2511','wan22-i2v-a14b','hunyuanvideo15'].includes(modelId))return {gpu:'RTX-PRO-6000',cpu:4,ramGiB:modelId==='wan22-i2v-a14b'?256:128,minVramGiB:96,verified:false};
 if(modelId==='latentsync16')return {gpu:'L40S',cpu:4,ramGiB:32,minVramGiB:24,verified:false};
 return {gpu:'L40S',cpu:2,ramGiB:16,minVramGiB:8,verified:false};
}
