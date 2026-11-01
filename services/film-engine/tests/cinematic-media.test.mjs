import test from 'node:test';
import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createCinematicMedia,runCinematicFFmpeg} from '../engine/cinematic-media.mjs';
import {inspectSpeechWav} from '../engine/voice-profiles.mjs';
import {pcmWav} from './voice-fixtures.mjs';

async function fixture(t){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'cinematic-cpu-')),store=new Store(folder,randomBytes(32).toString('base64'));
 t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});
 const scope={projectId:'project',customerId:'alice',attemptId:'attempt'};
 store.put('production-project',{id:'project',customerId:'alice',state:'running'});store.put('production-attempt',{id:'attempt',...scope,status:'running'});
 async function asset(id,kind,bytes,extra){const dir=path.join(folder,'production-assets','project',id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,kind==='audio'?'audio.wav':'video.mp4');if(bytes)await fs.writeFile(file,bytes);else await runCinematicFFmpeg(['-f','lavfi','-i','color=c=blue:s=64x64:r=25:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-n',file]);bytes=await fs.readFile(file);const row={id,projectId:'project',customerId:'alice',kind,path:file,sha256:hash(bytes),bytes:bytes.length,durationMs:1000,...extra};store.put('production-asset',row);return row;}
 const video=await asset('video','video',null,{width:64,height:64,fps:25,hasAudio:false}),audio=await asset('audio','audio',pcmWav({rate:24000,seconds:1}),{sampleRate:24000,channels:1,samples:24000,profileId:'voice'});
 store.put('production-cinematic-timeline',{id:'project',customerId:'alice',timeline:{needsReview:false,shots:[{shotId:'shot',videoAssetId:'video',startMs:0,endMs:800,sourceStartMs:0}],audioTracks:[{utteranceId:'line',assetId:'audio',startMs:0,endMs:1000}]}});
 const media=createCinematicMedia({store});const input={scope,shot:{id:'shot'},utterance:{id:'line',characterId:'actor'},videoAsset:video,audioAsset:audio,faceBinding:{characterId:'actor'},alignmentAsset:{words:[{text:'هلا',startMs:0,endMs:300},{text:'بيك',startMs:400,endMs:700}]}};
 return {store,media,input,video,audio,scope};
}

test('real CPU FFmpeg creates bounded 25fps silent video and 16kHz conditioning WAV, preserves originals and reuses derivatives',async t=>{
 const f=await fixture(t),originalVideo=await fs.readFile(f.video.path),originalAudio=await fs.readFile(f.audio.path),first=await f.media.prepareLipInput(f.input),second=await f.media.prepareLipInput(f.input);
 assert.equal(first.video.assetId,second.video.assetId);assert.equal(first.audio.assetId,second.audio.assetId);assert.equal(first.fps,25);const wav=inspectSpeechWav(Buffer.from(first.audio.base64,'base64'));assert.equal(wav.sampleRate,16000);assert.equal(wav.durationMs,800);assert.deepEqual(await fs.readFile(f.video.path),originalVideo);assert.deepEqual(await fs.readFile(f.audio.path),originalAudio);
 const normalized=await f.media.normalizeLipOutput({scope:f.scope,bytes:Buffer.from(first.video.base64,'base64'),expectedDurationMs:800,width:64,height:64});assert.equal(normalized.metadata.hasAudio,false);assert.equal(normalized.metadata.fps,25);assert.ok(Math.abs(normalized.metadata.durationMs-800)<=40);
});
test('a boundary inside an actual aligned word stops for review before conversion, and foreign tenants cannot derive media',async t=>{
 const f=await fixture(t);await assert.rejects(f.media.prepareLipInput({...f.input,alignmentAsset:{words:[{text:'كلمة',startMs:650,endMs:950}]}}),e=>e.needsReview===true&&/WORD_CUT/.test(e.message));assert.equal(f.store.all('production-asset').length,2);await assert.rejects(f.media.prepareLipInput({...f.input,scope:{...f.scope,customerId:'bob'}}),/ATTEMPT_NOT_ACTIVE/);
});
test('missing footage cannot be filled with a long frozen frame or repeat; changed source bytes cannot be adopted',async t=>{
 const f=await fixture(t);await assert.rejects(f.media.trimShot({scope:f.scope,assetId:'video',clip:{startMs:0,endMs:1600,sourceStartMs:0}}),e=>e.needsReview===true&&/COVERAGE/.test(e.message));await fs.appendFile(f.video.path,'changed');await assert.rejects(f.media.trimShot({scope:f.scope,assetId:'video',clip:{startMs:0,endMs:800,sourceStartMs:0}}),/ARTIFACT_CHANGED/);
});
