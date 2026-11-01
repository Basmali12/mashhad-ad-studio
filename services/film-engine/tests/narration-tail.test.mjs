import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {inspectNarrationTail,repairReviewedNarrationTail} from '../engine/narration-tail.mjs';
function sample({buzz=true,gap=true}={}){
 const sr=24000,n=sr*4,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++){const t=i/sr;let v=0;if(t<1.4||!gap)v=.15*Math.sin(2*Math.PI*(140+40*Math.sin(t*5))*t)*(1+.5*Math.sin(t*20));else if(buzz&&t>2)v=.03*Math.sin(2*Math.PI*1400*t);b.writeInt16LE(Math.round(v*32767),44+i*2);}return b;
}
test('stationary tail after quiet is review-only; speech/vowel without a gap is not erased',()=>{assert.equal(inspectNarrationTail(sample()).requiresReview,true);assert.equal(inspectNarrationTail(sample({gap:false})).requiresReview,false);assert.equal(inspectNarrationTail(sample({buzz:false})).requiresReview,false);});
test('repair requires explicit approval and a safe boundary inside the quiet gap',()=>{const b=sample();assert.throws(()=>repairReviewedNarrationTail(b,{muteFromMs:1700}),/APPROVAL_REQUIRED/);assert.throws(()=>repairReviewedNarrationTail(b,{approved:true,muteFromMs:1000}),/APPROVAL_REQUIRED/);});
test('reviewed repair preserves all earlier samples, duration and format while removing the terminal artifact',()=>{const b=sample(),r=repairReviewedNarrationTail(b,{approved:true,muteFromMs:1700,fadeMs:10});assert.equal(r.bytes.length,b.length);assert.deepEqual(r.bytes.subarray(0,44+1690*24*2),b.subarray(0,44+1690*24*2));assert.ok(r.bytes.subarray(44+1700*24*2).every(v=>v===0));assert.equal(inspectNarrationTail(r.bytes).requiresReview,false);assert.equal(r.evidence.pitchChanged,false);assert.equal(r.evidence.speedChanged,false);});
