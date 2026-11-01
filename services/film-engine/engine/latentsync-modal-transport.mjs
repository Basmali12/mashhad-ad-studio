import {Buffer} from 'node:buffer';
import {createModelModalTransport} from './flux-modal-transport.mjs';
import {hash} from './store.mjs';
import {resolveProductionAsset,resolveProductionAudioAsset,readProductionFile} from './production-artifacts.mjs';
import {inspectSpeechWav} from './voice-profiles.mjs';
import {validateAlignment} from './sync-assets.mjs';

const ID=/^[A-Za-z0-9_-]{1,100}$/;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Error(code);};
export function createLatentSyncModalTransport(options={}){return createModelModalTransport({...options,allowPaid:options.allowPaid===true&&options.usageMode==='noncommercial_research'&&options.researchOnly===true,modelId:'latentsync16'});}
export function latentRequestProof(request){return {...request,audio:request.audio?{assetId:request.audio.assetId,mime:request.audio.mime,sha256:request.audio.sha256}:undefined,...(request.video?{video:{assetId:request.video.assetId,mime:request.video.mime,sha256:request.video.sha256}}:{})};}
async function ownedBytes({store,scope,value,kind}){
 if(!value||Object.keys(value).some(k=>!['assetId','mime','sha256','base64'].includes(k))||!ID.test(value.assetId??'')||value.mime!==(kind==='video'?'video/mp4':'audio/wav')||typeof value.base64!=='string'||value.base64.length>(kind==='video'?90000000:45000000)||! /^[A-Za-z0-9+/]+={0,2}$/.test(value.base64))fail('LATENTSYNC_INPUT_INVALID');
 const row=await(kind==='video'?resolveProductionAsset:resolveProductionAudioAsset)({store,...scope,assetId:value.assetId}),bytes=Buffer.from(value.base64,'base64');if(row.kind!==kind||hash(bytes)!==row.sha256||row.sha256!==value.sha256||bytes.toString('base64')!==value.base64||!bytes.equals(await readProductionFile(row.path,row.sha256)))fail('LATENTSYNC_INPUT_NOT_OWNED');
 if(kind==='audio'){const wav=inspectSpeechWav(bytes,{maxDurationMs:120000,maxBytes:32*1024*1024});if(wav.channels!==1||![16000,24000].includes(wav.sampleRate)||Math.abs(wav.durationMs-row.durationMs)>2)fail('LATENTSYNC_AUDIO_FORMAT_INVALID');}
 else if(bytes.toString('ascii',4,8)!=='ftyp')fail('LATENTSYNC_VIDEO_FORMAT_INVALID');return row;
}
export async function authorizeLatentSyncRequest({store,request,scope,attempt,project}){
 if(!project?.adminCommissioning?.ownerId||project.adminCommissioning.usageMode!=='noncommercial_research')fail('LATENTSYNC_RESEARCH_ONLY');
 const r=request;if(!r||!['align','lip_sync'].includes(r.operation)||!Number.isSafeInteger(r.seed)||r.seed!==42)fail('LATENTSYNC_REQUEST_INVALID');const allowed=r.operation==='align'?['operation','text','utteranceId','speakerId','characterId','voiceProfileId','locale','audio','seed']:['operation','shotId','speakerId','characterId','voiceProfileId','faceBindingId','video','audio','targetFace','seed','settings'];if(Object.keys(r).some(k=>!allowed.includes(k))||!['speakerId','voiceProfileId'].every(k=>ID.test(r[k]??'')))fail('LATENTSYNC_REQUEST_INVALID');
 const stage=(await store.all('production-stage')).find(s=>s.projectId===project.id&&s.stageId===attempt.stageId&&s.attemptId===attempt.id);if(!stage||stage.kind!==r.operation||stage.modelId!=='latentsync16')fail('LATENTSYNC_STAGE_NOT_AUTHORIZED');const audio=await ownedBytes({store,scope,value:r.audio,kind:'audio'});
 if(r.operation==='align'){
  const u=project.plan?.utterances.find(u=>u.id===stage.subjectId),speaker=u?.narratorId?project.plan.narrators.find(n=>n.id===u.narratorId):project.plan?.characters.find(c=>c.id===u?.characterId),chunk=stage.chunkIndex==null?null:u?.speechChunks?.[stage.chunkIndex];const voiceStage=(await store.all('production-stage')).find(s=>s.projectId===project.id&&s.stageId===(stage.chunkIndex!=null&&audio.chunkIndex!=null?'voice_chunk:'+u?.id+':'+stage.chunkIndex:'voice:'+u?.id));if(!u||stage.subjectId!==r.utteranceId||r.text!==(chunk?.text??u.text)||r.speakerId!==(u.narratorId??u.characterId)||r.characterId!==u.characterId||r.voiceProfileId!==speaker?.voice.voiceId||r.locale!==speaker?.voice.locale||audio.profileId!==r.voiceProfileId||audio.spokenText!==r.text||voiceStage?.state!=='completed'||!voiceStage.result?.assetIds?.includes(audio.id))fail('LATENTSYNC_ALIGNMENT_NOT_AUTHORIZED');
 }else{
  if(!ID.test(r.characterId??'')||r.speakerId!==r.characterId||!ID.test(r.faceBindingId??'')||!equal(r.settings,{numInferenceSteps:20,guidanceScale:1.5,fps:25}))fail('LATENTSYNC_FACE_REVIEW_REQUIRED');const shot=project.plan?.shots.find(s=>s.id===stage.subjectId),face=await store.get('sync-face-binding',r.faceBindingId),speaker=project.plan?.characters.find(c=>c.id===r.characterId),lines=project.plan?.utterances.filter(u=>shot?.utteranceIds.includes(u.id)&&u.role==='dialogue'&&shot.characterIds.includes(u.characterId))??[];
  if(!shot||shot.id!==r.shotId||!shot.requires_lip_sync||!speaker||speaker.voice.voiceId!==r.voiceProfileId||lines.length!==1||lines[0].characterId!==r.characterId||!face||face.customerId!==scope.customerId||face.projectId!==scope.projectId||face.shotId!==shot.id||face.characterId!==r.characterId||face.faceCount!==1||face.trackId!=='face-0'||face.reviewed!==true)fail('LATENTSYNC_FACE_REVIEW_REQUIRED');
  const video=await ownedBytes({store,scope,value:r.video,kind:'video'}),original=await resolveProductionAsset({store,...scope,assetId:face.videoAssetId});if(original.sha256!==face.sourceVideoSHA256||video.sourceVideoAssetId!==original.id&&video.provenance?.sourceVideoAssetId!==original.id&&video.sourceAssetId!==original.id||audio.profileId!==r.voiceProfileId&&audio.voiceProfileId!==r.voiceProfileId||!equal(r.targetFace,{trackId:'face-0',faceCount:1,characterId:r.characterId,reviewed:true,sourceVideoSHA256:video.sha256}))fail('LATENTSYNC_FACE_BINDING_CHANGED');
 }
 return latentRequestProof(r);
}
export function validateLatentSyncResult({result,request,manifest,scope,runId,definition,audioDurationMs}){
 const m=result?.metadata??{},s=result?.scope;if(!s||s.engineId!==definition.id||s.accountId!==definition.accountId||s.runId!==runId||(s.requestId??s.attemptId)!==scope.attemptId||result.modelRevision!==manifest.revision||result.operation!==request.operation||m.operation!==request.operation||m.audioSHA256!==request.audio.sha256||m.speakerId!==request.speakerId||m.characterId!==request.characterId||m.voiceProfileId!==request.voiceProfileId)fail('LATENTSYNC_RESULT_SCOPE_INVALID');
 if(request.operation==='align'){if(m.utteranceId!==request.utteranceId||m.textSHA256!==hash(request.text)||m.locale!==request.locale)fail('LATENTSYNC_RESULT_SCOPE_INVALID');validateAlignment(result.alignment??m.alignment,{text:request.text,durationMs:audioDurationMs});}
 else{if(m.shotId!==request.shotId||m.faceBindingId!==request.faceBindingId||m.videoSHA256!==request.video.sha256||m.fps!==25||m.needsReview!==true||m.hasAudio!==true||typeof result.videoBase64!=='string'||result.videoBase64.length>90000000)fail('LATENTSYNC_RESULT_INVALID');const bytes=Buffer.from(result.videoBase64,'base64');if(bytes.toString('base64')!==result.videoBase64||bytes.length>64*1024*1024||bytes.toString('ascii',4,8)!=='ftyp'||hash(bytes)!==result.sha256||m.sha256!==result.sha256)fail('LATENTSYNC_RESULT_INVALID');}
 return result;
}
