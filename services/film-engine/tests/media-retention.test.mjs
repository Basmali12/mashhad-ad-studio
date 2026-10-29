import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,symlink,link} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {createFilmMediaLibrary,MEDIA_RETENTION_MS} from '../engine/film-media-library.mjs';
async function fixture(t){
 const folder=await mkdtemp(path.join(tmpdir(),'film-media-retention-')),store=new Store(folder,randomBytes(32).toString('base64'));let time=Date.now();
 const library=createFilmMediaLibrary({store,now:()=>time});await library.initialize();
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 async function asset(customerId='alice',{verified=true,rawOnly=false}={}){const p={id:randomUUID(),customerId,name:'فيلم حقيقي محفوظ',state:'completed',scenes:[]},j={id:randomUUID(),projectId:p.id,tenantId:customerId,action:'generate',sceneId:'scene-0',status:verified?'completed':'failed',cloudStopped:true,finishedAt:time,result:verified?{videoVerified:true,recordedCost:{usd:'0.1'}}:null};p.scenes=[{jobId:j.id,status:'done',attempted:true}];store.put('film-project',p);store.put('job',j);const dir=path.join(folder,'artifacts',j.id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,rawOnly?'raw-ltx.mp4':'video.mp4'),Buffer.alloc(128,1));await writeFile(path.join(dir,'last-frame.png'),Buffer.alloc(32,2));await writeFile(path.join(dir,'audit.json'),'financial receipt remains');return {p,j,dir};}
 return {folder,store,library,asset,now:()=>time,advance:n=>time+=n};
}
const missing=async file=>assert.rejects(lstat(file),{code:'ENOENT'});
test('seven-day expiry revokes access before cleanup, removes media rows and files, preserves receipts, ledgers, models and legacy results',async t=>{
 const f=await fixture(t),a=await f.asset();const outside=path.join(f.folder,'models');await mkdir(outside);await writeFile(path.join(outside,'video.mp4'),'model volume marker');
 const legacyId=randomUUID(),legacyDir=path.join(f.folder,'artifacts',legacyId);await mkdir(legacyDir);await writeFile(path.join(legacyDir,'video.mp4'),'successful legacy benchmark');f.store.put('job',{id:legacyId,action:'generate',status:'completed',cloudStopped:true,result:{videoVerified:true},finishedAt:f.now()});
 f.store.put('film-ledger',{id:'immutable-charge',microUSD:-12345});f.store.put('scene',{id:'scene-lock',jobId:a.j.id,status:'completed',artifact:'/video'});a.j.sceneKey='scene-lock';f.store.put('job',a.j);
 const list=await f.library.list('alice');assert.equal(list.length,1);assert.equal(list[0].expiresAt,f.now()+MEDIA_RETENTION_MS);f.advance(MEDIA_RETENTION_MS-1);assert.equal(await f.library.sceneAvailable(a.p,a.j),true);
 f.advance(1);assert.equal(await f.library.accessible(a.p,a.j,0),false);assert.equal((await f.library.list('alice')).length,0);await f.library.cleanup();
 await missing(path.join(a.dir,'video.mp4'));await missing(path.join(a.dir,'last-frame.png'));assert.equal(f.store.get('film-media',list[0].id),null);assert.equal(f.store.get('job',a.j.id).result.videoVerified,false);assert.equal(f.store.get('scene','scene-lock').artifact,undefined);
 assert.equal(await readFile(path.join(a.dir,'audit.json'),'utf8'),'financial receipt remains');assert.equal(await readFile(path.join(outside,'video.mp4'),'utf8'),'model volume marker');assert.equal(await readFile(path.join(legacyDir,'video.mp4'),'utf8'),'successful legacy benchmark');assert.equal(f.store.get('film-ledger','immutable-charge').microUSD,-12345);
});
test('ownership and active work prevent manual deletion; restart cannot reset the deadline',async t=>{
 const f=await fixture(t),a=await f.asset(),b=await f.asset('bob');const [file]=await f.library.list('alice');assert.equal((await f.library.list('bob')).length,1);
 await assert.rejects(f.library.get(file.id,'bob'),/NOT_FOUND/);await assert.rejects(f.library.remove(file.id,'bob'),/NOT_FOUND/);
 a.p.state='generating';f.store.put('film-project',a.p);await assert.rejects(f.library.remove(file.id,'alice'),/MEDIA_IN_USE/);assert.ok(await lstat(path.join(a.dir,'video.mp4')));
 f.advance(MEDIA_RETENTION_MS);await f.library.cleanup();assert.ok(await lstat(path.join(a.dir,'video.mp4')));await missing(path.join(b.dir,'video.mp4'));
 a.p.state='completed';f.store.put('film-project',a.p);const restarted=createFilmMediaLibrary({store:f.store,now:f.now});await restarted.initialize();await restarted.cleanup();await missing(path.join(a.dir,'video.mp4'));
});
test('merged deletion removes export hardlinks and metadata, retaining source scene until its own deadline',async t=>{
 const f=await fixture(t),a=await f.asset(),dir=path.join(f.folder,'film-exports',a.p.id,'a'.repeat(64));await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'merged.mp4'),Buffer.alloc(200,3));await link(path.join(a.dir,'video.mp4'),path.join(dir,'scene-0.mp4'));await writeFile(path.join(dir,'concat.txt'),'scene-0.mp4');
 a.p.merge={status:'completed',path:path.join(dir,'merged.mp4'),sha256:'b'.repeat(64),completedAt:f.now()};f.store.put('film-project',a.p);
 const files=await f.library.list('alice'),film=files.find(e=>e.kind==='film');assert.equal(files.length,2);await f.library.remove(film.id,'alice');await missing(dir);assert.ok(await lstat(path.join(a.dir,'video.mp4')));assert.equal(f.store.get('film-project',a.p.id).merge.status,'deleted');assert.equal(f.store.get('film-media',film.id),null);
 await f.library.cleanup();assert.equal((await f.library.list('alice')).filter(e=>e.kind==='film').length,0);
});
test('failed partial raw outputs are not advertised as playable and are reclaimed after seven days',async t=>{
 const f=await fixture(t),a=await f.asset('alice',{verified:false,rawOnly:true});assert.deepEqual(await f.library.list('alice'),[]);assert.equal(f.store.all('film-media')[0].state,'unverified');f.advance(MEDIA_RETENTION_MS);await f.library.cleanup();await missing(path.join(a.dir,'raw-ltx.mp4'));assert.equal(f.store.all('film-media').length,0);
});
test('symlink escape cannot delete another directory',async t=>{
 const f=await fixture(t),a=await f.asset(),outside=path.join(f.folder,'protected-other');await mkdir(outside);await writeFile(path.join(outside,'private.mp4'),'protected');const [file]=await f.library.list('alice');await symlink(outside,path.join(a.dir,'escape'),'junction');
 await assert.rejects(f.library.remove(file.id,'alice'),/MEDIA_INVALID_PATH/);assert.equal(await readFile(path.join(outside,'private.mp4'),'utf8'),'protected');assert.equal(f.store.get('film-media',file.id).state,'deleting');assert.equal(await f.library.accessible(a.p,a.j,0),false);
});
