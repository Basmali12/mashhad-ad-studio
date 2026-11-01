import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRecoveredPhone} from '../../../scripts/recover-private-afterlife-phone.mjs';
import {ACTOR,ENGINE_IDS} from '../../../scripts/private-afterlife-film-runner.mjs';
const work=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../../work/afterlife-film-20261101');
test('same-output private import requires exact actual image, completed native receipt and stopped original attempt',async t=>{
 let receipt,bytes;try{receipt=JSON.parse(await fs.readFile(path.join(work,'native-phone-receipt.json'),'utf8'));bytes=await fs.readFile(path.join(work,'native-phone.png'));}catch{t.skip('Owner private trial evidence is not part of repository');return;}
 const id=receipt.requestId,run=receipt.runId,stageId='scene_image:phone',definition={id:ENGINE_IDS['qwen-image-edit-2511'],accountId:receipt.accountId};
 const fixture=()=>({record:{id,runId:run,stageId,adminId:ACTOR.id,cloudStopped:true},request:{id,runId:run,stageId,definitionId:definition.id,accountId:definition.accountId,modelId:'qwen-image-edit-2511',modelRevision:receipt.modelRevision,modelVersion:receipt.metadata.version,referenceIds:['one','two'],settings:{seed:42},state:'uncertain'},stage:{attemptId:id,state:'failed'},attempt:{status:'failed',administrative:true},history:{runId:run,cloudStopped:true,engineId:definition.id},definition,receipt:structuredClone(receipt),bytes,stopped:{appId:'ap-wpx166qQ4HR8TI4ZVPM8Yo',cloudStopped:true}});
 assert.doesNotThrow(()=>assertRecoveredPhone(fixture()));
 for(const mutate of [f=>f.stage.state='completed',f=>f.record.result={},f=>f.request.definitionId='other',f=>f.stopped.cloudStopped=false,f=>f.attempt.cancelRequested=true,f=>f.receipt.status='running',f=>f.receipt.metadata.sha256='0'.repeat(64),f=>f.bytes=Buffer.from('wrong'),f=>f.record.adminId='other',f=>f.history.cloudStopped=false]){const f=fixture();mutate(f);assert.throws(()=>assertRecoveredPhone(f),/PRIVATE_FILM_PHONE_RECOVERY_UNVERIFIED/);}
});
