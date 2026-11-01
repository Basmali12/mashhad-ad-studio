/** CPU-only final assembly of immutable accelerated experiment media. */
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {privateFilmAssemblyArgs} from './private-afterlife-film-runner.mjs';
import {verifyLocalVideo} from '../services/film-engine/engine/production-artifacts.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.resolve(repo,'../../work/afterlife-film-20261101'),work=path.join(base,'accelerated-film-batch1');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const ff=path.resolve(repo,'../../work/video-comparison-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
process.env.FILM_FFMPEG_PATH=ff;process.env.ENGINE_FFMPEG_BIN=ff;
const stop=read(path.join(work,'final-stop-proof.json'));if(stop.tasks!==0||stop.activeApps.length)throw Error('RESOURCES_NOT_STOPPED');
const first=read(path.join(base,'lightwan-attempt5/result.json')),audio=read(path.join(base,'voice-narration-result.json')).artifacts[0];
const clips=[{shotId:'clock',localPath:path.join(base,'lightwan-attempt5/candidate-native.mp4'),...first},...['phone','window','empty-chair','hands','road'].map(s=>read(path.join(work,s+'-receipt.json')))];
for(const c of clips)if(hash(fs.readFileSync(c.localPath))!==c.sha256||c.steps!==4||c.numFrames!==81||c.width!==720||c.height!==1280)throw Error('CLIP_INTEGRITY_FAILED');
if(hash(fs.readFileSync(audio.path))!==audio.sha256||audio.request.modelId!=='habibi-msa'||audio.request.locale!=='ar-MSA'||audio.durationMs>30000)throw Error('AUDIO_CHANGED');
const output=path.join(work,'الحياة ما بعد الموت — النسخة المسرعة.mp4');
if(fs.existsSync(output))throw Error('FINAL_ALREADY_EXISTS');
const {args,narrationStartMs}=privateFilmAssemblyArgs({videoFiles:clips.map(c=>c.localPath),audioFile:audio.path,audioDurationMs:audio.durationMs,output});
// Measured source peak -8.1dB: modest gain improves audibility while keeping headroom.
const index=args.indexOf('-filter_complex')+1;args[index]=args[index].replace('[6:a]aresample=48000,','[6:a]aresample=48000,volume=3dB,').replace('[4:v]trim=start=0:duration=5,setpts=PTS-STARTPTS,','[4:v]trim=start=0:duration=5,setpts=PTS-STARTPTS,crop=480:854:144:426,scale=720:1280:flags=lanczos,');
const started=Date.now();execFileSync(ff,args,{windowsHide:true,timeout:180000,stdio:['ignore','pipe','pipe']});
const measured=await verifyLocalVideo({file:output,expectedDurationMs:30000,hasAudio:true});
const bytes=fs.readFileSync(output),project=read(path.join(base,'project.json'));
const receipt={title:'الحياة ما بعد الموت',projectId:project.projectId,path:output,sha256:hash(bytes),bytes:bytes.length,...measured,assemblySeconds:(Date.now()-started)/1000,shots:clips.map(c=>({shotId:c.shotId??'clock',path:c.localPath,sha256:c.sha256,modelRevision:c.revision,steps:4})),narration:{path:audio.path,sha256:audio.sha256,profileId:audio.profileId,durationMs:audio.durationMs,startMs:narrationStartMs,speedChanged:false,wordsCut:false,gainDB:3},handsEditorialCrop:{x:144,y:426,width:480,height:854,outputWidth:720,outputHeight:1280,reason:'Requested close-up of hands; preserve native source and avoid emphasizing uncertain frontal face match.'},ambience:'Locally generated quiet brown-noise air texture under speech ducking; no external music or audio service.',publication:false,sourceMediaPreserved:true,createdAt:new Date().toISOString()};
fs.writeFileSync(path.join(work,'final-film-receipt.json'),JSON.stringify(receipt,null,2)+'\n');process.stdout.write(JSON.stringify(receipt)+'\n');
