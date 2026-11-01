import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createEngineCommissioning} from '../engine/engine-commissioning.mjs';
import {waitForCommissioningTest,assertPrivateWatchdogLiveness,runWithPrivateWatchdog,retryPrivateRename} from '../../../scripts/private-commissioning-observation.mjs';

/** The only inference/allocation boundary is mocked; the service, quote claim,
 * snapshot DTO, state changes and repeated status observations are real. */
async function fixture(t,{uncertain=false,stopSupported=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'private-observation-')),store=new Store(folder,randomBytes(32).toString('base64')),admin={id:'private-admin',isAdmin:true};
 const definition={id:'private-flux',accountId:'primary-fixture',modelId:'flux2-klein-4b',version:'4B',revision:1,hourMicros:3000000};store.put('engine-definition',definition);
 const counters={quote:0,execute:0,stop:0,abort:0,close:0,observe:0,wait:0,guard:0};let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const runner={quote:async()=>{counters.quote++;return {available:true,estimatedMicroUSD:100000,snapshot:{projectId:'private-project',stageId:'scene_image:shot'},estimate:{resourceWindowUSD:.1}};},execute:async args=>{counters.execute++;args.signal.addEventListener('abort',()=>{counters.abort++;});if(uncertain)throw Error('SYNTHETIC_UNCONFIRMED_RESULT');await gate;return {testId:args.testId,engineId:definition.id,accountId:definition.accountId,settingsRevision:definition.revision,cloudStopped:true,verified:true,runId:'synthetic-run',artifacts:[{id:'synthetic-image',kind:'image',sha256:'a'.repeat(64),mime:'image/png',bytes:128,width:720,height:1280}]};},stop:async args=>{counters.stop++;if(stopSupported)return {testId:args.testId,engineId:definition.id,accountId:definition.accountId,cloudStopped:true};throw Error('Premature stop is not observation');}};
 const service=createEngineCommissioning({store,registry:{},testRunner:runner,allowPaid:true,now:()=>1000000,policyFor:async()=>({...definition,fingerprint:hash('private-flux-v1'),manifestRevision:'pinned',softwareVersion:'native-v1',dependenciesFingerprint:'pinned-locks',inspection:{filesReady:true,environmentReady:true},runtimeStopped:true,license:{allowed:true,blockers:[],evidenceDigest:'pinned-licence'}})});
 const close=service.close;service.close=async()=>{counters.close++;return close();};
 t.after(async()=>{release();await service.drain();await service.close();store.close();await rm(folder,{recursive:true,force:true});});
 const q=await service.dispatch(admin,'admin.engine.test.quote',{id:definition.id,input:{projectId:'private-project',stageId:'scene_image:shot'}});
 const initial=await service.dispatch(admin,'admin.engine.test.execute',{id:definition.id,quoteId:q.id,requestId:'one-private-test',approved:true});
 return {service,initial,counters,release,admin,definition,observe:async()=>{counters.observe++;return service.status({id:definition.id,requestId:'one-private-test'},admin);}};
}

test('actual commissioning latestTest snapshot is polled through running without premature close, cancellation or another execution',async t=>{
 const f=await fixture(t);assert.equal(f.initial.test,undefined);assert.equal(f.initial.latestTest.status,'queued');assert.equal(f.counters.execute,1);
 const terminal=await waitForCommissioningTest(f.initial,{observe:async()=>{if(f.counters.observe===1){f.release();await f.service.drain();}return f.observe();},continueAllowed:async()=>{f.counters.guard++;assert.equal(f.counters.close,0);assert.equal(f.counters.abort,0);},wait:async()=>{f.counters.wait++;assert.equal(f.counters.stop,0);}});
 assert.equal(terminal.status,'needs_review');assert.equal(terminal.cloudStopped,true);assert.equal(terminal.artifacts[0].id,'synthetic-image');assert.equal(f.counters.observe,2);assert.ok(f.counters.wait>=1);assert.ok(f.counters.guard>=1);assert.equal(f.counters.quote,1);assert.equal(f.counters.execute,1);assert.equal(f.counters.close,0);assert.equal(f.counters.stop,0);assert.equal(f.counters.abort,0);
});

