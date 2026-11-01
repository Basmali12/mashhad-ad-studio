import test from 'node:test';
import {setImmediate} from 'node:timers';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createEngineCommissioning} from '../engine/engine-commissioning.mjs';

const admin={id:'admin-one',isAdmin:true},otherAdmin={id:'admin-two',isAdmin:true};
async function fixture(t,{paid=true,licensed=true,filesReady=true,environmentReady=true}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'engine-commission-')),store=new Store(folder,randomBytes(32).toString('base64'));
 let at=1000000,allowed=licensed,files=filesReady,environment=environmentReady,dependencies='deps-one',runtimeStopped=true,estimated=100000,available=true;
 const definitions=[{id:'engine-one',accountId:'account-one',modelId:'flux2-klein-4b',version:'4B',revision:1,hourMicros:3000000},{id:'engine-two',accountId:'account-two',modelId:'flux2-klein-4b',version:'4B',revision:1,hourMicros:3000000}];for(const e of definitions)store.put('engine-definition',e);
 const calls={quote:0,execute:0,follow:0,stop:0,publish:0,unpublish:0},controls={fail:false,badReceipt:false,pending:false,gate:null,release:null};
 const policyFor=async id=>{const e=store.get('engine-definition',id);if(!e)throw Error('NOT_FOUND');return {id:e.id,accountId:e.accountId,revision:e.revision,fingerprint:hash(JSON.stringify([e.id,e.revision,e.accountId])),manifestRevision:'pinned-manifest-one',softwareVersion:'native-v1',dependenciesFingerprint:dependencies,inspection:{filesReady:files,environmentReady:environment},runtimeStopped,license:{allowed,blockers:allowed?[]:['ENGINE_LICENSE_REQUIRED'],evidenceDigest:'licensed-evidence'}};};
 const receipt=args=>({testId:args.testId,engineId:args.definition.id,accountId:args.definition.accountId,settingsRevision:args.definition.revision,runId:'run-'+args.testId,cloudStopped:true,verified:true,artifacts:[{id:'artifact-'+args.testId,kind:'image',sha256:'a'.repeat(64),mime:'image/png',bytes:128,width:512,height:512}],recordedProviderUSD:.015});
 const runner={quote:async()=>{calls.quote++;return {available,estimatedMicroUSD:estimated,estimate:{resourceWindowUSD:.1,recordedUSD:null,note:'Synthetic local quote; not provider invoice.'}};},execute:async args=>{calls.execute++;controls.args=args;await args.onProgress({completed:1,total:4,unit:'steps'});if(controls.gate)await controls.gate;if(controls.fail)throw Error('sk-private-provider-output-fixture');return controls.badReceipt?{...receipt(args),accountId:'wrong-account'}:receipt(args);},follow:async()=>{calls.follow++;return null;},stop:async args=>{calls.stop++;return {testId:args.testId,engineId:args.definition.id,accountId:args.definition.accountId,cloudStopped:true};}};
 const options={store,policyFor,testRunner:runner,allowPaid:paid,now:()=>at,onPublish:async(e,pub)=>{calls.publish++;store.put('test-published-slot',{id:e.id,accountId:e.accountId,price:e.hourMicros,pub});},onUnpublish:async e=>{calls.unpublish++;store.delete('test-published-slot',e.id);}};
 let service=createEngineCommissioning(options);
 t.after(async()=>{controls.release?.();await service.drain();store.close();await rm(folder,{recursive:true,force:true});});
 const invoke=(suffix,input={},actor=admin)=>service.dispatch(actor,'admin.engine.'+suffix,{id:'engine-one',...input});
 const quote=()=>invoke('test.quote',{input:{prompt:'A realistic cinematic portrait'}});
 const execute=async(requestId='native-test-one')=>{const q=await quote();const status=await invoke('test.execute',{quoteId:q.id,requestId,approved:true});await service.drain();return {...await invoke('test.status'),initial:status,quote:q};};
 const pass=async()=>{const status=await execute();await invoke('test.review',{testId:status.latestTest.id,approved:true,accept:true});return status.latestTest.id;};
 const approve=async()=>{const testId=await pass();await invoke('approve',{testId,approved:true});return testId;};
 return {store,calls,controls,runner,options,invoke,quote,execute,pass,approve,policyFor,service,get current(){return service;},restart:()=>service=createEngineCommissioning(options),setTime:v=>at=v,setLicense:v=>allowed=v,setFiles:v=>files=v,setEnvironment:v=>environment=v,setDependencies:v=>dependencies=v,setStopped:v=>runtimeStopped=v,setEstimate:v=>estimated=v,setAvailable:v=>available=v,pause:()=>{controls.gate=new Promise(resolve=>controls.release=resolve);}};
}

