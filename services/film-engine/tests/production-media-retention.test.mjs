import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {createProductionMediaRetention} from '../engine/production-media-retention.mjs';
import {createFilmMediaLibrary,MEDIA_RETENTION_MS} from '../engine/film-media-library.mjs';
const missing=file=>assert.rejects(fs.lstat(file),{code:'ENOENT'});
async function fixture(t){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'production-retention-')),store=new Store(folder,randomBytes(32).toString('base64'));let time=Date.now();
 const retention=()=>createProductionMediaRetention({store,now:()=>time,retentionMs:MEDIA_RETENTION_MS}),api=retention();
 t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});
 function project(id='project',customerId='alice',state='completed'){const p={id,customerId,state,createdAt:time,updatedAt:time};store.put('production-project',p);return p;}
 async function asset(id='asset',p=store.get('production-project','project'),{group=false,registered=true}={}){
  const parts=group?['production-groups',p.id,'chapter', 'a'.repeat(64)]:['production-assets',p.id,id],dir=path.join(folder,...parts);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,group?'group.mp4':'video.mp4');await fs.writeFile(file,'synthetic retained media');await fs.utimes(file,time/1000,time/1000);
  const row={id,customerId:p.customerId,projectId:p.id,path:file,kind:'video',sha256:'b'.repeat(64),createdAt:time,...(group?{generatedBy:'production-assembly-v1',groupId:'chapter',inputFingerprint:'a'.repeat(64)}:{})};
  if(registered)store.put('production-asset',row);if(group)store.put('production-assembly',{id:'assembly-'+id,assetId:id,projectId:p.id,customerId:p.customerId,groupId:'chapter',inputFingerprint:'a'.repeat(64),createdAt:time});return {...row,dir};
 }
 await api.cleanup();return {folder,store,api,project,asset,retention,now:()=>time,advance:n=>time+=n};
}
test('expiry cleans only internal completed media and groups, preserves current finals, immutable accounting and reference roots',async t=>{
 const f=await fixture(t),p=f.project(),a=await f.asset('clip'),g=await f.asset('group',p,{group:true}),ref=await f.asset('character');f.store.put('production-character-reference',{id:'portrait',customerId:'alice',projectId:p.id,assetId:ref.id});
 const protectedPath=path.join(f.folder,'production-audio-references','alice','voice','audio.wav');await fs.mkdir(path.dirname(protectedPath),{recursive:true});await fs.writeFile(protectedPath,'voice');const final=path.join(f.folder,'film-exports',p.id,'c'.repeat(64),'merged.mp4');await fs.mkdir(path.dirname(final),{recursive:true});await fs.writeFile(final,'final');f.store.put('film-ledger',{id:'money',microUSD:123});f.store.put('production-charge',{id:'charge',settled:456});
 f.advance(MEDIA_RETENTION_MS-1);assert.equal((await f.api.cleanup()).removedFiles,0);await fs.lstat(a.path);f.advance(2);const result=await f.api.cleanup();assert.equal(result.removedFiles,2);await missing(a.path);await missing(g.path);assert.equal(f.store.get('production-asset',a.id),null);assert.equal(f.store.get('production-assembly','assembly-group'),null);await fs.lstat(ref.path);await fs.lstat(protectedPath);await fs.lstat(final);assert.equal(f.store.get('film-ledger','money').microUSD,123);assert.equal(f.store.get('production-charge','charge').settled,456);assert.equal(f.store.all('production-media-removal').length,2);
});
test('active, failed-resumable, queued, uncertain, writing and customer-isolated projects survive while independent expired assets are collected',async t=>{
 const f=await fixture(t),blocked=[];for(const state of ['draft','planned','running','failed','needs_review','queued']){const p=f.project(state,'alice',state);blocked.push(await f.asset(state,p));}
 for(const [id,kind,row] of [['attempt','production-attempt',{status:'uncertain'}],['stage','production-stage',{state:'running'}],['writing','production-image-intent',{state:'writing'}],['cloud','job',{status:'ready',cloudStopped:false}],['test','engine-test',{status:'running',input:{projectId:'test'}}]]){const p=f.project(id);blocked.push(await f.asset(id,p));f.store.put(kind,{id:'live-'+id,projectId:id,customerId:'alice',...row});}
 const independent=await f.asset('independent',f.project('bobproject','bob'));f.advance(MEDIA_RETENTION_MS+1);await f.api.cleanup();for(const a of blocked)await fs.lstat(a.path);await missing(independent.path);
});
test('current final retention extends internal sources and completed source references remain transitively protected',async t=>{
 const f=await fixture(t),p=f.project(),a=await f.asset('source'),anchor=await f.asset('anchor');f.store.put('production-asset',{...anchor,lineage:{rootAssetIds:[a.id]}});f.store.put('production-reference-binding',{id:'retained-anchor',referenceId:anchor.id,customerId:'alice'});const other=await f.asset('other');f.advance(MEDIA_RETENTION_MS);f.store.put('production-result',{id:p.id,projectId:p.id,customerId:p.customerId,createdAt:f.now()});await f.api.cleanup();await fs.lstat(other.path);f.advance(MEDIA_RETENTION_MS+1);await f.api.cleanup();await missing(other.path);await fs.lstat(a.path);await fs.lstat(anchor.path);
});
test('restart and concurrent sweeps safely repeat cleanup, including a crash after unlink before metadata commit',async t=>{
 const f=await fixture(t);f.project();const a=await f.asset();f.advance(MEDIA_RETENTION_MS+1);await fs.unlink(a.path);await fs.rmdir(a.dir);const restarted=f.retention();const results=await Promise.all([restarted.cleanup(),restarted.cleanup()]);assert.equal(results.length,2);assert.equal(f.store.get('production-asset',a.id),null);assert.equal(f.store.all('production-media-removal').length,1);assert.equal((await f.retention().cleanup()).removedFiles,0);
});
test('orphan temporaries get full rollout grace and are reclaimed without touching unknown files or namespaces',async t=>{
 const f=await fixture(t);const p=f.project();const a=await f.asset('orphan',p,{registered:false});await fs.rename(a.path,path.join(a.dir,'.working-abcd.mp4'));const unknown=await f.asset('unknown',p,{registered:false});await fs.writeFile(path.join(unknown.dir,'customer-notes.txt'),'preserve');const elsewhere=path.join(f.folder,'models','x.mp4');await fs.mkdir(path.dirname(elsewhere),{recursive:true});await fs.writeFile(elsewhere,'weights');assert.equal((await f.api.cleanup()).removedFiles,0);f.advance(MEDIA_RETENTION_MS+1);await f.api.cleanup();await missing(path.join(a.dir,'.working-abcd.mp4'));await fs.lstat(unknown.path);await fs.lstat(elsewhere);
});
test('symlink ancestors or children and mismatched ledger ownership never authorize deletion',async t=>{
 const f=await fixture(t);f.project();const a=await f.asset(),foreign=await f.asset('foreign');f.store.put('production-asset',{...foreign,customerId:'bob'});const outside=path.join(f.folder,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.mp4'),'private');await fs.symlink(outside,path.join(a.dir,'escape'),'junction');f.advance(MEDIA_RETENTION_MS+1);await f.api.cleanup();await fs.lstat(path.join(outside,'private.mp4'));await fs.lstat(a.path);await fs.lstat(foreign.path);
});
test('new production started while cleanup is waiting on the transaction is protected before physical deletion',async t=>{
 const f=await fixture(t),p=f.project(),a=await f.asset();f.advance(MEDIA_RETENTION_MS+1);let release;const barrier=new Promise(r=>release=r),started=f.store.transaction(async()=>{await barrier;f.store.put('production-project',{...p,state:'running'});});const pending=f.api.cleanup();release();await started;await pending;await fs.lstat(a.path);
});
test('existing media sweep invokes internal cleanup and manual final deletion refuses production stages and intents',async t=>{
 const f=await fixture(t),p=f.project(),a=await f.asset(),folder=path.join(f.folder,'film-exports',p.id,'d'.repeat(64));await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'merged.mp4'),'final');f.store.put('film-project',{id:p.id,customerId:p.customerId,name:'fixture',state:'completed',merge:{status:'completed',path:path.join(folder,'merged.mp4'),completedAt:f.now()}});const library=createFilmMediaLibrary({store:f.store,now:f.now});const [media]=await library.list(p.customerId);f.store.put('production-stage',{id:'newstage',projectId:p.id,customerId:p.customerId,state:'running'});await assert.rejects(library.remove(media.id,p.customerId),/MEDIA_IN_USE/);f.store.delete('production-stage','newstage');f.advance(MEDIA_RETENTION_MS+1);await library.cleanup();await missing(a.path);await missing(path.join(folder,'merged.mp4'));
});