test('actual uncertain commissioning outcome stops observation without repeating the approved command or inference',async t=>{
 const f=await fixture(t,{uncertain:true});await f.service.drain();
 await assert.rejects(waitForCommissioningTest(f.initial,{observe:f.observe,wait:async()=>{f.counters.wait++;}}),/PRIVATE_TRIAL_TEST_UNCERTAIN/);
 assert.equal(f.counters.observe,1);assert.equal(f.counters.quote,1);assert.equal(f.counters.execute,1);assert.equal(f.counters.stop,0);assert.equal(f.counters.close,0);assert.equal(f.counters.abort,0);
});

test('legacy test alias, absent latestTest and malformed snapshots cannot be treated as terminal success',async()=>{
 for(const snapshot of [null,{}, {test:{id:'a',status:'needs_review'}},{latestTest:null}]){
  let observations=0;await assert.rejects(waitForCommissioningTest(snapshot,{observe:async()=>{observations++;throw Error('No observation after protocol failure');}}),/PRIVATE_TRIAL_TEST_PROTOCOL/);assert.equal(observations,0);
 }
});

test('queued and running progress wait for the same test, then return failed or cancelled without restarting',async()=>{
 for(const status of ['failed','cancelled']){
  let observations=0,waits=0;const sequence=[{latestTest:{id:'same-test',status:'running'}},{latestTest:{id:'same-test',status,cloudStopped:true}}];
  const result=await waitForCommissioningTest({latestTest:{id:'same-test',status:'queued'}},{observe:async()=>{observations++;return sequence.shift();},wait:async()=>{waits++;}});
  assert.equal(result.id,'same-test');assert.equal(result.status,status);assert.equal(observations,2);assert.ok(waits>=1);
 }
});

