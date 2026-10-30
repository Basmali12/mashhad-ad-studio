import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createEngineAPI} from '../engine/api.mjs';
async function fixture(t){
 const folder=await mkdtemp(path.join(tmpdir(),'visual-accept-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);let calls=0;store.installRentalSchema();
 const api=await createEngineAPI({folder,key,store,provider:{call:async()=>{calls++;throw Error('NO_PROVIDER');}},allowPaid:false,allowCustomerRentals:true});
 const j={id:randomUUID(),projectId:'p',accountId:'account',tenantId:'alice',rentalId:'r',engineSlotId:'s',action:'generate',status:'needs_review',error:'GENERATION_SUCCEEDED_TEXT_REVIEW_REQUIRED',cloudStopped:true,result:{videoVerified:true,sha256:hash('verified-fixture-original'),textQuality:{status:'needs_review',boxes_before:1}}};
 const review={id:'review-call',mode:'review',projectId:'p',status:'completed',model:'gpt-6.1-terra',evidence:{policy:'ltx-native-av-sampled-visual-review-v1',jobId:j.id,sha256:j.result.sha256},visualReview:{visibleText:'not_seen_in_samples',audioAssessment:'not_checked'}};
 await mkdir(path.join(folder,'artifacts',j.id),{recursive:true});await writeFile(path.join(folder,'artifacts',j.id,'video.mp4'),'verified-fixture-original');store.put('job',j);store.put('text-call',review);
 t.after(async()=>{await api.close();await rm(folder,{recursive:true,force:true});});
 const accept=(body={reviewCallId:review.id,approved:true},scope=undefined)=>api.invoke('jobs/'+j.id+'/accept-review',body,scope);
 return {api,store,j,review,accept,folder,calls:()=>calls};
}
test('matched review accepts same verified video, preserves original evidence and creates no cloud operation',async t=>{
 const f=await fixture(t),body={reviewCallId:f.review.id,approved:true};
 const scope={tenantId:'alice',rentalId:'r',engineSlotId:'s',accountId:'account'};
 const result=await f.accept(body,scope);assert.equal(result.status,'completed');assert.equal(result.result.textQuality.status,'passed');assert.equal(result.result.textQuality.detectorStatus,'needs_review');assert.equal(result.result.textQuality.scope,'sampled_frames_not_full_video_or_audio');assert.equal(result.result.sha256,f.j.result.sha256);
 assert.equal((await readFile(path.join(f.folder,'artifacts',f.j.id,'video.mp4'))).toString(),'verified-fixture-original');await f.accept(body,scope);assert.equal(f.calls(),0);
});
test('no approval, foreign tenant, wrong job/hash/project, visible writing and changed artifact cannot be accepted',async t=>{
 const f=await fixture(t);await assert.rejects(f.accept({reviewCallId:f.review.id}),/QUALITY_REVIEW_APPROVAL_REQUIRED/);
 await assert.rejects(f.api.invoke('llm/reviews',{jobId:f.j.id,projectId:'p',requestId:'not-approved'}),/TEXT_COST_APPROVAL_REQUIRED/);
 await assert.rejects(f.accept(undefined,{tenantId:'bob',rentalId:'r',engineSlotId:'s',accountId:'account'}),/RENTAL_SCOPE_DENIED/);
 for(const change of [v=>v.evidence.sha256='different',v=>v.evidence.jobId='another',v=>v.projectId='other',v=>v.visualReview.visibleText='detected',v=>v.status='uncertain']){
  const r=structuredClone(f.review);change(r);f.store.put('text-call',r);await assert.rejects(f.accept(),/MATCHED_VISUAL_REVIEW_REQUIRED/);assert.equal(f.store.get('job',f.j.id).status,'needs_review');
 }
 f.store.put('text-call',f.review);await writeFile(path.join(f.folder,'artifacts',f.j.id,'video.mp4'),'changed');await assert.rejects(f.accept(),/REVIEW_ARTIFACT_CHANGED/);assert.equal(f.calls(),0);
});


test('customer can release only its own intact verified OCR-held output, without review or a provider call',async t=>{
 const f=await fixture(t),scope={tenantId:'alice',rentalId:'r',engineSlotId:'s',accountId:'account'};
 f.store.put('film-project',{id:'p',customerId:'alice',scenes:[{jobId:f.j.id}]});
 const finish=(scopeOverride=scope)=>f.api.invoke('jobs/'+f.j.id+'/accept-output',{},scopeOverride);
 await assert.rejects(finish({...scope,tenantId:'bob'}),/RENTAL_SCOPE_DENIED/);
 await assert.rejects(finish({}),/VERIFIED_CUSTOMER_OUTPUT_REQUIRED/);
 const result=await finish();assert.equal(result.status,'completed');assert.equal(result.error,null);
 assert.equal(result.result.textQuality.status,'needs_review');assert.equal(result.result.sha256,f.j.result.sha256);
 assert.equal(result.result.qualityWarning,'TEXT_QUALITY_NOT_CERTIFIED_CONTINUATION_ALLOWED');
 await finish();assert.equal(f.calls(),0);assert.equal(f.store.all('text-call').length,1);
});
test('release of a historical output refuses missing project ownership, uncertain generation or changed bytes',async t=>{
 const f=await fixture(t),scope={tenantId:'alice',rentalId:'r',engineSlotId:'s',accountId:'account'};
 const finish=()=>f.api.invoke('jobs/'+f.j.id+'/accept-output',{},scope);
 await assert.rejects(finish(),/VERIFIED_CUSTOMER_OUTPUT_REQUIRED/);
 f.store.put('film-project',{id:'p',customerId:'alice',scenes:[{jobId:f.j.id}]});
 f.store.put('job',{...f.j,status:'uncertain'});await assert.rejects(finish(),/VERIFIED_CUSTOMER_OUTPUT_REQUIRED/);
 f.store.put('job',f.j);await writeFile(path.join(f.folder,'artifacts',f.j.id,'video.mp4'),'changed');await assert.rejects(finish(),/REVIEW_ARTIFACT_CHANGED/);assert.equal(f.calls(),0);
});
