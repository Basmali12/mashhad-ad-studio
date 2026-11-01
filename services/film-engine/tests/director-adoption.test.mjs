import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createProductionEngine} from '../engine/production-engine.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'director-adopt-')),store=new Store(dir,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(dir,{force:true,recursive:true});});const calls=[];
 const board={id:'plan',story:'A story',durationMs:20000,orientation:'landscape',characters:[{id:'man',name:'Man',description:'A fictional man',age:40,face:'Oval',body:'Tall',wardrobe:'Blue',props:[],referenceIds:[],angles:['front'],relationships:[],voice:{engineId:'habibi-irq',voiceId:'unassigned-man',locale:'ar-IQ'}}],utterances:[{id:'line',characterId:'man',text:'هلا بيك.',startMs:0,endMs:1000}],shots:[0,1].map(i=>({id:'shot'+i,startMs:i*10000,endMs:(i+1)*10000,prompt:'A new event '+i,characterIds:['man'],utteranceIds:i===0?['line']:[],referenceIds:[],eventIds:['event'+i]}))};
 const models={quote:async s=>({available:true,estimatedMicroUSD:s.kind==='save'?0:100,blockers:[],snapshot:'fixture'}),execute:async(s,p,{attempt})=>{calls.push(s.stageId);const assetId=hash(attempt.id);store.put('production-asset',{id:assetId,customerId:p.customerId,projectId:p.id,kind:s.kind==='voice'?'audio':'video',sha256:'a'.repeat(64),durationMs:20000});return {customerId:p.customerId,projectId:p.id,attemptId:attempt.id,cloudStopped:true,actualMicroUSD:s.kind==='save'?0:80,definitiveNoSpend:s.kind==='save',result:{assetIds:s.kind==='save'?[]:[assetId]}};},readAsset:async()=>Buffer.from('fixture-final')};
 const engine=createProductionEngine({store,models,allowExecution:true,artifacts:{commitFinal:async({projectId,customerId})=>({artifactId:hash(projectId+customerId),durationMs:20000,sha256:'f'.repeat(64),bytes:13})}});
 store.put('film-credit',{id:'credit',customerId:'alice',amount:1000000,remaining:1000000,createdAt:Date.now(),expiresAt:Date.now()+86400000});const p=await engine.create('alice',{requestId:'create',title:'Film',story:'Original user story',durationMs:20000});await engine.adoptPlan('alice',{id:p.id,plan:board,requestId:'adopt-first',expectedRevision:p.revision});
 const q=await engine.quote('alice',{id:p.id});await engine.approve('alice',{id:p.id,quoteId:q.id,requestId:'approved',approved:true});assert.equal((await engine.run('alice',p.id)).state,'completed');return {store,engine,p,board,calls};
}
test('reviewed shot revision preserves real completed neighbours, files and financial receipts without dispatch',async t=>{
 const f=await fixture(t),count=f.calls.length,assets=f.store.all('production-asset').length,ledger=JSON.stringify(f.store.all('film-ledger')),p=f.store.get('production-project',f.p.id),changed=structuredClone(f.board);changed.shots[1].prompt='Changed target only';const result=await f.engine.adoptPlan('alice',{id:p.id,plan:changed,requestId:'target-change',expectedRevision:p.revision});
 assert.equal(f.calls.length,count);assert.equal(f.store.all('production-asset').length,assets);assert.equal(JSON.stringify(f.store.all('film-ledger')),ledger);assert.equal(result.stages.find(s=>s.id==='animate:shot0').state,'completed');assert.equal(result.stages.find(s=>s.id==='character_image:man:0').state,'completed');assert.equal(result.stages.find(s=>s.id==='voice:line').state,'completed');assert.equal(result.stages.find(s=>s.id==='animate:shot1').state,'planned');assert.equal(result.stages.find(s=>s.id==='merge').state,'planned');assert.equal(result.story,'Original user story');assert.ok(f.store.all('production-plan-revision').length);await f.engine.run('alice',p.id);assert.equal(f.calls.length,count);
 const quote=await f.engine.quote('alice',{id:p.id});await f.engine.approve('alice',{id:p.id,quoteId:quote.id,requestId:'changed-only',approved:true});await f.engine.run('alice',p.id);assert.equal(f.calls.filter(c=>c==='animate:shot0').length,1);assert.equal(f.calls.filter(c=>c==='animate:shot1').length,2);
});
test('explicit approved voice change invalidates audio and dependent sync but preserves images and silent shot',async t=>{
 const f=await fixture(t),changed=structuredClone(f.board),p=f.store.get('production-project',f.p.id);changed.characters[0].voice.voiceId='new-explicitly-approved-profile';const r=await f.engine.adoptPlan('alice',{id:p.id,plan:changed,requestId:'voice-change',expectedRevision:p.revision});assert.equal(r.stages.find(s=>s.id==='voice:line').state,'planned');assert.equal(r.stages.find(s=>s.id==='sync:shot0').state,'planned');for(const id of ['character_image:man:0','scene_image:shot0','animate:shot0','animate:shot1','sync:shot1'])assert.equal(r.stages.find(s=>s.id===id).state,'completed',id);
 await assert.rejects(f.engine.adoptPlan('bob',{id:p.id,plan:changed,requestId:'foreign',expectedRevision:r.revision}),/NOT_FOUND/);await assert.rejects(f.engine.adoptPlan('alice',{id:p.id,plan:changed,requestId:'stale',expectedRevision:p.revision}),/CONFIG_CHANGED/);
});
