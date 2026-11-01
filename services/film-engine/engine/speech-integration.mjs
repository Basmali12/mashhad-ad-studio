import fs from 'node:fs';
import {URL} from 'node:url';
import {Buffer} from 'node:buffer';
import {setTimeout as wait} from 'node:timers/promises';
import {hash} from './store.mjs';
import {cost} from './film-money.mjs';
import {createFluxRegistryAdapter} from './flux-integration.mjs';
import {createImageAdapterRouter} from './qwen-integration.mjs';
import {createSpeechModalTransport} from './speech-modal-transport.mjs';
import {createVoiceProfiles} from './voice-profiles.mjs';
import {createNarrationProfiles} from './narration-profiles.mjs';
import {prepareNarrationText,narrationPauses} from './speech-text.mjs';
import {masterNarration} from './narration-mastering.mjs';
import {createSpeechAudioAssets} from './speech-audio-assets.mjs';
import {createSpeechAudioMerge} from './speech-audio-merge.mjs';
import {prepareSpeechStoryboard,selectSpeechModel,speechExpression} from './speech-policy.mjs';
export const SPEECH_MANIFESTS=Object.freeze(Object.fromEntries(['habibi-irq','habibi-egy','habibi-msa','audar-tts-v1-flash'].map(id=>[id,JSON.parse(fs.readFileSync(new URL('./speech/manifests/'+id+'.json',import.meta.url),'utf8'))])));

