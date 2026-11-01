import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../engine/store.mjs';
import {createProductionRenderer} from '../engine/production-renderer.mjs';
function fixture(){
 const records=new Map(),calls=[],store={get:async(k,id)=>records.get(k+':'+id),put:async(k,v)=>records.set(k+':'+v.id,v)},project={id:'p',customerId:'c',plan:{utterances:[{id:'line',startMs:0,endMs:20000}],shots:[{id:'s',chapterId:'chapter',startMs:0,endMs:10000,soundEffects:[]}],chapters:[{id:'chapter',startMs:0,endMs:20000}]}};
 records.set('production-project:p',project);records.set('production-asset:video',{id:'video',customerId:'c',projectId:'p',durationMs:10000});records.set('production-asset:voice',{id:'voice',customerId:'c',projectId:'p',durationMs:20000});records.set('production-stage:'+hash('p:voice:line'),{result:{assetIds:['voice']}});
 const assembly={assembleGroup:async input=>{calls.push(input);return {assetId:'merged-'+calls.length};}},renderer=createProductionRenderer({store,assembly});return {renderer,records,calls,project,scope:{customerId:'c',projectId:'p',attemptId:'attempt'}};
}
test('sync validates actual media timing and stores edit decisions without synthesizing another voice',async()=>{
 const f=fixture(),receipt=await f.renderer.execute({scope:f.scope,stage:{stageId:'sync:s',kind:'sync',subjectId:'s'},plan:f.project.plan,inputs:[{stageId:'animate:s',result:{assetIds:['video']}}],onProgress:async()=>{}});assert.deepEqual(receipt.result.assetIds,['video']);assert.equal(f.calls.length,0);assert.equal(f.records.get('production-edit:'+hash('p:sync:s')).startMs,0);
});
test('chapter assembly mixes each original voice once and final assembly preserves chapter soundtrack',async()=>{
 const f=fixture();await f.renderer.execute({scope:f.scope,stage:{stageId:'chapter_merge:chapter',kind:'merge',scope:'chapter',subjectId:'chapter'},plan:f.project.plan,inputs:[{stageId:'effects:s',result:{assetIds:['video']}}],onProgress:async()=>{}});assert.deepEqual(f.calls[0].narration,[{assetId:'voice',startMs:0,endMs:20000,sourceOffsetMs:0}]);
 await f.renderer.execute({scope:f.scope,stage:{stageId:'merge',kind:'merge',scope:'film'},plan:f.project.plan,inputs:[{stageId:'chapter_merge:chapter',result:{assetIds:['merged-1']}}],onProgress:async()=>{}});assert.equal(f.calls[1].narration,undefined);
});
test('one-hour-sized chapter bounds FFmpeg inputs using reusable nested groups',async()=>{
 const f=fixture();f.project.plan.utterances=[];const inputs=Array.from({length:360},(_,i)=>({stageId:'effects:s'+i,result:{assetIds:['asset-'+i]}}));
 await f.renderer.execute({scope:f.scope,stage:{stageId:'chapter_merge:chapter',kind:'merge',scope:'chapter',subjectId:'chapter'},plan:f.project.plan,inputs,onProgress:async()=>{}});assert.ok(f.calls.length>1);assert.ok(f.calls.every(c=>c.assetIds.length<=64));assert.deepEqual(f.calls.at(-1).narration,[]);
});
test('unprovided effects and overlong spoken audio are honest blockers, not silently dropped or truncated',async()=>{
 const f=fixture();f.project.plan.shots[0].soundEffects=[{id:'door',description:'door slam',startMs:0,endMs:500}];const quote=await f.renderer.estimate({stage:{kind:'effects',subjectId:'s'},plan:f.project.plan});assert.equal(quote.available,false);f.project.plan.shots[0].soundEffects=[];f.records.get('production-asset:voice').durationMs=22000;
 await assert.rejects(f.renderer.execute({scope:f.scope,stage:{stageId:'sync:s',kind:'sync',subjectId:'s'},plan:f.project.plan,inputs:[{stageId:'animate:s',result:{assetIds:['video']}}],onProgress:async()=>{}}),/PRODUCTION_AUDIO_TIMING_REPLAN_REQUIRED/);
});
