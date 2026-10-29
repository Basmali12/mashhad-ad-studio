import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createEngineAPI} from '../engine/api.mjs';
import {Store} from '../engine/store.mjs';
import {inferenceManifest,manifest} from '../engine/config.mjs';
import {transferIdentity,workerFingerprint,assertTransferPlan} from '../engine/transfer-profile.mjs';

// Metadata and dispatch fixtures only; no SDK, provider network, model bytes or GPU.
async function fixture(t,{existing=[],sourceMissing=[],corrupt=[],wrongWorker=false,failDispatch=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'film-prepare-fixture-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);store.installRentalSchema();
 const source={id:randomUUID(),mode:'local_profile',workspace:'basm1998ali',role:'primary',volume:'modal-ltx25-test-models'};
 const destination={id:randomUUID(),mode:'local_profile',workspace:'destination-fixture',role:'backup',volume:'iff-ltx25-1234abcd',corruptFiles:corrupt};store.put('account',source);store.put('account',destination);
 const calls=[];const rows=volume=>Object.entries(inferenceManifest.files).map(([name,f])=>({name,size:(volume===source.volume?!sourceMissing.includes(name):existing.includes(name))?f.size:null,present:volume===source.volume?!sourceMissing.includes(name):existing.includes(name)}));
 const provider={session(){throw Error('GPU_FORBIDDEN');},async call(action,input){calls.push({action,input});
  if(action==='discover')return {ready:input.volume===source.volume,files:input.volume===source.volume?Object.entries(manifest.files).map(([name,f])=>({name,size:f.size,manifestMatch:true})):[]};
  if(action==='quality_discover'){const files=rows(input.volume);return {profile:inferenceManifest.id,ready:files.every(f=>f.present),files};}
  if(action==='cloud_transfer_preflight')return {workerReady:true,fingerprint:wrongWorker?'old-five-file-worker':workerFingerprint,...transferIdentity,workerApp:'iff-ltx25-cloud-copy-v1'};
  if(action==='cloud_transfer_dispatch'){if(failDispatch)throw Error('AMBIGUOUS_FIXTURE_DISPATCH');return {host_orchestrated:true,worker_app_id:'fixture-cpu-worker'};}
  if(action==='cloud_transfer_status')return {cloud_stopped:true,callFinished:true,running_containers:0,tasks:0,events:[],result:{ready:true,gpuUsed:false,status:'completed',inspection:{ready:true,files:rows(source.volume)}}};
  if(action==='cloud_transfer_stop')return {cloud_stopped:!failDispatch,running_containers:failDispatch?null:0,tasks:failDispatch?null:0};
  throw Error('UNEXPECTED_PROVIDER_BOUNDARY');
 }};
 const api=await createEngineAPI({folder,key,store,provider,allowPaid:true,cloudTransferApp:'iff-ltx25-cloud-copy-v1'});
 t.after(async()=>{await api.close();await rm(folder,{recursive:true,force:true});});
 const quote=extra=>api.invoke('quote',{action:'prepare',accountId:destination.id,settings:{budget:0},source:'volume',...extra});
 const execute=q=>api.invoke('execute',{quoteId:q.id,approvedCost:true});
 return {api,store,calls,source,destination,quote,execute};
}
const files=Object.entries(inferenceManifest.files);
test('DFR preparation quotes exactly six bound files, CPU source+destination cost and no HostHatch staging',async t=>{
 const f=await fixture(t),q=await f.quote();assert.equal(q.plan.profile,'dfr-main');assert.equal(q.plan.files.length,6);assert.equal(q.plan.files.some(f=>f.name.includes('-conv-')),false);assert.equal(q.plan.usesHostDisk,false);assert.equal(q.plan.localStagingRequiredBytes,0);assert.equal(q.plan.gpuUsed,false);
 assert.deepEqual(q.plan.files,files.map(([name,f])=>({name,size:f.size,sha256:f.sha256})));
 const total=files.reduce((n,[,f])=>n+f.size,0);assert.equal(q.plan.requiredBytes,total);assert.equal(q.plan.sourceIntegrityReadBytes,total);assert.equal(q.plan.destinationIntegrityReadBytes,2*total);assert.equal(q.plan.totalIntegrityReadBytes,3*total);assert.equal(q.estimate.resourceWindowUSD,q.plan.compute.resourceWindowUSD);assert.ok(q.plan.compute.destination.resourceWindowUSD>0);assert.equal(assertTransferPlan(q.plan),true);
 assert.equal(f.calls.some(c=>/dispatch|generate|official/.test(c.action)),false);
});
test('DFR missing-only plan skips four valid components and quotes the two additions',async t=>{
 const f=await fixture(t,{existing:files.slice(0,4).map(([name])=>name)}),q=await f.quote();assert.deepEqual(q.plan.files.map(f=>f.name),files.slice(4).map(([name])=>name));assert.equal(q.plan.requiredBytes,files.slice(4).reduce((n,[,f])=>n+f.size,0));
});
test('known corrupt component is reapproved, completed targets transfer zero model bytes',async t=>{
 const f=await fixture(t,{existing:files.map(([n])=>n),corrupt:[files[4][0]]}),q=await f.quote();assert.deepEqual(q.plan.files.map(f=>f.name),[files[4][0]]);
 const complete=await fixture(t,{existing:files.map(([n])=>n)}),empty=await complete.quote();assert.deepEqual(empty.plan.files,[]);assert.equal(empty.plan.requiredBytes,0);assert.equal(empty.plan.sourceIntegrityReadBytes,0);assert.ok(empty.plan.destinationIntegrityReadBytes>0);
 const verify=await complete.quote({verifyOnly:true});assert.equal(verify.plan.mode,'verify-only');assert.equal(verify.plan.requiredBytes,0);assert.equal(verify.plan.sourceCpuCalls,0);assert.equal(verify.plan.compute.destination.calls,1);
});
test('missing DFR source addition fails quote without official download or paid dispatch',async t=>{
 const f=await fixture(t,{sourceMissing:[files[5][0]]});await assert.rejects(f.quote(),/SOURCE_ACTIVE_PROFILE_NOT_READY/);await assert.rejects(f.quote({source:'official',licenseAccepted:true}),/ACTIVE_PROFILE_REQUIRES_CLOUD_VOLUME_SOURCE/);await assert.rejects(f.quote({transport:'local'}),/ACTIVE_PROFILE_REQUIRES_CLOUD_VOLUME_SOURCE/);assert.equal(f.calls.some(c=>/dispatch|official|transfer$/.test(c.action)),false);
});
test('stale profile, changed exact files or fingerprint reject before provider dispatch',async t=>{
 const f=await fixture(t);for(const mutate of [q=>q.plan.profile='conv-stable',q=>q.plan.manifestFingerprint='old',q=>q.plan.files[0].size--,q=>q.plan.files[0].sha256='wrong',q=>q.plan.files[0]={name:'__proto__'},q=>q.plan.files[0].name='../unapproved-file',q=>q.plan.transferPlanFingerprint='wrong']){
  const q=await f.quote();mutate(q);f.store.put('quote',q);const before=f.calls.length;await assert.rejects(f.execute(q),/TRANSFER_(PROFILE|PLAN)_CHANGED_REQUOTE/);assert.equal(f.calls.length,before);
 }
 const moved=await f.quote();f.store.put('account',{...f.destination,volume:'iff-ltx25-ffffffff'});const before=f.calls.length;await assert.rejects(f.execute(moved),/TRANSFER_PLAN_CHANGED_REQUOTE/);assert.equal(f.calls.length,before);
 const oldWorker=await fixture(t,{wrongWorker:true}),q=await oldWorker.quote();assert.equal(q.plan.workerReady,false);await assert.rejects(oldWorker.execute(q),/CLOUD_WORKER_NOT_DEPLOYED/);assert.equal(oldWorker.calls.some(c=>c.action==='cloud_transfer_dispatch'),false);
});
test('approved CPU preparation dispatches once; repeat execute follows original intent',async t=>{
 const f=await fixture(t),q=await f.quote();const [a,b]=await Promise.all([f.execute(q),f.execute(q)]);assert.equal(a.id,b.id);for(let n=0;n<100&&!f.store.get('job',a.id).cloudStopped;n++)await new Promise(r=>setTimeout(r,5));assert.equal(f.calls.filter(c=>c.action==='cloud_transfer_dispatch').length,1);assert.equal(f.store.get('job',a.id).plan.transferPlanFingerprint,q.plan.transferPlanFingerprint);assert.equal(f.store.get('job',a.id).result.gpuUsed,false);
});
test('ambiguous dispatch is retained uncertain and never automatically repeated',async t=>{
 const f=await fixture(t,{failDispatch:true}),q=await f.quote(),a=await f.execute(q);for(let n=0;n<100&&f.store.get('job',a.id).status!=='uncertain';n++)await new Promise(r=>setTimeout(r,5));assert.equal(f.store.get('job',a.id).cloudStopped,false);const again=await f.execute(q);assert.equal(again.id,a.id);assert.equal(f.calls.filter(c=>c.action==='cloud_transfer_dispatch').length,1);
});
test('explicit Conv rollback transfer contract retains exactly its five historical files',()=>{
 const code=`import assert from 'node:assert/strict';import {inferenceManifest} from './engine/config.mjs';import {bindTransferPlan,assertTransferPlan,transferIdentity,workerFingerprint} from './engine/transfer-profile.mjs';import {createEngineAPI} from './engine/api.mjs';import {Store} from './engine/store.mjs';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {randomBytes,randomUUID} from 'node:crypto';
 const files=Object.entries(inferenceManifest.files).map(([name,f])=>({name,size:f.size,sha256:f.sha256}));const plan=bindTransferPlan({files,mode:'full',sourceVolume:'modal-ltx25-test-models',destinationVolume:'iff-ltx25-1234abcd',requiredBytes:files.reduce((n,f)=>n+f.size,0),transport:'modal-cpu-cloud'});assert.equal(plan.profile,'conv-stable');assert.equal(files.length,5);assert.ok(files.some(f=>f.name.includes('-conv-')));assert.equal(assertTransferPlan(plan),true);
 const folder=await mkdtemp(path.join(tmpdir(),'conv-prep-fixture-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key),source={id:randomUUID(),mode:'local_profile',workspace:'basm1998ali',role:'primary',volume:'modal-ltx25-test-models'},dest={id:randomUUID(),mode:'local_profile',workspace:'fixture-only',volume:'iff-ltx25-1234abcd'};store.put('account',source);store.put('account',dest);
 const api=await createEngineAPI({folder,key,store,cloudTransferApp:'iff-ltx25-cloud-copy-v1',provider:{async call(action,input){if(action==='discover')return {ready:input.volume===source.volume,files:input.volume===source.volume?files.map(f=>({...f,manifestMatch:true})):[]};if(action==='cloud_transfer_preflight')return {workerReady:true,...transferIdentity,fingerprint:workerFingerprint,workerApp:'iff-ltx25-cloud-copy-v1'};throw Error('UNAPPROVED_PROVIDER_CALL');}}});
 try{const q=await api.invoke('quote',{action:'prepare',accountId:dest.id,settings:{budget:0}});assert.equal(q.plan.profile,'conv-stable');assert.equal(q.plan.files.length,5);assert.deepEqual(q.plan.files,files);}finally{await api.close();await rm(folder,{recursive:true,force:true});}`;
 execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,LTX_INFERENCE_PROFILE:'conv-stable'},stdio:'pipe'});
});
