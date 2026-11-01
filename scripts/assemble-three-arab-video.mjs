/** Private test through real owned narration -> shared assembly -> final library. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {Store,hash} from '../services/film-engine/engine/store.mjs';
import {createThreeArabFilmTrack} from '../services/film-engine/engine/three-arab-film-track.mjs';
import {createFinalFilmThumbnail} from '../services/film-engine/engine/final-film-thumbnail.mjs';
import {createProductionAssembly} from '../services/film-engine/engine/production-assembly.mjs';
import {createProductionArtifacts,productionDirectory,readProductionFile,verifyLocalVideo} from '../services/film-engine/engine/production-artifacts.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.resolve(repo,'../../work/three-arab-video-trial1'),base=path.resolve(repo,'../../work/afterlife-film-20261101'),audioRoot=path.resolve(repo,'../../work/three-arab-audioseal-audition6');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const stopped=await read(path.join(work,'final-stop-proof.json'));
if(!stopped.cloudStoppedAndTasksZero||stopped.allActiveApps!==0)throw Error('RESOURCES_NOT_STOPPED');
const receipt=await read(path.join(audioRoot,'solemn-receipt.json')),audio=await fs.readFile(path.join(audioRoot,'solemn-native.wav')),claim=await read(path.join(work,'audio-claim.json'));
const customerId='private-owner-basm1998ali',projectId='three-arab-film-trial1';
await fs.mkdir(path.join(work,'backend-store'),{recursive:true});
const store=new Store(path.join(work,'backend-store'),randomBytes(32).toString('base64'));
const ff=path.resolve(repo,'../../work/video-comparison-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
process.env.ENGINE_FFMPEG_BIN=ff;process.env.FILM_FFMPEG_PATH=ff;
try{
 const prior=await store.get('production-project',projectId);
 if(!prior)await store.put('production-project',{id:projectId,customerId,title:'ليلة تغيّر الحياة — تجربة السرد',story:receipt.request.text,state:'running',durationMs:15000,width:720,height:1280,fps:16,createdAt:Date.now(),privateTrial:true,plan:{orientation:'portrait',utterances:[{id:'narration',narratorId:'narrator',role:'narration',text:receipt.request.text,startMs:0,endMs:15000}]}});
 const track=await createThreeArabFilmTrack({store}).admit({actor:{isAdmin:true},trialApproved:true,customerId,projectId,attemptId:'saved-solemn-narration',utteranceId:'narration',receipt,claim,bytes:audio});
 const sources=[
  {name:'clock',file:path.join(base,'lightwan-attempt5/candidate-native.mp4'),receipt:path.join(base,'lightwan-attempt5/result.json'),reused:true},
  {name:'phone',file:path.join(base,'accelerated-film-batch1/phone-native.mp4'),receipt:path.join(base,'accelerated-film-batch1/phone-receipt.json'),reused:true},
  {name:'doorway',file:path.join(work,'doorway-native.mp4'),receipt:path.join(work,'video-result.json'),reused:false},
 ];
 const assetIds=[],proofs=[];
 for(const source of sources){
  const r=await read(source.receipt),bytes=await fs.readFile(source.file);
  if(hash(bytes)!==r.sha256||r.steps!==4||r.width!==720||r.height!==1280||r.numFrames!==81||r.executionProfile!=='accelerated')throw Error('VIDEO_SOURCE_CHANGED');
  const verified=await verifyLocalVideo({file:source.file,expectedDurationMs:5000,hasAudio:false});
  const id=hash(projectId+':clip:'+source.name+':'+r.sha256),folder=await productionDirectory(store,['production-assets',projectId,id],{create:true}),file=path.join(folder,'video.mp4');
  try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  await readProductionFile(file,r.sha256);
  await store.put('production-asset',{id,customerId,projectId,kind:'video',status:'completed',generatedBy:'private-verified-wan-import-v1',path:file,sha256:r.sha256,bytes:bytes.length,...verified,durationMs:5000,hasAudio:false,privateTrial:true,createdAt:Date.now()});
  assetIds.push(id);proofs.push({name:source.name,reused:source.reused,sourceSHA256:r.sha256,nativeDurationMs:r.durationMs,timelineDurationMs:5000,internalClipNotPublished:true});
 }
 const previousEvidence=await read(path.join(work,'film-result.json')).catch(()=>null);
 const started=Date.now(),assembly=createProductionAssembly({store});
 const group=await assembly.assembleGroup({customerId,projectId,groupId:'three-arab-final',assetIds,narration:[{assetId:track.id,startMs:0,endMs:15000,sourceOffsetMs:0,layer:'narration'}]});
 const artifacts=createProductionArtifacts({store,thumbnail:createFinalFilmThumbnail({store})}),final=await artifacts.commitFinal({customerId,projectId,sourceAssetId:group.assetId,expectedDurationMs:15000,hasAudio:true});
 const resolved=await artifacts.resolveFinal({customerId,projectId}),target=path.join(work,'مشهد — تجربة السرد الجديدة.mp4');
 try{await fs.copyFile(resolved.path,target,1);}catch(e){if(e.code!=='EEXIST')throw e;}
 const actual=await verifyLocalVideo({file:target,expectedDurationMs:15000,hasAudio:true});
 const evidence={title:'ليلة تغيّر الحياة — تجربة السرد',path:target,projectId,customerId,...actual,sha256:hash(await fs.readFile(target)),final,assemblySeconds:previousEvidence?.assemblySeconds??(Date.now()-started)/1000,narration:{assetId:track.id,modelId:track.modelId,style:receipt.request.style,sourceSHA256:track.sha256,profileFingerprint:track.profileFingerprint,durationMs:15000,regenerated:false,speedChanged:false,wordsIntentionallyTrimmed:false,pronunciationVerified:false},shots:proofs,resourcesStopped:true,privateTrial:true,published:false,customerProductionUIEnabled:false};
 await fs.writeFile(path.join(work,'film-result.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}finally{store.close();}