test('budget or independent stop guard failure prevents further observation and never becomes a new submit',async()=>{
 let observations=0;await assert.rejects(waitForCommissioningTest({latestTest:{id:'same-test',status:'running'}},{continueAllowed:async()=>{throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');},observe:async()=>{observations++;return {latestTest:{id:'same-test',status:'needs_review'}};}}),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.equal(observations,0);
});

test('an uncertain initial result never enters another poll cycle',async()=>{
 let observations=0;await assert.rejects(waitForCommissioningTest({latestTest:{id:'same-test',status:'uncertain'}},{observe:async()=>{observations++;}}),/PRIVATE_TRIAL_TEST_UNCERTAIN/);assert.equal(observations,0);
});


test('watchdog requires fresh heartbeat, a live separate PID, controls permission and both deadlines',()=>{const now=100000,base={status:'watching',cloudStopped:false,heartbeatAt:now,watchdogPID:12345,deadline:now+60000,globalDeadlineISO:new Date(now+120000).toISOString()},options={now,isProcessAlive:()=>true};assert.doesNotThrow(()=>assertPrivateWatchdogLiveness(base,options));assert.doesNotThrow(()=>assertPrivateWatchdogLiveness({...base,heartbeatAt:now-20000},options));for(const altered of [{heartbeatAt:now-20001},{heartbeatAt:now+1001},{watchdogPID:0},{status:'stopped'},{cloudStopped:true},{deadline:now},{globalDeadlineISO:new Date(now).toISOString()},{globalDeadlineISO:null}])assert.throws(()=>assertPrivateWatchdogLiveness({...base,...altered},options),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.throws(()=>assertPrivateWatchdogLiveness(base,{...options,isProcessAlive:()=>false}),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.throws(()=>assertPrivateWatchdogLiveness(base,{...options,control:{stopRequested:true}}),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.throws(()=>assertPrivateWatchdogLiveness(base,{...options,control:{mainStatus:'failed'}}),/PRIVATE_TRIAL_WATCHDOG_STOP/);});
test('watchdog death during polling wait closes and stops before another observation; never re-executes',async()=>{let alive=true,observations=0,cleanup=0;const actions=[],state={status:'watching',heartbeatAt:100000,watchdogPID:12345,deadline:200000,globalDeadlineISO:new Date(300000).toISOString()};await assert.rejects(waitForCommissioningTest({latestTest:{id:'same-paid-test',status:'running'}},{continueAllowed:async()=>assertPrivateWatchdogLiveness(state,{now:100000,isProcessAlive:()=>alive}),wait:async()=>{alive=false;},observe:async()=>{observations++;return {latestTest:{id:'same-paid-test',status:'needs_review'}};},onGuardFailure:async()=>{cleanup++;actions.push('close','stop:same-paid-test');}}),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.equal(observations,0);assert.equal(cleanup,1);assert.deepEqual(actions,['close','stop:same-paid-test']);});
test('fresh-looking watching file with dead PID cannot yield terminal success and failed stop stays unconfirmed',async()=>{let observations=0,stops=0;await assert.rejects(waitForCommissioningTest({latestTest:{id:'same-paid-test',status:'needs_review',cloudStopped:true}},{continueAllowed:async()=>assertPrivateWatchdogLiveness({status:'watching',heartbeatAt:100000,watchdogPID:12345,deadline:200000,globalDeadlineISO:new Date(300000).toISOString()},{now:100000,isProcessAlive:()=>false}),observe:async()=>{observations++;},onGuardFailure:async()=>{stops++;throw Error('STOP_UNCONFIRMED');}}),e=>e.message==='PRIVATE_TRIAL_WATCHDOG_STOP'&&e.cleanupUnconfirmed===true);assert.equal(stops,1);assert.equal(observations,0);});


test('dead watcher closes actual commissioning and stops the same approved test, without replay',async t=>{const f=await fixture(t,{stopSupported:true});let observations=0;await assert.rejects(waitForCommissioningTest(f.initial,{continueAllowed:async()=>assertPrivateWatchdogLiveness({status:'watching',heartbeatAt:100000,watchdogPID:12345,deadline:200000,globalDeadlineISO:new Date(300000).toISOString()},{now:100000,isProcessAlive:()=>false}),observe:async()=>{observations++;return f.observe();},onGuardFailure:async()=>{await f.service.close();await f.service.dispatch(f.admin,'admin.engine.test.stop',{id:f.definition.id,testId:f.initial.latestTest.id,approved:true});f.release();}}),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.equal(observations,0);assert.equal(f.counters.close,1);assert.equal(f.counters.abort,1);assert.equal(f.counters.stop,1);assert.equal(f.counters.execute,1);assert.equal(f.counters.quote,1);});


test('long preparation detects watchdog death before native bridge settles, then runs STOP-only after settling',async()=>{let alive=true,release,starts=0;const events=[],gate=new Promise(resolve=>{release=resolve;});await assert.rejects(runWithPrivateWatchdog(async()=>{starts++;await gate;events.push('native-settled');return 'unused';},{continueAllowed:async()=>{if(!alive)throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');},wait:async()=>{alive=false;},onGuardFailure:async()=>{events.push('close','stop-unsettled');release();throw Error('UNCONFIRMED_UNSETTLED');},onSettledAfterFailure:async()=>{events.push('stop-settled');return {cloudStopped:true};}}),e=>e.message==='PRIVATE_TRIAL_WATCHDOG_STOP'&&e.cleanupUnconfirmed===false);assert.equal(starts,1);assert.ok(events.indexOf('stop-unsettled')<events.indexOf('native-settled'));assert.ok(events.indexOf('native-settled')<events.indexOf('stop-settled'));});
test('initial dead lease invokes STOP-only cleanup and never invokes the paid native operation',async()=>{let starts=0,stops=0;await assert.rejects(runWithPrivateWatchdog(async()=>{starts++;},{continueAllowed:async()=>{throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');},onGuardFailure:async()=>{stops++;},onSettledAfterFailure:async()=>({cloudStopped:false})}),/PRIVATE_TRIAL_WATCHDOG_STOP/);assert.equal(starts,0);assert.equal(stops,1);});
test('Windows control rename retries only bounded transient locks without rewriting state',async()=>{let tries=0;const waits=[];await retryPrivateRename(async()=>{tries++;if(tries<3)throw Object.assign(Error('synthetic'),{code:'EPERM'});},{wait:async ms=>{waits.push(ms);}});assert.equal(tries,3);assert.deepEqual(waits,[25,50]);tries=0;await assert.rejects(retryPrivateRename(async()=>{tries++;throw Object.assign(Error('synthetic'),{code:'EACCES'});},{wait:async()=>{}}));assert.equal(tries,6);tries=0;await assert.rejects(retryPrivateRename(async()=>{tries++;throw Object.assign(Error('synthetic'),{code:'ENOENT'});},{wait:async()=>{}}));assert.equal(tries,1);});
