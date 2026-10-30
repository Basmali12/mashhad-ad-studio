import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeCloudTransfer} from '../engine/cloud-transfer.mjs';

test('a lost status response does not cancel or redispatch a healthy transfer',async()=>{
 let clock=0,n=0;const calls=[],events=[];
 const result=await observeCloudTransfer({request:{jobId:'same'},provider:{async call(action,input){calls.push([action,input.jobId]);if(++n<=2)throw Error('sensitive exception discarded');return {cloud_stopped:true,result:{ready:true},events:[{sequence:3,kind:'ready',phase:'ready'}]};}},deadline:30000,now:()=>clock,sleep:async ms=>{clock+=ms;},onEvent:e=>events.push(e)});
 assert.equal(result.ready,true);assert.deepEqual(calls,[['cloud_transfer_status','same'],['cloud_transfer_status','same'],['cloud_transfer_status','same']]);assert.equal(events[0].error_type,'TRANSFER_STATUS_TEMPORARILY_UNAVAILABLE');assert.equal(clock,9000);
});

test('observation failure retains original deadline and cancels only that job at its limit',async()=>{
 let clock=0;const calls=[];
 const result=await observeCloudTransfer({request:{jobId:'same'},provider:{async call(action,input){calls.push([action,input.jobId]);if(action==='cloud_transfer_status')throw Error('offline');return {cloud_stopped:true};}},deadline:10000,now:()=>clock,sleep:async ms=>{clock+=ms;},onEvent:()=>{}});
 assert.equal(clock,10000);assert.equal(result.error,'TRANSFER_TIMEOUT');assert.deepEqual(calls.at(-1),['cloud_transfer_stop','same']);assert.equal(calls.filter(c=>c[0]==='cloud_transfer_stop').length,1);assert.equal(calls.some(c=>/dispatch|generate|deploy/.test(c[0])),false);
});

test('server shutdown detaches observation without stopping or redispatching the approved CPU task',async()=>{
 const controller=new AbortController(),calls=[];
 await assert.rejects(observeCloudTransfer({request:{jobId:'same'},signal:controller.signal,deadline:Date.now()+60000,provider:{async call(action){calls.push(action);return {cloud_stopped:false,events:[]};}},onEvent:()=>{},sleep:async()=>{controller.abort();}}),/CLOUD_MONITOR_DETACHED/);
 assert.deepEqual(calls,['cloud_transfer_status']);
});
