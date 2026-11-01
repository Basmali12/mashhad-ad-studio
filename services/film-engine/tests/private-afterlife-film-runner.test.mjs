import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPrivateFilmPlan,afterlifeStage,privateFilmAssemblyArgs,privateFilmCommissioningRequestId,assertPrivateFilmNoSpendReconciliation,FILM_ID,OWNER,ACTOR,ENGINE_IDS} from '../../../scripts/private-afterlife-film-runner.mjs';
import {AFTERLIFE_NARRATION} from '../../../scripts/private-afterlife-film-plan.mjs';
import {verifyLocalVideo} from '../engine/production-artifacts.mjs';
import {hash} from '../engine/store.mjs';
import {createEngineCommissioning} from '../engine/engine-commissioning.mjs';

test('private film plan uses exact full narration and one stable voice across six ordered real-motion shots',()=>{
 const p=createPrivateFilmPlan('a'.repeat(64));assert.equal(p.id,FILM_ID);assert.equal(p.durationMs,30000);assert.equal(p.story,AFTERLIFE_NARRATION);assert.equal(p.utterances.length,1);assert.equal(p.utterances[0].text,AFTERLIFE_NARRATION);assert.equal(p.utterances[0].startMs,0);assert.equal(p.utterances[0].endMs,30000);assert.equal(p.narrators[0].voice.voiceId,'a'.repeat(64));assert.equal(p.shots.length,6);assert.equal(p.shots[0].startMs,0);assert.equal(p.shots.at(-1).endMs,30000);assert.deepEqual(p.shots[3].characterIds,[]);assert.deepEqual(p.shots[5].characterIds,[]);for(const shot of p.shots){assert.ok(shot.motionPlan.development.length>20);assert.equal(shot.allowText,false);assert.equal(shot.requires_lip_sync,false);assert.equal(shot.videoModelId,'wan22-i2v-a14b');}
});
test('stage routing is closed to specified film models and known six shots',()=>{
 assert.equal(afterlifeStage('voice:narration').modelId,'habibi-msa');assert.equal(afterlifeStage('character_image:man:0').modelId,'flux2-klein-4b');assert.equal(afterlifeStage('scene_image:phone').modelId,'qwen-image-edit-2511');assert.equal(afterlifeStage('animate:phone').modelId,'wan22-i2v-a14b');for(const stage of ['animate:unknown','voice:other','lip_sync:phone','scene_image:phone:bad','character_image:other:0'])assert.throws(()=>afterlifeStage(stage));
});
test('actual commissioning rejects legacy colon request before storage, while every routed film stage derives a distinct safe request key',async()=>{
 let reads=0,transactions=0;const commissioning=createEngineCommissioning({store:{get(){reads++;throw Error('NO_STORAGE');},transaction(){transactions++;throw Error('NO_TRANSACTION');}},registry:{},allowPaid:true});
 await assert.rejects(commissioning.dispatch(ACTOR,'admin.engine.test.execute',{id:ENGINE_IDS['habibi-msa'],quoteId:'quote-one',requestId:FILM_ID+'-execute-voice:narration',approved:true}),/INVALID_ENGINE_TEST_INPUT/);assert.equal(reads,0);assert.equal(transactions,0);
 const stages=['voice:narration','character_image:man:0',...['clock','phone','window','empty-chair','hands','road'].flatMap(id=>['scene_image:'+id,'animate:'+id])],keys=stages.map(privateFilmCommissioningRequestId);assert.equal(new Set(keys).size,stages.length);for(const key of keys)assert.match(key,/^[A-Za-z0-9_-]{1,100}$/);assert.equal(privateFilmCommissioningRequestId('voice:narration'),privateFilmCommissioningRequestId('voice:narration'));await commissioning.close();
});
function noSpendFixture(){
 const rows=new Map(),store={get:(kind,id)=>rows.get(kind+':'+id),all:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,v])=>v)},put=(kind,row)=>rows.set(kind+':'+row.id,row),now=1793508000000,stageId='voice:narration',definition={id:ENGINE_IDS['habibi-msa'],modelId:'habibi-msa',accountId:'primary-private-account'},project={id:'private-film-project',customerId:OWNER,title:'الحياة ما بعد الموت',durationMs:30000,story:AFTERLIFE_NARRATION,adminCommissioning:{ownerId:ACTOR.id,privateFilmId:FILM_ID,privateFilmAccountId:definition.accountId}},intent={id:FILM_ID+'-execute-'+stageId,filmId:FILM_ID,stageId,quoteId:'quote-unused',createdAt:now-1000,state:'claimed'};
 put('private-film-paid-intent',intent);put('engine-test-quote',{id:'quote-unused',engineId:definition.id,adminId:ACTOR.id,input:{projectId:project.id,stageId}});put('production-stage',{id:hash(project.id+':'+stageId),projectId:project.id,customerId:OWNER,stageId,modelId:'habibi-msa',state:'planned',attempts:0});
 const stoppedProof={filmTrialApproved:true,filmId:FILM_ID,account:'basm1998ali',engineId:definition.id,accountId:definition.accountId,modelId:'habibi-msa',status:'stopped',cloudStopped:true,appId:'ap-exact',boundAppId:'ap-exact',stoppedAt:now-500};return {rows,put,store,project,stageId,definition,stoppedProof,now,intent};
}
test('explicit legacy request reconciliation proves an unused quote, untouched stage, absent submissions and exact stopped lease without deleting original claim',()=>{
 const f=noSpendFixture(),before=JSON.stringify(f.intent),out=assertPrivateFilmNoSpendReconciliation(f);assert.equal(out.reconciliation.definitiveNoSpend,true);assert.equal(out.reconciliation.quoteUnused,true);assert.equal(out.reconciliation.cloudStopped,true);assert.equal(out.reconciliation.replacementIntentId,f.intent.id+'-safe-v2');assert.match(out.reconciliation.commissioningRequestId,/^[A-Za-z0-9_-]{1,100}$/);assert.equal(JSON.stringify(f.store.get('private-film-paid-intent',f.intent.id)),before);
 f.put('engine-runtime-history',{id:'old-runtime',engineId:f.definition.id,startedAt:f.now-100000});f.put('engine-command',{id:'old-command',runtimeId:'old-runtime'});assert.equal(assertPrivateFilmNoSpendReconciliation(f).reconciliation.definitiveNoSpend,true);
 f.put('engine-command',{id:'old-prepare-command',engineId:f.definition.id,binding:hash(JSON.stringify([f.definition.id,'old-prepare-quote']))});f.put('engine-quote',{id:'old-prepare-quote',action:'prepare',engineId:f.definition.id,usedBy:'old-prepare-command'});assert.equal(assertPrivateFilmNoSpendReconciliation(f).reconciliation.definitiveNoSpend,true);
});
test('reconciliation refuses every ambiguous or dispatched state, used quote, scope change and paid-command trace',()=>{
 for(const change of [
  f=>{f.intent.testId='some-test';},f=>{f.intent.commissioningRequestId='safe-sent';},f=>{f.intent.createdAt=f.now-600001;},f=>{f.store.get('engine-test-quote','quote-unused').usedBy='test';},f=>{f.store.get('production-stage',hash(f.project.id+':'+f.stageId)).attempts=1;},f=>{f.stoppedProof.cloudStopped=false;},f=>{f.stoppedProof.boundAppId='ap-other';},f=>{f.project.adminCommissioning.privateFilmId='other';},f=>{f.put('engine-test',{id:'test',quoteId:'quote-unused'});},f=>{f.put('admin-native-test',{id:'test',projectId:f.project.id,stageId:f.stageId});},f=>{f.put('production-attempt',{id:'test',projectId:f.project.id,stageId:f.stageId});},f=>{f.put('engine-test-command',{id:hash('engine-test:'+ACTOR.id+':'+privateFilmCommissioningRequestId(f.stageId)),testId:'test'});},f=>{f.put('engine-runtime-history',{id:'new-runtime',engineId:f.definition.id,startedAt:f.now});f.put('engine-command',{id:'new-command',runtimeId:'new-runtime'});},f=>{f.put('engine-command',{id:'missing-runtime-command',runtimeId:'missing'});},f=>{f.put('engine-command',{id:'unproven-prepare',engineId:f.definition.id,binding:'unproven'});},f=>{f.put('engine-command',{id:'false-prepare',engineId:f.definition.id,binding:hash(JSON.stringify([f.definition.id,'false-quote']))});f.put('engine-quote',{id:'false-quote',action:'start',engineId:f.definition.id,usedBy:'false-prepare'});}
 ]){const f=noSpendFixture();change(f);assert.throws(()=>assertPrivateFilmNoSpendReconciliation(f),/PRIVATE_FILM_NO_SPEND_UNCONFIRMED/);}
});
test('assembly uses actual six video inputs, keeps original speech rate, rejects overlong narration and fades only the ending',()=>{
 const input={videoFiles:Array.from({length:6},(_,i)=>'/clip'+i+'.mp4'),audioFile:'/voice.wav',audioDurationMs:27000,output:'/film.mp4'},built=privateFilmAssemblyArgs(input),filter=built.args[built.args.indexOf('-filter_complex')+1];assert.equal(built.narrationStartMs,600);assert.ok(filter.includes('concat=n=6:v=1:a=0'));assert.ok(filter.includes('fade=t=out:st=29.4:d=0.6'));assert.ok(filter.includes('sidechaincompress'));assert.ok(!/zoompan|atempo|setpts=.*\*/.test(filter));assert.ok(!filter.includes('tpad'));assert.equal(privateFilmAssemblyArgs({...input,audioDurationMs:30000}).narrationStartMs,0);assert.throws(()=>privateFilmAssemblyArgs({...input,audioDurationMs:30001}));assert.throws(()=>privateFilmAssemblyArgs({...input,videoFiles:input.videoFiles.slice(1)}));
});

