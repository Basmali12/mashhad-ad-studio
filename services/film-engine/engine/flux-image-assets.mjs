import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash} from './store.mjs';
import {inspectReference,REFERENCE_LIMIT} from './film-reference.mjs';
import {productionDirectory,productionId,readProductionFile} from './production-artifacts.mjs';

const exec=promisify(execFile),MODEL='flux2-klein-4b',STAGE=/^[A-Za-z0-9_:-]{1,200}$/,SHA=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const roles=new Map([['face','mainface'],['mainface','mainface'],['fullbody','fullbody'],['front','front'],['side','side'],['threequarter','threequarter']]);
const angleOf=value=>roles.get(String(value||'front').toLowerCase().replace(/[ _-]/g,''))||null;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function requestMetadata(request,profile){
 if(!plain(request)||Object.keys(request).some(k=>!['modelId','modelVersion','revision','prompt','settings','referenceIds'].includes(k))||request.modelId!==profile.modelId||typeof request.modelVersion!=='string'||!request.modelVersion.trim()||request.modelVersion.length>100||/[\x00-\x1f]/.test(request.modelVersion)||!SHA.test(request.revision||'')||typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>12000||request.prompt.includes('\0')||!plain(request.settings)||Object.keys(request.settings).length>30||!Array.isArray(request.referenceIds)||request.referenceIds.length>12||request.referenceIds.some(id=>!productionId(id))||new Set(request.referenceIds).size!==request.referenceIds.length)throw Error('FLUX_IMAGE_REQUEST_INVALID');
 const settings={};for(const key of Object.keys(request.settings).sort()){const value=request.settings[key];if(!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(key)||/token|secret|credential|password|api.?key|url|endpoint|path|directory|folder/i.test(key)||!(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^[A-Za-z0-9_. -]{1,80}$/.test(value)&&!/^(?:sk-|ak-|as-)/.test(value)))throw Error('FLUX_IMAGE_REQUEST_INVALID');settings[key]=value;}
 if(profile.version&&request.modelVersion!==profile.version||profile.revision&&request.revision!==profile.revision)throw Error('FLUX_IMAGE_REQUEST_INVALID');
 return {modelId:profile.modelId,modelVersion:request.modelVersion.trim(),revision:request.revision,prompt:request.prompt.trim(),settings,referenceIds:[...request.referenceIds]};
}
function imageMetadata(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>REFERENCE_LIMIT)throw Error('FLUX_IMAGE_SIZE');
 if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return {...inspectReference(bytes,'image/png'),extension:'png'};
 if(bytes[0]===255&&bytes[1]===216)return {...inspectReference(bytes,'image/jpeg'),extension:'jpg'};
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('FLUX_IMAGE_FORMAT');
 let offset=12,size=null,frame=false;
 while(offset+8<=bytes.length){const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),data=bytes.subarray(offset+8,offset+8+length);if(offset+8+length>bytes.length||['ANIM','ANMF'].includes(type))throw Error('FLUX_IMAGE_FORMAT');
  if(type==='VP8X'){if(length!==10||data[0]&2)throw Error('FLUX_IMAGE_FORMAT');size={width:1+data.readUIntLE(4,3),height:1+data.readUIntLE(7,3)};}
  if(type==='VP8L'){if(frame||length<5||data[0]!==0x2f)throw Error('FLUX_IMAGE_FORMAT');frame=true;size??={width:1+data[1]+((data[2]&0x3f)<<8),height:1+(data[2]>>6)+(data[3]<<2)+((data[4]&0x0f)<<10)};}
  if(type==='VP8 '){if(frame||length<10||data.toString('hex',3,6)!=='9d012a')throw Error('FLUX_IMAGE_FORMAT');frame=true;size??={width:data.readUInt16LE(6)&0x3fff,height:data.readUInt16LE(8)&0x3fff};}
  offset+=8+length+(length%2);
 }
 if(!frame||offset!==bytes.length||!size||size.width<1||size.height<1||size.width>4096||size.height>4096||size.width*size.height>16000000)throw Error('FLUX_IMAGE_DIMENSIONS');
 return {...size,mime:'image/webp',extension:'webp'};
}
async function defaultPreview({file,width,height}){
 try{const {stdout,stderr}=await exec(process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg',['-nostdin','-hide_banner','-v','info','-threads','2','-i',file,'-frames:v','1','-vf',"scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease",'-f','image2pipe','-c:v','png','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:1024*1024,encoding:'buffer'});const input=stderr.toString().split(/Output #/)[0],streams=[...input.matchAll(/Stream[^\n]*Video: ([^\n]+)/g)],dimensions=streams[0]?.[1].match(/\b(\d{1,5})x(\d{1,5})\b/);if(streams.length!==1||!dimensions||Number(dimensions[1])!==width||Number(dimensions[2])!==height)throw Error('FLUX_IMAGE_DECODE_DIMENSIONS');return stdout;}catch(e){throw Error(e.code==='ENOENT'?'FLUX_IMAGE_PREVIEW_TOOL_UNAVAILABLE':'FLUX_IMAGE_PREVIEW_FAILED');}
}

/** Original bytes are immutable. Images are references, never a face-identity certificate. */
export function createFluxImageAssets({store,now=Date.now,makePreview=defaultPreview,modelProfile=null}){
 const profile=modelProfile??{modelId:MODEL,version:null,revision:null};if(!['flux2-klein-4b','qwen-image-edit-2511'].includes(profile.modelId)||modelProfile&&(!profile.version||!SHA.test(profile.revision||'')))throw Error('IMAGE_MODEL_PROFILE_INVALID');
 const modelId=profile.modelId,editedModel=modelId==='qwen-image-edit-2511';
 const pending=new Map();
 const publicAsset=a=>({assetId:a.id,kind:'image',mime:a.mime,width:a.width,height:a.height,sha256:a.sha256,bytes:a.bytes,preview:{mime:a.preview.mime,width:a.preview.width,height:a.preview.height,sha256:a.preview.sha256,bytes:a.preview.bytes},modelId:a.request.modelId,modelVersion:a.request.modelVersion,revision:a.request.revision,referenceIds:a.request.referenceIds,characterId:a.characterId,shotId:a.shotId,angle:a.angle,lineage:a.lineage??null,identityVerified:false,qualityCertified:false});
 async function owned(projectId,customerId){if(!productionId(projectId)||!productionId(customerId))throw Error('NOT_FOUND');const p=await store.get('production-project',projectId);if(!p||p.customerId!==customerId)throw Error('NOT_FOUND');return p;}
 async function active(input){
  const p=await owned(input.projectId,input.customerId);if(p.cancelRequested||p.cancelledAt||['cancelled','cancelling','deleted'].includes(p.state))throw Error('PRODUCTION_CANCELLED');
  if(!productionId(input.attemptId)||!STAGE.test(input.stageId||''))throw Error('NOT_FOUND');const a=await store.get('production-attempt',input.attemptId),s=await store.get('production-stage',hash(input.projectId+':'+input.stageId));
  if(!a||a.customerId!==input.customerId||a.projectId!==input.projectId||a.stageId!==input.stageId||a.status!=='running'||a.cancelRequested||!s||s.projectId!==input.projectId||s.customerId!==input.customerId||s.stageId!==input.stageId||s.state!=='running'||s.attemptId!==input.attemptId||s.modelId!==modelId)throw Error('FLUX_IMAGE_ATTEMPT_NOT_ACTIVE');
  if(s.kind==='character_image'){
   const c=p.plan?.characters?.find(c=>c.id===input.characterId),angle=angleOf(input.angle);if(!c||input.shotId||s.subjectId!==c.id||!angle||!Number.isSafeInteger(s.angleIndex)||s.angleIndex<0||!c.angles?.[s.angleIndex]||angleOf(c.angles[s.angleIndex])!==angle)throw Error('FLUX_IMAGE_CHARACTER_MISMATCH');
  }else if(s.kind==='scene_image'){
   const shot=p.plan?.shots?.find(s=>s.id===input.shotId);if(!shot||input.characterId||input.angle||s.subjectId!==shot.id)throw Error('FLUX_IMAGE_SHOT_MISMATCH');
  }else throw Error('FLUX_IMAGE_STAGE_INVALID');
  return {p,s};
 }
 async function read({customerId,projectId,assetId,preview=false}){
  await owned(projectId,customerId);if(!productionId(assetId))throw Error('NOT_FOUND');const a=await store.get('production-asset',assetId);if(!a||a.customerId!==customerId||a.projectId!==projectId||a.kind!=='image'||!['flux-image-assets-v1','qwen-image-assets-v1'].includes(a.generatedBy))throw Error('NOT_FOUND');
  const folder=await productionDirectory(store,['production-assets',projectId,assetId]),name=preview?'image-preview.png':'image.'+a.extension;if(!['png','jpg','webp'].includes(a.extension))throw Error('FLUX_IMAGE_ARTIFACT_INVALID');const file=path.join(folder,name),expected=preview?a.preview.sha256:a.sha256;
  if(a.path!==path.join(folder,'image.'+a.extension)||a.preview.path!==path.join(folder,'image-preview.png'))throw Error('FLUX_IMAGE_ARTIFACT_INVALID');const bytes=await readProductionFile(file,expected);if(bytes.length!==(preview?a.preview.bytes:a.bytes))throw Error('FLUX_IMAGE_ARTIFACT_CHANGED');const checked=imageMetadata(bytes),info=preview?a.preview:a;if(checked.mime!==info.mime||checked.width!==info.width||checked.height!==info.height)throw Error('FLUX_IMAGE_ARTIFACT_INVALID');return {bytes,path:file,metadata:publicAsset(a)};
 }
 async function loadReference({customerId,projectId,assetId}){
  await owned(projectId,customerId);if(!productionId(assetId))throw Error('FLUX_IMAGE_REFERENCE_NOT_OWNED');
  const generated=await store.get('production-asset',assetId);
  if(generated){
   if(generated.customerId!==customerId||generated.projectId!==projectId||generated.kind!=='image')throw Error('FLUX_IMAGE_REFERENCE_NOT_OWNED');
   const extension=generated.extension||({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[generated.mime]);if(!['png','jpg','webp'].includes(extension))throw Error('FLUX_IMAGE_REFERENCE_INVALID');
   const folder=await productionDirectory(store,['production-assets',projectId,assetId]),file=path.join(folder,'image.'+extension);if(generated.path!==file)throw Error('FLUX_IMAGE_REFERENCE_INVALID');const bytes=await readProductionFile(file,generated.sha256),metadata=imageMetadata(bytes);if(bytes.length!==generated.bytes||metadata.mime!==generated.mime||metadata.width!==generated.width||metadata.height!==generated.height)throw Error('FLUX_IMAGE_REFERENCE_INVALID');return {assetId,bytes,mime:metadata.mime,width:metadata.width,height:metadata.height,sha256:generated.sha256};
  }
  const retained=await store.get('film-reference-retained',assetId);if(!retained||retained.customerId!==customerId||!productionId(retained.projectId)||!Number.isSafeInteger(retained.size)||retained.size<32||retained.size>REFERENCE_LIMIT)throw Error('FLUX_IMAGE_REFERENCE_NOT_OWNED');
  const source=await store.get('film-project',retained.projectId);if(!source||source.customerId!==customerId)throw Error('FLUX_IMAGE_REFERENCE_NOT_OWNED');const folder=await productionDirectory(store,['film-references',retained.projectId]),file=path.join(folder,assetId+'.image'),bindingId=hash('retained-image-reference:'+customerId+':'+assetId),bound=await store.get('production-reference-binding',bindingId),current=source.reference?.id===assetId?source.reference:null;
  if(bound&&(bound.customerId!==customerId||bound.referenceId!==assetId||bound.sourceProjectId!==retained.projectId))throw Error('FLUX_IMAGE_REFERENCE_INVALID');
  const expected=bound?.sha256??current?.sha256??retained.sha256;let bytes;
  if(expected){if(!/^[a-f0-9]{64}$/.test(expected))throw Error('FLUX_IMAGE_REFERENCE_INVALID');bytes=await readProductionFile(file,expected);}else{
   // Older retained rows have no upload hash. Bind the first observed local file;
   // this proves later byte consistency, not original upload authenticity.
   const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const stat=await handle.stat(),entry=await fs.lstat(file);if(!stat.isFile()||entry.isSymbolicLink()||!entry.isFile()||stat.size!==retained.size||stat.size>REFERENCE_LIMIT)throw Error('FLUX_IMAGE_REFERENCE_INVALID');bytes=await handle.readFile();}finally{await handle.close();}await readProductionFile(file,hash(bytes));
  }
  const metadata=imageMetadata(bytes);if(bytes.length!==retained.size||current&&(current.mime!==metadata.mime||current.width!==metadata.width||current.height!==metadata.height||current.sha256!==hash(bytes))||bound&&(bound.sha256!==hash(bytes)||bound.size!==bytes.length||bound.mime!==metadata.mime||bound.width!==metadata.width||bound.height!==metadata.height))throw Error('FLUX_IMAGE_REFERENCE_INVALID');
  await store.transaction(async()=>{await owned(projectId,customerId);const row=await store.get('film-reference-retained',assetId),owner=row?await store.get('film-project',row.projectId):null;if(!row||row.customerId!==customerId||row.projectId!==retained.projectId||row.size!==bytes.length||owner?.customerId!==customerId)throw Error('FLUX_IMAGE_REFERENCE_NOT_OWNED');const old=await store.get('production-reference-binding',bindingId);if(old){if(old.sha256!==hash(bytes)||old.sourceProjectId!==retained.projectId||old.customerId!==customerId)throw Error('FLUX_IMAGE_REFERENCE_INVALID');return;}await store.put('production-reference-binding',{id:bindingId,referenceId:assetId,customerId,sourceProjectId:retained.projectId,sha256:hash(bytes),size:bytes.length,mime:metadata.mime,width:metadata.width,height:metadata.height,provenance:current?.sha256?'upload_metadata':retained.sha256?'retained_metadata':'first_observed_local_file',createdAt:now()});});
  return {assetId,bytes,mime:metadata.mime,width:metadata.width,height:metadata.height,sha256:hash(bytes)};
 }
 async function commitImage(input){
  const {p}=await active(input),request=requestMetadata(input.request,profile);if(editedModel&&!request.referenceIds.length)throw Error('IMAGE_EDIT_REFERENCE_REQUIRED');if(!Buffer.isBuffer(input.bytes)&&!(input.bytes instanceof Uint8Array))throw Error('FLUX_IMAGE_BYTES_REQUIRED');const bytes=Buffer.from(input.bytes),image=imageMetadata(bytes);
  if(!Number.isSafeInteger(input.expectedWidth)||!Number.isSafeInteger(input.expectedHeight)||image.width!==input.expectedWidth||image.height!==input.expectedHeight||request.settings.width!=null&&request.settings.width!==image.width||request.settings.height!=null&&request.settings.height!==image.height)throw Error('FLUX_IMAGE_DIMENSIONS');
  for(const referenceId of request.referenceIds)await loadReference({customerId:input.customerId,projectId:input.projectId,assetId:referenceId});
  const roots=[];for(const referenceId of request.referenceIds){const source=await store.get('production-asset',referenceId);for(const root of (source?.lineage?.rootAssetIds?.length?source.lineage.rootAssetIds:[referenceId])){if(!productionId(root))throw Error('IMAGE_LINEAGE_INVALID');if(!roots.includes(root))roots.push(root);}}if(roots.length>128)throw Error('IMAGE_LINEAGE_INVALID');for(const root of roots)await loadReference({customerId:input.customerId,projectId:input.projectId,assetId:root});const lineage={kind:editedModel||request.referenceIds.length?'edited':'generated',sourceAssetIds:[...request.referenceIds],rootAssetIds:roots};
  const assetId=hash((editedModel?'qwen-image:':'flux-image:')+input.projectId+':'+input.attemptId),sha256=hash(bytes),characterId=input.characterId??null,shotId=input.shotId??null,angle=characterId?angleOf(input.angle):null,binding=hash(JSON.stringify({sha256,request,stageId:input.stageId,characterId,shotId,angle,width:image.width,height:image.height})),token=randomUUID();let existing;
  await store.transaction(async()=>{await active(input);existing=await store.get('production-asset',assetId);if(existing){if(existing.customerId!==input.customerId||existing.binding!==binding)throw Error('FLUX_IMAGE_ALREADY_COMMITTED');return;}const old=await store.get('production-image-intent',input.attemptId);if(old&&old.binding!==binding)throw Error('FLUX_IMAGE_ALREADY_COMMITTED');if(old?.state==='writing')throw Error('FLUX_IMAGE_PENDING');await store.put('production-image-intent',{id:input.attemptId,customerId:input.customerId,projectId:input.projectId,assetId,binding,sha256,mime:image.mime,extension:image.extension,width:image.width,height:image.height,token,state:'writing',startedAt:now()});});
  if(existing){await read({customerId:input.customerId,projectId:input.projectId,assetId});return publicAsset(existing);}
  const temporary=[];
  try{
   const folder=await productionDirectory(store,['production-assets',input.projectId,assetId],{create:true}),source=path.join(folder,'image.'+image.extension),sourceTemp=path.join(folder,'.original-'+token+'.'+image.extension),preview=path.join(folder,'image-preview.png'),previewTemp=path.join(folder,'.preview-'+token+'.png');temporary.push(sourceTemp,previewTemp);
   async function write(file,payload){const h=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);try{await h.writeFile(payload);await h.sync();}finally{await h.close();}}
   await write(sourceTemp,bytes);try{await fs.link(sourceTemp,source);}catch(e){if(e.code!=='EEXIST')throw e;}await readProductionFile(source,sha256);
   // Retain a verified private original even if local thumbnail tooling fails.
   // It is not a ready asset until the thumbnail and ownership commit succeed.
   const previewBytes=await makePreview({file:source,mime:image.mime,width:image.width,height:image.height,maxWidth:320,maxHeight:320});if(!Buffer.isBuffer(previewBytes)||previewBytes.length>512*1024)throw Error('FLUX_IMAGE_PREVIEW_INVALID');const previewImage=imageMetadata(previewBytes);if(previewImage.mime!=='image/png'||previewImage.width>320||previewImage.height>320||previewImage.width>image.width||previewImage.height>image.height)throw Error('FLUX_IMAGE_PREVIEW_INVALID');await write(previewTemp,previewBytes);
   await productionDirectory(store,['production-assets',input.projectId,assetId]);for(const [from,to,digest] of [[sourceTemp,source,sha256],[previewTemp,preview,hash(previewBytes)]]){try{await fs.link(from,to);}catch(e){if(e.code!=='EEXIST')throw e;}await readProductionFile(to,digest);}
   let saved;await store.transaction(async()=>{await active(input);const intent=await store.get('production-image-intent',input.attemptId);if(intent?.token!==token||intent.state!=='writing'||intent.binding!==binding)throw Error('FLUX_IMAGE_PENDING');if(await store.get('production-asset',assetId))throw Error('FLUX_IMAGE_ALREADY_COMMITTED');saved={id:assetId,customerId:input.customerId,projectId:input.projectId,attemptId:input.attemptId,stageId:input.stageId,kind:'image',status:'completed',generatedBy:editedModel?'qwen-image-assets-v1':'flux-image-assets-v1',path:source,extension:image.extension,mime:image.mime,width:image.width,height:image.height,sha256,bytes:bytes.length,preview:{path:preview,mime:previewImage.mime,width:previewImage.width,height:previewImage.height,sha256:hash(previewBytes),bytes:previewBytes.length},characterId,shotId,angle,request,lineage,binding,createdAt:now(),identityVerified:false,qualityCertified:false};await store.put('production-asset',saved);
    if(characterId){const c=p.plan.characters.find(c=>c.id===characterId),reference={id:hash('character-image:'+input.projectId+':'+characterId+':'+angle+':'+assetId),projectId:input.projectId,customerId:input.customerId,characterId,name:c.name,angle,assetId,modelId,revision:request.revision,createdAt:now(),identityVerified:false,sourceAssetIds:lineage.sourceAssetIds,rootAssetIds:lineage.rootAssetIds};await store.put('production-character-reference',reference);}
    await store.put('production-image-intent',{...intent,state:'completed',finishedAt:now()});await store.audit(editedModel?'qwen_image_asset_committed':'flux_image_asset_committed',assetId);
   });return publicAsset(saved);
  }catch(error){await store.transaction(async()=>{const intent=await store.get('production-image-intent',input.attemptId);if(intent?.token===token&&intent.state==='writing')await store.put('production-image-intent',{...intent,state:'failed',finishedAt:now()});});throw error;}
  finally{for(const file of temporary)await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 return {read,loadReference,async reference(input){const result=await read({...input,preview:false});return {...result.metadata,path:result.path};},async commit(input){const key=input.projectId+':'+input.customerId+':'+input.attemptId;if(!Buffer.isBuffer(input.bytes)&&!(input.bytes instanceof Uint8Array))throw Error('FLUX_IMAGE_BYTES_REQUIRED');const bytes=Buffer.from(input.bytes),binding=hash(bytes)+':'+hash(JSON.stringify([input.stageId,input.characterId??null,input.shotId??null,input.angle??null,input.request,input.expectedWidth,input.expectedHeight])),old=pending.get(key);if(old){if(old.binding!==binding)throw Error('FLUX_IMAGE_ALREADY_COMMITTED');return old.promise;}const promise=commitImage({...input,bytes});pending.set(key,{binding,promise});try{return await promise;}finally{pending.delete(key);}}};
}
