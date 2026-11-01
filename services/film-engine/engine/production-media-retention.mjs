import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from './store.mjs';

const SAFE=/^[a-zA-Z0-9_-]{1,100}$/,SHA=/^[a-f0-9]{64}$/;
const TERMINAL=new Set(['completed','cancelled','deleted']);
const LIVE=new Set(['queued','running','starting','ready','stopping','uncertain','recovery_required','cancelling']);
const INTENTS=['production-image-intent','production-video-intent','production-speech-intent','production-assembly-intent','production-artifact-intent'];
const positive=v=>Number.isSafeInteger(v)&&v>0?v:0;
const assetKeys=new Set(['assetId','assetIds','sourceAssetId','sourceAssetIds','referenceId','referenceIds','referenceAssetId','rootAssetIds','chunkAssetIds','videoAssetId','audioAssetId','alignmentAssetId']);
function references(value,out=new Set(),key='',depth=0){
 if(depth>40)return out;
 if(typeof value==='string'){if(assetKeys.has(key)&&SAFE.test(value))out.add(value);return out;}
 if(Array.isArray(value)){for(const v of value)references(v,out,key,depth+1);return out;}
 if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))if(!['story','prompt','spokenText','messages'].includes(k))references(v,out,k,depth+1);
 return out;
}
/** Called within the same store transaction as the deletion decision. Unknown work stays protected. */
export async function productionMediaInUse(store,projectId,{includeResumable=true}={}){
 const p=await store.get('production-project',projectId);
 if(p&&((includeResumable?!TERMINAL.has(p.state):LIVE.has(p.state))||p.cancelRequested&&p.state!=='cancelled'||p.requiresReconcile))return true;
 for(const kind of ['production-stage','production-attempt'])for(const r of await store.all(kind))if(r.projectId===projectId&&(LIVE.has(r.state??r.status)||r.requiresReconcile))return true;
 for(const kind of INTENTS)if((await store.all(kind)).some(r=>(r.projectId===projectId||kind==='production-artifact-intent'&&r.id===projectId)&&r.state==='writing'))return true;
 if((await store.all('engine-test')).some(r=>(r.input?.projectId===projectId||r.projectId===projectId)&&LIVE.has(r.status)))return true;
 return (await store.all('job')).some(r=>r.projectId===projectId&&r.cloudStopped!==true&&LIVE.has(r.status));
}

