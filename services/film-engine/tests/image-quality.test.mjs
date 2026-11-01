import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../engine/store.mjs';
import {createImageQuality} from '../engine/image-quality.mjs';

function fixture(inspector){
 const rows=new Map(),put=(kind,row)=>(rows.set(kind+':'+row.id,structuredClone(row)),row),store={put,get:(k,id)=>structuredClone(rows.get(k+':'+id)||null),all:k=>[...rows].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v)),audit:()=>{}};
 put('production-project',{id:'project',customerId:'alice',state:'running',plan:{characters:[{id:'zeinab'},{id:'fatima'}],shots:[{id:'shot',characterIds:['zeinab']}]}});
 put('production-asset',{id:'anchor',customerId:'alice',projectId:'project',characterId:'zeinab',request:{referenceIds:[]}});put('production-asset',{id:'scene',customerId:'alice',projectId:'project',shotId:'shot',request:{referenceIds:['anchor']}});put('production-character-reference',{id:'ref',customerId:'alice',projectId:'project',characterId:'zeinab',assetId:'anchor',angle:'front'});
 let checksum='a'.repeat(64);const assets={async loadReference(i){const row=store.get('production-asset',i.assetId);if(!row||row.customerId!==i.customerId||row.projectId!==i.projectId)throw Error('NOT_FOUND');return {assetId:i.assetId,sha256:checksum,mime:'image/png',width:720,height:1280,bytes:Buffer.from('fixture')};}};
 const quality=createImageQuality({store,assets,visualInspector:inspector}),input={customerId:'alice',projectId:'project',assetId:'scene'};
 const approve=async(assetId='scene')=>{const review=await quality.assess({...input,assetId});return quality.approve({...input,assetId,reviewId:review.id,actor:{customerId:'alice'},approved:true,humanReviewed:true});};
 return {store,quality,input,approve,mutate:()=>{checksum='b'.repeat(64);}};
}
test('unavailable visual inspection is persisted unverified and does not certify identity',async()=>{const f=fixture(),r=await f.quality.assess(f.input);assert.equal(r.status,'unverified');assert.equal(r.visual.source,'unavailable');assert.equal((await f.quality.get(f.input)).id,r.id);await assert.rejects(f.quality.getAnimationInput(f.input),/IMAGE_REVIEW_REQUIRED/);assert.equal(f.store.get('production-asset','scene').status,undefined);});
test('manual owner approval permits handoff only after approved primary character anchor',async()=>{const f=fixture();await f.approve();await assert.rejects(f.quality.getAnimationInput(f.input),/PRIMARY_ANCHOR/);await f.approve('anchor');const refs=await f.quality.selectCharacterReferences({...f.input,characterId:'zeinab'});assert.equal(refs.length,1);assert.equal(refs[0].identityVerified,false);const handoff=await f.quality.getAnimationInput(f.input);assert.equal(handoff.approved,true);assert.equal(handoff.approvalMethod,'human_review');assert.ok(!('bytes' in handoff));assert.ok(!('path' in handoff));assert.ok(Buffer.isBuffer((await f.quality.getAnimationInput({...f.input,includeBytes:true})).bytes));});
test('foreign actors, missing human review and stale hashes cannot approve or animate',async()=>{const f=fixture(),r=await f.quality.assess(f.input);await assert.rejects(f.quality.approve({...f.input,reviewId:r.id,actor:{customerId:'bob'},approved:true,humanReviewed:true}),/FORBIDDEN/);await assert.rejects(f.quality.approve({...f.input,reviewId:r.id,actor:{customerId:'alice'},approved:true}),/HUMAN_REVIEW/);await assert.rejects(f.quality.assess({...f.input,customerId:'bob'}),/NOT_FOUND/);await f.approve();f.mutate();await assert.rejects(f.quality.get(f.input),/STALE/);});
test('failed visual evidence or wrong dimensions remain blocked without regeneration',async()=>{const f=fixture(async()=>({checks:{faces:true,identity:true,anatomy:false,props:true,text:true}})),r=await f.quality.assess(f.input);assert.equal(r.status,'failed');await assert.rejects(f.approve(),/QUALITY_FAILED/);await assert.rejects(f.quality.getAnimationInput(f.input),/QUALITY_FAILED/);const g=fixture();assert.equal((await g.quality.assess({...g.input,expectedWidth:100})).status,'failed');});
test('partial inspector evidence is unverified and cast mismatch fails metadata checks',async()=>{const f=fixture(async()=>({checks:{faces:true}}));assert.equal((await f.quality.assess(f.input)).status,'unverified');assert.equal((await f.quality.assess({...f.input,characterIds:['fatima']})).status,'failed');await assert.rejects(f.quality.assess({...f.input,characterIds:['foreign']}),/CHARACTER_MAPPING/);});
test('trusted visual pass still requires human approval and re-assessment revokes approval',async()=>{const f=fixture(async()=>({checks:{faces:true,identity:true,anatomy:true,props:true,text:true}}));assert.equal((await f.quality.assess(f.input)).status,'passed');await assert.rejects(f.quality.getAnimationInput(f.input),/REVIEW_REQUIRED/);await f.approve();await f.approve('anchor');await f.quality.getAnimationInput(f.input);await f.quality.assess(f.input);await assert.rejects(f.quality.getAnimationInput(f.input),/REVIEW_REQUIRED/);});
test('old review tokens and changed plans invalidate earlier approvals',async()=>{const f=fixture(),old=await f.quality.assess(f.input);await f.quality.assess(f.input);await assert.rejects(f.quality.approve({...f.input,reviewId:old.id,actor:{customerId:'alice'},approved:true,humanReviewed:true}),/REVIEW_REQUIRED/);await f.approve();const p=f.store.get('production-project','project');f.store.put('production-project',{...p,revision:2});await assert.rejects(f.quality.get(f.input),/STALE/);});
test('reference bindings cannot associate a character with another identity source',async()=>{const f=fixture();assert.equal((await f.quality.assess({...f.input,requirements:{referenceBindings:[{assetId:'anchor',characterId:'fatima'}]}})).status,'failed');assert.equal((await f.quality.assess({...f.input,requirements:{referenceBindings:[{assetId:'anchor',characterId:'zeinab'}]}})).status,'unverified');});