const exec=promisify(execFile),here=path.dirname(fileURLToPath(import.meta.url)),ffmpeg=process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||path.resolve(here,'../../../../../work/video-comparison-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
test('real local FFmpeg fixture produces a decoded 30-second MP4 from moving clips and unsped continuous speech fixture',{skip:!existsSync(ffmpeg)},async()=>{
 const base=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(base,'mashhad-private-film-test-'));
 try{
  const clip=path.join(directory,'clip.mp4'),voice=path.join(directory,'voice.wav'),output=path.join(directory,'film.mp4');
  await exec(ffmpeg,['-nostdin','-v','error','-threads','2','-f','lavfi','-i','testsrc2=size=128x96:rate=16:duration=5','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',clip],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  await exec(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=24000:duration=27','-c:a','pcm_s16le',voice],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  const built=privateFilmAssemblyArgs({videoFiles:Array(6).fill(clip),audioFile:voice,audioDurationMs:27000,output});await exec(ffmpeg,built.args,{windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
  const checked=await verifyLocalVideo({file:output,expectedDurationMs:30000,hasAudio:true,ffmpeg});assert.ok(Math.abs(checked.durationMs-30000)<100);assert.equal(checked.hasAudio,true);assert.equal(checked.width,128);assert.equal(checked.height,96);assert.equal(checked.fps,16);
 }finally{const resolved=await fs.realpath(directory);assert.ok(resolved.startsWith(base+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
});