test('initial metadata, readiness and quotes never allocate a test resource or claim weights imply inference',async t=>{
 const f=await fixture(t);const status=await f.invoke('test.status');assert.equal(status.workflowState,'awaiting_test');assert.equal(status.filesReady,true);assert.equal(status.environmentReady,true);assert.equal(status.latestTest,null);assert.equal(status.publication.published,false);
 const q=await f.quote();assert.equal(q.dispatchAvailable,true);assert.equal(q.estimatedMicroUSD,100000);assert.equal(f.calls.execute,0);assert.equal(f.store.all('engine-test').length,0);
});

test('all commissioning operations are administrator-only',async t=>{const f=await fixture(t);for(const op of ['test.quote','test.execute','test.status','test.review','test.stop','approve','publish','unpublish'])await assert.rejects(f.invoke(op,{}, {id:'customer',isAdmin:false}),/FORBIDDEN/);assert.equal(f.calls.quote,0);});

test('missing weights and missing environment stay distinct and cannot dispatch',async t=>{const f=await fixture(t,{filesReady:false,environmentReady:false});let s=await f.invoke('test.status');assert.equal(s.workflowState,'needs_preparation');let q=await f.quote();assert.equal(q.dispatchAvailable,false);assert.ok(q.blockers.includes('ENGINE_NOT_READY'));assert.ok(q.blockers.includes('ENGINE_DEPLOYMENT_REQUIRED'));f.setFiles(true);s=await f.invoke('test.status');assert.equal(s.workflowState,'files_ready');q=await f.quote();await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'not-ready',approved:true}),/NOT_READY/);assert.equal(f.calls.execute,0);});

test('paid switch, explicit approval, known estimate and valid quote all gate native dispatch',async t=>{
 const f=await fixture(t,{paid:false}),q=await f.quote();assert.ok(q.blockers.includes('PAID_DISABLED'));await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'none'}),/APPROVAL_REQUIRED/);await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'none',approved:true}),/NOT_READY/);assert.equal(f.calls.execute,0);
 const g=await fixture(t);g.setEstimate(null);const unknown=await g.quote();assert.equal(unknown.dispatchAvailable,false);assert.equal(unknown.estimatedMicroUSD,null);assert.ok(unknown.blockers.includes('ENGINE_TEST_ESTIMATE_UNAVAILABLE'));assert.equal(g.calls.execute,0);
});

test('test success requires hash-scoped native output, confirmed stop and then human review',async t=>{
 const f=await fixture(t),s=await f.execute();assert.equal(s.initial.latestTest.status,'queued');assert.equal(s.latestTest.status,'needs_review');assert.equal(s.latestTest.cloudStopped,true);assert.equal(s.latestTest.progress.completed,1);assert.equal(s.latestTest.artifacts[0].sha256,'a'.repeat(64));assert.equal(s.latestTest.recordedProviderUSD,.015);assert.equal(s.publication.published,false);
 await assert.rejects(f.invoke('approve',{testId:s.latestTest.id,approved:true}),/APPROVAL_BLOCKED/);await assert.rejects(f.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);
 const accepted=await f.invoke('test.review',{testId:s.latestTest.id,approved:true,accept:true});assert.equal(accepted.workflowState,'test_passed');assert.equal(accepted.latestTest.reviewed,true);assert.equal(accepted.latestTest.accepted,true);assert.equal(f.calls.execute,1);
});

