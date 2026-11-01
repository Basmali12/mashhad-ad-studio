import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store,hash} from '../engine/store.mjs';
import {createProductionAssembly,planProductionSoundtrack} from '../engine/production-assembly.mjs';
import {createProductionArtifacts,verifyLocalVideo,verifyLocalAudio} from '../engine/production-artifacts.mjs';

const exec=promisify(execFile),header=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom00000000000000000000')]);
async function fixture(t){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'production-assembly-')),store=new Store(folder,randomBytes(32).toString('base64'));store.put('production-project',{id:'p',customerId:'alice',title:'فيلم كامل',durationMs:2000,state:'running'});let calls=0;
 const verifyVideo=async({expectedDurationMs})=>({durationMs:expectedDurationMs,width:64,height:64,hasAudio:true,fps:24,checker:'mock_fixture'});
 const runFFmpeg=async args=>{calls++;assert.ok(args.includes('concat=n=2:v=1:a=1[v][a]')||args.join(' ').includes('concat=n='));await fs.writeFile(args.at(-1),Buffer.concat([header,Buffer.from('group-'+calls)]));};
 const assembly=createProductionAssembly({store,verifyVideo,runFFmpeg});
 async function asset(id,bytes=Buffer.concat([header,Buffer.from(id)])){const dir=path.join(folder,'production-assets','p',id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'video.mp4');await fs.writeFile(file,bytes);const a={id,projectId:'p',customerId:'alice',path:file,sha256:hash(bytes),durationMs:1000,bytes:bytes.length};store.put('production-asset',a);return a;}
 t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});return {store,folder,assembly,asset,calls:()=>calls,verifyVideo,runFFmpeg};
}
test('ordered owned assets assemble once, successful chapters are reused and only a final commit reaches files',async t=>{
 const f=await fixture(t);await f.asset('one');await f.asset('two');const input={projectId:'p',customerId:'alice',groupId:'chapter-one',assetIds:['one','two']};
 const [a,b]=await Promise.all([f.assembly.assembleGroup(input),f.assembly.assembleGroup(input)]);assert.equal(a.id,b.id);assert.equal(f.calls(),1);assert.equal(f.store.all('film-media').length,0);
 assert.equal((await f.assembly.assembleGroup(input)).id,a.id);assert.equal(f.calls(),1);assert.equal((await f.assembly.readGroup(input)).sha256,a.sha256);
 const final=createProductionArtifacts({store:f.store,verifyVideo:f.verifyVideo});const receipt=await final.commitFinal({projectId:'p',customerId:'alice',sourceAssetId:a.id,expectedDurationMs:2000,hasAudio:true});assert.equal(receipt.mediaReady,true);assert.equal(f.store.all('film-media').filter(m=>m.kind==='film').length,1);
 await assert.rejects(f.assembly.assembleGroup({...input,assetIds:['two','one']}),/ALREADY_COMPLETED/);assert.equal(f.calls(),1);
});
test('nested chapter output uses its canonical ledger namespace without reassembling finished chapters',async t=>{
 const f=await fixture(t);await f.asset('one');await f.asset('two');const chapter=await f.assembly.assembleGroup({projectId:'p',customerId:'alice',groupId:'chapter-one',assetIds:['one']});const final=await f.assembly.assembleGroup({projectId:'p',customerId:'alice',groupId:'whole-film',assetIds:[chapter.id,'two']});assert.equal(final.sourceAssetIds[0],chapter.id);assert.equal(final.durationMs,2000);assert.equal(f.calls(),2);
});
test('foreign ownership, unsafe source paths, changed bytes and cancellation cannot become an assembled success',async t=>{
 const f=await fixture(t),asset=await f.asset('one'),input={projectId:'p',customerId:'alice',groupId:'chapter',assetIds:['one']};
 await assert.rejects(f.assembly.assembleGroup({...input,customerId:'bob'}),/NOT_FOUND/);f.store.put('production-asset',{...asset,path:path.join(f.folder,'foreign.mp4')});await assert.rejects(f.assembly.assembleGroup(input),/UNSAFE_PATH/);f.store.put('production-asset',asset);await fs.appendFile(asset.path,'changed');await assert.rejects(f.assembly.assembleGroup(input),/ARTIFACT_CHANGED/);assert.equal(f.calls(),0);
 f.store.put('production-project',{...f.store.get('production-project','p'),state:'cancelled'});await assert.rejects(f.assembly.assembleGroup(input),/CANCELLED/);assert.equal(f.store.all('production-assembly').length,0);
});
test('actual CPU FFmpeg concatenates two AV clips and does not run a second successful assembly',async t=>{
 const binary=process.env.ENGINE_FFMPEG_BIN||'ffmpeg';try{await exec(binary,['-version']);}catch{t.skip('Existing CPU FFmpeg unavailable; no download');return;}
 const f=await fixture(t);for(const [id,color] of [['one','blue'],['two','red']]){const dir=path.join(f.folder,'production-assets','p',id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'video.mp4');await exec(binary,['-v','error','-f','lavfi','-i',`color=c=${color}:s=64x64:r=24:d=1`,'-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=1','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file]);const bytes=await fs.readFile(file);f.store.put('production-asset',{id,projectId:'p',customerId:'alice',path:file,sha256:hash(bytes),durationMs:1000,bytes:bytes.length});}
 let calls=0;const assembly=createProductionAssembly({store:f.store,verifyVideo:args=>verifyLocalVideo({...args,ffmpeg:binary}),runFFmpeg:async args=>{calls++;await exec(binary,['-nostdin','-v','error','-threads','2',...args],{timeout:120000});}}),input={projectId:'p',customerId:'alice',groupId:'whole-film',assetIds:['one','two']};
 const a=await assembly.assembleGroup(input);assert.equal(a.hasAudio,true);assert.equal(a.width,64);assert.ok(Math.abs(a.durationMs-2000)<100);assert.equal(a.checker,'ffmpeg_full_decode');assert.equal((await assembly.assembleGroup(input)).id,a.id);assert.equal(calls,1);
});
test('absolute continuous narration slices advance source offsets between chapters without replay',()=>{
 const assets=[{id:'utterance',durationMs:6000}],narration=[{assetId:'utterance',startMs:1000,endMs:7000}];
 assert.deepEqual(planProductionSoundtrack({narration,assets,durationMs:3000,timelineStartMs:0}),[{kind:'narration',assetId:'utterance',startMs:1000,durationMs:2000,sourceOffsetMs:0}]);
 assert.deepEqual(planProductionSoundtrack({narration,assets,durationMs:4000,timelineStartMs:3000}),[{kind:'narration',assetId:'utterance',startMs:0,durationMs:4000,sourceOffsetMs:2000}]);
 assert.throws(()=>planProductionSoundtrack({narration:[...narration,{...narration[0],startMs:8000,endMs:14000}],assets,durationMs:15000}),/AUDIO_REPEATED/);
});
test('continuous narration replaces silent clip audio once and retains changing voice frequency across the boundary',async t=>{
 const binary=process.env.ENGINE_FFMPEG_BIN||'ffmpeg';try{await exec(binary,['-version']);}catch{t.skip('Existing CPU FFmpeg unavailable; no download');return;}
 const f=await fixture(t);for(const [id,color] of [['one','blue'],['two','red']]){const dir=path.join(f.folder,'production-assets','p',id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'video.mp4');await exec(binary,['-v','error','-f','lavfi','-i',`color=c=${color}:s=64x64:r=24:d=1`,'-an','-c:v','libx264','-pix_fmt','yuv420p',file]);const bytes=await fs.readFile(file);f.store.put('production-asset',{id,projectId:'p',customerId:'alice',path:file,sha256:hash(bytes),durationMs:1000,bytes:bytes.length});}
 const voiceDir=path.join(f.folder,'production-assets','p','voice');await fs.mkdir(voiceDir,{recursive:true});const voice=path.join(voiceDir,'audio.wav');await exec(binary,['-v','error','-f','lavfi','-i','aevalsrc=0.2*sin(2*PI*(400*t+200*t*t)):s=48000:d=2','-c:a','pcm_s16le',voice]);const bytes=await fs.readFile(voice);f.store.put('production-asset',{id:'voice',projectId:'p',customerId:'alice',path:voice,sha256:hash(bytes),durationMs:2000,bytes:bytes.length});
 let voiceInputs=0;const assembly=createProductionAssembly({store:f.store,verifyVideo:args=>verifyLocalVideo({...args,ffmpeg:binary}),verifyAudio:args=>verifyLocalAudio({...args,ffmpeg:binary}),runFFmpeg:async args=>{voiceInputs=args.filter(a=>a===voice).length;await exec(binary,['-nostdin','-v','error','-threads','2',...args],{timeout:120000});}});
 const result=await assembly.assembleGroup({projectId:'p',customerId:'alice',groupId:'continuous-voice',assetIds:['one','two'],narration:[{assetId:'voice',startMs:0,endMs:2000}]});assert.equal(voiceInputs,1);assert.equal(result.hasAudio,true);assert.ok(Math.abs(result.durationMs-2000)<100);
 const pcm=await exec(binary,['-v','error','-i',result.path,'-map','0:a:0','-ac','1','-ar','48000','-f','s16le','pipe:1'],{encoding:'buffer',maxBuffer:500000});
 const crossings=(start,end)=>{let n=0;for(let i=Math.floor(start*48000)+1;i<Math.floor(end*48000);i++){const a=pcm.stdout.readInt16LE((i-1)*2),b=pcm.stdout.readInt16LE(i*2);if(a<0&&b>=0)n++;}return n;};assert.ok(crossings(1.3,1.7)>crossings(.3,.7)*1.4,'late audio advances through the source chirp instead of replaying its first clip');
});
