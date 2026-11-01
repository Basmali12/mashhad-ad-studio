import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {createFilmMediaLibrary} from './film-media-library.mjs';

const exec=promisify(execFile),SAFE=/^[a-zA-Z0-9_-]{1,100}$/,SHA=/^[a-f0-9]{64}$/;
const MAX_BYTES=512*1024*1024;
const MAX_FILE_BYTES=64*1024*1024*1024;
export const productionId=value=>typeof value==='string'&&SAFE.test(value);

/** Server-generated relative components only. Symlinks/junctions are never accepted. */
export async function productionDirectory(store,parts,{create=false}={}){
 const root=path.resolve(store.folder);if(await fs.realpath(root)!==root)throw Error('PRODUCTION_UNSAFE_PATH');
 let current=root;
 for(const part of parts){
  if(!productionId(part)&&!SHA.test(part))throw Error('PRODUCTION_UNSAFE_PATH');
  current=path.join(current,part);
  if(create)try{await fs.mkdir(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(current)!==current)throw Error('PRODUCTION_UNSAFE_PATH');
 }
 return current;
}
export async function readProductionFile(file,expectedSHA){
 if(!SHA.test(expectedSHA||''))throw Error('PRODUCTION_INVALID_RECEIPT');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const stat=await handle.stat(),entry=await fs.lstat(file);if(!stat.isFile()||entry.isSymbolicLink()||!entry.isFile()||stat.size>MAX_BYTES)throw Error('PRODUCTION_UNSAFE_PATH');const bytes=await handle.readFile();if(hash(bytes)!==expectedSHA)throw Error('PRODUCTION_ARTIFACT_CHANGED');return bytes;}finally{await handle.close();}
}
export async function verifyProductionFile(file,expectedSHA){
 if(!SHA.test(expectedSHA||''))throw Error('PRODUCTION_INVALID_RECEIPT');
 const h=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const before=await h.stat(),entry=await fs.lstat(file);if(!before.isFile()||entry.isSymbolicLink()||!entry.isFile()||before.size<16||before.size>MAX_FILE_BYTES)throw Error('PRODUCTION_UNSAFE_PATH');const digest=createHash('sha256');let bytes=0;for await(const chunk of h.createReadStream({autoClose:false})){digest.update(chunk);bytes+=chunk.length;}const after=await h.stat();if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||digest.digest('hex')!==expectedSHA)throw Error('PRODUCTION_ARTIFACT_CHANGED');return {bytes,sha256:expectedSHA};}finally{await h.close();}
}
/** Resolve an owned server ledger ID. Neither HTTP URLs nor caller paths are inputs. */
export async function resolveProductionAsset({store,projectId,customerId,assetId}){
 if(!productionId(projectId)||!productionId(customerId)||!productionId(assetId))throw Error('NOT_FOUND');const a=await store.get('production-asset',assetId);if(!a||a.projectId!==projectId||a.customerId!==customerId||!SHA.test(a.sha256||'')||!Number.isSafeInteger(a.durationMs)||a.durationMs<1)throw Error('NOT_FOUND');
 let folder,file;
 if(a.generatedBy==='production-assembly-v1'){
  if(!productionId(a.groupId)||!SHA.test(a.inputFingerprint||''))throw Error('PRODUCTION_UNSAFE_PATH');folder=await productionDirectory(store,['production-groups',projectId,a.groupId,a.inputFingerprint]);file=path.join(folder,'group.mp4');
 }else{folder=await productionDirectory(store,['production-assets',projectId,assetId]);file=path.join(folder,'video.mp4');}
 if(typeof a.path!=='string'||path.resolve(a.path)!==file)throw Error('PRODUCTION_UNSAFE_PATH');const checked=await verifyProductionFile(file,a.sha256);if(a.bytes!=null&&a.bytes!==checked.bytes)throw Error('PRODUCTION_ARTIFACT_CHANGED');return {...a,...checked,path:file};
}
export async function resolveProductionAudioAsset({store,projectId,customerId,assetId}){
 if(!productionId(projectId)||!productionId(customerId)||!productionId(assetId))throw Error('NOT_FOUND');const a=await store.get('production-asset',assetId);if(!a||a.projectId!==projectId||a.customerId!==customerId||!SHA.test(a.sha256||'')||!Number.isSafeInteger(a.durationMs)||a.durationMs<1)throw Error('NOT_FOUND');
 const folder=await productionDirectory(store,['production-assets',projectId,assetId]),name=path.basename(a.path||'');if(!/^audio\.(wav|mp3|flac|m4a|aac)$/.test(name)||path.resolve(a.path)!==path.join(folder,name))throw Error('PRODUCTION_UNSAFE_PATH');const checked=await verifyProductionFile(a.path,a.sha256);if(a.bytes!=null&&a.bytes!==checked.bytes)throw Error('PRODUCTION_ARTIFACT_CHANGED');return {...a,...checked};
}
export async function verifyLocalAudio({file,expectedDurationMs,ffmpeg=process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg'}){
 let output;try{output=await exec(ffmpeg,['-nostdin','-hide_banner','-threads','2','-i',file,'-map','0:a:0','-vn','-progress','pipe:1','-nostats','-f','null','-'],{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});}catch(e){throw Error(e.code==='ENOENT'?'PRODUCTION_AUDIO_TOOL_UNAVAILABLE':'PRODUCTION_AUDIO_DECODE_FAILED');}
 const input=output.stderr.split(/Output #/)[0],audio=[...input.matchAll(/Stream[^\n]*Audio: ([^\n]+)/g)],time=[...output.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1);if(audio.length!==1||/Stream[^\n]*Video:/.test(input)||!time||!Number.isSafeInteger(expectedDurationMs)||expectedDurationMs<=0||Math.abs(Number(time[1])/1000-expectedDurationMs)>250)throw Error('PRODUCTION_AUDIO_INVALID');return {durationMs:Math.round(Number(time[1])/1000),hasAudio:true,checker:'ffmpeg_full_decode'};
}
export function validateProductionVideo(metadata,expectedDurationMs,{requireAudio=true}={}){
 const m=metadata;
 if(!Number.isSafeInteger(expectedDurationMs)||expectedDurationMs<1||expectedDurationMs>3600000||!m||typeof m.hasAudio!=='boolean'||requireAudio&&m.hasAudio!==true||!Number.isFinite(m.durationMs)||m.durationMs<=0||!Number.isSafeInteger(m.width)||!Number.isSafeInteger(m.height)||m.width<2||m.height<2||m.width>8192||m.height>8192)throw Error('PRODUCTION_VIDEO_INVALID');
 const tolerance=Math.max(250,m.fps>0?2000/m.fps:0);if(Math.abs(m.durationMs-expectedDurationMs)>tolerance)throw Error('PRODUCTION_DURATION_MISMATCH');
 return {durationMs:Math.round(m.durationMs),width:m.width,height:m.height,hasAudio:m.hasAudio,fps:Number.isFinite(m.fps)&&m.fps>0?m.fps:null,checker:typeof m.checker==='string'&&/^[a-z0-9_]{1,60}$/.test(m.checker)?m.checker:'trusted_verifier'};
}
/** Full CPU decode, including audio; no remote tool or automatic dependency download. */
export async function verifyLocalVideo({file,expectedDurationMs,hasAudio=true,ffmpeg=process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg'}){
 let result;try{result=await exec(ffmpeg,['-nostdin','-hide_banner','-threads','2','-i',file,'-map','0:v:0','-map',hasAudio?'0:a:0':'0:a:0?','-progress','pipe:1','-nostats','-f','null','-'],{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});}catch(e){throw Error(e.code==='ENOENT'?'PRODUCTION_VIDEO_TOOL_UNAVAILABLE':'PRODUCTION_VIDEO_DECODE_FAILED');}
 const videos=[...result.stderr.matchAll(/Stream[^\n]*Video: ([^\n]+)/g)],audios=[...result.stderr.matchAll(/Stream[^\n]*Audio: ([^\n]+)/g)];
 // Ignore the output stream description after "Output #"; input must contain one video and audio.
 const input=result.stderr.split(/Output #/)[0],v=[...input.matchAll(/Stream[^\n]*Video: ([^\n]+)/g)],a=[...input.matchAll(/Stream[^\n]*Audio: ([^\n]+)/g)];
 if(!videos.length||hasAudio&&!audios.length||v.length!==1||a.length>1||hasAudio&&a.length!==1)throw Error('PRODUCTION_VIDEO_INVALID');
 const size=v[0][1].match(/\b(\d{2,5})x(\d{2,5})\b/),fps=v[0][1].match(/(\d+(?:\.\d+)?) fps/),clock=[...result.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1);
 if(!size||!clock)throw Error('PRODUCTION_VIDEO_INVALID');
 return validateProductionVideo({durationMs:Number(clock[1])/1000,width:Number(size[1]),height:Number(size[2]),hasAudio:a.length===1,fps:fps?Number(fps[1]):null,checker:'ffmpeg_full_decode'},expectedDurationMs,{requireAudio:hasAudio});
}

export function createProductionArtifacts({store,now=Date.now,verifyVideo=verifyLocalVideo,thumbnail=null}){
 const media=createFilmMediaLibrary({store,now}),pending=new Map();
 const owned=async(projectId,customerId)=>{if(!productionId(projectId)||!productionId(customerId))throw Error('NOT_FOUND');const p=await store.get('production-project',projectId);if(!p||p.customerId!==customerId)throw Error('NOT_FOUND');if(['cancelled','cancelling','deleted'].includes(p.state)||p.cancelledAt||p.cancelRequested)throw Error('PRODUCTION_CANCELLED');return p;};
 const receipt=r=>({artifactId:r.artifactId,sha256:r.sha256,bytes:r.bytes,durationMs:r.durationMs,width:r.width,height:r.height,hasAudio:r.hasAudio,mediaId:r.mediaId??null,mediaReady:r.mediaReady===true});
 async function checkAttempt(projectId,customerId,attemptId){if(!attemptId)return;if(!productionId(attemptId))throw Error('NOT_FOUND');const a=await store.get('production-attempt',attemptId);if(!a||a.projectId!==projectId||a.customerId!==customerId)throw Error('NOT_FOUND');if(a.status!=='running'||a.stageId!=='save'||a.cancelledAt||a.cancelRequested)throw Error('PRODUCTION_CANCELLED');const s=await store.get('production-stage',hash(projectId+':save'));if(!s||s.projectId!==projectId||s.customerId!==customerId||s.stageId!=='save'||s.state!=='running'||s.attemptId!==attemptId)throw Error('PRODUCTION_ATTEMPT_NOT_ACTIVE');}
 async function indexFinal(result){
  try{if(thumbnail){const folder=await productionDirectory(store,['film-exports',result.projectId,result.sha256]),poster=await thumbnail.create({projectId:result.projectId,customerId:result.customerId,sourceSHA256:result.sha256,file:path.join(folder,'merged.mp4'),durationMs:result.durationMs});const project=await store.get('film-project',result.projectId);if(project?.customerId!==result.customerId)throw Error('NOT_FOUND');project.merge.thumbnail={path:poster.path,sha256:poster.sha256,bytes:poster.bytes};await store.put('film-project',project);result={...result,thumbnailReady:true};}await media.sync(result.customerId);const mediaId=hash('film:'+result.projectId+':'+result.sha256),entry=await media.get(mediaId,result.customerId);if(entry.projectId!==result.projectId||entry.kind!=='film')throw Error('PRODUCTION_MEDIA_INDEX_PENDING');result={...result,mediaId,mediaReady:true};await store.put('production-result',result);}catch{result={...result,mediaReady:false};}
  return receipt(result);
 }
 async function readFinal({projectId,customerId}){
  await owned(projectId,customerId);const r=await store.get('production-result',projectId);if(!r||r.customerId!==customerId||r.projectId!==projectId||r.status!=='completed'||!SHA.test(r.sha256))throw Error('NOT_FOUND');
  const folder=await productionDirectory(store,['film-exports',projectId,r.sha256]),bytes=await readProductionFile(path.join(folder,'merged.mp4'),r.sha256);if(bytes.length!==r.bytes)throw Error('PRODUCTION_ARTIFACT_CHANGED');
  return {bytes,receipt:receipt(r)};
 }
 async function commit({projectId,customerId,bytes,sourceAssetId,expectedDurationMs,hasAudio,attemptId}){
  const p=await owned(projectId,customerId);await checkAttempt(projectId,customerId,attemptId);
  let payload,source;if(sourceAssetId){if(bytes!==undefined)throw Error('PRODUCTION_INVALID_INPUT');source=await resolveProductionAsset({store,projectId,customerId,assetId:sourceAssetId});}else{if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))throw Error('PRODUCTION_BYTES_REQUIRED');payload=Buffer.from(bytes);if(payload.length<16||payload.length>MAX_BYTES||payload.toString('ascii',4,8)!=='ftyp')throw Error('PRODUCTION_VIDEO_INVALID');}
  if(typeof hasAudio!=='boolean')throw Error('PRODUCTION_VIDEO_INVALID');
  if(!Number.isSafeInteger(expectedDurationMs)||expectedDurationMs!==(p.measuredDurationMs??p.durationMs))throw Error('PRODUCTION_DURATION_MISMATCH');
  const sha256=source?.sha256||hash(payload),byteLength=source?.bytes??payload.length,token=randomUUID();await media.initialize();let prior;
  await store.transaction(async()=>{await owned(projectId,customerId);await checkAttempt(projectId,customerId,attemptId);const mirror=await store.get('film-project',projectId);if(mirror&&mirror.customerId!==customerId)throw Error('NOT_FOUND');prior=await store.get('production-result',projectId);if(prior){if(prior.customerId!==customerId||prior.sha256!==sha256)throw Error('PRODUCTION_RESULT_ALREADY_COMMITTED');return;}if(mirror?.merge?.status==='completed'&&mirror.merge.sha256!==sha256)throw Error('PRODUCTION_RESULT_ALREADY_COMMITTED');const old=await store.get('production-artifact-intent',projectId);if(old?.state==='writing')throw Error('PRODUCTION_ARTIFACT_PENDING');await store.put('production-artifact-intent',{id:projectId,customerId,sha256,token,state:'writing',startedAt:now()});});
  if(prior){const folder=await productionDirectory(store,['film-exports',projectId,prior.sha256]);await verifyProductionFile(path.join(folder,'merged.mp4'),prior.sha256);return indexFinal(prior);}
  const disk=await fs.statfs(store.folder),freeBytes=Number(disk.bavail)*Number(disk.bsize);if(!Number.isFinite(freeBytes)||freeBytes<byteLength+32*1024*1024){await store.transaction(async()=>{const intent=await store.get('production-artifact-intent',projectId);if(intent?.token===token)await store.put('production-artifact-intent',{...intent,state:'failed',finishedAt:now()});});throw Error('PRODUCTION_STORAGE_INSUFFICIENT');}
  let temporary;
  try{
   const folder=await productionDirectory(store,['film-exports',projectId,sha256],{create:true}),target=path.join(folder,'merged.mp4');temporary=path.join(folder,'.pending-'+token+'.mp4');
   const h=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);try{if(source){const input=await fs.open(source.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{for await(const chunk of input.createReadStream({autoClose:false}))await h.writeFile(chunk);}finally{await input.close();}}else await h.writeFile(payload);await h.sync();}finally{await h.close();}
   await verifyProductionFile(temporary,sha256);
   const header=await fs.open(temporary,'r');try{const b=Buffer.alloc(8);await header.read(b,0,8,0);if(b.toString('ascii',4,8)!=='ftyp')throw Error('PRODUCTION_VIDEO_INVALID');}finally{await header.close();}
   const checked=validateProductionVideo(await verifyVideo({file:temporary,expectedDurationMs,hasAudio}),expectedDurationMs,{requireAudio:hasAudio});
   await productionDirectory(store,['film-exports',projectId,sha256]);
   try{await fs.link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;}await verifyProductionFile(target,sha256);
   const at=now();let result;
   await store.transaction(async()=>{const project=await owned(projectId,customerId);await checkAttempt(projectId,customerId,attemptId);const intent=await store.get('production-artifact-intent',projectId);if(intent?.token!==token||intent.sha256!==sha256||intent.state!=='writing')throw Error('PRODUCTION_ARTIFACT_PENDING');const old=await store.get('film-project',projectId);if(old&&old.customerId!==customerId)throw Error('NOT_FOUND');if(await store.get('production-result',projectId))throw Error('PRODUCTION_RESULT_ALREADY_COMMITTED');result={id:projectId,projectId,customerId,artifactId:hash('production-final:'+projectId+':'+sha256),sha256,bytes:byteLength,...checked,status:'completed',createdAt:at,attemptId:attemptId??null,mediaReady:false};await store.put('production-result',result);await store.put('film-project',{...old,id:projectId,customerId,name:old?.name||project.title||'فيلم مشهد',story:old?.story||'',messages:old?.messages||[],scenes:old?.scenes||[],orientation:old?.orientation||(checked.width>=checked.height?'landscape':'portrait'),orientationConfirmed:true,seconds:checked.durationMs/1000,createdAt:old?.createdAt||at,state:'completed',merge:{status:'completed',path:target,sha256,duration:checked.durationMs/1000,width:checked.width,height:checked.height,audio:checked.hasAudio,nativeAudio:false,checker:checked.checker,source:'production_adapter_verified_final',mediaCreatedAt:at,completedAt:at}});await store.put('production-artifact-intent',{...intent,state:'completed',finishedAt:at});await store.audit('production_final_verified',projectId);});
   return indexFinal(result);
  }catch(e){await store.transaction(async()=>{const intent=await store.get('production-artifact-intent',projectId);if(intent?.token===token&&intent.state==='writing')await store.put('production-artifact-intent',{...intent,state:'failed',finishedAt:now()});});throw e;}
  finally{if(temporary)await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 return {async recover({processStoppedConfirmed=false}={}){if(processStoppedConfirmed!==true)throw Error('PRODUCTION_RECOVERY_CONFIRMATION_REQUIRED');if(pending.size)throw Error('PRODUCTION_ARTIFACT_PENDING');for(const r of await store.all('production-artifact-intent'))if(r.state==='writing'&&!await store.get('production-result',r.id))await store.put('production-artifact-intent',{...r,state:'failed',error:'LOCAL_PROCESS_INTERRUPTED',finishedAt:now()});},readFinal,async resolveFinal({projectId,customerId}){await owned(projectId,customerId);const r=await store.get('production-result',projectId);if(!r||r.customerId!==customerId||r.status!=='completed')throw Error('NOT_FOUND');const folder=await productionDirectory(store,['film-exports',projectId,r.sha256]),file=path.join(folder,'merged.mp4');await verifyProductionFile(file,r.sha256);return {path:file,receipt:receipt(r)};},async commitFinal(input){
  let copy={...input},identity;
  if(input.sourceAssetId){if(input.bytes!==undefined)throw Error('PRODUCTION_INVALID_INPUT');const a=await resolveProductionAsset({store,projectId:input.projectId,customerId:input.customerId,assetId:input.sourceAssetId});identity=a.id+':'+a.sha256;}
  else{if(!Buffer.isBuffer(input.bytes)&&!(input.bytes instanceof Uint8Array))throw Error('PRODUCTION_BYTES_REQUIRED');const bytes=Buffer.from(input.bytes);copy={...input,bytes};identity=hash(bytes);}
  const key=input.projectId+':'+input.customerId,binding=identity+':'+input.expectedDurationMs+':'+input.hasAudio+':'+(input.attemptId||''),active=pending.get(key);if(active){if(active.binding!==binding)throw Error('PRODUCTION_RESULT_ALREADY_COMMITTED');return active.promise;}
  const promise=commit(copy);pending.set(key,{binding,promise});try{return await promise;}finally{pending.delete(key);}
 }};
}