function privateFixture(){
 const f=fixture(),owner='owner-private-flux-test',customerId=hash('film-customer:'+owner);
 const p=f.store.get('production-project','project');Object.assign(p,{customerId,title:'الحياة ما بعد الموت',durationMs:30000,revision:1,adminCommissioning:{ownerId:owner,privateFilmId:'afterlife-20261101',privateFilmAccountId:'private-primary'}});f.store.put('production-project',p);
 f.store.put('account',{id:'private-primary',workspace:'basm1998ali',credentials:'synthetic-sealed-reference'});
 for(const id of ['anchor','scene']){const a=f.store.get('production-asset',id);Object.assign(a,{customerId,kind:'image',status:'completed',sha256:'a'.repeat(64),generatedBy:'flux-image-assets-v1',request:{...a.request,modelId:'flux2-klein-4b'}});f.store.put('production-asset',a);}
 f.store.put('production-character-reference',{...f.store.get('production-character-reference','ref'),customerId});
 f.input={...f.input,customerId};f.actor={id:owner,isAdmin:true};
 f.approveDelegated=async(assetId='scene',extra={})=>{const input={...f.input,assetId},r=await f.quality.assess(input);return f.quality.approve({...input,reviewId:r.id,actor:f.actor,approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual',...extra});};
 return f;
}

test('private delegated visual approval is truthful, remains unverified, and enables only scoped animation with approved anchors',async()=>{
 const f=privateFixture(),r=await f.approveDelegated();assert.equal(r.status,'unverified');assert.equal(r.approval.humanReviewed,false);assert.equal(r.approval.reviewerKind,'delegated_agent_visual');assert.equal(r.approval.identityVerified,false);assert.equal(r.approval.approvedForAnimation,true);assert.equal(r.approval.sha256,'a'.repeat(64));
 await assert.rejects(f.quality.getAnimationInput(f.input),/PRIMARY_ANCHOR/);await f.approveDelegated('anchor');const handoff=await f.quality.getAnimationInput(f.input),refs=await f.quality.selectCharacterReferences({...f.input,characterId:'zeinab'});
 for(const value of [handoff,refs[0]]){assert.equal(value.approvalMethod,'delegated_agent_visual');assert.equal(value.humanReviewed,false);assert.equal(value.reviewerKind,'delegated_agent_visual');assert.equal(value.identityVerified,false);}
});
for(const [name,mutate] of [
 ['other actor',f=>{f.actor={id:'other-admin',isAdmin:true};}],
 ['nonadmin actor',f=>{f.actor={id:'owner-private-flux-test',isAdmin:false,customerId:f.input.customerId};}],
 ['other private film',f=>{const p=f.store.get('production-project','project');p.adminCommissioning.privateFilmId='other';f.store.put('production-project',p);}],
 ['other title',f=>{const p=f.store.get('production-project','project');p.title='other';f.store.put('production-project',p);}],
 ['other duration',f=>{const p=f.store.get('production-project','project');p.durationMs=60000;f.store.put('production-project',p);}],
 ['other account',f=>{const a=f.store.get('account','private-primary');a.workspace='other';f.store.put('account',a);}],
 ['unlinked account',f=>{const a=f.store.get('account','private-primary');a.unlinked=true;f.store.put('account',a);}],
 ['ordinary project without private markers',f=>{const p=f.store.get('production-project','project');delete p.adminCommissioning;f.store.put('production-project',p);}]
])test('delegated visual review cannot bypass '+name,async()=>{const f=privateFixture();mutate(f);await assert.rejects(f.approveDelegated(),/IMAGE_PRIVATE_VISUAL_REVIEW_REQUIRED/);await assert.rejects(f.quality.getAnimationInput(f.input),/REVIEW_REQUIRED/);});

test('private review cannot claim human review or waive failed structural checks',async()=>{
 const f=privateFixture();await assert.rejects(f.approveDelegated('scene',{humanReviewed:true}),/PRIVATE_VISUAL/);
 const r=await f.quality.assess({...f.input,expectedWidth:100});await assert.rejects(f.quality.approve({...f.input,reviewId:r.id,actor:f.actor,approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual'}),/QUALITY_FAILED/);
});
test('delegated approval is revoked by changed SHA, project revision, plan or private account scope',async()=>{
 for(const change of ['sha','revision','plan','account']){const f=privateFixture();await f.approveDelegated();await f.approveDelegated('anchor');
  if(change==='sha')f.mutate();else if(change==='account'){const a=f.store.get('account','private-primary');a.workspace='other';f.store.put('account',a);}else{const p=f.store.get('production-project','project');if(change==='revision')p.revision++;else p.plan.extra='changed';f.store.put('production-project',p);}
  await assert.rejects(f.quality.getAnimationInput(f.input),/STALE|REVIEW_REQUIRED/);
 }
});
test('ordinary customer still needs real human review and cannot use delegated kind',async()=>{const f=fixture(),r=await f.quality.assess(f.input);await assert.rejects(f.quality.approve({...f.input,reviewId:r.id,actor:{customerId:'alice'},approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual'}),/PRIVATE_VISUAL/);await assert.rejects(f.quality.getAnimationInput(f.input),/REVIEW_REQUIRED/);});

test('copying all private film markers onto a different customer project cannot forge delegated approval',async()=>{
 const f=fixture(),p=f.store.get('production-project','project');Object.assign(p,{title:'الحياة ما بعد الموت',durationMs:30000,adminCommissioning:{ownerId:'owner-private-flux-test',privateFilmId:'afterlife-20261101',privateFilmAccountId:'primary'}});f.store.put('production-project',p);f.store.put('account',{id:'primary',workspace:'basm1998ali',credentials:'synthetic-sealed'});
 const r=await f.quality.assess(f.input);await assert.rejects(f.quality.approve({...f.input,reviewId:r.id,actor:{id:'owner-private-flux-test',isAdmin:true},approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual'}),/PRIVATE_VISUAL/);await assert.rejects(f.quality.getAnimationInput(f.input),/REVIEW_REQUIRED/);
});