test('review, approval and publication are separate current-scope states and preserve the rental rate',async t=>{
 const f=await fixture(t),testId=await f.pass();assert.equal((await f.invoke('test.status')).workflowState,'test_passed');await f.invoke('approve',{testId,approved:true});assert.equal((await f.invoke('test.status')).workflowState,'approved');const published=await f.invoke('publish',{approved:true});assert.equal(published.workflowState,'published');assert.equal(published.publication.testId,testId);const e=f.store.get('engine-definition','engine-one');assert.equal(e.publication.tested,true);assert.equal(e.publication.approved,true);assert.equal(e.publication.revision,1);assert.equal(e.hourMicros,3000000);assert.equal(f.store.get('test-published-slot',e.id).price,3000000);assert.equal(f.calls.execute,1);assert.equal(f.calls.publish,1);
 const removed=await f.invoke('unpublish',{approved:true});assert.equal(removed.workflowState,'approved');assert.equal(removed.publication.published,false);assert.equal(f.store.get('test-published-slot',e.id),null);assert.equal(f.calls.execute,1);
});

test('rejected or failed tests cannot be approved or published',async t=>{
 const f=await fixture(t),s=await f.execute();await f.invoke('test.review',{testId:s.latestTest.id,approved:true,accept:false});const state=await f.invoke('test.status');assert.equal(state.workflowState,'failed');await assert.rejects(f.invoke('approve',{testId:s.latestTest.id,approved:true}),/APPROVAL_BLOCKED/);await assert.rejects(f.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);assert.equal(f.calls.publish,0);
});

test('licence/rights guards cannot be bypassed by possessing weights or forging approval input',async t=>{
 const f=await fixture(t,{licensed:false}),q=await f.quote();assert.equal(q.dispatchAvailable,false);assert.ok(q.blockers.includes('ENGINE_LICENSE_REQUIRED'));await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'licence',approved:true,licenseAccepted:true}),/NOT_READY/);await assert.rejects(f.invoke('publish',{approved:true,tested:true,accepted:true}),/PUBLICATION_BLOCKED/);assert.equal(f.calls.execute,0);
 const g=await fixture(t);await g.approve();g.setLicense(false);await assert.rejects(g.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);assert.equal(g.calls.publish,0);
});

test('duplicate concurrent executes and status reload never start another paid attempt',async t=>{
 const f=await fixture(t);f.pause();const q=await f.quote(),input={quoteId:q.id,requestId:'same',approved:true};const [one,two]=await Promise.all([f.invoke('test.execute',input),f.invoke('test.execute',input)]);assert.equal(one.latestTest.id,two.latestTest.id);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.execute,1);await f.invoke('test.status');assert.equal(f.calls.follow,0);await assert.rejects(f.invoke('test.execute',{...input,quoteId:'other-quote'}),/IDEMPOTENCY_CONFLICT/);f.controls.release();await f.service.drain();await f.invoke('test.execute',input);assert.equal(f.calls.execute,1);assert.equal(f.store.all('engine-test').length,1);
});

test('unknown provider response retains uncertainty and never replays on restart or repeated execute',async t=>{
 const f=await fixture(t);f.controls.fail=true;const q=await f.quote(),input={quoteId:q.id,requestId:'unknown',approved:true};await f.invoke('test.execute',input);await f.service.drain();let s=await f.invoke('test.status');assert.equal(s.latestTest.status,'uncertain');assert.equal(s.latestTest.cloudStopped,false);assert.equal(JSON.stringify(s).includes('private-provider'),false);assert.equal(s.latestTest.error,'ENGINE_TEST_STATE_UNKNOWN');f.restart();await f.current.recover();await f.invoke('test.execute',input);s=await f.invoke('test.status');assert.equal(s.latestTest.status,'uncertain');assert.equal(f.calls.execute,1);assert.ok(f.calls.follow>=1);await assert.rejects(f.invoke('approve',{testId:s.latestTest.id,approved:true}),/APPROVAL_BLOCKED/);
});