/** Own approved voices only. No engine, reference or speaker is chosen randomly. */
export function createSpeechServices({store,now=Date.now,allowPaid=false,audarLicenseAccepted=false,codecLicenseAccepted=false,voiceProfiles=createVoiceProfiles({store,now}),assets=createSpeechAudioAssets({store,voiceProfiles,now}),transports={},mastering=masterNarration}){
 const productionAdapters={},registryAdapters=[];
 const narration=createNarrationProfiles({store,voiceProfiles,manifests:SPEECH_MANIFESTS,now});
 async function preparePlan(plan,context={}){
  const utterances=[];for(const u of plan.utterances){const speaker=u.narratorId?plan.narrators.find(n=>n.id===u.narratorId):plan.characters.find(c=>c.id===u.characterId),p=await store.get('voice-profile',speaker?.voice?.voiceId);
   if(p?.settings?.narrationStyle&&p.customerId===context.customerId&&(!context.projectId||p.projectId===context.projectId)){await voiceProfiles.get({customerId:p.customerId,projectId:p.projectId,profileId:p.id});utterances.push({...u,speechPauses:u.speechPauses?.length?u.speechPauses:narrationPauses(u.text,p.settings.narrationStyle)});}else utterances.push(u);
  }return prepareSpeechStoryboard({...plan,utterances});
 }
 for(const [modelId,manifest] of Object.entries(SPEECH_MANIFESTS)){
  const audar=modelId==='audar-tts-v1-flash',paid=allowPaid&&(!audar||audarLicenseAccepted&&codecLicenseAccepted),transport=transports[modelId]??createSpeechModalTransport({modelId,store,now,allowPaid,audarLicenseAccepted,codecLicenseAccepted}),entity='speech-request-'+modelId;
  const profile={manifest,adapterVersion:'mashhad-speech-v1',windowSeconds:1500,validateResources:e=>e.gpu==='L40S'&&[2,4].includes(e.cpu)&&[16,32].includes(e.ramGiB)&&e.minVramGiB>=8&&e.minVramGiB<=48};
  registryAdapters.push(createFluxRegistryAdapter({transport,allowPaid:paid,modelProfile:profile}));
  async function requestFor({scope,stage,plan}){
   const utterance=plan.utterances.find(u=>u.id===stage.subjectId);if(stage.kind!=='voice'||!utterance)throw Error('SPEECH_UTTERANCE_INVALID');
   const narrator=utterance.narratorId!=null,speaker=narrator?plan.narrators.find(n=>n.id===utterance.narratorId):plan.characters.find(c=>c.id===utterance.characterId);if(!speaker)throw Error('VOICE_SPEAKER_INVALID');
   const p=await voiceProfiles.resolve({customerId:scope.customerId,projectId:scope.projectId,profileId:speaker.voice.voiceId,characterId:narrator?null:utterance.characterId,narrator,...(narrator?{narratorId:utterance.narratorId}:{})});
   if(p.modelId!==modelId||p.version!==manifest.version||p.revision!==manifest.revision||p.locale!==speaker.voice.locale||Object.keys(p.settings).some(k=>!['seed','speakingRate','narrationStyle','textPolicy','mastering'].includes(k))||p.settings.speakingRate!==undefined&&(!modelId.startsWith('habibi-')||!Number.isFinite(p.settings.speakingRate)||p.settings.speakingRate<0.85||p.settings.speakingRate>1.15))throw Error('VOICE_PROFILE_CHANGED');
   const expression=speechExpression(utterance.expression);selectSpeechModel({locale:p.locale,profile:p,modelId:speaker.voice.engineId,expression});
   if(p.settings.narrationStyle){const current=await narration.select({actor:{customerId:scope.customerId},customerId:scope.customerId,styleId:p.settings.narrationStyle,locale:p.locale,referenceAssetId:p.referenceAssetId});if(!current.available)throw Error('NARRATION_LICENSED_REFERENCE_REQUIRED');}
   const index=stage.chunkIndex??0,chunk=utterance.speechChunks?.[index],text=chunk?.text??utterance.text,seed=((p.settings.seed??42)+index)%4294967296,reference=await voiceProfiles.readReference({customerId:scope.customerId,referenceAssetId:p.referenceAssetId});
   if(utterance.speechChunks?.length&&!chunk||text.length>600||Buffer.byteLength(text,'utf8')>1200)throw Error('SPEECH_CHUNK_INVALID');
   const textPreparation=modelId.startsWith('habibi-')&&p.settings.textPolicy?prepareNarrationText(text,{policy:p.settings.textPolicy}):null;
   return {utterance,p,chunk,textPreparation,request:{text:textPreparation?.text??text,referenceTranscript:p.referenceTranscript,voiceProfileId:p.id,voiceProfileFingerprint:p.fingerprint,characterId:narrator?null:utterance.characterId,narrator,...(narrator?{narratorId:utterance.narratorId}:{}),utteranceId:utterance.id,locale:p.locale,expression,seed,...(p.settings.speakingRate!==undefined?{speakingRate:p.settings.speakingRate}:{}),referenceAudio:{assetId:p.referenceAssetId,mime:'audio/wav',sha256:p.referenceSHA256,base64:reference.bytes.toString('base64')}}};
  }
  async function save(record,generated){
   const s=generated?.scope??generated;if(s.customerId!==record.customerId||s.projectId!==record.projectId||(s.attemptId??s.requestId)!==record.id||(generated.runId??s.runId)!==record.runId||generated.modelRevision!==manifest.revision)throw Error('SPEECH_RESULT_SCOPE_INVALID');
   const bytes=Buffer.isBuffer(generated.audioBytes)?generated.audioBytes:typeof generated.audioBase64==='string'?Buffer.from(generated.audioBase64,'base64'):null;if(!bytes||bytes.length>32*1024*1024||generated.sha256&&hash(bytes)!==generated.sha256)throw Error('SPEECH_RESULT_INVALID');
   const mastered=record.mastering?await mastering(bytes,{preset:record.mastering}):null;
   const asset=await assets.commit({customerId:record.customerId,projectId:record.projectId,attemptId:record.id,stageId:record.stageId,utteranceId:record.utteranceId,profileId:record.profileId,bytes:mastered?.bytes??bytes,...(mastered?{nativeBytes:bytes,processingEvidence:mastered.evidence}:{}),spokenText:record.text,expression:record.expression,timelineStartMs:record.startMs,timelineEndMs:record.endMs,request:{modelId,version:manifest.version,revision:manifest.revision,locale:record.locale,settings:{seed:record.seed,...(record.speakingRate!==undefined?{speakingRate:record.speakingRate}:{})}}});
   await store.put(entity,{...record,state:'completed',assetId:asset.assetId,inferenceSeconds:generated.inferenceSeconds??generated.metadata?.inferenceSeconds??null,outputDurationMs:asset.durationMs,sampleRate:asset.sampleRate,channels:asset.channels,numSamples:asset.samples,wordTimings:null,transcriptionVerified:false});return asset;
  }
  productionAdapters[modelId]={version:'mashhad-'+modelId+'-v1',metering:'registry_hourly',preparePlan,requestFor,
   async estimate({stage,definition,plan,customerId,projectId}){if(stage.kind!=='voice'||definition?.modelId!==modelId||definition.version!==manifest.version)return {available:false,estimatedMicroUSD:null};try{await requestFor({scope:{customerId,projectId,attemptId:'quote'},stage,plan});return {estimatedMicroUSD:cost(definition.hourMicros,1500000)};}catch{return {available:false,estimatedMicroUSD:null};}},
   async preflight(input){await requestFor(input);},
   async execute({scope,stage,plan,definition,runId,onProgress,signal}){
    if(signal?.aborted)throw Object.assign(Error('SPEECH_CANCELLED'),{definitiveNoSpend:true});const {utterance,p,request,chunk,textPreparation}=await requestFor({scope,stage,plan}),record={id:scope.attemptId,...scope,stageId:stage.stageId,utteranceId:utterance.id,chunkIndex:stage.chunkIndex??0,profileId:p.id,profileFingerprint:p.fingerprint,characterId:request.characterId,narratorId:utterance.narratorId,role:utterance.role,definitionId:definition.id,resources:{gpu:definition.gpu,cpu:definition.cpu,ramGiB:definition.ramGiB,minVramGiB:definition.minVramGiB},accountId:definition.accountId,runId,modelId,version:manifest.version,revision:manifest.revision,locale:p.locale,text:chunk?.text??utterance.text,synthesisText:request.text,textPreparation,mastering:p.settings.mastering??null,expression:request.expression,seed:request.seed,...(request.speakingRate!==undefined?{speakingRate:request.speakingRate}:{}),referenceAssetId:p.referenceAssetId,referenceSHA256:p.referenceSHA256,startMs:utterance.startMs,endMs:utterance.endMs,state:'running',createdAt:now()};await store.put(entity,record);let received=false;
    try{const generated=await transport.generate({definition,runId,requestId:scope.attemptId,scope,approved:true,request,onProgress});received=true;const asset=await save(record,generated);return {...scope,engineId:definition.id,accountId:definition.accountId,runId,billingScope:'registry_hourly',actualMicroUSD:null,result:{assetIds:[asset.assetId]}};}
    catch{await store.put(entity,{...record,state:received?'awaiting_local_commit':'uncertain',error:'SPEECH_RESULT_UNCONFIRMED'});throw Object.assign(Error('SPEECH_RESULT_UNCONFIRMED'),{outputRecoveryRequired:received});}
   },
   async waitReady({runId,observe,signal}){const deadline=Date.now()+900000;while(Date.now()<deadline){if(signal?.aborted)throw Error('SPEECH_CANCELLED');const r=await observe();if(r.runtime.id!==runId||r.runtime.state==='failed'||r.runtime.cloudStopped)throw Error('SPEECH_STATE_UNKNOWN');if(r.runtime.state==='running')return;await wait(1000);}throw Error('SPEECH_START_TIMEOUT');},
   async onStopped({scope,result,history}){const r=await store.get(entity,scope.attemptId);if(!r?.assetId)return;if(r.customerId!==scope.customerId||r.projectId!==scope.projectId||!history?.cloudStopped||history.id!==r.runId||history.engineId!==r.definitionId||history.accountId!==r.accountId)throw Error('SPEECH_USAGE_UNCONFIRMED');await store.put(entity,{...r,meteredRuntimeMs:Math.max(0,history.stoppedAt-history.startedAt),customerChargeMicroUSD:result.actualMicroUSD,recordedProviderUSD:history.recordedProviderUSD??null});},
   async observeResult({scope,runId}){let r=await store.get(entity,scope.attemptId);if(!r||r.customerId!==scope.customerId||r.projectId!==scope.projectId||r.runId!==runId)throw Error('SPEECH_RESULT_UNCONFIRMED');const d=await store.get('engine-definition',r.definitionId),history=await store.get('engine-runtime-history',runId);if(!d||!history?.cloudStopped||history.engineId!==d.id||history.accountId!==r.accountId)throw Error('SPEECH_RESULT_UNCONFIRMED');if(r.state!=='completed'){await save(r,await transport.observeResult({definition:d,runId,requestId:scope.attemptId,scope}));r=await store.get(entity,scope.attemptId);}return {...scope,engineId:d.id,accountId:d.accountId,runId,billingScope:'all_resources',cloudStopped:true,actualMicroUSD:cost(history.hourMicros,Math.max(0,history.stoppedAt-history.startedAt)),result:{assetIds:[r.assetId]}};},
   async cancel({attemptId,customerId,projectId}){const r=await store.get(entity,attemptId);if(r&&r.customerId===customerId&&r.projectId===projectId)await transport.cancelGeneration?.({requestId:attemptId,definitionId:r.definitionId,runId:r.runId});}
  };
 }
 return {registryAdapter:createImageAdapterRouter(registryAdapters),productionAdapters,voiceProfiles,narration,assets,merger:createSpeechAudioMerge({store,speechAssets:assets,voiceProfiles})};
}
