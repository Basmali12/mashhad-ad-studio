import test from 'node:test';
import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createProductionEngine} from '../engine/production-engine.mjs';
import {createProductionModels} from '../engine/production-models.mjs';
import {createProductionRenderer} from '../engine/production-renderer.mjs';
import {createEngineRegistry} from '../engine/engine-registry.mjs';
import {createSpeechServices,SPEECH_MANIFESTS} from '../engine/speech-integration.mjs';
import {splitSpeechText,selectSpeechModel,speechExpression} from '../engine/speech-policy.mjs';
import {pcmWav} from './voice-fixtures.mjs';

async function fixture(t,{durationMs=60000,paid=true,audarRights=true}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'speech-flow-')),store=new Store(dir,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 let time=1000000,failAt=null;const now=()=>time,calls=[],transports={},bindings={},profiles={};
 for(const [modelId,manifest] of Object.entries(SPEECH_MANIFESTS))transports[modelId]={
  inspect:async({definition:d})=>({accountId:d.accountId,volume:d.volume,weightPath:d.weightPath,revision:manifest.revision,deploymentReady:true,files:manifest.files.map(f=>({...f,verified:true}))}),
  start:async({definition:d,runId})=>{calls.push({kind:'start',modelId,accountId:d.accountId});return {engineId:d.id,accountId:d.accountId,runId,ready:true};},
  stop:async({definition:d,runId})=>{time+=1000;return {engineId:d.id,accountId:d.accountId,runId,cloudStopped:true,admissionClosed:true,activeTasks:0,startSettled:true};},
  generate:async({definition:d,scope,runId,request})=>{calls.push({kind:'generate',modelId,request});if(calls.filter(c=>c.kind==='generate').length===failAt)throw Error('fixture synthesis failure');const bytes=pcmWav({rate:24000,seconds:.5});return {scope:{...scope,engineId:d.id,accountId:d.accountId,runId},modelRevision:manifest.revision,audioBase64:bytes.toString('base64'),sha256:hash(bytes),inferenceSeconds:.1};}
 };
 const speech=createSpeechServices({store,now,allowPaid:paid,audarLicenseAccepted:audarRights,codecLicenseAccepted:audarRights,transports}),registry=createEngineRegistry({store,now,allowPaid:paid,adapter:speech.registryAdapter});
 for(const [modelId,m] of Object.entries(SPEECH_MANIFESTS)){const accountId=randomUUID();store.put('account',{id:accountId,mode:'token',credentials:store.seal({tokenId:'ak-fixture-only',tokenSecret:'as-fixture-only'},accountId)});const d=await registry.dispatch({isAdmin:true},'admin.engine.save',{name:modelId,modelId,version:m.version,accountId,gpu:'L40S',cpu:2,ramGiB:16,minVramGiB:8,hourPriceUSD:'3'});await registry.dispatch({isAdmin:true},'admin.engine.inspect',{id:d.id});// Explicit local fixture publication, never a real admin action.
 const published=store.get('engine-definition',d.id);store.put('engine-definition',{...published,publication:{approved:true,tested:true,revision:published.revision}});bindings[modelId]=d.id;}
 const renderer=createProductionRenderer({store,speechMerge:speech.merger}),models=createProductionModels({store,registry,adapters:speech.productionAdapters,renderer,now});
 const board=()=>({durationMs,characters:Object.entries(profiles).filter(([key])=>key!=='narrator-two').map(([key,p])=>({id:key,name:key,description:'Consented synthetic fixture',age:30,face:'Oval face',body:'Average',wardrobe:'Blue jacket',props:[],referenceIds:[],angles:['front'],relationships:[],voice:{engineId:p.modelId,voiceId:p.id,locale:p.locale}})),narrators:[{id:'narrator-two',name:'Narrator',voice:{engineId:profiles['narrator-two'].modelId,voiceId:profiles['narrator-two'].id,locale:'ar'}}],
  utterances:Object.entries(profiles).map(([key],i)=>({id:'line'+i,characterId:key==='narrator-two'?null:key,...(key==='narrator-two'?{narratorId:key,role:'narration',expression:'whispers'}:{}),text:(i===0?'هلا بيك، شلونك اليوم؟ نريد نسوي قصة جميلة وتبقى الأصوات ثابتة. '.repeat(4):'هذا نص اختباري فقط.').trim(),startMs:i*10000,endMs:(i+1)*10000})),
  shots:Array.from({length:durationMs/10000},(_,i)=>({id:'shot'+i,startMs:i*10000,endMs:(i+1)*10000,prompt:'A local test scene '+i,characterIds:[],referenceIds:[],utteranceIds:i<4?['line'+i]:[],eventIds:['event'+i]}))});
 const make=()=>createProductionEngine({store,models,now,allowExecution:paid,planner:{billingMode:'none',analyze:async()=>({}),plan:async()=>board()}}),engine=make();
 store.put('film-credit',{id:'credit',customerId:'alice',amount:100000000,remaining:100000000,createdAt:time,expiresAt:time+86400000});await engine.configure({isAdmin:true},{bindings});
 const project=await engine.create('alice',{requestId:'new',title:'Speech test',story:'A local speech fixture',durationMs});
 const reference=await speech.voiceProfiles.commitReference({actor:{customerId:'alice'},customerId:'alice',bytes:pcmWav(),transcript:'هذا صوت اصطناعي للاختبار فقط.',rightsAttestation:{kind:'licensed',confirmed:true}});
 for(const [index,modelId] of Object.keys(SPEECH_MANIFESTS).entries()){const narrator=modelId==='audar-tts-v1-flash',key=narrator?'narrator-two':'character'+index,m=SPEECH_MANIFESTS[modelId];profiles[key]=await speech.voiceProfiles.create({actor:{customerId:'alice'},customerId:'alice',projectId:project.id,characterId:narrator?null:key,narrator,...(narrator?{narratorId:key}:{}),name:key,modelId,version:m.version,revision:m.revision,locale:({'habibi-irq':'ar-IQ','habibi-egy':'ar-EG','habibi-msa':'ar-MSA'})[modelId]??'ar',gender:index%2?'male':'female',referenceAssetId:reference.referenceAssetId,settings:{seed:42},approved:true});}
 await engine.plan('alice',{id:project.id});return {store,engine,make,project,speech,registry,bindings,profiles,calls,setFailure:n=>{failAt=n;}};
}

