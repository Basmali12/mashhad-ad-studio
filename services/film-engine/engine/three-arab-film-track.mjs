import fs from 'node:fs/promises';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {hash} from './store.mjs';
import {productionId,productionDirectory,readProductionFile,resolveProductionAudioAsset} from './production-artifacts.mjs';
import {inspectNarrationTail,repairReviewedNarrationTail} from './narration-tail.mjs';
import {inspectSpeechWav} from './voice-profiles.mjs';
import {THREE_ARAB_MANIFEST,THREE_ARAB_STYLES} from './three-arab-integration.mjs';

/** Explicit owner/admin admission of already-generated narration, not synthesis.
 * Uses the same owned asset IDs and FFmpeg soundtrack path as other engines.
 * Never upgrades a private audition into a published engine or cloned voice.
 */
export function createThreeArabFilmTrack({store,now=Date.now}){
 async function admit(i){
  if(i.actor?.isAdmin!==true||i.trialApproved!==true)throw Error('THREE_ARAB_FILM_APPROVAL_REQUIRED');
  if(![i.customerId,i.projectId,i.attemptId,i.utteranceId].every(productionId))throw Error('NOT_FOUND');
  const p=await store.get('production-project',i.projectId);
  if(!p||p.customerId!==i.customerId)throw Error('NOT_FOUND');
  if(['cancelled','cancelling','deleted'].includes(p.state)||p.cancelRequested)throw Error('PRODUCTION_CANCELLED');
  if(!Buffer.isBuffer(i.bytes)&&!(i.bytes instanceof Uint8Array))throw Error('THREE_ARAB_AUDIO_BYTES_REQUIRED');
  const u=p.plan?.utterances.find(u=>u.id===i.utteranceId),r=i.receipt,b=Buffer.from(i.bytes),modelRevision=THREE_ARAB_MANIFEST.revisions['sherif1313/3arab-TTS-500M-v1-VoiceDesign'];
  let repairEvidence=null;
  if(i.repair){
   if(!Buffer.isBuffer(i.originalBytes)||hash(i.originalBytes)!==r?.result?.sha256)throw Error('THREE_ARAB_REPAIR_SOURCE_INVALID');
   const repaired=repairReviewedNarrationTail(i.originalBytes,i.repair);
   if(hash(repaired.bytes)!==hash(b))throw Error('THREE_ARAB_REPAIR_OUTPUT_INVALID');
   repairEvidence=repaired.evidence;
  }
  if(!u||!u.narratorId||r?.modelId!==THREE_ARAB_MANIFEST.modelId||r?.result?.adapterVariant!=='audioseal-v1'||!Object.hasOwn(THREE_ARAB_STYLES,r.request?.style??'')||r.request.text!==u.text||r.result.sha256!==(repairEvidence?.sourceSHA256??hash(b))||r.result.watermark?.detected!==true||r.result.watermark.backend!=='audioseal'||r.result.watermark.score<.8||r.result.watermark.sampleCountPreserved!==true)throw Error('THREE_ARAB_FILM_RECEIPT_INVALID');
  const tailReview=inspectNarrationTail(b);
  if(tailReview.requiresReview)throw Error('THREE_ARAB_AUDIO_TAIL_REVIEW_REQUIRED');
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(r.request).sort(([a],[b])=>a.localeCompare(b))));
  if(i.claim?.modelRevision!==modelRevision||i.claim.requestSHA256!==hash(canonical))throw Error('THREE_ARAB_CLAIM_INVALID');
  const m=inspectSpeechWav(b),expected=u.endMs-u.startMs;
  if(m.durationMs!==expected||m.sampleRate!==48000||m.channels!==1||r.result.sampleRate!==m.sampleRate||r.request.seconds*1000!==m.durationMs||r.request.seed!==42)throw Error('THREE_ARAB_FILM_TIMING_INVALID');
  const profile={modelId:r.modelId,revision:modelRevision,adapterVariant:'audioseal-v1',style:r.request.style,seed:r.request.seed,caption:r.caption,voiceIdentityGuaranteed:false},fingerprint=hash(JSON.stringify(profile)),bindingId=hash(i.projectId+':narrator:'+u.narratorId),assetId=hash('three-arab-audio:'+i.projectId+':'+i.attemptId),binding=hash(JSON.stringify([fingerprint,hash(b),u.id,u.text,u.startMs,u.endMs]));
  return store.transaction(async()=>{
   const prior=await store.get('production-narration-design',bindingId);
   if(prior&&prior.fingerprint!==fingerprint)throw Error('VOICE_PROFILE_ALREADY_BOUND');
   const old=await store.get('production-asset',assetId);
   if(old){if(old.customerId!==i.customerId||old.binding!==binding)throw Error('THREE_ARAB_AUDIO_ALREADY_COMMITTED');await resolveProductionAudioAsset({store,projectId:i.projectId,customerId:i.customerId,assetId});return old;}
   const dir=await productionDirectory(store,['production-assets',i.projectId,assetId],{create:true}),file=path.join(dir,'audio.wav');
   try{await fs.writeFile(file,b,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
   await readProductionFile(file,hash(b));
   const row={id:assetId,customerId:i.customerId,projectId:i.projectId,attemptId:i.attemptId,kind:'audio',status:'completed',generatedBy:'three-arab-narration-assets-v1',path:file,sha256:hash(b),bytes:b.length,...m,binding,profileFingerprint:fingerprint,narratorId:u.narratorId,utteranceId:u.id,spokenText:u.text,timelineStartMs:u.startMs,timelineEndMs:u.endMs,modelId:r.modelId,modelRevision,watermark:{...r.result.watermark,...(repairEvidence?{postRepairDetectorVerified:false,retainedSpeechPCMUnchanged:true}: {})},tailReview,repairEvidence,trialOnly:true,transcriptionVerified:false,listeningApproved:false,createdAt:now()};
   await store.put('production-narration-design',{id:bindingId,customerId:i.customerId,projectId:i.projectId,narratorId:u.narratorId,profile,fingerprint,trialOnly:true});
   await store.put('production-asset',row);await store.audit('three_arab_narration_admitted',assetId);return row;
  });
 }
 return {admit};
}
