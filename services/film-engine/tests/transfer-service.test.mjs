import test from 'node:test';
import assert from 'node:assert/strict';
import {transferWorkerApp} from '../service.mjs';
test('dedicated service uses the canonical transfer worker without a manual environment repair for each account',()=>{
 assert.equal(transferWorkerApp({}),'mashhad-model-cloud-copy-v1');
 assert.equal(transferWorkerApp({ENGINE_CLOUD_TRANSFER_APP:''}),'mashhad-model-cloud-copy-v1');
 assert.equal(transferWorkerApp({ENGINE_CLOUD_TRANSFER_APP:' fixture-worker '}),'fixture-worker');
 assert.throws(()=>transferWorkerApp({ENGINE_CLOUD_TRANSFER_APP:'https://untrusted.invalid'}),/INVALID_TRANSFER_WORKER_APP/);
});
