import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {Store,hash} from '../engine/store.mjs';
import {THREE_ARAB_MANIFEST} from '../engine/three-arab-integration.mjs';
import {createThreeArabFilmTrack} from '../engine/three-arab-film-track.mjs';
import {repairReviewedNarrationTail} from '../engine/narration-tail.mjs';
import {resolveProductionAudioAsset} from '../engine/production-artifacts.mjs';
const revision=THREE_ARAB_MANIFEST.revisions['sherif1313/3arab-TTS-500M-v1-VoiceDesign'];
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'narration-track-')),store=new Store(root,randomBytes(32).toString('base64'));
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const text='في ليلة ساد فيها السكون.',bytes=Buffer.alloc(44+48000*15*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 await store.put('production-project',{id:'project',customerId:'alice',state:'draft',durationMs:15000,plan:{utterances:[{id:'line',narratorId:'narrator',text,startMs:0,endMs:15000}]}});
 const request={text,style:'solemn',seed:42,seconds:15},receipt={modelId:'3arab-voicedesign-v1',request,caption:'صوت رجل مهيب',result:{adapterVariant:'audioseal-v1',sampleRate:48000,sha256:hash(bytes),watermark:{backend:'audioseal',detected:true,score:1,sampleCountPreserved:true}}};
 const claim={modelRevision:revision,requestSHA256:hash(JSON.stringify(Object.fromEntries(Object.entries(request).sort(([a],[b])=>a.localeCompare(b)))))};
 return {store,service:createThreeArabFilmTrack({store}),input:{actor:{isAdmin:true},trialApproved:true,customerId:'alice',projectId:'project',attemptId:'voice-one',utteranceId:'line',receipt,claim,bytes}};
}
test('real owned narration asset reaches shared film soundtrack resolver exactly once',async t=>{const f=await fixture(t),a=await f.service.admit(f.input),again=await f.service.admit(f.input);assert.equal(a.id,again.id);const r=await resolveProductionAudioAsset({store:f.store,projectId:'project',customerId:'alice',assetId:a.id});assert.equal(r.durationMs,15000);assert.equal(r.sampleRate,48000);assert.equal(r.trialOnly,true);assert.equal(r.transcriptionVerified,false);});
test('owner/admin consent, source claim and user isolation cannot be bypassed',async t=>{const f=await fixture(t);for(const patch of [{actor:{customerId:'alice'}},{trialApproved:false},{customerId:'bob'},{claim:{...f.input.claim,modelRevision:'0'.repeat(40)}},{bytes:Buffer.from('bad')}])await assert.rejects(()=>f.service.admit({...f.input,...patch}));});
test('one film narrator cannot silently change voice-design style after binding',async t=>{const f=await fixture(t);await f.service.admit(f.input);const request={...f.input.receipt.request,style:'calm'},receipt={...f.input.receipt,request};const claim={...f.input.claim,requestSHA256:hash(JSON.stringify(Object.fromEntries(Object.entries(request).sort(([a],[b])=>a.localeCompare(b)))))};await assert.rejects(()=>f.service.admit({...f.input,attemptId:'voice-two',receipt,claim}),/VOICE_PROFILE_ALREADY_BOUND/);});

test('stationary artifact cannot be admitted unchanged; reviewed safe-gap repair is hash-bound',async t=>{
 const f=await fixture(t),b=Buffer.from(f.input.bytes),sr=48000;
 for(let i=0;i<sr*15;i++){const time=i/sr;const v=time<11?.15*Math.sin(2*Math.PI*(180+40*Math.sin(time))*time):time>=12?.03*Math.sin(2*Math.PI*1400*time):0;b.writeInt16LE(Math.round(v*32767),44+i*2);}
 const receipt={...f.input.receipt,result:{...f.input.receipt.result,sha256:hash(b)}};
 await assert.rejects(()=>f.service.admit({...f.input,bytes:b,receipt}),/TAIL_REVIEW_REQUIRED/);
 const repair={approved:true,muteFromMs:11500,fadeMs:10},clean=repairReviewedNarrationTail(b,repair);
 const asset=await f.service.admit({...f.input,bytes:clean.bytes,originalBytes:b,receipt,repair});
 assert.equal(asset.repairEvidence.sourceSHA256,hash(b));assert.equal(asset.repairEvidence.outputSHA256,hash(clean.bytes));
 assert.equal(asset.watermark.postRepairDetectorVerified,false);
 await assert.rejects(()=>f.service.admit({...f.input,bytes:clean.bytes,originalBytes:Buffer.alloc(b.length),receipt,repair}),/REPAIR_SOURCE_INVALID/);
});
