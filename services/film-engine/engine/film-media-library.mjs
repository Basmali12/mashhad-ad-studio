import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from './store.mjs';
export const MEDIA_RETENTION_MS=7*86400000;
const SAFE=/^[a-zA-Z0-9_-]{1,100}$/;
const mediaExtension=/\.(?:mp4|mov|mkv|webm|wav|mp3|flac|aac|png|jpe?g|webp)$/i;
const instant=v=>Number.isSafeInteger(v)&&v>0?v:null;
/** Customer generated assets only. Never visits model, reference, scheduler or legacy benchmark folders. */
export function createFilmMediaLibrary({store,now=Date.now}){
 let busy=false;
 async function policy(){let p=await store.get('film-media-policy','seven-days');if(!p)await store.transaction(async()=>{p=await store.get('film-media-policy','seven-days');if(!p){p={id:'seven-days',startedAt:now(),retentionMs:MEDIA_RETENTION_MS};await store.put('film-media-policy',p);}});return p;}
 async function deadline(record){const p=await policy();return (instant(record.mediaCreatedAt)||instant(record.finishedAt)||instant(record.completedAt)||instant(record.createdAt)||p.startedAt)+MEDIA_RETENTION_MS;}
 async function sceneAvailable(p,j){return !!(j&&j.tenantId===p.customerId&&j.projectId===p.id&&j.result?.videoVerified&&!j.mediaRemovedAt&&await deadline(j)>now());}
 async function filmAvailable(p){return !!(p.merge?.status==='completed'&&!p.merge.removedAt&&await deadline(p.merge)>now());}
 async function safeFolder(root,id){
  if(!SAFE.test(id||''))throw Error('MEDIA_INVALID_PATH');
  const base=path.resolve(store.folder,root),target=path.resolve(base,id);
  if(path.dirname(target)!==base)throw Error('MEDIA_INVALID_PATH');
  // Reject symlinked ancestors too, not just a symlink at the final filename.
  let current=path.resolve(store.folder);for(const part of [root,id]){current=path.join(current,part);try{const s=await fs.lstat(current);if(s.isSymbolicLink()||!s.isDirectory())throw Error('MEDIA_INVALID_PATH');}catch(e){if(e.code==='ENOENT')return target;throw e;}}
  if(await fs.realpath(path.resolve(store.folder))!==path.resolve(store.folder))throw Error('MEDIA_INVALID_PATH');return target;
 }
 async function exportFolder(p){
  if(!p.merge?.path)return null;
  const root=await safeFolder('film-exports',p.id),target=path.resolve(p.merge.path),relative=path.relative(root,target);
  if(!/^[a-f0-9]{64}[\\/]merged\.mp4$/.test(relative))throw Error('MEDIA_INVALID_PATH');
  const folder=path.dirname(target);try{const s=await fs.lstat(folder);if(s.isSymbolicLink()||!s.isDirectory())throw Error('MEDIA_INVALID_PATH');}catch(e){if(e.code!=='ENOENT')throw e;}
  return folder;
 }
 async function present(file){try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('MEDIA_INVALID_PATH');return stat.size;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function mediaBytes(folder){let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return 0;throw e;}let size=0;for(const e of entries){const file=path.join(folder,e.name),s=await fs.lstat(file);if(s.isSymbolicLink())throw Error('MEDIA_INVALID_PATH');if(s.isDirectory())size+=await mediaBytes(file);else if(s.isFile()&&mediaExtension.test(e.name))size+=s.size;}return size;}
 async function sync(customerId=null){
  const projects=(await store.all('film-project')).filter(p=>!customerId||p.customerId===customerId),jobs=await store.all('job');await policy();
  for(const p of projects){if(!SAFE.test(p.id)||!SAFE.test(p.customerId))continue;
   for(const j of jobs.filter(j=>j.action==='generate'&&j.projectId===p.id&&j.tenantId===p.customerId)){
    const found=(p.scenes||[]).findIndex(s=>s.jobId===j.id||s.quoteId&&s.quoteId===j.quoteId),index=found>=0?found:/^scene-([0-9]|[12][0-9])$/.test(j.sceneId||'')?Number(j.sceneId.slice(6)):0;if(!j||j.tenantId!==p.customerId||j.projectId!==p.id||j.mediaRemovedAt||!SAFE.test(j.id))continue;
    const key=hash('scene:'+j.id),old=await store.get('film-media',key);if(old&&(old.state!=='unverified'||!j.result?.videoVerified))continue;
    const folder=await safeFolder('artifacts',j.id),bytes=await present(path.join(folder,'video.mp4')),total=bytes||await mediaBytes(folder);if(!total)continue;
    const expiresAt=await deadline(j);await store.put('film-media',{id:key,customerId:p.customerId,projectId:p.id,jobId:j.id,index,kind:'scene',name:p.name+' — المشهد '+(index+1),createdAt:expiresAt-MEDIA_RETENTION_MS,expiresAt,bytes:bytes||total,state:j.result?.videoVerified&&bytes?'ready':'unverified'});
   }
   if(p.merge?.status==='completed'&&!p.merge.removedAt){const folder=await exportFolder(p);if(!folder)continue;const key=hash('film:'+p.id+':'+path.basename(folder));if(await store.get('film-media',key))continue;const bytes=await present(path.join(folder,'merged.mp4'));if(bytes===null)continue;const expiresAt=await deadline(p.merge);await store.put('film-media',{id:key,customerId:p.customerId,projectId:p.id,index:'merged',kind:'film',name:p.name,createdAt:expiresAt-MEDIA_RETENTION_MS,expiresAt,bytes,state:'ready'});}
  }
 }
 async function list(customerId){await sync(customerId);return (await store.all('film-media')).filter(e=>e.customerId===customerId&&e.state==='ready'&&e.expiresAt>now()).map(({id,projectId,index,kind,name,createdAt,expiresAt,bytes})=>({id,projectId,index,kind,name,createdAt,expiresAt,bytes})).sort((a,b)=>b.createdAt-a.createdAt);}
 async function inUse(p){return p.state==='generating'||p.merge?.status==='running'||p.textPending||p.reviewPending||p.launch?.state==='starting'||(await store.all('job')).some(j=>j.projectId===p.id&&j.cloudStopped!==true&&['queued','running','stopping','uncertain','recovery_required'].includes(j.status));}
 async function eraseMedia(folder){
  let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const entry of entries){const file=path.join(folder,entry.name),stat=await fs.lstat(file);if(stat.isSymbolicLink())throw Error('MEDIA_INVALID_PATH');if(stat.isDirectory()){await eraseMedia(file);try{await fs.rmdir(file);}catch(e){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(e.code))throw e;}}else if(stat.isFile()&&mediaExtension.test(entry.name))await fs.unlink(file);}
 }
 async function remove(id,customerId,reason='customer'){
  let e,p;await store.transaction(async()=>{
   e=await store.get('film-media',id);if(!e||e.customerId!==customerId)throw Error('NOT_FOUND');p=await store.get('film-project',e.projectId);if(!p||p.customerId!==customerId)throw Error('NOT_FOUND');if(await inUse(p))throw Error('MEDIA_IN_USE');
   e.state='deleting';e.reason=reason;await store.put('film-media',e);
  });
  if(e.kind==='scene')await eraseMedia(await safeFolder('artifacts',e.jobId));
  else{const folder=await exportFolder(p);if(folder){await eraseMedia(folder);for(const name of ['concat.txt'])await fs.unlink(path.join(folder,name)).catch(err=>{if(err.code!=='ENOENT')throw err;});try{await fs.rmdir(folder);}catch(err){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(err.code))throw err;}}}
  await store.transaction(async()=>{
   const current=await store.get('film-project',p.id);
   if(e.kind==='scene'){const j=await store.get('job',e.jobId);if(j&&j.tenantId===customerId){j.mediaRemovedAt=now();j.mediaRemovalReason=reason;if(j.result)j.result.videoVerified=false;delete j.previousFrame;await store.put('job',j);if(j.sceneKey){const scene=await store.get('scene',j.sceneKey);if(scene?.jobId===j.id){delete scene.artifact;scene.mediaRemovedAt=now();await store.put('scene',scene);}}}}
   else if(current?.customerId===customerId){current.merge={status:'deleted',removedAt:now(),reason};await store.put('film-project',current);}
   for(const t of await store.all('film-media-ticket'))if(t.projectId===p.id&&(e.kind==='film'?!!t.mergeSHA:t.jobId===e.jobId))await store.delete('film-media-ticket',t.id);
   await store.delete('film-media',e.id);await store.audit('film_media_removed_'+reason,e.id);
  });return {removed:true};
 }
 async function accessible(p,j,index){if(index==='merged'){if(!await filmAvailable(p))return false;}else if(!await sceneAvailable(p,j))return false;return !(await store.all('film-media')).some(e=>e.projectId===p.id&&(index==='merged'?e.kind==='film':e.jobId===j?.id)&&(e.state==='deleting'||e.expiresAt<=now()));}
 async function cleanup(){if(busy)return;busy=true;try{await sync();for(const e of await store.all('film-media'))if(e.expiresAt<=now()||e.state==='deleting')try{await remove(e.id,e.customerId,e.reason||'expired');}catch{const key=hash('media-cleanup:'+e.id);if(!await store.get('film-alert',key)){await store.put('film-alert',{id:key,reason:'MEDIA_CLEANUP_PENDING',subject:e.id,createdAt:now(),acknowledged:false});await store.audit('film_media_cleanup_deferred',e.id);}}}finally{busy=false;}}
 return {initialize:policy,list,sync,remove,cleanup,sceneAvailable,filmAvailable,accessible,deadline,async get(id,customerId){const e=await store.get('film-media',id);if(!e||e.customerId!==customerId||e.state!=='ready'||e.expiresAt<=now())throw Error('NOT_FOUND');return e;}};
}
