import test from 'node:test';
import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import process from 'node:process';
import {Store,hash} from '../engine/store.mjs';
import {createFinalFilmQuality} from '../engine/final-film-quality.mjs';

const exec=promisify(execFile),binary=process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg';
async function fixture(t){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'final-film-quality-')),store=new Store(folder,randomBytes(32).toString('base64'));store.put('production-project',{id:'project',customerId:'alice',durationMs:2400,state:'running'});t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});
 const add=async(name,bytes,hasAudio=true)=>{const dir=path.join(folder,'production-assets','project',name);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'video.mp4');await fs.writeFile(file,bytes);store.put('production-asset',{id:name,projectId:'project',customerId:'alice',path:file,sha256:hash(bytes),bytes:bytes.length,durationMs:2400,hasAudio});return {file,input:{customerId:'alice',projectId:'project',assetId:name,expectedDurationMs:2400,expectedAudio:hasAudio,expectedWidth:64,expectedHeight:64}};};
 const make=async(name,{visual='testsrc2=s=64x64:r=25:d=2.4',audio='sine=frequency=400:sample_rate=48000:duration=2.4',filter=null}={})=>{const file=path.join(folder,name+'.mp4'),args=['-nostdin','-v','error','-f','lavfi','-i',visual,...(audio?['-f','lavfi','-i',audio]:[]),'-t','2.4','-c:v','libx264','-pix_fmt','yuv420p',...(audio?['-c:a','aac']:[]),...(filter?['-af',filter]:[]),file];await exec(binary,args,{windowsHide:true,timeout:30000,maxBuffer:1024*1024});const saved=await add(name,await fs.readFile(file),!!audio);await fs.unlink(file);return saved;};
 return {store,folder,make,add};
}
async function ffmpegAvailable(t){try{await exec(binary,['-version'],{windowsHide:true,timeout:10000});return true;}catch{t.skip('Existing local CPU FFmpeg unavailable; no dependency download');return false;}}

test('real CPU full decode records observations, never certifies semantics, and review reuses exact output once',async t=>{
 if(!await ffmpegAvailable(t))return;const f=await fixture(t),asset=await f.make('normal');let scans=0;const runner=async(args,options)=>{scans++;return exec(options.ffmpeg,args,{windowsHide:true,timeout:options.timeout,maxBuffer:16*1024*1024});},qc=createFinalFilmQuality({store:f.store,ffmpeg:binary,runner});
 const [a,b]=await Promise.all([qc.inspect(asset.input),qc.inspect(asset.input)]);assert.equal(a.id,b.id);assert.equal(scans,1);assert.equal(a.needsReview,true);assert.equal(a.quality.structuralVerified,true);assert.equal(a.quality.visualQualityCertified,false);assert.equal(a.quality.voiceIdentityVerified,false);assert.equal(a.quality.dialectVerified,false);assert.equal(a.quality.lipSynchronizationVerified,false);assert.equal(a.measurements.blackIntervals.length,0);assert.equal(a.measurements.freezeIntervals.length,0);assert.equal(a.measurements.silenceIntervals.length,0);assert.equal(a.measurements.audioClippingStatus,'no_evidence');assert.equal(a.findings.some(x=>x.code==='SEMANTIC_QUALITY_UNVERIFIED'),true);assert.equal(JSON.stringify(a).includes(f.folder),false);
 await assert.rejects(qc.review({...asset.input,actor:{customerId:'bob'},reviewed:true,accepted:true}),/FORBIDDEN/);await assert.rejects(qc.review({...asset.input,actor:{customerId:'alice'},reviewed:false,accepted:true}),/REVIEW_REQUIRED/);const reviewed=await qc.review({...asset.input,actor:{customerId:'alice'},reviewed:true,accepted:true});assert.equal(reviewed.status,'reviewed');assert.equal(reviewed.needsReview,false);assert.equal(reviewed.quality.visualQualityCertified,false);assert.equal((await qc.inspect(asset.input)).reviewed,true);assert.equal(scans,1);assert.equal((await qc.read('alice','project','normal')).id,a.id);await assert.rejects(qc.read('bob','project','normal'),/NOT_FOUND/);
});

test('real black/frozen frames and silent audio are observed and intentional windows remain visible',async t=>{
 if(!await ffmpegAvailable(t))return;const f=await fixture(t),asset=await f.make('black',{visual:'color=c=black:s=64x64:r=25:d=2.4',audio:'anullsrc=r=48000:cl=mono:d=2.4'}),qc=createFinalFilmQuality({store:f.store,ffmpeg:binary});const result=await qc.inspect(asset.input);for(const code of ['BLACK_INTERVAL','FROZEN_FRAMES','AUDIO_SILENCE'])assert.ok(result.findings.some(x=>x.code===code),JSON.stringify(result));assert.ok(result.measurements.silenceIntervals[0].durationMs>2000);
 const intentional=await qc.inspect({...asset.input,intentionalBlackIntervals:[{startMs:0,endMs:2400}],intentionalFreezeIntervals:[{startMs:0,endMs:2400}],intentionalSilenceIntervals:[{startMs:0,endMs:2400}]});assert.notEqual(intentional.id,result.id);assert.equal(intentional.measurements.blackIntervals[0].intentional,true);assert.equal(intentional.findings.some(x=>['BLACK_INTERVAL','FROZEN_FRAMES','AUDIO_SILENCE'].includes(x.code)),false);assert.equal(intentional.needsReview,true);
});

