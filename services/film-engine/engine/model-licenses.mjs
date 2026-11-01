import {URL} from 'node:url';
import fs from 'node:fs';
import {hash} from './store.mjs';

const audit=JSON.parse(fs.readFileSync(new URL('./model-license-evidence.json',import.meta.url),'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>hash(JSON.stringify(canonical(value)));
const apache=['Retain license/copyright/NOTICE and mark redistributed modifications.','Rights in voices, faces, input images and output use remain separate obligations.'];
const conditions={
 'hunyuanvideo15':['Use and outputs restricted to territory excluding EU, UK and South Korea.','Over 100 million MAU at release requires a separate Tencent grant.','Pass through license/use restrictions; disclose actual provider identity and non-affiliation; label public AI output.'],
 'audar-tts-v1-flash':['AudarAI Open License v1.0 permits paid hosted services without revenue/user cap.','Preserve license/notices for redistributed code/containers/weights; identify modifications; third-party rights remain separate.','NeuCodec Apache license is separate from Hugging Face gated access approval.'],
 'latentsync16':['InsightFace pretrained buffalo_m weights permit non-commercial research only. Personal entertainment/business/customer service is not a blanket permitted research use.','LatentSync OpenRAIL++ weight restrictions, Apache code notices and remaining component terms still apply.','No validated commercially licensed drop-in detector plus 106-landmark replacement has been installed or verified.']
};
/** Bind rights review to the exact sources/weights, not a license label or browser checkbox. */
export function modelLicenseBinding(manifest={}){
 return {modelId:manifest.modelId??null,revision:manifest.revision??null,sourceCommit:manifest.sourceCommit??manifest.sourceRevision??null,files:(manifest.files??[]).map(f=>Object.fromEntries(['path','repoId','revision','sourcePath','filename','url','size','sha256'].map(k=>[k,f[k]??null])))};
}
export function modelLicenseEligibility(modelId,manifest,options={}){
 const reviewKey=modelId==='wan22-i2v-a14b'&&manifest?.executionProfile==='accelerated'?'wan22-i2v-a14b:accelerated':modelId;
 const reviewed=audit.models[reviewKey],blockers=[];
 if(!reviewed||!manifest)blockers.push('ENGINE_LICENSE_REQUIRED');
 else {
  if(manifest.license!==reviewed.identifier)blockers.push('ENGINE_LICENSE_REQUIRED');
  if(manifest.revision!==reviewed.revision||digest(modelLicenseBinding(manifest))!==reviewed.auditedManifestDigest)blockers.push('ENGINE_LICENSE_SOURCES_UNREVIEWED');
 }
 const known=blockers.length===0,personalBlockers=[...blockers],commercialBlockers=[...blockers];
 if(modelId==='latentsync16')commercialBlockers.push('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED');
 if(modelId==='hunyuanvideo15'&&!options.hunyuanLicenseAccepted){personalBlockers.push('HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED');commercialBlockers.push('HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED');}
 if(modelId==='audar-tts-v1-flash'&&(!options.audarLicenseAccepted||!options.audarCodecLicenseAccepted)){personalBlockers.push('SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED');commercialBlockers.push('SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED');}
 const terms=conditions[modelId]??(modelId.startsWith('habibi-')?[...apache,'Only specialized IRQ/EGY/MSA checkpoint paths reviewed; unified/SAU/UAE are not commercially cleared.']:apache);
 const base={checkedAt:reviewed?.checkedAt??audit.checkedAt,policyVersion:audit.policyVersion,revision:reviewed?.revision??null,identifier:reviewed?.identifier??null,conditions:terms,manifestVerified:known};
 return {...base,personal:{allowed:personalBlockers.length===0,status:!known?'unreviewed':modelId==='latentsync16'?'noncommercial_research_only':'permitted_with_conditions',scope:modelId==='latentsync16'?'noncommercial_research':'personal',runtimeEnabled:false,blockers:personalBlockers},commercial:{allowed:commercialBlockers.length===0,status:commercialBlockers.length?'blocked':'permitted_with_conditions',blockers:commercialBlockers},evidenceDigest:digest({base,personalBlockers,commercialBlockers,auditSources:audit.components,auditCode:audit.codeSources})};
}

export function modelDependencyLicensesReviewed(dependencies){return dependencies.every(d=>audit.dependencyLockDigests[d.file]===d.sha256);}