test('speech policy preserves exact long text, planned pauses and fixed dialect without guessing',()=>{
 const text='هذه جملة عراقية. '.repeat(90),chunks=splitSpeechText(text,{modelId:'habibi-irq',pauses:[{afterOffset:16,durationMs:100}]});assert.equal(chunks.map(c=>c.text).join(''),text);assert.equal(chunks[0].pauseAfterMs,100);assert.ok(chunks.every(c=>Buffer.byteLength(c.text,'utf8')<=120));
 assert.equal(selectSpeechModel({locale:'ar-IQ'}),'habibi-irq');assert.equal(selectSpeechModel({locale:'ar-EG'}),'habibi-egy');assert.equal(speechExpression('همس'),'whispers');assert.throws(()=>selectSpeechModel({locale:'ar-IQ',modelId:'audar-tts-v1-flash'}),/UNVERIFIED/);assert.throws(()=>selectSpeechModel({locale:'ar-IQ',expression:'whispers'}),/UNSUPPORTED/);assert.throws(()=>splitSpeechText('[laughs]',{modelId:'audar-tts-v1-flash'}),/INVALID/);
});

for(const durationMs of [60000,600000])test(`real orchestration with mock TTS: ${durationMs/1000}s plan checkpoints voices and native PCM without repeated synthesis`,async t=>{
 const f=await fixture(t,{durationMs}),balance=f.store.get('film-credit','credit').remaining;
 const q=await f.engine.quote('alice',{id:f.project.id,phase:'audio'});assert.equal(q.dispatchAvailable,true);assert.equal(f.calls.length,0);assert.equal(f.store.get('film-credit','credit').remaining,balance);
 await assert.rejects(f.engine.approve('alice',{id:f.project.id,quoteId:q.id,requestId:'no'}),/APPROVAL_REQUIRED/);
 await f.engine.approve('alice',{id:f.project.id,quoteId:q.id,requestId:'yes',approved:true});await f.engine.run('alice',f.project.id,{maxStages:2});f.engine.close();const resumed=f.make();await resumed.recover();const p=await resumed.run('alice',f.project.id);assert.equal(p.state,'planned',JSON.stringify(p.stages.filter(s=>s.state==='failed')));assert.ok(p.completedPhases.includes('audio'));
 const generated=f.calls.filter(c=>c.kind==='generate'),stored=f.store.get('production-project',p.id).plan;assert.equal(generated.length,stored.utterances.reduce((n,u)=>n+u.speechChunks.length,0));assert.equal(new Set(generated.map(c=>c.request.utteranceId+':'+c.request.seed)).size,generated.length);
 for(const u of stored.utterances){const calls=generated.filter(c=>c.request.utteranceId===u.id),speaker=u.narratorId?stored.narrators[0]:stored.characters.find(c=>c.id===u.characterId);assert.equal(calls.map(c=>c.request.text).join(''),u.text);assert.ok(calls.every(c=>c.request.voiceProfileId===speaker.voice.voiceId&&c.modelId===speaker.voice.engineId));const s=f.store.get('production-stage',hash(p.id+':voice:'+u.id)),audio=await f.speech.assets.read({customerId:'alice',projectId:p.id,assetId:s.result.assetIds[0]});assert.equal(audio.metadata.wordTimings,null);assert.equal(audio.metadata.transcriptionVerified,false);assert.equal(audio.metadata.sampleRate,24000);assert.equal(audio.metadata.durationMs,calls.length*500);}
 assert.ok(f.store.get('film-credit','credit').remaining<balance);assert.ok(f.store.all('production-charge').every(c=>c.state==='settled'));await resumed.run('alice',p.id);assert.equal(f.calls.filter(c=>c.kind==='generate').length,generated.length);await assert.rejects(resumed.get('bob',p.id),/NOT_FOUND/);
});

