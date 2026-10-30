import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparationRecovery,persistCloudRecoveryFailure} from '../engine/preparation-recovery.mjs';

test('a stale observer cannot reopen a durably closed preparation',async()=>{
 let saved={id:'same',status:'failed',cloudStopped:true,error:'VERIFIED_CLOSED'};
 const store={transaction:fn=>fn(),get:async()=>saved,put:async(_,value)=>{saved=value;}};
 assert.equal(await persistCloudRecoveryFailure(store,'same'),false);
 assert.deepEqual(saved,{id:'same',status:'failed',cloudStopped:true,error:'VERIFIED_CLOSED'});
 saved={id:'same',status:'running',cloudStopped:false,stopRequestedAt:42};
 assert.equal(await persistCloudRecoveryFailure(store,'same'),true);
 assert.equal(saved.status,'uncertain');assert.equal(saved.stopRequestedAt,42);
});

test('server reattaches persisted CPU preparation without page requests or new dispatch',async()=>{
 let clock=100000;const resumed=[];
 const jobs=[{id:'old',action:'prepare',plan:{transport:'modal-cpu-cloud'},status:'recovery_required'},
  {id:'done',action:'prepare',plan:{transport:'modal-cpu-cloud'},status:'completed',cloudStopped:true},
  {id:'gpu',action:'generate',status:'running'},
  {id:'unsent',action:'prepare',plan:{transport:'modal-cpu-cloud'},status:'queued'}];
 const control=preparationRecovery({store:{all:async()=>jobs},resume:j=>resumed.push(j.id),now:()=>clock});
 try{await new Promise(r=>setImmediate(r));assert.deepEqual(resumed,['old']);await control.scan();assert.deepEqual(resumed,['old']);clock+=60001;await control.scan();assert.deepEqual(resumed,['old','old']);jobs[0].cloudStopped=true;clock+=60001;await control.scan();assert.equal(resumed.length,2);}finally{control.close();}
});

test('temporary store failure does not kill the worker; close prevents any further reconciliation',async()=>{
 let failing=true,errors=0,count=0;
 const control=preparationRecovery({store:{all:async()=>{if(failing)throw Error('PRIVATE_DB_DETAIL');return [{id:'one',action:'prepare',plan:{transport:'modal-cpu-cloud'},status:'running'}];}},resume:()=>count++,onError:()=>errors++});
 await new Promise(r=>setImmediate(r));assert.equal(errors,1);failing=false;await control.scan();assert.equal(count,1);control.close();await control.scan();assert.equal(count,1);
});
