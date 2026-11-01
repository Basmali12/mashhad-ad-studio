/** Offline private-helper regressions. Licensed WAV fixture tests use the local
 * externally stored recordings when prepared; never download media in tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,URL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store,hash} from '../engine/store.mjs';
import {createAdminModelTestRunner} from '../engine/admin-model-test-runner.mjs';
import {createPrivateTrialModelServices} from '../../../scripts/private-trial-model-services.mjs';
const root=new URL('../../../',import.meta.url),fixtures=process.env.PRIVATE_HABIBI_REFERENCE_DIR??fileURLToPath(new URL('../../work/private-habibi-references/',root));
const actor={id:'owner-private-flux-test',isAdmin:true},models=['wan22-i2v-a14b','hunyuanvideo15','habibi-irq','habibi-egy','habibi-msa'];
const ready=await Promise.all(['IRQ','EGY','MSA'].map(d=>stat(path.join(fixtures,d+'-16khz.wav')).then(s=>s.isFile()).catch(()=>false))).then(a=>a.every(Boolean));
const mediaSkip=ready?false:'Run scripts/prepare-private-habibi-references.py first; licensed WAVs intentionally live outside Git.';
async function fixture(t,modelId='habibi-irq'){
 const folder=await mkdtemp(path.join(tmpdir(),'private-model-helper-')),store=new Store(folder,randomBytes(32).toString('base64'));let calls=0;
 t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
 const guardedRunner=()=>{calls++;throw Error('UNEXPECTED_PROVIDER_CALL');},service=createPrivateTrialModelServices({modelId,store,guardedRunner,hunyuanLicenseAccepted:true});
 const runner=createAdminModelTestRunner({store,registry:{dispatch:()=>{throw Error('UNEXPECTED_REGISTRY_DISPATCH');}},adapters:{[modelId]:service.productionAdapter}}),definition={id:'fixture-'+modelId,accountId:'private-primary',modelId,revision:1};
 return {store,service,runner,definition,folder,guardedRunner,calls:()=>calls,input:{runner,definition,actor,referenceDirectory:fixtures,text:'Private functional audio test.',gender:'male',licensedFixturesApproved:true}};
}
for(const modelId of models)test('private helper composes only '+modelId+' without dispatch and freezes bounded actual resources',async t=>{
 const f=await fixture(t,modelId),s=f.service,speech=modelId.startsWith('habibi-');assert.equal(s.manifest.modelId,modelId);assert.equal(typeof s.productionAdapter.execute,'function');assert.ok(Object.isFrozen(s.resources));
 assert.deepEqual(s.resources,speech?{gpu:'L40S',cpu:2,ramGiB:16,minVramGiB:8,timeout:600,startupTimeout:300,idleSeconds:60}:{gpu:'RTX-PRO-6000',cpu:8,ramGiB:256,minVramGiB:96,timeout:1800,startupTimeout:300,idleSeconds:60});
 for(const other of ['audar-tts-v1-flash','latentsync16',...models.filter(x=>x!==modelId)]){assert.equal(s.registryAdapter.profile({modelId:other}),null);assert.throws(()=>s.registryAdapter.start({modelId:other}),/PRIVATE_TRIAL_MODEL_UNSUPPORTED/);}
 assert.equal(f.calls(),0);assert.equal(f.store.all('production-project').length,0);
});
test('private helper requires guarded runner, excludes unapproved models and requires Hunyuan license',async t=>{
 const f=await fixture(t);assert.throws(()=>createPrivateTrialModelServices({modelId:'habibi-irq',store:f.store}),/PRIVATE_TRIAL_GUARDED_RUNNER_REQUIRED/);
 for(const modelId of ['audar-tts-v1-flash','latentsync16','flux2-klein-4b','qwen-image-edit-2511'])assert.throws(()=>createPrivateTrialModelServices({modelId,store:f.store,guardedRunner:f.guardedRunner}),/PRIVATE_TRIAL_MODEL_UNSUPPORTED/);
 assert.throws(()=>createPrivateTrialModelServices({modelId:'hunyuanvideo15',store:f.store,guardedRunner:f.guardedRunner}),/HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED/);assert.equal(f.calls(),0);
});
for(const modelId of ['habibi-irq','habibi-egy','habibi-msa'])test(modelId+' real licensed fixture uses existing Store/Production/Voice APIs, immutable narrator profile and no RPC',{skip:mediaSkip},async t=>{
 const f=await fixture(t,modelId),r=await f.service.createSpeechTestInput(f.input),p=f.store.get('production-project',r.input.projectId),source=f.store.get('production-project',r.sourceProjectId),voice=f.store.get('voice-profile',p.plan.narrators[0].voice.voiceId),ref=f.store.get('voice-reference',r.referenceAssetId);
 assert.equal(p.customerId,hash('film-customer:'+actor.id));assert.equal(p.adminCommissioning.ownerId,actor.id);assert.equal(p.plan.utterances.length,1);assert.equal(p.plan.utterances[0].text,f.input.text);assert.equal(voice.modelId,modelId);assert.equal(voice.projectId,p.id);assert.equal(voice.referenceSHA256,r.referenceSHA256);assert.equal(voice.referenceAssetId,r.referenceAssetId);assert.equal(voice.approved,true);
 assert.equal(source.state,'draft');assert.equal(source.plan,undefined);assert.equal(source.customerId,p.customerId);assert.equal(ref.rightsAttestation.kind,'licensed');assert.equal(ref.rightsAttestation.confirmed,true);assert.equal(ref.sampleRate,16000);assert.equal(ref.channels,1);assert.ok(ref.durationMs>=5000&&ref.durationMs<=12000);assert.equal(ref.transcript,voice.referenceTranscript);
 const again=await f.service.createSpeechTestInput(f.input);assert.equal(again.sourceProjectId,r.sourceProjectId);assert.equal(again.sourceVoiceProfileId,r.sourceVoiceProfileId);assert.equal(again.referenceAssetId,r.referenceAssetId);assert.equal(f.store.all('voice-reference').length,1);
 for(const entity of ['production-charge','production-quote','production-model-run','film-credit'])assert.equal(f.store.all(entity).length,0);assert.equal(f.calls(),0);
});
test('voice helper rejects actor, definition, license and malformed voice inputs before filesystem or RPC',async t=>{
 const f=await fixture(t);
 for(const [change,code] of [[{actor:{id:actor.id,isAdmin:false}},'PRIVATE_TRIAL_ADMIN_REQUIRED'],[{definition:{...f.definition,modelId:'habibi-egy'}},'PRIVATE_TRIAL_SPEECH_SCOPE_INVALID'],[{licensedFixturesApproved:false},'PRIVATE_TRIAL_REFERENCE_LICENSE_REQUIRED'],[{gender:'unknown'},'PRIVATE_TRIAL_VOICE_INPUT_INVALID'],[{text:'x'.repeat(301)},'PRIVATE_TRIAL_VOICE_INPUT_INVALID'],[{text:''},'PRIVATE_TRIAL_VOICE_INPUT_INVALID']])await assert.rejects(f.service.createSpeechTestInput({...f.input,...change}),new RegExp(code));
 assert.equal(f.store.all('voice-reference').length,0);assert.equal(f.store.all('production-project').length,0);assert.equal(f.calls(),0);
});
test('voice helper rejects changed real waveform bytes before registration',{skip:mediaSkip},async t=>{
 const f=await fixture(t),bytes=await readFile(path.join(fixtures,'IRQ-16khz.wav'));bytes[bytes.length-1]^=1;await writeFile(path.join(f.folder,'IRQ-16khz.wav'),bytes);
 await assert.rejects(f.service.createSpeechTestInput({...f.input,referenceDirectory:f.folder}),/PRIVATE_TRIAL_REFERENCE_CHANGED/);assert.equal(f.store.all('voice-reference').length,0);assert.equal(f.calls(),0);
});
test('voice helper preserves immutable existing source voice rather than silently rebinding its gender',{skip:mediaSkip},async t=>{
 const f=await fixture(t);await f.service.createSpeechTestInput(f.input);await assert.rejects(f.service.createSpeechTestInput({...f.input,gender:'female'}),/VOICE_PROFILE_ALREADY_BOUND/);assert.equal(f.calls(),0);
});