test('closed spend and unaccepted Audar rights cannot start speech resources',async t=>{
 const f=await fixture(t,{paid:false});const q=await f.engine.quote('alice',{id:f.project.id,phase:'audio'});assert.equal(q.dispatchAvailable,false);assert.equal(f.calls.length,0);await assert.rejects(f.registry.dispatch({isAdmin:false},'admin.engine.list'),/FORBIDDEN/);
 const g=await fixture(t,{audarRights:false});const cost=await g.registry.dispatch({isAdmin:true},'admin.engine.quote',{id:g.bindings['audar-tts-v1-flash'],action:'start'});assert.equal(cost.dispatchAvailable,false);assert.equal(g.calls.length,0);
});

test('one failed speech chunk waits for explicit retry with the same profile, text and seed',async t=>{
 const f=await fixture(t),q=await f.engine.quote('alice',{id:f.project.id,phase:'audio'});await f.engine.approve('alice',{id:f.project.id,quoteId:q.id,requestId:'yes',approved:true});f.setFailure(2);let p=await f.engine.run('alice',f.project.id);assert.equal(p.state,'failed');assert.equal(f.calls.filter(c=>c.kind==='generate').length,2);const failed=p.stages.find(s=>s.state==='failed'),original=f.calls.filter(c=>c.kind==='generate')[1].request;
 await f.engine.run('alice',p.id);assert.equal(f.calls.filter(c=>c.kind==='generate').length,2);const quote=await f.engine.quote('alice',{id:p.id,phase:'audio'});await f.engine.retry('alice',{id:p.id,stageId:failed.id,quoteId:quote.id,requestId:'explicit-retry',approved:true});f.setFailure(null);p=await f.engine.run('alice',p.id);assert.equal(p.state,'planned');const calls=f.calls.filter(c=>c.kind==='generate');assert.deepEqual(calls[2].request,original);assert.equal(calls.filter(c=>c.request.utteranceId===calls[0].request.utteranceId&&c.request.seed===42).length,1);
});

test('sixty-minute storyboard accepts independent narration without spending or allocating',async t=>{
 const f=await fixture(t,{durationMs:3600000});const p=await f.engine.get('alice',f.project.id);assert.equal(p.durationMs,3600000);assert.equal(p.timeline.shots.length,360);assert.equal(p.narrators[0].id,'narrator-two');assert.equal(f.calls.length,0);
});
