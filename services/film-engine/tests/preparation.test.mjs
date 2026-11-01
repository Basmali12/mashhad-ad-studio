import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createEngineAPI} from '../engine/api.mjs';
import {Store} from '../engine/store.mjs';
import {inferenceManifest} from '../engine/config.mjs';
import {assertTransferPlan} from '../engine/transfer-profile.mjs';

async function fixture(t,{recovering=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'film-prepare-fixture-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);store.installRentalSchema();
 const source={id:randomUUID(),mode:'local_profile',workspace:'basm1998ali',role:'primary',volume:'mashhad-model-source'};
 const destination={id:randomUUID(),mode:'local_profile',workspace:'destination-fixture',role:'backup',volume:'mashhad-model-1234abcd'};
 store.put('account',source);store.put('account',destination);const calls=[];
 const provider={modelConfigured:false,session(){throw Error('GPU_FORBIDDEN');},async call(action,input){calls.push({action,input});
  if(action==='discover')return {ready:false,files:[]};
  if(action==='cloud_transfer_status')return {cloud_stopped:true,callFinished:true,running_containers:0,tasks:0,events:[],result:{ready:true,gpuUsed:false,status:'completed',inspection:{ready:true,files:[]}}};
  if(action==='cloud_transfer_stop')return {cloud_stopped:true,running_containers:0,tasks:0};
  throw Error('UNEXPECTED_PROVIDER_BOUNDARY');
 }};
 const recoveredId=randomUUID();if(recovering)store.put('job',{id:recoveredId,action:'prepare',accountId:destination.id,sourceId:source.id,status:'running',cloudStopped:false,createdAt:Date.now(),startedAt:Date.now(),events:[],estimate:{rate:0.00003508},plan:{transport:'modal-cpu-cloud',workerApp:'mashhad-model-cloud-copy-v1',compute:{totalWindowSeconds:5000}}});
 const api=await createEngineAPI({folder,key,store,provider,allowPaid:true,cloudTransferApp:'mashhad-model-cloud-copy-v1'});
 t.after(async()=>{await api.close();await rm(folder,{recursive:true,force:true});});
 return {store,calls,recoveredId,quote:()=>api.invoke('quote',{action:'prepare',accountId:destination.id,settings:{budget:0}})};
}
test('unconfigured model cannot quote or dispatch a model transfer',async t=>{
 const f=await fixture(t);await assert.rejects(f.quote(),/ENGINE_NOT_CONFIGURED/);
 assert.equal(f.calls.some(c=>/dispatch|official|transfer$/.test(c.action)),false);
});
test('empty or historical transfer plan cannot bypass the retired-model guard',()=>{
 assert.throws(()=>assertTransferPlan({files:[],requiredBytes:0,mode:'full'}),/ENGINE_NOT_CONFIGURED/);
 assert.deepEqual(inferenceManifest.files,{});assert.equal(inferenceManifest.id,'unconfigured');
});
test('actual API startup follows a persisted preparation without a new paid dispatch',async t=>{
 const f=await fixture(t,{recovering:true});for(let n=0;n<100&&!f.store.get('job',f.recoveredId).cloudStopped;n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.store.get('job',f.recoveredId).status,'completed');assert.equal(f.calls.some(c=>c.action==='cloud_transfer_status'),true);
 assert.equal(f.calls.some(c=>/dispatch|generate|transfer$/.test(c.action)),false);
});
