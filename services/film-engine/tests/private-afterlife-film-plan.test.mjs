import test from 'node:test';
import assert from 'node:assert/strict';
import {createAfterlifeFilmBrief,AFTERLIFE_NARRATION} from '../../../scripts/private-afterlife-film-plan.mjs';

test('owner film preserves exact narration, six real-motion shots and 30-second provisional timeline',()=>{
 const b=createAfterlifeFilmBrief();assert.equal(b.narration,AFTERLIFE_NARRATION);assert.equal(b.narration.split(/\s+/u).length,44);assert.equal(b.shots.length,6);assert.equal(b.durationMs,30000);
 assert.deepEqual(b.shots.map(s=>[s.targetStartMs,s.targetEndMs]),[[0,5000],[5000,10000],[10000,15000],[15000,20000],[20000,25000],[25000,30000]]);
 assert.equal(new Set(b.shots.map(s=>s.id)).size,6);
 for(const s of b.shots){assert.ok(s.action.length>30);assert.ok(s.camera.length>20);assert.equal(s.actualVideoRequired,true);assert.equal(s.allowText,false);assert.equal(s.lipSync,false);}
 assert.deepEqual(b.shots[3].logicalReferences,['room-main']);assert.ok(!b.shots[3].prompt.includes('short neat beard'));
});
test('brief requires audio-first measurement and blocks paid work, fake completion and forced narration timing',()=>{
 const b=createAfterlifeFilmBrief();assert.equal(b.paidWorkStarted,false);assert.equal(b.status,'prepared_not_generated');assert.equal(b.voice.singleImmutableProfile,true);assert.equal(b.voice.postSynthesisSpeedupAllowed,false);assert.equal(b.voice.wordCuttingAllowed,false);assert.equal(b.schedule.audioFirst,true);assert.equal(b.schedule.timingIsProvisional,true);assert.match(b.schedule.ifNarrationExceeds30Seconds,/Stop before video/);assert.equal(b.policy.sitePublication,false);assert.equal(b.policy.automaticSuccessfulRegeneration,false);assert.equal(b.voice.referenceVoiceQualityApproved,false);
});
