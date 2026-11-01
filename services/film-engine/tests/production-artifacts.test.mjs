import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store,hash} from '../engine/store.mjs';
import {createFilmMediaLibrary} from '../engine/film-media-library.mjs';
import {createProductionArtifacts,verifyLocalVideo} from '../engine/production-artifacts.mjs';

const exec=promisify(execFile),mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom00000000000000000000')]);
async function fixture(t,{verifyVideo}={}){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'production-final-')),store=new Store(folder,randomBytes(32).toString('base64'));let verified=0;
 store.put('production-project',{id:'project-one',customerId:'alice',title:'فيلم جديد',durationMs:1000,state:'running'});
 const verifier=verifyVideo|| (async()=>{verified++;return {durationMs:1000,width:720,height:1280,hasAudio:true,fps:24,checker:'mock_fixture'};});
 const artifacts=createProductionArtifacts({store,verifyVideo:verifier}),input={projectId:'project-one',customerId:'alice',bytes:mp4,expectedDurationMs:1000,hasAudio:true};
 t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});return {folder,store,artifacts,input,verified:()=>verified};
}
test('trusted final commit exposes only the complete owned film, preserves chat and is idempotent',async t=>{
 const f=await fixture(t);f.store.put('film-project',{id:'project-one',customerId:'alice',name:'اسم محفوظ',messages:[{role:'user',content:'قصة محفوظة'}],pinned:true,scenes:[]});
 const [a,b]=await Promise.all([f.artifacts.commitFinal(f.input),f.artifacts.commitFinal(f.input)]);assert.equal(a.artifactId,b.artifactId);assert.equal(a.mediaReady,true);assert.equal(a.bytes,mp4.length);assert.equal(a.sha256,hash(mp4));assert.ok(!JSON.stringify(a).includes(f.folder));assert.equal(f.verified(),1);
 const library=createFilmMediaLibrary({store:f.store}),list=await library.list('alice',{finalOnly:true});assert.equal(list.length,1);assert.equal(list[0].kind,'film');assert.equal(list[0].index,'merged');assert.equal(list[0].name,'اسم محفوظ');assert.deepEqual(await library.list('bob',{finalOnly:true}),[]);
 const saved=f.store.get('film-project','project-one');assert.equal(saved.messages[0].content,'قصة محفوظة');assert.equal(saved.pinned,true);assert.equal(saved.merge.nativeAudio,false);
 const read=await f.artifacts.readFinal({projectId:'project-one',customerId:'alice'});assert.deepEqual(read.bytes,mp4);assert.equal((await f.artifacts.commitFinal(f.input)).artifactId,a.artifactId);assert.equal(f.verified(),1);
});
test('ownership, cancellation, attempt identity and duration reject before final registration',async t=>{
 const f=await fixture(t);await assert.rejects(f.artifacts.commitFinal({...f.input,customerId:'bob'}),/NOT_FOUND/);await assert.rejects(f.artifacts.commitFinal({...f.input,expectedDurationMs:2000}),/DURATION/);
 f.store.put('production-attempt',{id:'wrong-attempt',projectId:'another-project',customerId:'alice',state:'running'});await assert.rejects(f.artifacts.commitFinal({...f.input,attemptId:'wrong-attempt'}),/NOT_FOUND/);
 f.store.put('production-project',{...f.store.get('production-project','project-one'),state:'cancelled'});await assert.rejects(f.artifacts.commitFinal(f.input),/CANCELLED/);assert.equal(f.store.all('production-result').length,0);assert.equal(f.verified(),0);
});
test('cancel requested and failed attempt status reject a late provider result',async t=>{
 const f=await fixture(t);f.store.put('production-attempt',{id:'attempt',projectId:'project-one',customerId:'alice',status:'failed'});await assert.rejects(f.artifacts.commitFinal({...f.input,attemptId:'attempt'}),/CANCELLED/);
 f.store.put('production-project',{...f.store.get('production-project','project-one'),cancelRequested:true});await assert.rejects(f.artifacts.commitFinal(f.input),/CANCELLED/);assert.equal(f.verified(),0);
});
test('final save requires its currently running stage attempt when an attempt is supplied',async t=>{
 const f=await fixture(t);f.store.put('production-attempt',{id:'attempt',projectId:'project-one',customerId:'alice',stageId:'save',status:'running'});
 f.store.put('production-stage',{id:hash('project-one:save'),projectId:'project-one',customerId:'alice',stageId:'save',state:'running',attemptId:'another'});
 await assert.rejects(f.artifacts.commitFinal({...f.input,attemptId:'attempt'}),/ATTEMPT_NOT_ACTIVE/);f.store.put('production-stage',{...f.store.get('production-stage',hash('project-one:save')),attemptId:'attempt'});
 assert.equal((await f.artifacts.commitFinal({...f.input,attemptId:'attempt'})).mediaReady,true);
});
test('a foreign legacy mirror, invalid media or mismatched verifier cannot become a customer film',async t=>{
 const f=await fixture(t);f.store.put('film-project',{id:'project-one',customerId:'bob',name:'foreign'});await assert.rejects(f.artifacts.commitFinal(f.input),/NOT_FOUND/);assert.equal(f.store.get('film-project','project-one').name,'foreign');
 f.store.delete('film-project','project-one');await assert.rejects(f.artifacts.commitFinal({...f.input,bytes:Buffer.from('not an mp4')}),/VIDEO_INVALID/);
 const other=await fixture(t,{verifyVideo:async()=>({durationMs:500,width:720,height:1280,hasAudio:true})});await assert.rejects(other.artifacts.commitFinal(other.input),/DURATION_MISMATCH/);assert.equal(other.store.all('film-media').length,0);assert.equal(other.store.all('production-result').length,0);
});
test('different concurrent final payloads cannot share an idempotent success and cancelled work cannot commit late',async t=>{
 let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r);const f=await fixture(t,{verifyVideo:async()=>{started();await gate;return {durationMs:1000,width:720,height:1280,hasAudio:true};}});
 const first=f.artifacts.commitFinal(f.input);await entered;
 await assert.rejects(f.artifacts.commitFinal({...f.input,bytes:Buffer.concat([mp4,Buffer.from('other')])}),/ALREADY_COMMITTED/);
 f.store.put('production-project',{...f.store.get('production-project','project-one'),cancelledAt:Date.now()});release();await assert.rejects(first,/CANCELLED/);assert.equal(f.store.all('production-result').length,0);
});
test('canonical directories reject junction escapes and committed file changes fail closed',async t=>{
 const f=await fixture(t),outside=await fs.mkdtemp(path.join(tmpdir(),'production-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'keep.txt'),'unchanged');
 await fs.symlink(outside,path.join(f.folder,'film-exports'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.artifacts.commitFinal(f.input),/UNSAFE_PATH/);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'unchanged');await fs.unlink(path.join(f.folder,'film-exports'));
 await f.artifacts.commitFinal(f.input);const target=f.store.get('film-project','project-one').merge.path;await fs.appendFile(target,'corrupted');await assert.rejects(f.artifacts.readFinal({projectId:'project-one',customerId:'alice'}),/ARTIFACT_CHANGED/);
});
test('default verifier decodes actual local AV and missing tooling is not simulated success',async t=>{
 const binary=process.env.ENGINE_FFMPEG_BIN||'ffmpeg';const f=await fixture(t);await assert.rejects(verifyLocalVideo({file:'unused',expectedDurationMs:1000,ffmpeg:path.join(f.folder,'absent-ffmpeg')}),/TOOL_UNAVAILABLE/);
 try{await exec(binary,['-version']);}catch{t.skip('Existing CPU FFmpeg unavailable; no download');return;}
 const source=path.join(f.folder,'real.mp4');await exec(binary,['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=1','-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=1','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
 const artifacts=createProductionArtifacts({store:f.store,verifyVideo:args=>verifyLocalVideo({...args,ffmpeg:binary})}),result=await artifacts.commitFinal({...f.input,bytes:await fs.readFile(source)});assert.equal(result.mediaReady,true);assert.equal(result.width,64);assert.ok(Math.abs(result.durationMs-1000)<100);assert.equal(f.store.get('production-result','project-one').checker,'ffmpeg_full_decode');
});
test('a trusted source asset commits by bounded streaming and rejects foreign paths without loading client paths',async t=>{
 const f=await fixture(t),assetId='trusted-source',folder=path.join(f.folder,'production-assets','project-one',assetId);await fs.mkdir(folder,{recursive:true});const file=path.join(folder,'video.mp4');await fs.writeFile(file,mp4);
 f.store.put('production-asset',{id:assetId,projectId:'project-one',customerId:'alice',path:file,sha256:hash(mp4),durationMs:1000,bytes:mp4.length});const {bytes,...withoutBytes}=f.input;void bytes;
 const result=await f.artifacts.commitFinal({...withoutBytes,sourceAssetId:assetId});assert.equal(result.sha256,hash(mp4));assert.equal(result.mediaReady,true);
 f.store.put('production-asset',{...f.store.get('production-asset',assetId),path:path.join(f.folder,'elsewhere.mp4')});await assert.rejects(f.artifacts.commitFinal({...withoutBytes,sourceAssetId:assetId}),/UNSAFE_PATH/);
});
