import {createHash} from 'node:crypto';
import {inferenceProfile,inferenceManifest} from './config.mjs';

const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
export const transferHash=value=>createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
export const TRANSFER_SOURCE_VOLUME='modal-ltx25-test-models';
export const transferIdentity=Object.freeze({profile:inferenceProfile,manifestId:inferenceManifest.id,manifestFingerprint:transferHash(inferenceManifest)});
export const workerFingerprint=transferHash({version:'cloud-copy-v4-profile-bound',profile:inferenceProfile,manifestFingerprint:transferIdentity.manifestFingerprint,cpu:2,ram:4096,timeout:3600,verifyTimeout:600,source:TRANSFER_SOURCE_VOLUME});
const scope=plan=>({...transferIdentity,workerFingerprint,sourceVolume:plan.sourceVolume??null,destinationVolume:plan.destinationVolume,mode:plan.mode||'full',files:plan.files.map(f=>({name:f.name,size:f.size,sha256:f.sha256})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)});
export function bindTransferPlan(plan){return {...plan,...transferIdentity,workerFingerprint,transferPlanFingerprint:transferHash(scope(plan))};}
export function assertTransferPlan(plan){
 if(!plan||plan.profile!==inferenceProfile||plan.manifestId!==inferenceManifest.id||plan.manifestFingerprint!==transferIdentity.manifestFingerprint||plan.workerFingerprint!==workerFingerprint||!Array.isArray(plan.files))throw Error('TRANSFER_PROFILE_CHANGED_REQUOTE');
 const names=new Set();
 for(const file of plan.files){const spec=Object.hasOwn(inferenceManifest.files,file?.name)?inferenceManifest.files[file.name]:null;if(!spec||names.has(file.name)||file.size!==spec.size||file.sha256!==spec.sha256)throw Error('TRANSFER_PLAN_CHANGED_REQUOTE');names.add(file.name);}
 const mode=plan.mode||'full';if(!['full','probe','verify-only'].includes(mode)||plan.transferPlanFingerprint!==transferHash(scope(plan)))throw Error('TRANSFER_PLAN_CHANGED_REQUOTE');
 const bytes=mode==='probe'?65536:mode==='verify-only'?0:plan.files.reduce((n,f)=>n+f.size,0);
 if(plan.requiredBytes!==bytes||(mode!=='full'&&plan.files.length))throw Error('TRANSFER_PLAN_CHANGED_REQUOTE');
 if(plan.transport==='modal-cpu-cloud'&&plan.sourceVolume!==TRANSFER_SOURCE_VOLUME)throw Error('TRANSFER_SOURCE_NOT_APPROVED');
 if(plan.transport==='modal-cpu-cloud'&&!/^iff-ltx25-[a-f0-9]{8}$/.test(plan.destinationVolume))throw Error('TRANSFER_PLAN_CHANGED_REQUOTE');
 return true;
}