/** Only owned internal namespaces. No model, reference, export, account, receipt or wallet traversal. */
export function createProductionMediaRetention({store,now=Date.now,retentionMs}){
 if(!Number.isSafeInteger(retentionMs)||retentionMs<1)throw Error('MEDIA_RETENTION_INVALID');
 let sweep=null;
 async function safeDirectory(parts){
  const root=path.resolve(store.folder);if(await fs.realpath(root)!==root)throw Error('MEDIA_INVALID_PATH');let current=root;
  for(const part of parts){if(!SAFE.test(part))throw Error('MEDIA_INVALID_PATH');current=path.join(current,part);let stat;try{stat=await fs.lstat(current);}catch(e){if(e.code==='ENOENT')return null;throw e;}if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(current)!==current)throw Error('MEDIA_INVALID_PATH');}
  return current;
 }
 async function directories(parts){const folder=await safeDirectory(parts);if(!folder)return [];return (await fs.readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&SAFE.test(e.name)).map(e=>e.name);}
 async function leaves(parts){const folder=await safeDirectory(parts);if(!folder)return [];const out=[];for(const e of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,e.name),stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('MEDIA_INVALID_PATH');out.push({file,name:e.name,stat});}return out;}
 const knownFile=name=>/^(?:image\.(?:png|jpg|webp)|image-preview\.png|(?:native|video|group)\.mp4|audio\.(?:wav|mp3|flac|m4a|aac)|alignment\.json)$/.test(name)||/^\.(?:original|preview|native|timeline|upload|speech|working|pending)-[a-zA-Z0-9_-]+\.(?:png|jpg|webp|mp4|wav)$/.test(name)||/^(?:audio\.wav|video\.mp4|alignment\.json)\.[a-zA-Z0-9_-]+\.part$/.test(name);
 async function protectedAssets(projects,assets){
  const out=new Set();
  // Explicit reference libraries survive film expiry; history alone is not a live reference.
  for(const kind of ['production-character-reference','production-reference-binding','voice-profile','voice-reference','sfx-import','film-reference-retained'])for(const r of await store.all(kind))references(r,out);
  for(const p of projects){references({referenceIds:p.referenceIds,plan:{referenceIds:p.plan?.referenceIds,characters:(p.plan?.characters??[]).map(c=>({referenceIds:c.referenceIds})),shots:(p.plan?.shots??[]).map(s=>({referenceIds:s.referenceIds}))}},out);if(!TERMINAL.has(p.state)||await productionMediaInUse(store,p.id))references(p,out);}
  for(const r of await store.all('engine-test'))if(r.verified===true||LIVE.has(r.status)){for(const a of r.artifacts??[])if(SAFE.test(a.id??''))out.add(a.id);references(r.input,out);}
  let changed=true;while(changed){changed=false;for(const a of assets)if(out.has(a.id)){const n=out.size;references(a,out);if(out.size!==n)changed=true;}}
  return out;
 }
 async function eligible(p,rows,files,policyStart){
  const current=await store.get('production-project',p.id);if(!current||current.customerId!==p.customerId||!TERMINAL.has(current.state)||await productionMediaInUse(store,p.id))return false;
  const film=await store.get('film-project',p.id);if(film&&film.customerId!==p.customerId)return false;
  if(film&&(film.state==='generating'||film.merge?.status==='running'||film.textPending||film.reviewPending||film.launch?.state==='starting'))return false;
  const result=await store.get('production-result',p.id);if(result&&result.customerId!==p.customerId)return false;
  const dates=[current.createdAt,current.updatedAt,current.completedAt,current.cancelledAt,result?.createdAt,film?.merge?.mediaCreatedAt,film?.merge?.completedAt,...rows.flatMap(r=>[r.createdAt,r.finishedAt,r.completedAt]),...files.map(f=>Math.trunc(f.stat.mtimeMs))].map(positive);
  // Unstamped historical data gets a full retention interval from this policy's first activation.
  if(!rows.length||rows.some(r=>![r.createdAt,r.finishedAt,r.completedAt].some(positive)))dates.push(policyStart);
  return Math.max(...dates)+retentionMs<=now();
 }
 async function removeUnit(parts,p,rows,assetRows,policyStart){
  return store.transaction(async()=>{
   const files=await leaves(parts);if(!files.length&&!rows.length)return {removed:0,bytes:0};
   if(files.some(f=>!knownFile(f.name))||!await eligible(p,rows,files,policyStart))return {removed:0,bytes:0};
   const projects=await store.all('production-project'),allAssets=await store.all('production-asset'),protectedIds=await protectedAssets(projects,allAssets);
   const unitPath=path.resolve(store.folder,...parts);if(allAssets.some(a=>(a.id===parts[2]&&parts[0]==='production-assets'||typeof a.path==='string'&&path.dirname(path.resolve(a.path))===unitPath)&&(a.customerId!==p.customerId||a.projectId!==p.id)))return {removed:0,bytes:0};
   if(assetRows.some(a=>protectedIds.has(a.id)))return {removed:0,bytes:0};
   // An unexpected ledger/path/owner change means uncertain ownership, never permission to erase.
   for(const a of assetRows){const fresh=await store.get('production-asset',a.id);if(!fresh||fresh.customerId!==p.customerId||fresh.projectId!==p.id||fresh.path!==a.path||path.dirname(path.resolve(a.path??''))!==path.resolve(store.folder,...parts))return {removed:0,bytes:0};}
   for(const r of rows)if(r.customerId&&r.customerId!==p.customerId)return {removed:0,bytes:0};
   for(const f of files)await fs.unlink(f.file).catch(e=>{if(e.code!=='ENOENT')throw e;});
   for(const a of assetRows){await store.delete('production-asset',a.id);await store.put('production-media-removal',{id:hash('production-media:'+a.id),projectId:p.id,customerId:p.customerId,assetId:a.id,sha256:a.sha256??null,removedAt:now(),reason:'expired'});}
   for(const row of rows)if(row.__kind==='production-assembly')await store.delete('production-assembly',row.id);
   await store.audit('production_media_expired',hash(parts.join('/')));
   const folder=await safeDirectory(parts);if(folder)await fs.rmdir(folder).catch(e=>{if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(e.code))throw e;});
   return {removed:files.length,bytes:files.reduce((n,f)=>n+f.stat.size,0)};
  });
 }
 async function run(){
  let policy=await store.get('production-media-policy','internal-seven-days');if(!policy)await store.transaction(async()=>{policy=await store.get('production-media-policy','internal-seven-days');if(!policy){policy={id:'internal-seven-days',startedAt:now(),retentionMs};await store.put('production-media-policy',policy);}});
  const stats={removedFiles:0,removedBytes:0,deferred:0},projects=await store.all('production-project');
  for(const p of projects){if(!SAFE.test(p.id??'')||!SAFE.test(p.customerId??''))continue;
   const assets=(await store.all('production-asset')).filter(a=>a.projectId===p.id),assemblies=(await store.all('production-assembly')).filter(a=>a.projectId===p.id);
   for(const root of ['production-assets','production-groups'])try{
    const storedIds=root==='production-assets'?assets.filter(a=>a.generatedBy!=='production-assembly-v1').map(a=>a.id):[...assemblies,...assets.filter(a=>a.generatedBy==='production-assembly-v1')].map(a=>a.groupId);
    for(const id of new Set([...(await directories([root,p.id])),...storedIds.filter(v=>SAFE.test(v??''))])){
     const fingerprints=new Set([...(root==='production-groups'?await directories([root,p.id,id]):[]),...[...assemblies,...assets].filter(a=>a.groupId===id).map(a=>a.inputFingerprint)]);
     const units=root==='production-assets'?[[root,p.id,id]]:[...fingerprints].filter(v=>SHA.test(v??'')).map(v=>[root,p.id,id,v]);
     for(const parts of units){
      const unitAssets=assets.filter(a=>root==='production-assets'?a.id===id:a.groupId===id&&a.inputFingerprint===parts[3]);
      const rows=root==='production-assets'?unitAssets:[...unitAssets,...assemblies.filter(a=>a.groupId===id&&a.inputFingerprint===parts[3]).map(a=>({...a,__kind:'production-assembly'}))];
      try{const result=await removeUnit(parts,p,rows,unitAssets,policy.startedAt);stats.removedFiles+=result.removed;stats.removedBytes+=result.bytes;}catch{stats.deferred++;await store.put('film-alert',{id:hash('production-cleanup:'+parts.join('/')),reason:'PRODUCTION_MEDIA_CLEANUP_PENDING',subject:p.id,createdAt:now(),acknowledged:false});}
     }
    }
   }catch{stats.deferred++;}
  }
  return stats;
 }
 return {cleanup(){if(sweep)return sweep;const current=run();sweep=current;return current.finally(()=>{if(sweep===current)sweep=null;});}};
}