test('wrong account, revision or artifact hash cannot become an inference proof',async t=>{
 const f=await fixture(t);f.controls.badReceipt=true;const s=await f.execute();assert.equal(s.latestTest.status,'uncertain');assert.equal(s.latestTest.artifacts.length,0);await assert.rejects(f.invoke('test.review',{testId:s.latestTest.id,approved:true,accept:true}),/REVIEW_REQUIRED/);assert.equal(f.calls.publish,0);
});

test('engine/account isolation binds every quote, test, volume scope and publication',async t=>{
 const f=await fixture(t),q=await f.quote();await assert.rejects(f.invoke('test.execute',{id:'engine-two',quoteId:q.id,requestId:'scope',approved:true}),/QUOTE_EXPIRED/);await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'scope',approved:true},otherAdmin),/QUOTE_EXPIRED/);const s=await f.execute();await assert.rejects(f.invoke('test.status',{id:'engine-two',testId:s.latestTest.id}),/NOT_FOUND/);await assert.rejects(f.invoke('test.review',{id:'engine-two',testId:s.latestTest.id,approved:true,accept:true}),/NOT_FOUND/);assert.equal((await f.invoke('test.status',{id:'engine-two'})).latestTest,null);assert.equal(f.calls.execute,1);
});

test('settings, account, software or dependency changes invalidate old proofs and quotes',async t=>{
 const f=await fixture(t),q=await f.quote();f.setDependencies('deps-new');await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'stale',approved:true}),/CONFIG_CHANGED/);f.setDependencies('deps-one');await f.approve();f.setDependencies('deps-new');await assert.rejects(f.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);assert.equal((await f.invoke('test.status')).approval.approved,false);
 const e=f.store.get('engine-definition','engine-one');f.store.put('engine-definition',{...e,revision:2});assert.equal((await f.invoke('test.status')).testCurrent,false);assert.equal(f.calls.publish,0);
});

test('expired quotes and busy resources reject without invoking the runner',async t=>{
 const f=await fixture(t),q=await f.quote();f.setTime(q.expiresAt);await assert.rejects(f.invoke('test.execute',{quoteId:q.id,requestId:'expired',approved:true}),/QUOTE_EXPIRED/);f.setStopped(false);const blocked=await f.quote();assert.ok(blocked.blockers.includes('ENGINE_BUSY'));assert.equal(blocked.dispatchAvailable,false);assert.equal(f.calls.execute,0);
});

test('explicit stop confirms resource closure and cannot reinterpret cancellation as test success',async t=>{
 const f=await fixture(t);f.pause();const q=await f.quote();await f.invoke('test.execute',{quoteId:q.id,requestId:'cancel',approved:true});await new Promise(resolve=>setImmediate(resolve));const stopped=await f.invoke('test.stop',{approved:true});assert.equal(stopped.latestTest.status,'cancelled');assert.equal(stopped.latestTest.cloudStopped,true);f.controls.release();await f.service.drain();const result=await f.invoke('test.status');assert.equal(result.latestTest.status,'cancelled');assert.equal(result.latestTest.artifacts.length,0);assert.equal(f.calls.stop,1);await assert.rejects(f.invoke('approve',{testId:result.latestTest.id,approved:true}),/APPROVAL_BLOCKED/);
});

test('a newer successful but unreviewed test cannot inherit approval from an earlier test',async t=>{const f=await fixture(t);await f.approve();const q=await f.quote();await f.invoke('test.execute',{quoteId:q.id,requestId:'second-test',approved:true});await f.service.drain();const s=await f.invoke('test.status');assert.equal(s.approval.approved,false);assert.equal(s.workflowState,'needs_review');await assert.rejects(f.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);assert.equal(f.calls.execute,2);});

