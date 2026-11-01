/** Private sequential commissioning composition. Importing/creating services is
 * inert: only the caller-owned guarded runner may perform provider operations.
 * No public routes, publication, rental changes or customer financial records.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,URL} from 'node:url';
import {hash} from '../services/film-engine/engine/store.mjs';
import {createWanServices,WAN_MANIFEST} from '../services/film-engine/engine/wan-integration.mjs';
import {createWanModalTransport} from '../services/film-engine/engine/wan-modal-transport.mjs';
import {createHunyuanServices,HUNYUAN_MANIFEST} from '../services/film-engine/engine/hunyuan-integration.mjs';
import {createHunyuanModalTransport} from '../services/film-engine/engine/hunyuan-modal-transport.mjs';
import {createSpeechServices,SPEECH_MANIFESTS} from '../services/film-engine/engine/speech-integration.mjs';
import {createSpeechModalTransport} from '../services/film-engine/engine/speech-modal-transport.mjs';
import {createProductionEngine} from '../services/film-engine/engine/production-engine.mjs';
import {inspectSpeechWav} from '../services/film-engine/engine/voice-profiles.mjs';

const HABIBI=new Set(['habibi-irq','habibi-egy','habibi-msa']);
const LOCALES={'habibi-irq':'ar-IQ','habibi-egy':'ar-EG','habibi-msa':'ar-MSA'};
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const fail=code=>{throw Error(code);};
const validateActor=actor=>{if(actor?.isAdmin!==true||typeof actor.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(actor.id))fail('PRIVATE_TRIAL_ADMIN_REQUIRED');return hash('film-customer:'+actor.id);};

export function createPrivateTrialModelServices({modelId,store,guardedRunner,now=Date.now,hunyuanLicenseAccepted=false}={}){
 if(!store||typeof guardedRunner!=='function')fail('PRIVATE_TRIAL_GUARDED_RUNNER_REQUIRED');
 let service,manifest,resources;
 if(modelId==='wan22-i2v-a14b'){
  manifest=WAN_MANIFEST;resources={gpu:'RTX-PRO-6000',cpu:8,ramGiB:256,minVramGiB:96,timeout:1800,startupTimeout:300,idleSeconds:60};
  service=createWanServices({store,now,allowPaid:true,transport:createWanModalTransport({store,now,runner:guardedRunner,allowPaid:true})});
 }else if(modelId==='hunyuanvideo15'){
  if(hunyuanLicenseAccepted!==true)fail('HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED');
  manifest=HUNYUAN_MANIFEST;resources={gpu:'RTX-PRO-6000',cpu:8,ramGiB:256,minVramGiB:96,timeout:1800,startupTimeout:300,idleSeconds:60};
  service=createHunyuanServices({store,now,allowPaid:true,licenseAccepted:true,transport:createHunyuanModalTransport({store,now,runner:guardedRunner,allowPaid:true,licenseAccepted:true})});
 }else if(HABIBI.has(modelId)){
  manifest=SPEECH_MANIFESTS[modelId];resources={gpu:'L40S',cpu:2,ramGiB:16,minVramGiB:8,timeout:600,startupTimeout:300,idleSeconds:60};
  service=createSpeechServices({store,now,allowPaid:true,transports:{[modelId]:createSpeechModalTransport({modelId,store,now,runner:guardedRunner,allowPaid:true})}});
 }else fail('PRIVATE_TRIAL_MODEL_UNSUPPORTED');
 const base=service.registryAdapter,methods=['inspectFiles','prepareQuote','prepare','observePreparation','stopPreparation','estimateStart','start','observe','stop'];
 const registryAdapter={profile:e=>e?.modelId===modelId?base.profile(e):null,...Object.fromEntries(methods.map(method=>[method,(definition,...args)=>{if(definition?.modelId!==modelId)fail('PRIVATE_TRIAL_MODEL_UNSUPPORTED');return base[method](definition,...args);}]))};
 const productionAdapter=HABIBI.has(modelId)?service.productionAdapters[modelId]:service.productionAdapter;
 async function createSpeechTestInput({runner,definition,actor,referenceDirectory,text,gender,licensedFixturesApproved=false}={}){
  const customerId=validateActor(actor);
  if(!HABIBI.has(modelId)||definition?.modelId!==modelId||!runner?.createProject)fail('PRIVATE_TRIAL_SPEECH_SCOPE_INVALID');
  if(licensedFixturesApproved!==true)fail('PRIVATE_TRIAL_REFERENCE_LICENSE_REQUIRED');
  if(!['male','female'].includes(gender)||typeof text!=='string'||!text.trim()||text.length>300)fail('PRIVATE_TRIAL_VOICE_INPUT_INVALID');
  const evidence=JSON.parse(await fs.readFile(path.join(ROOT,'docs/private-habibi-reference-evidence.json'),'utf8'));
  const fixture=evidence.references.find(r=>r.modelId===modelId);
  if(evidence.recordingLicense!=='Apache-2.0'||evidence.datasetRevision!=='1d247ff668738d824c400cdefc542df6499f8c5e'||fixture?.privateOnly!==true||fixture.rightsAttestationKind!=='licensed'||!fixture.transcript?.trim()||fixture.localFileName!==modelId.slice(7).toUpperCase()+'-16khz.wav')fail('PRIVATE_TRIAL_REFERENCE_EVIDENCE_INVALID');
  const directory=await fs.realpath(referenceDirectory),file=path.join(directory,fixture.localFileName),stat=await fs.lstat(file);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024||await fs.realpath(file)!==file)fail('PRIVATE_TRIAL_REFERENCE_PATH_INVALID');
  const bytes=await fs.readFile(file),metadata=inspectSpeechWav(bytes,{minDurationMs:5000,maxDurationMs:12000});
  if(hash(bytes)!==fixture.normalizedSHA256||metadata.sampleRate!==16000||metadata.channels!==1||metadata.bitsPerSample!==16||metadata.durationMs!==fixture.normalizedAudio.durationMs)fail('PRIVATE_TRIAL_REFERENCE_CHANGED');
  const ref=await service.voiceProfiles.commitReference({actor,customerId,bytes,transcript:fixture.transcript,rightsAttestation:{kind:'licensed',confirmed:true}});
  // Existing production API creates a genuine unplanned draft. No synthetic plan,
  // overwritten completed project, fake voice consent or customer billing rows.
  const sourceEngine=createProductionEngine({store,now,allowExecution:false});
  const source=await sourceEngine.create(customerId,{requestId:'private-voice-source-'+hash(modelId+':'+fixture.normalizedSHA256).slice(0,40),title:'Private licensed voice reference',story:'Register the licensed benchmark reference for a private functional speech test only.',durationMs:10000});
  const voice=await service.voiceProfiles.create({actor,customerId,projectId:source.id,narrator:true,narratorId:'reference-narrator',characterId:null,name:'Private '+fixture.dialect+' benchmark voice',approved:true,referenceAssetId:ref.referenceAssetId,modelId,version:manifest.version,revision:manifest.revision,locale:LOCALES[modelId],gender,tone:null,settings:{seed:42}});
  const project=await runner.createProject({definition,adminId:actor.id,input:{voiceProfileId:voice.id,text}});
  if(project.needsInputs?.length)fail('PRIVATE_TRIAL_SPEECH_INPUT_NOT_READY');
  return {input:{projectId:project.projectId,stageId:project.stageId},sourceProjectId:source.id,sourceVoiceProfileId:voice.id,referenceAssetId:ref.referenceAssetId,referenceSHA256:fixture.normalizedSHA256,licenseSource:evidence.licenseSource,privateOnly:true};
 }
 return {modelId,manifest,resources:Object.freeze(resources),registryAdapter,productionAdapter,...(HABIBI.has(modelId)?{createSpeechTestInput}:{} )};
}
