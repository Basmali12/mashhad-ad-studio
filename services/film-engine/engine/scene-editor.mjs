import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileDigest} from './media-digest.mjs';
import {PACING_VERSION} from './scene-pacing.mjs';
const exec=promisify(execFile),SAFE=/^[A-Za-z0-9_-]{1,100}$/;
export function idleTailCut({duration,quiet=[],still=[]},{minimumRemoval=1,minimumKept=2,padding=.3}={}){
 if(!Number.isFinite(duration)||duration<=minimumKept)return null;
 const tails=rows=>rows.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.start>=0&&r.end>=duration-.18&&r.end>r.start);
 const q=tails(quiet).at(-1),v=tails(still).at(-1);if(!q||!v||q.start<.3)return null;
 const cut=Math.max(minimumKept,q.start+padding,v.start+padding);
 return duration-cut>=minimumRemoval?Math.round(cut*24)/24:null;
}
function ranges(log,prefix,duration){
 const starts=[...log.matchAll(new RegExp(prefix+'_start: ([0-9.]+)','g'))].map(m=>Number(m[1]));
 const ends=[...log.matchAll(new RegExp(prefix+'_end: ([0-9.]+)','g'))].map(m=>Number(m[1]));
 return starts.map((start,i)=>({start,end:ends[i]??duration}));
}
export function createSceneEditor({ffmpeg=process.env.FILM_FFMPEG_PATH||'ffmpeg'}={}){
 const run=args=>exec(ffmpeg,['-nostdin',...args],{windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
 return {async prepare({store,project,scene,job}){
  if(scene.pacing?.version!==PACING_VERSION||scene.pacing.tailPolicy!=='trim_idle'||scene.audioContract?.mode==='silent')return {status:'kept',reason:'authored_hold_or_legacy'};
  if(!SAFE.test(job.id)||job.tenantId!==project.customerId||job.projectId!==project.id||!job.result?.videoVerified)throw Error('PACING_OWNERSHIP_REQUIRED');
  const folder=path.resolve(store.folder,'artifacts',job.id),source=path.join(folder,'video.mp4');
  const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('PACING_SOURCE_INVALID');
  const sourceSHA=await fileDigest(source);if(sourceSHA!==job.result.sha256)throw Error('PACING_SOURCE_CHANGED');
  const {stderr}=await run(['-hide_banner','-i',source,'-vf','freezedetect=n=-35dB:d=1.2','-af','silencedetect=noise=-45dB:d=0.6','-map','0:v:0','-map','0:a:0','-f','null','-']);
  const m=stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);if(!m)throw Error('PACING_PROBE_FAILED');
  const duration=Number(m[1])*3600+Number(m[2])*60+Number(m[3]),quiet=ranges(stderr,'silence',duration),still=ranges(stderr,'freeze',duration),cut=idleTailCut({duration,quiet,still});
  const measurements={sourceDuration:duration,quiet,still,method:'low_audio_and_near_static_tail_not_speech_recognition'};
  if(cut===null)return {status:'kept',reason:'no_confirmed_idle_tail',...measurements};
  const output=path.join(folder,'paced.mp4'),frame=path.join(folder,'paced-last-frame.png'),candidate=path.join(folder,'paced-candidate.mp4');
  try{
   await run(['-v','error','-y','-i',source,'-t',String(cut),'-map','0:v:0','-map','0:a:0','-c:v','libx264','-crf','18','-preset','fast','-c:a','copy','-movflags','+faststart',candidate]);
   const checked=await run(['-hide_banner','-i',candidate,'-map','0:v:0','-map','0:a:0','-f','null','-']);
   const d=checked.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);if(!d)throw Error('PACING_OUTPUT_INVALID');
   const actual=Number(d[1])*3600+Number(d[2])*60+Number(d[3]);if(Math.abs(actual-cut)>.18)throw Error('PACING_DURATION_INVALID');
   await run(['-v','error','-y','-sseof','-0.08','-i',candidate,'-frames:v','1',frame]);
   const image=await fs.readFile(frame);if(image.length>4000000||image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PACING_FRAME_INVALID');
   if(await fileDigest(source)!==sourceSHA)throw Error('PACING_SOURCE_CHANGED');
   await fs.rename(candidate,output);
   return {version:PACING_VERSION,status:'trimmed',sourceSHA,sha256:await fileDigest(output),frameSHA:await fileDigest(frame),durationSeconds:actual,removedSeconds:duration-actual,nativeAudio:true,...measurements};
  }finally{await fs.rm(candidate,{force:true});}
 }};
}
export async function pacedArtifact(store,job,edit){
 if(edit?.status!=='trimmed')return {file:path.resolve(store.folder,'artifacts',job.id,'video.mp4'),sha256:job.result.sha256};
 if(!SAFE.test(job.id)||edit.version!==PACING_VERSION||edit.sourceSHA!==job.result.sha256)throw Error('PACING_SOURCE_CHANGED');
 const folder=path.resolve(store.folder,'artifacts',job.id),file=path.join(folder,'paced.mp4'),frame=path.join(folder,'paced-last-frame.png');
 for(const [p,digest] of [[file,edit.sha256],[frame,edit.frameSHA]]){const stat=await fs.lstat(p);if(!stat.isFile()||stat.isSymbolicLink()||await fileDigest(p)!==digest)throw Error('PACING_SOURCE_CHANGED');}
 return {file,frame,sha256:edit.sha256};
}