test('publication is withdrawn from the effective catalog when verified files, environment or licence change',async t=>{
 const f=await fixture(t);await f.approve();await f.invoke('publish',{approved:true});assert.equal((await f.invoke('test.status')).publication.published,true);
 f.setFiles(false);assert.equal((await f.invoke('test.status')).publication.published,false);f.setFiles(true);f.setEnvironment(false);assert.equal((await f.invoke('test.status')).publication.published,false);f.setEnvironment(true);f.setLicense(false);assert.equal((await f.invoke('test.status')).publication.published,false);assert.equal(f.calls.execute,1);
});

test('running resources do not erase publication proof, but block new tests and approvals',async t=>{
 const f=await fixture(t);await f.approve();await f.invoke('publish',{approved:true});f.setStopped(false);assert.equal((await f.invoke('test.status')).publication.published,true);const q=await f.quote();assert.equal(q.dispatchAvailable,false);assert.ok(q.blockers.includes('ENGINE_BUSY'));await assert.rejects(f.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);await f.invoke('unpublish',{approved:true});assert.equal(f.calls.stop,0);assert.equal(f.calls.execute,1);
});

test('a definitive pre-dispatch failure is failed with confirmed stop, not silently retried or published',async t=>{
 const f=await fixture(t);f.runner.execute=async()=>{f.calls.execute++;throw Object.assign(Error('private-native-diagnostic'),{definitiveNoSpend:true,cloudStopped:true});};const s=await f.execute();assert.equal(s.latestTest.status,'failed');assert.equal(s.latestTest.cloudStopped,true);assert.equal(s.latestTest.error,'ENGINE_TEST_FAILED');assert.equal(JSON.stringify(s).includes('private-native'),false);await f.invoke('test.status');assert.equal(f.calls.execute,1);await assert.rejects(f.invoke('publish',{approved:true}),/PUBLICATION_BLOCKED/);
});

test('runner quote snapshots are persisted privately and replayed only to the same explicitly approved test',async t=>{
 const f=await fixture(t),snap={projectId:'project-one',stageId:'character_image',planFingerprint:'b'.repeat(64)};f.runner.quote=async()=>({available:true,estimatedMicroUSD:1,estimate:{resourceWindowUSD:.000001},snapshot:snap});const q=await f.quote();assert.equal(JSON.stringify(q).includes('planFingerprint'),false);await f.invoke('test.execute',{quoteId:q.id,requestId:'snapshot',approved:true});await f.service.drain();assert.deepEqual(f.controls.args.quote,{snapshot:snap});assert.equal(JSON.stringify(await f.invoke('test.status')).includes('planFingerprint'),false);assert.equal(f.calls.execute,1);
});

test('a timed-out request follows its exact command rather than a previous stopped test',async t=>{
 const f=await fixture(t);const old=await f.execute('previous-stopped-test');assert.equal(old.latestTest.cloudStopped,true);await assert.rejects(f.invoke('test.status',{requestId:'not-yet-confirmed-request'}),/NOT_FOUND/);
 f.pause();const q=await f.quote();await f.invoke('test.execute',{quoteId:q.id,requestId:'current-unknown-request',approved:true});await new Promise(resolve=>setImmediate(resolve));const current=await f.invoke('test.status',{requestId:'current-unknown-request'});assert.notEqual(current.latestTest.id,old.latestTest.id);assert.equal(current.latestTest.requestId,'current-unknown-request');assert.equal(current.latestTest.cloudStopped,false);await assert.rejects(f.invoke('test.status',{requestId:'current-unknown-request',testId:old.latestTest.id}),/NOT_FOUND/);await assert.rejects(f.invoke('test.status',{requestId:'current-unknown-request'},otherAdmin),/NOT_FOUND/);f.controls.release();await f.service.drain();assert.equal(f.calls.execute,2);
});