test('explicit plan references protect completed source assets across projects without making unused outputs immortal',async t=>{
 const f=await fixture(t),source=f.project('source'),a=await f.asset('reference',source),unused=await f.asset('unused',source),consumer=f.project('consumer');f.store.put('production-project',{...consumer,referenceIds:[a.id],plan:{referenceIds:[a.id]}});f.advance(MEDIA_RETENTION_MS+1);await f.api.cleanup();await fs.lstat(a.path);await missing(unused.path);
});
test('legacy media deletion rechecks new production after marking intent and never deletes in the gap',async t=>{
 const f=await fixture(t),p=f.project(),folder=path.join(f.folder,'film-exports',p.id,'e'.repeat(64));await fs.mkdir(folder,{recursive:true});const file=path.join(folder,'merged.mp4');await fs.writeFile(file,'final');f.store.put('film-project',{id:p.id,customerId:p.customerId,name:'fixture',state:'completed',merge:{status:'completed',path:file,completedAt:f.now()}});const library=createFilmMediaLibrary({store:f.store,now:f.now}),[media]=await library.list(p.customerId),put=f.store.put.bind(f.store);f.store.put=(kind,row)=>{const result=put(kind,row);if(kind==='film-media'&&row.state==='deleting')put('production-project',{...p,state:'running'});return result;};await assert.rejects(library.remove(media.id,p.customerId),/MEDIA_IN_USE/);await fs.lstat(file);assert.equal(f.store.get('film-media',media.id).state,'deleting');
});
