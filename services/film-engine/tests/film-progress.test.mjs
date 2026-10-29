import test from 'node:test';import assert from 'node:assert/strict';
import {observedProgress,verifiedVideoSeconds} from '../engine/film-progress.mjs';
test('diffusion steps remain steps and cannot become completed seconds',()=>{
 const job={result:{videoVerified:false,metadata:{duration_seconds:10}},events:[{kind:'phase_start',phase:'denoise_stage_1'},{kind:'progress',phase:'denoise_stage_1',completed:8,total:8,global_completed:8,global_total:11}]};
 assert.equal(verifiedVideoSeconds(job),null);assert.deepEqual(observedProgress(job.events),{phase:'denoise_stage_1',completed:8,total:8,stages:[{phase:'denoise_stage_1',state:'running'}]});
 job.result.videoVerified=true;assert.equal(verifiedVideoSeconds(job),10);
});
test('stage completion is driven by end events and stale denoising percentage does not leak into decoding',()=>{
 const p=observedProgress([{kind:'app_created',phase:'application_setup'},{kind:'phase_start',phase:'pipeline_setup'},{kind:'phase_end',phase:'pipeline_setup'},{kind:'progress',phase:'denoise_stage_2',completed:3,total:3},{kind:'phase_end',phase:'denoise_stage_2'},{kind:'phase_start',phase:'video_decode'},{kind:'resource_status',phase:'ready'}]);
 assert.equal(p.phase,'video_decode');assert.equal(p.completed,null);assert.equal(p.total,null);assert.deepEqual(p.stages.map(s=>s.state),['completed','completed','completed','running']);
 assert.equal(observedProgress([{kind:'phase_error',phase:'video_decode',message:'private'}]).stages[0].state,'failed');
});
test('missing and malformed duration is unknown, not an inferred ten-second success',()=>{for(const v of [null,{}, {result:{videoVerified:true}}, {result:{videoVerified:true,metadata:{duration_seconds:-1}}}])assert.equal(verifiedVideoSeconds(v),null);assert.equal(verifiedVideoSeconds({result:{videoVerified:true,metadata:{ffprobe:{format:{duration:'10.005'}}}}}),10.005);});