test('human artifact acceptance is propagated outside the lifecycle transaction and before approval',async t=>{
 const f=await fixture(t);const s=await f.execute();let reviewed=0;f.runner.reviewOutput=async args=>{reviewed++;assert.equal(args.testId,s.latestTest.id);assert.equal(args.accept,true);assert.equal(args.adminId,admin.id);await f.store.transaction(async()=>f.store.put('test-human-acceptance',{id:args.testId,accepted:true}));};await f.invoke('test.review',{testId:s.latestTest.id,approved:true,accept:true});assert.equal(reviewed,1);assert.equal(f.store.get('test-human-acceptance',s.latestTest.id).accepted,true);assert.equal((await f.invoke('test.status')).workflowState,'test_passed');
});

test('a failed paid native inference with confirmed closure is failed without inventing a free invoice',async t=>{
 const f=await fixture(t);f.runner.execute=async()=>{f.calls.execute++;throw Object.assign(Error('private-paid-native-failure'),{executionFailed:true,cloudStopped:true,definitiveNoSpend:false});};const s=await f.execute();assert.equal(s.latestTest.status,'failed');assert.equal(s.latestTest.cloudStopped,true);assert.equal(s.latestTest.recordedProviderUSD,null);assert.equal(f.calls.execute,1);assert.equal(f.store.all('engine-approval').length,0);
});

test('stopping an older test cannot cancel a newer replacement test',async t=>{
 const f=await fixture(t),old=await f.execute('old-run');f.pause();const q=await f.quote(),newer=await f.invoke('test.execute',{quoteId:q.id,requestId:'new-run',approved:true});await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.invoke('test.stop',{testId:old.latestTest.id,approved:true}),/ENGINE_TEST_STALE/);assert.equal(f.calls.stop,0);assert.equal((await f.invoke('test.status')).latestTest.cloudStopped,false);const stopped=await f.invoke('test.stop',{testId:newer.latestTest.id,approved:true});assert.equal(stopped.latestTest.status,'cancelled');assert.equal(f.calls.stop,1);f.controls.release();await f.service.drain();
});


test('failed stopped dispatched coordinator adopts exact cached native receipt through guarded follow without a second execute',async t=>{const f=await fixture(t),s=await f.execute(),testId=s.latestTest.id,existing=f.store.get('engine-test',testId),receipt={testId,engineId:'engine-one',accountId:'account-one',settingsRevision:1,runId:'run-'+testId,cloudStopped:true,verified:true,artifacts:s.latestTest.artifacts};f.store.put('engine-test',{...existing,status:'failed',verified:false,artifacts:[],error:'ENGINE_TEST_FAILED'});let checks=0;f.runner.recoveryAvailable=async args=>{checks++;assert.equal(args.testId,testId);assert.equal(args.adminId,admin.id);return true;};f.runner.follow=async args=>{f.calls.follow++;assert.equal(args.testId,testId);return receipt;};const recovered=await f.invoke('test.status');assert.equal(recovered.latestTest.id,testId);assert.equal(recovered.latestTest.status,'needs_review');assert.equal(recovered.latestTest.verified,undefined);assert.equal(f.store.get('engine-test',testId).verified,true);assert.deepEqual(recovered.latestTest.artifacts,receipt.artifacts);assert.equal(recovered.latestTest.reviewed,false);assert.equal(recovered.publication.published,false);assert.equal(f.calls.execute,1);assert.equal(f.calls.follow,1);assert.equal(checks,1);await f.invoke('test.status');assert.equal(f.calls.follow,1);});
test('failed stopped coordinator without eligible local recovery cannot adopt arbitrary output',async t=>{const f=await fixture(t),s=await f.execute(),row=f.store.get('engine-test',s.latestTest.id);f.store.put('engine-test',{...row,status:'failed',verified:false,artifacts:[],error:'ENGINE_TEST_FAILED'});f.runner.recoveryAvailable=async()=>false;f.runner.follow=async()=>{throw Error('MUST_NOT_READ_NATIVE_OUTPUT');};const result=await f.invoke('test.status');assert.equal(result.latestTest.status,'failed');assert.equal(result.latestTest.artifacts.length,0);assert.equal(f.calls.execute,1);});
