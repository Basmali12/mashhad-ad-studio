import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function fileDigest(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
const run=(binary,args)=>exec(binary,args,{windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
export function createFilmMerger({ffmpeg=process.env.FILM_FFMPEG_PATH||'ffmpeg',ffprobe=process.env.FILM_FFPROBE_PATH||'ffprobe'}={}){
 const decodeProbe=async file=>{
  const {stderr}=await run(ffmpeg,['-nostdin','-hide_banner','-v','info','-i',file,'-map','0:v:0','-map','0:a:0','-f','null','-']);
  const d=stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/),v=stderr.match(/Stream[^\n]*Video: ([^\n]+)/),a=stderr.match(/Stream[^\n]*Audio: ([^\n]+)/);
  const dimensions=v?.[1].match(/\b(\d{2,5})x(\d{2,5})\b/),fps=v?.[1].match(/(\d+(?:\.\d+)?) fps/),pixel=v?.[1].match(/,\s*(yuv\w+|rgb\w+)/),audio=a?.[1].match(/^([^ ,]+).*?(\d+) Hz,\s*([^,\r\n]+)/);
  if(!d||!dimensions||!fps||!pixel||!audio)throw Error('MERGE_VERIFICATION_FAILED');
  const duration=Number(d[1])*3600+Number(d[2])*60+Number(d[3]),width=Number(dimensions[1]),height=Number(dimensions[2]);
  return {duration,width,height,checker:'ffmpeg_full_decode',contract:JSON.stringify([v[1].split(/[ (]/)[0],width,height,pixel[1],fps[1],audio[1],audio[2],audio[3]])};
 };
 const probe=async file=>{let stdout;try{({stdout}=await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file]));}catch(e){if(e.code==='ENOENT')return decodeProbe(file);throw e;}const p=JSON.parse(stdout),v=p.streams?.filter(s=>s.codec_type==='video'),a=p.streams?.filter(s=>s.codec_type==='audio');if(v?.length!==1||a?.length!==1||!Number.isFinite(Number(p.format?.duration))||Number(p.format.duration)<=0)throw Error('MERGE_AV_REQUIRED');return {checker:'ffprobe',duration:Number(p.format.duration),width:v[0].width,height:v[0].height,contract:JSON.stringify([v[0].codec_name,v[0].width,v[0].height,v[0].pix_fmt,v[0].r_frame_rate,a[0].codec_name,a[0].sample_rate,a[0].channels])};};
 return {async merge({store,project}){
  // Tools are only queried on merge; importing/reading project state never launches them.
  try{await run(ffmpeg,['-version']);}catch{throw Error('MERGE_UNAVAILABLE');}
  const jobs=[];
  for(const scene of project.scenes||[]){const j=scene.jobId?await store.get('job',scene.jobId):null;if(scene.status!=='done'||j?.tenantId!==project.customerId||j?.projectId!==project.id||!j?.result?.videoVerified)throw Error('MERGE_SCENES_NOT_READY');jobs.push(j);}
  if(jobs.some(j=>!/^[a-zA-Z0-9_-]{1,100}$/.test(j.id))||!/^[a-zA-Z0-9_-]{1,100}$/.test(project.id))throw Error('MERGE_INVALID_ID');
  if(!jobs.length)throw Error('MERGE_SCENES_NOT_READY');
  const outputId=createHash('sha256').update(JSON.stringify(jobs.map(j=>j.id))).digest('hex'),folder=path.resolve(store.folder,'film-exports',project.id,outputId);await fs.mkdir(folder,{recursive:true,mode:0o700});
  let expected=0,contract,first;const lines=[];
  for(let i=0;i<jobs.length;i++){
   const file=path.resolve(store.folder,'artifacts',jobs[i].id,'video.mp4'),p=await probe(file),sha=await fileDigest(file);
   if(jobs[i].result.sha256&&sha!==jobs[i].result.sha256)throw Error('MERGE_SOURCE_HASH_MISMATCH');
   if(contract&&contract!==p.contract)throw Error('MERGE_FORMAT_MISMATCH');contract=p.contract;first??=p;expected+=p.duration;
   const name='scene-'+i+'.mp4',target=path.join(folder,name);try{await fs.link(file,target);}catch(e){if(e.code!=='EEXIST')await fs.copyFile(file,target);}if(await fileDigest(target)!==sha)throw Error('MERGE_SOURCE_HASH_MISMATCH');lines.push("file '"+name+"'");
  }
  const list=path.join(folder,'concat.txt'),temporary=path.join(folder,'merging.mp4'),output=path.join(folder,'merged.mp4');await fs.writeFile(list,lines.join('\n')+'\n',{mode:0o600});
  try{
   await run(ffmpeg,['-nostdin','-v','error','-y','-f','concat','-safe','1','-i',list,'-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',temporary]);
   const result=await probe(temporary);if(result.contract!==contract||Math.abs(result.duration-expected)>Math.max(1,jobs.length*.05)||result.width!==first.width||result.height!==first.height)throw Error('MERGE_VERIFICATION_FAILED');
   await fs.rename(temporary,output);
   return {path:output,sha256:await fileDigest(output),duration:result.duration,width:result.width,height:result.height,audio:true,checker:result.checker,sceneCount:jobs.length,source:'local_cpu_stream_copy_native_audio'};
  }finally{await fs.rm(temporary,{force:true});}
 }};
}