test('real loud clipped audio is a review observation, not a claim of certified safe audio',async t=>{
 if(!await ffmpegAvailable(t))return;const f=await fixture(t),asset=await f.make('clipped',{filter:'volume=20'}),qc=createFinalFilmQuality({store:f.store,ffmpeg:binary}),r=await qc.inspect(asset.input);assert.equal(r.measurements.audioClippingStatus,'suspected',JSON.stringify(r.measurements));assert.ok(r.findings.some(x=>x.code==='AUDIO_CLIPPING_SUSPECTED'));assert.equal(r.needsReview,true);
});

test('structural corruption, missing sound, dimensions and duration cannot become quality success',async t=>{
 if(!await ffmpegAvailable(t))return;const f=await fixture(t),qc=createFinalFilmQuality({store:f.store,ffmpeg:binary}),broken=await f.add('broken',Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000000000000000')]));await assert.rejects(qc.inspect(broken.input),/DECODE_FAILED/);const silent=await f.make('no-audio',{audio:null});await assert.rejects(qc.inspect({...silent.input,expectedAudio:true}),/DECODE_FAILED|VIDEO_INVALID/);const good=await f.make('sound');await assert.rejects(qc.inspect({...good.input,expectedWidth:128}),/DIMENSION_MISMATCH/);await assert.rejects(qc.inspect({...good.input,expectedDurationMs:1000}),/DURATION_MISMATCH/);assert.equal(f.store.all('production-quality').length,0);
});

test('cached checks cannot approve modified files, foreign paths or new settings',async t=>{
 if(!await ffmpegAvailable(t))return;const f=await fixture(t),asset=await f.make('source'),qc=createFinalFilmQuality({store:f.store,ffmpeg:binary});await qc.inspect(asset.input);await qc.review({...asset.input,actor:{isAdmin:true,id:'admin'},reviewed:true,accepted:true});const changed=await qc.inspect({...asset.input,allowSilence:true});assert.equal(changed.reviewed,false);assert.equal(changed.needsReview,true);await fs.appendFile(asset.file,'mutated');await assert.rejects(qc.inspect(asset.input),/ARTIFACT_CHANGED/);await assert.rejects(qc.review({...asset.input,actor:{isAdmin:true},reviewed:true,accepted:true}),/ARTIFACT_CHANGED/);const row=f.store.get('production-asset','source');f.store.put('production-asset',{...row,path:path.join(f.folder,'foreign.mp4')});await assert.rejects(qc.inspect(asset.input),/UNSAFE_PATH/);
});

test('missing tool and malformed injected observations fail explicitly without storing a success',async t=>{
 const f=await fixture(t),asset=await f.add('synthetic',Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000000000000000')]));const unavailable=createFinalFilmQuality({store:f.store,ffmpeg:path.join(f.folder,'absent-ffmpeg')});await assert.rejects(unavailable.inspect(asset.input),/TOOL_UNAVAILABLE/);const malformed=createFinalFilmQuality({store:f.store,runner:async()=>({stdout:'not progress',stderr:'not decoder output'})});await assert.rejects(malformed.inspect(asset.input),/VIDEO_INVALID/);await assert.rejects(malformed.inspect({...asset.input,path:'https://foreign.example/secret'}),/INVALID_INPUT/);assert.equal(f.store.all('production-quality').length,0);
 const badInterval=createFinalFilmQuality({store:f.store,runner:async()=>({stdout:'frame=60\nout_time_us=2400000\n',stderr:'Input #0, mov\n  Stream #0:0: Video: h264, yuv420p, 64x64, 25 fps\n  Stream #0:1: Audio: aac, 48000 Hz, mono\nOutput #0, null\n[blackdetect @ fixture] black_start:NaN black_end:2.4\n'})});await assert.rejects(badInterval.inspect(asset.input),/INVALID_OBSERVATIONS/);assert.equal(f.store.all('production-quality').length,0);
});

test('an explicitly silent film can omit audio without falsely claiming voice quality was verified',async t=>{
 if(!await ffmpegAvailable(t))return;const f=await fixture(t),asset=await f.make('silent-film',{audio:null}),qc=createFinalFilmQuality({store:f.store,ffmpeg:binary}),r=await qc.inspect({...asset.input,allowSilence:true});assert.equal(r.quality.hasAudio,false);assert.equal(r.quality.structuralVerified,true);assert.equal(r.quality.voiceIdentityVerified,false);assert.equal(r.measurements.audioClippingStatus,'not_measured');assert.equal(r.findings.some(x=>x.code==='AUDIO_STATS_UNAVAILABLE'),false);assert.equal(r.needsReview,true);
});
