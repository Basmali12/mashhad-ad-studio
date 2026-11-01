import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Buffer} from 'node:buffer';
import {randomBytes} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createCinematicSync} from '../engine/cinematic-sync.mjs';
import {stagesForPlan} from '../engine/production-plan.mjs';
import {pcmWav} from './voice-fixtures.mjs';

async function fixture(t,{low=false}={}){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'cinematic-checkpoints-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});
 const scope={projectId:'project',customerId:'alice',attemptId:'attempt'},plan={durationMs:1000,characters:[],narrators:[{id:'narrator',voice:{voiceId:'voice'}}],utterances:[{id:'line',characterId:null,narratorId:'narrator',role:'narration',text:'حاكم قاس',startMs:0,endMs:1000}],shots:[{id:'first',sceneId:'scene',chapterId:'chapter',startMs:0,endMs:500,utteranceIds:['line']},{id:'second',sceneId:'scene',chapterId:'chapter',startMs:500,endMs:1000,utteranceIds:['line'],audioCue:{utteranceId:'line',wordIndex:1,sentenceIndex:null}}]};
 store.put('production-project',{id:'project',customerId:'alice',revision:1,state:'running',plan});
 async function asset(id,kind,bytes,extra={}){const dir=path.join(folder,'production-assets','project',id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,kind==='audio'?'audio.wav':'video.mp4');await fs.writeFile(file,bytes);store.put('production-asset',{id,projectId:'project',customerId:'alice',kind,path:file,sha256:hash(bytes),bytes:bytes.length,durationMs:1000,...extra});}
 function completed(stageId,assetId){store.put('production-stage',{id:hash('project:'+stageId),stageId,projectId:'project',customerId:'alice',state:'completed',result:{assetIds:[assetId]}});}
 await asset('audio','audio',pcmWav({rate:24000,seconds:1}),{profileId:'voice',sampleRate:24000,samples:24000});completed('voice:line','audio');for(const id of ['first','second']){await asset(id,'video',Buffer.alloc(32),{durationMs:500,hasAudio:false,width:64,height:64,fps:25});completed('animate:'+id,id);}
 const raw={id:'alignment',projectId:'project',customerId:'alice',kind:'alignment',approved:!low,needsReview:low,reviewed:false,alignment:{words:[{text:'حاكم',startMs:0,endMs:400,confidence:low?.3:.95},{text:'قاس',startMs:500,endMs:900,confidence:low?.3:.95}],sentences:[{text:'حاكم قاس',startMs:0,endMs:900}],durationMs:1000,confidence:low?.3:.95,needsReview:low}};store.put('production-asset',raw);completed('align:line','alignment');let trims=0;const sync=createCinematicSync({store,assets:{readAlignment:async()=>({metadata:store.get('production-asset','alignment')})},media:{trimShot:async({assetId})=>{trims++;return {id:assetId};}}});return {store,sync,scope,plan,completed,raw,getTrims:()=>trims};
}
test('durable measured timeline uses actual words, one narration track and content-addressed checkpoints across restart',async t=>{
 const f=await fixture(t),input={scope:f.scope,stage:{kind:'timeline_sync'},plan:f.plan},r=await f.sync.execute(input);assert.equal(r.actualMicroUSD,0);const page=await f.sync.getTimeline('alice','project',{offset:0,limit:1});assert.equal(page.totalShots,2);assert.equal(page.shots[0].endMs,520);assert.equal(page.audioTracks.length,1);assert.equal(page.audioTracks[0].voiceProfileId,'voice');assert.equal(page.quality.lipSynchronizationVerified,false);assert.equal(f.store.get('production-project','project').measuredDurationMs,1000);const again=await f.sync.execute(input);assert.deepEqual(again.result,r.result);assert.equal(f.store.all('production-cinematic-timeline').length,1);await assert.rejects(f.sync.getTimeline('bob','project'),/NOT_FOUND/);
});
test('low-confidence alignment persists review proposal without another model call; explicit human acceptance can resume it',async t=>{
 const f=await fixture(t,{low:true}),input={scope:f.scope,stage:{kind:'timeline_sync'},plan:f.plan};await assert.rejects(f.sync.execute(input),e=>e.needsReview===true&&e.definitiveNoSpend===true);assert.equal((await f.sync.getTimeline('alice','project')).needsReview,true);f.store.put('production-asset',{...f.raw,approved:true,reviewed:true,needsReview:false});await f.sync.execute(input);assert.equal((await f.sync.getTimeline('alice','project')).needsReview,false);assert.equal(f.store.get('production-asset','alignment').alignment.confidence,.3);assert.equal(f.getTrims(),0);
});
test('a successful lip asset is retained while local visual review is pending, and accepted output resumes without rerunning inference',async t=>{
 const f=await fixture(t);f.plan.shots[0].requires_lip_sync=true;await f.sync.execute({scope:f.scope,stage:{kind:'timeline_sync'},plan:f.plan});f.store.put('production-asset',{id:'lips',projectId:'project',customerId:'alice',approved:false,needsReview:true});const input={scope:f.scope,stage:{kind:'sync',stageId:'sync:first',subjectId:'first'},plan:f.plan,inputs:[{stageId:'lip_sync:first',result:{assetIds:['lips']}}]};await assert.rejects(f.sync.renderShot(input),e=>e.needsReview===true);assert.equal(f.getTrims(),0);f.store.put('production-asset',{id:'lips',projectId:'project',customerId:'alice',approved:true,needsReview:false});await f.sync.renderShot(input);assert.equal(f.getTrims(),1);assert.equal(f.store.all('production-edit').length,1);assert.equal(f.store.get('production-stage',hash('project:animate:first')).state,'completed');
});
test('synchronization DAG includes required lips only, follows all dependencies and keeps the continuous narrator voice unique',()=>{
 const plan={id:'story',story:'قصة قصيرة',durationMs:10000,characters:[{id:'actor',name:'حسن',description:'رجل عراقي',age:30,face:'عينان بنيتان',body:'متوسط القامة',wardrobe:'قميص أزرق',voice:{engineId:'habibi-irq',voiceId:'fixed',locale:'ar-IQ'},angles:['front']}],utterances:[{id:'line',characterId:'actor',text:'هلا بيك',startMs:0,endMs:10000}],shots:[{id:'shot',startMs:0,endMs:10000,prompt:'A man speaks.',characterIds:['actor'],utteranceIds:['line'],eventIds:['greeting'],requires_lip_sync:true}]};const stages=stagesForPlan(plan,{cinematicSync:true}),seen=new Set();for(const s of stages){assert.ok(s.deps.every(d=>seen.has(d)),s.id);seen.add(s.id);}assert.ok(seen.has('align:line'));assert.ok(seen.has('timeline_sync'));assert.ok(seen.has('lip_sync:shot'));assert.equal(stages.filter(s=>s.id==='voice:line').length,1);assert.equal(stages.at(-1).id,'save');
});
