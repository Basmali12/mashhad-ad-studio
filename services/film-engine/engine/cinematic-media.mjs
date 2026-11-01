import fs from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {fileDigest} from './media-digest.mjs';
import {inspectSpeechWav} from './voice-profiles.mjs';
import {productionDirectory,readProductionFile,resolveProductionAsset,resolveProductionAudioAsset,verifyLocalVideo,validateProductionVideo} from './production-artifacts.mjs';

const exec=promisify(execFile);
const review=reason=>{throw Object.assign(Error(reason),{needsReview:true,definitiveNoSpend:true});};
const milliseconds=value=>Number.isSafeInteger(value)&&value>=0;
export async function runCinematicFFmpeg(args){try{await exec(process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg',['-nostdin','-hide_banner','-v','error','-threads','2',...args],{windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});}catch(e){throw Error(e.code==='ENOENT'?'CINEMATIC_FFMPEG_UNAVAILABLE':'CINEMATIC_FFMPEG_FAILED',{cause:e});}}

/** Bounded local media conversion, never an inference or download path. */
export function createCinematicMedia({store,now=Date.now,runner=runCinematicFFmpeg,verifyVideo=verifyLocalVideo}){
 async function active(scope){const p=await store.get('production-project',scope.projectId),a=await store.get('production-attempt',scope.attemptId);if(!p||p.customerId!==scope.customerId||p.cancelRequested||!a||a.customerId!==scope.customerId||a.projectId!==scope.projectId||a.status!=='running')throw Error('CINEMATIC_ATTEMPT_NOT_ACTIVE');return p;}
 async function deriveVideo({scope,source,durationMs,startMs=0,fps=25}){
  await active(scope);if(!milliseconds(startMs)||!Number.isSafeInteger(durationMs)||durationMs<=0||durationMs>120000||startMs+durationMs>source.durationMs+40)review('CINEMATIC_VISUAL_COVERAGE_REQUIRED');
  const id=hash(JSON.stringify(['cinematic-video-v1',scope.projectId,source.id,source.sha256,startMs,durationMs,fps])),existing=await store.get('production-asset',id);if(existing)return resolveProductionAsset({store,...scope,assetId:id});
  const folder=await productionDirectory(store,['production-assets',scope.projectId,id],{create:true}),temporary=path.join(folder,'.working-'+randomUUID()+'.mp4'),target=path.join(folder,'video.mp4');
  try{await runner(['-ss',(startMs/1000).toFixed(6),'-i',source.path,'-map','0:v:0','-an','-vf',`setpts=PTS-STARTPTS,fps=${fps},setsar=1,tpad=stop_mode=clone:stop_duration=0.04,trim=duration=${(durationMs/1000).toFixed(6)}`,'-t',(durationMs/1000).toFixed(6),'-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-n',temporary]);const metadata=validateProductionVideo(await verifyVideo({file:temporary,expectedDurationMs:durationMs,hasAudio:false}),durationMs,{requireAudio:false});if(metadata.hasAudio||metadata.fps!==fps||metadata.width!==source.width||metadata.height!==source.height)throw Error('CINEMATIC_VIDEO_FORMAT_CHANGED');const sha256=await fileDigest(temporary);await resolveProductionAsset({store,...scope,assetId:source.id});try{await fs.link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;}const bytes=await readProductionFile(target,sha256);const row={id,customerId:scope.customerId,projectId:scope.projectId,kind:'video',status:'completed',generatedBy:'cinematic-media-v1',path:target,sha256,bytes:bytes.length,...metadata,sourceAssetId:source.id,sourceSHA256:source.sha256,sourceStartMs:startMs,sourceEndMs:startMs+durationMs,qualityCertified:false,createdAt:now()};await store.put('production-asset',row);return row;}finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 async function deriveAudio({scope,source,offsetMs,durationMs,delayMs=0}){
  await active(scope);if(![offsetMs,delayMs].every(milliseconds)||!Number.isSafeInteger(durationMs)||durationMs<1||durationMs>120000||offsetMs>=source.durationMs||delayMs>=durationMs)throw Error('CINEMATIC_AUDIO_WINDOW_INVALID');
  const takeMs=Math.min(durationMs-delayMs,source.durationMs-offsetMs),id=hash(JSON.stringify(['cinematic-audio-v1',scope.projectId,source.id,source.sha256,offsetMs,durationMs,delayMs]));let row=await store.get('production-asset',id);if(row){await resolveProductionAudioAsset({store,...scope,assetId:id});return row;}
  const folder=await productionDirectory(store,['production-assets',scope.projectId,id],{create:true}),temporary=path.join(folder,'.working-'+randomUUID()+'.wav'),target=path.join(folder,'audio.wav');
  try{await runner(['-i',source.path,'-vn','-af',`atrim=start=${(offsetMs/1000).toFixed(6)}:duration=${(takeMs/1000).toFixed(6)},asetpts=PTS-STARTPTS,aresample=16000,aformat=channel_layouts=mono,adelay=${delayMs}:all=1,apad,atrim=duration=${(durationMs/1000).toFixed(6)}`,'-ar','16000','-ac','1','-c:a','pcm_s16le','-n',temporary]);const bytes=await fs.readFile(temporary),metadata=inspectSpeechWav(bytes,{maxDurationMs:120000});if(metadata.sampleRate!==16000||metadata.channels!==1||Math.abs(metadata.durationMs-durationMs)>2)throw Error('CINEMATIC_AUDIO_FORMAT_CHANGED');const sha256=hash(bytes);await resolveProductionAudioAsset({store,...scope,assetId:source.id});try{await fs.link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;}await readProductionFile(target,sha256);row={id,customerId:scope.customerId,projectId:scope.projectId,kind:'audio',status:'completed',generatedBy:'cinematic-media-v1',path:target,sha256,bytes:bytes.length,...metadata,sourceAssetId:source.id,sourceSHA256:source.sha256,sourceOffsetMs:offsetMs,delayMs,profileId:source.profileId,utteranceId:source.utteranceId,characterId:source.characterId,createdAt:now()};await store.put('production-asset',row);return row;}finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 return {
  async prepareLipInput({scope,shot,utterance,videoAsset,audioAsset,alignmentAsset,faceBinding}){
   await active(scope);const record=await store.get('production-cinematic-timeline',scope.projectId),timeline=record?.timeline;if(record?.customerId!==scope.customerId||!timeline||timeline.needsReview)review('CINEMATIC_TIMELINE_REVIEW_REQUIRED');
   const clip=timeline.shots.find(s=>s.shotId===shot.id),track=timeline.audioTracks.find(t=>t.utteranceId===utterance.id);if(!clip||!track||clip.videoAssetId!==videoAsset.id||track.assetId!==audioAsset.id||faceBinding?.characterId!==utterance.characterId)review('CINEMATIC_SPEAKER_REVIEW_REQUIRED');
   const source=await resolveProductionAsset({store,...scope,assetId:videoAsset.id}),audio=await resolveProductionAudioAsset({store,...scope,assetId:audioAsset.id}),durationMs=clip.endMs-clip.startMs,offsetMs=Math.max(0,clip.startMs-track.startMs),delayMs=Math.max(0,track.startMs-clip.startMs),endOffset=Math.min(audio.durationMs,clip.endMs-track.startMs),alignment=alignmentAsset.alignment??alignmentAsset.metadata?.alignment??alignmentAsset;
   const words=alignment.words;if(!Array.isArray(words)||!words.length)review('CINEMATIC_ALIGNMENT_REVIEW_REQUIRED');for(const word of words)if([offsetMs,endOffset].some(boundary=>boundary>word.startMs+5&&boundary<word.endMs-5))review('CINEMATIC_WORD_CUT_REVIEW_REQUIRED');
   const v=await deriveVideo({scope,source,durationMs,startMs:clip.sourceStartMs??0}),a=await deriveAudio({scope,source:audio,offsetMs,durationMs,delayMs});
   return {video:{assetId:v.id,mime:'video/mp4',base64:(await readProductionFile(v.path,v.sha256)).toString('base64'),sha256:v.sha256},audio:{assetId:a.id,mime:'audio/wav',base64:(await readProductionFile(a.path,a.sha256)).toString('base64'),sha256:a.sha256},durationMs,width:v.width,height:v.height,fps:25,provenance:{sourceVideoAssetId:source.id,sourceAudioAssetId:audio.id,sourceVideoSHA256:source.sha256,sourceAudioSHA256:audio.sha256,startMs:clip.startMs,endMs:clip.endMs}};
  },
  async normalizeLipOutput({scope,bytes,expectedDurationMs,width,height}){
   await active(scope);if(!Buffer.isBuffer(bytes)||bytes.length>128*1024*1024||expectedDurationMs>120000)throw Error('CINEMATIC_OUTPUT_INVALID');const folder=await productionDirectory(store,['production-sync-work',scope.projectId,scope.attemptId],{create:true}),token=randomUUID(),source=path.join(folder,token+'-native.mp4'),target=path.join(folder,token+'-silent.mp4');
   try{await fs.writeFile(source,bytes,{flag:'wx',mode:0o600});await runner(['-i',source,'-map','0:v:0','-an','-c:v','copy','-movflags','+faststart','-n',target]);const metadata=validateProductionVideo(await verifyVideo({file:target,expectedDurationMs,hasAudio:false}),expectedDurationMs,{requireAudio:false});if(metadata.hasAudio||metadata.width!==width||metadata.height!==height||metadata.fps!==25)throw Error('CINEMATIC_OUTPUT_INVALID');return {bytes:await fs.readFile(target),metadata};}finally{await Promise.all([source,target].map(file=>fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;})));}
  },
  async trimShot({scope,assetId,clip}){const source=await resolveProductionAsset({store,...scope,assetId});return deriveVideo({scope,source,durationMs:clip.endMs-clip.startMs,startMs:clip.sourceStartMs??0});},
 };
}
