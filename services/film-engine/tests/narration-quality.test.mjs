import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../engine/store.mjs';
import {NARRATION_STYLES,matchNarrationStyle,narrationComparisonPlan} from '../engine/narration-styles.mjs';
import {prepareNarrationText,narrationPauses} from '../engine/speech-text.mjs';
import {createNarrationProfiles} from '../engine/narration-profiles.mjs';
import {createSpeechServices,SPEECH_MANIFESTS} from '../engine/speech-integration.mjs';
import {masterNarration,speechSignal} from '../engine/narration-mastering.mjs';
import {voiceFixture,pcmWav} from './voice-fixtures.mjs';

test('five honest styles: no invented emotions; description maps to closest target',()=>{
 assert.equal(NARRATION_STYLES.length,5);for(const [description,id] of [['صوت رجولي عميق ومهيب','deep-majestic'],['خشن ومؤثر','rough-moving'],['هادئ وخاشع','calm-reverent'],['وثائقي رصين','documentary'],['سرد ملحمي','epic-story']])assert.equal(matchNarrationStyle(description).style.id,id);
 assert.ok(NARRATION_STYLES.every(s=>s.expression==='neutral'&&!s.qualityVerified&&s.referenceRequired));const plan=narrationComparisonPlan();assert.equal(new Set(plan.samples.map(s=>s.text)).size,1);assert.equal(plan.dispatch,false);assert.equal(plan.paidApproved,false);assert.ok(plan.samples.every(s=>s.referenceAssetId===null));
});
test('Arabic synthesis copy preserves original, punctuation and words, avoids byte inflation',()=>{
 const original='فِي يَوْمٍ… كَانَ هُنَاكَ رَجُلٌ، اسْمُهُ عَلِيّ؟';const p=prepareNarrationText(original,{policy:'plain'});
 assert.equal(p.original,original);assert.equal(p.text,'في يوم. كان هناك رجل, اسمه علي?');assert.equal(p.originalSHA256,hash(original));assert.notEqual(p.synthesisSHA256,p.originalSHA256);assert.ok(p.warnings.length);assert.equal(prepareNarrationText('إلى أُمّه',{policy:'preserve'}).text,'إلى أُمّه');assert.throws(()=>prepareNarrationText('\ufffd'),/TEXT_INVALID/);assert.ok(prepareNarrationText('عام ١٩٣٠').warnings.includes('NUMBERS_REQUIRE_PRONUNCIATION_REVIEW'));
});
test('pause offsets are explicit word boundaries and do not cut Arabic words',()=>{
 const text='في يوم من الأيام، كان هناك رجل. عرف قيمة الحياة.';const pauses=narrationPauses(text,'calm-reverent');assert.equal(pauses.length,2);assert.deepEqual(pauses.map(p=>p.durationMs),[180,350]);for(const p of pauses)assert.equal(text[p.afterOffset-1],' ');assert.ok(pauses.every(p=>p.afterOffset<text.length));
});
async function fixture(t){const f=await voiceFixture(t,{modelId:'habibi-msa',locale:'ar-MSA',narrator:true});const refBytes=pcmWav();for(let k=44;k<refBytes.length;k+=2)refBytes.writeInt16LE(Math.round(2000*Math.sin(2*Math.PI*180*(k-44)/2/16000)),k);f.reference=await f.profiles.commitReference({...f.referenceInput,bytes:refBytes});const narration=createNarrationProfiles({store:f.store,voiceProfiles:f.profiles,manifests:SPEECH_MANIFESTS});const approved={actor:{isAdmin:true,id:'admin'},customerId:'alice',referenceAssetId:f.reference.referenceAssetId,styleId:'deep-majestic',locale:'ar-MSA',gender:'male',listeningApproved:true,productionAllowed:true,rightsEvidence:{kind:'licensed',voiceUseAllowed:true,privateOnly:false,source:'synthetic fixture, not a real person',documentId:'fixture-only'},listeningChecks:{clean:true,matching_transcript:true,natural_delivery:true}};return {...f,narration,approved};}
test('reference admission requires rights, listening review and ownership; benchmark is not production voice',async t=>{
 const f=await fixture(t);for(const patch of [{actor:f.actor},{listeningApproved:false},{rightsEvidence:{...f.approved.rightsEvidence,privateOnly:true}},{rightsEvidence:{...f.approved.rightsEvidence,voiceUseAllowed:false}},{listeningChecks:{clean:true}}])await assert.rejects(f.narration.register({...f.approved,...patch}),/FORBIDDEN|APPROVAL_REQUIRED/);
 await assert.rejects(f.narration.register({...f.approved,customerId:'bob'}),/NOT_FOUND/);assert.equal((await f.narration.select({actor:f.actor,customerId:'alice',description:'عميق'})).available,false);
 const silent=await f.profiles.commitReference({...f.referenceInput,bytes:pcmWav({value:0})});await assert.rejects(f.narration.register({...f.approved,referenceAssetId:silent.referenceAssetId}),/SIGNAL_INVALID/);const ref=await f.narration.register(f.approved);assert.equal(ref.productionAllowed,true);assert.equal((await f.narration.select({actor:{customerId:'bob'},customerId:'bob',description:'عميق'})).available,false);
});
test('description binds licensed reference once and restart preserves identity and settings',async t=>{
 const f=await fixture(t);await f.narration.register(f.approved);f.store.put('production-project',{id:'new-film',customerId:'alice',state:'draft'});const input={actor:f.actor,customerId:'alice',projectId:'new-film',narrator:true,characterId:null,description:'صوت عميق ومهيب'};
 const p=await f.narration.bind(input);assert.equal(p.modelId,'habibi-msa');assert.equal(p.settings.narrationStyle,'deep-majestic');assert.equal(p.settings.speakingRate,.97);assert.equal((await f.profiles.resolve({customerId:'alice',projectId:'new-film',profileId:p.id,narrator:true})).fingerprint,p.fingerprint);
 assert.equal((await f.narration.bind(input)).id,p.id);await f.narration.register({...f.approved,styleId:'epic-story'});await assert.rejects(f.narration.bind({...input,description:'ملحمي'}),/ALREADY_BOUND/);
 const plan=await f.narration.comparison({actor:f.actor,customerId:'alice'});assert.equal(plan.samples.filter(s=>s.referenceAssetId).length,2);assert.equal(plan.dispatch,false);
});
test('actual speech adapter gets normalized text, original transcript, native rate; quote/planning never dispatch',async t=>{
 const f=await fixture(t);await f.narration.register(f.approved);f.store.put('production-project',{id:'new-film',customerId:'alice',state:'draft'});const p=await f.narration.bind({actor:f.actor,customerId:'alice',projectId:'new-film',narrator:true,characterId:null,description:'عميق'});
 let calls=0;const svc=createSpeechServices({store:f.store,allowPaid:false,transports:{'habibi-msa':{generate(){calls++;throw Error('must not dispatch');}}}}),plan={characters:[],narrators:[{id:'narrator',voice:{voiceId:p.id,locale:'ar-MSA',engineId:'habibi-msa'}}],utterances:[{id:'line',narratorId:'narrator',role:'narration',text:'فِي يَوْمٍ، كَانَ هُنَاكَ رَجُلٌ.',startMs:0,endMs:6000}]};
 const prepared=await svc.productionAdapters['habibi-msa'].preparePlan(plan,{customerId:'alice',projectId:'new-film'});assert.equal(prepared.utterances[0].text,plan.utterances[0].text);assert.ok(prepared.utterances[0].speechChunks.length>1);
 const req=await svc.productionAdapters['habibi-msa'].requestFor({scope:{customerId:'alice',projectId:'new-film'},stage:{kind:'voice',subjectId:'line',chunkIndex:0},plan:prepared});assert.equal(req.request.expression,'neutral');assert.equal(req.request.speakingRate,.97);assert.equal(req.request.referenceTranscript,p.referenceTranscript);assert.ok(!/[\u064b-\u065f]/u.test(req.request.text));assert.equal(req.textPreparation.original,prepared.utterances[0].speechChunks[0].text);assert.equal(calls,0);
 // Removing the exact reference admission cannot silently select a different voice.
 f.store.put('narration-reference',{...f.store.all('narration-reference')[0],productionAllowed:false});await assert.rejects(svc.productionAdapters['habibi-msa'].requestFor({scope:{customerId:'alice',projectId:'new-film'},stage:{kind:'voice',subjectId:'line'},plan}),/REFERENCE_REQUIRED/);
});
test('real local FFmpeg: no pitch/time shift, same samples, no clipping; native retained with asset',async t=>{
 const bytes=pcmWav({rate:24000,seconds:1});for(let i=44;i<bytes.length;i+=2)bytes.writeInt16LE(Math.round(1600*Math.sin(2*Math.PI*180*(i-44)/2/24000)),i);const original=Buffer.from(bytes),processed=await masterNarration(bytes);assert.deepEqual(bytes,original);assert.equal(processed.evidence.before.samples,processed.evidence.after.samples);assert.equal(processed.evidence.after.clippedSamples,0);assert.equal(processed.evidence.listeningApproved,false);assert.equal(processed.evidence.speedChanged,false);assert.ok(processed.evidence.gainDB<=6);assert.equal(speechSignal(processed.bytes).sampleRate,24000);
 const f=await voiceFixture(t);const {createSpeechAudioAssets}=await import('../engine/speech-audio-assets.mjs');const assets=createSpeechAudioAssets({store:f.store,voiceProfiles:f.profiles}),m=SPEECH_MANIFESTS['habibi-irq'];const asset=await assets.commit({customerId:'alice',projectId:'project',attemptId:'attempt',stageId:'voice:line',utteranceId:'line',profileId:f.profile.id,bytes:processed.bytes,nativeBytes:bytes,processingEvidence:processed.evidence,spokenText:'هلا بيك، شلونك اليوم؟',expression:'neutral',timelineStartMs:0,timelineEndMs:1000,request:{modelId:f.profile.modelId,version:f.profile.version,revision:f.profile.revision,locale:f.profile.locale,settings:{seed:42}}});void m;
 const row=f.store.get('production-asset',asset.assetId);assert.deepEqual(await fs.readFile(path.join(path.dirname(row.path),'native.wav')),original);assert.equal((await assets.read({customerId:'alice',projectId:'project',assetId:asset.assetId})).metadata.processingEvidence.sourceSHA256,hash(original));
 await assert.rejects(assets.read({customerId:'bob',projectId:'project',assetId:asset.assetId}),/NOT_FOUND/);
 await fs.appendFile(path.join(path.dirname(row.path),'native.wav'),'changed');await assert.rejects(assets.read({customerId:'alice',projectId:'project',assetId:asset.assetId}),/ARTIFACT_CHANGED/);
});
