/* global structuredClone */
/** Private owner film harness. No HTTP route, auto-dispatch, publication or wallet mutation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as wait} from 'node:timers/promises';
import {Store,hash} from '../services/film-engine/engine/store.mjs';
import {masterKey} from '../services/film-engine/engine/keyring.mjs';
import {validateProductionPlan} from '../services/film-engine/engine/production-plan.mjs';
import {createProductionEngine} from '../services/film-engine/engine/production-engine.mjs';
import {createFluxServices} from '../services/film-engine/engine/flux-integration.mjs';
import {createFluxPythonRunner,createFluxModalTransport} from '../services/film-engine/engine/flux-modal-transport.mjs';
import {createQwenServices,createImageAdapterRouter} from '../services/film-engine/engine/qwen-integration.mjs';
import {createQwenModalTransport} from '../services/film-engine/engine/qwen-modal-transport.mjs';
import {createEngineRegistry} from '../services/film-engine/engine/engine-registry.mjs';
import {createAdminModelTestRunner} from '../services/film-engine/engine/admin-model-test-runner.mjs';
import {createEngineCommissioning} from '../services/film-engine/engine/engine-commissioning.mjs';
import {createVoiceProfiles} from '../services/film-engine/engine/voice-profiles.mjs';
import {createFluxImageAssets} from '../services/film-engine/engine/flux-image-assets.mjs';
import {createImageQuality} from '../services/film-engine/engine/image-quality.mjs';
import {verifyLocalVideo,readProductionFile} from '../services/film-engine/engine/production-artifacts.mjs';
import {assertPrivateModelTrialBudget} from '../services/film-engine/engine/private-model-trial-policy.mjs';
import {createPrivateTrialModelServices} from './private-trial-model-services.mjs';
import {assertPrivateWatchdogLiveness,runWithPrivateWatchdog,waitForCommissioningTest,retryPrivateRename} from './private-commissioning-observation.mjs';
import {createAfterlifeFilmBrief,AFTERLIFE_NARRATION} from './private-afterlife-film-plan.mjs';

export const FILM_ID='afterlife-20261101',ACTOR=Object.freeze({id:'owner-private-flux-test',isAdmin:true});
export const OWNER=hash('film-customer:'+ACTOR.id);
export const ENGINE_IDS=Object.freeze({'flux2-klein-4b':'ccdb2b9a-ca33-4606-8aed-0f172191ab2f','qwen-image-edit-2511':'226b322e-3abb-4163-8d85-9b4a603ee3a0','wan22-i2v-a14b':'d830d93c-394d-4c92-bdc2-7fda7c79d9ae','habibi-msa':'b85f1892-b6e3-4622-82f6-9ecb75eb6e4e'});
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=path.resolve(repo,'../../work/flux-primary-gpu-round1'),work=path.resolve(repo,'../../work/afterlife-film-20261101');
const exec=promisify(execFile),brief=createAfterlifeFilmBrief(),KEY=/^[A-Za-z0-9_:-]{1,180}$/;
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const fail=code=>{throw Error(code);};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.pending',JSON.stringify(value,null,2)+'\n',{mode:0o600});await retryPrivateRename(()=>fs.rename(file+'.pending',file));}

export function privateFilmCommissioningRequestId(stageId){afterlifeStage(stageId);return FILM_ID+'-stage-'+hash(stageId).slice(0,24);}
const legacyIntentId=stageId=>FILM_ID+'-execute-'+stageId;
const replacementIntentId=stageId=>legacyIntentId(stageId)+'-safe-v2';
function executionIntentId(store,stageId){const old=store.get('private-film-paid-intent',legacyIntentId(stageId));return old?.state==='definitive_no_spend'&&old.reconciliation?.replacementIntentId===replacementIntentId(stageId)?replacementIntentId(stageId):legacyIntentId(stageId);}

/** Explicit local reconciliation only. An absent browser response is never proof. */
export function assertPrivateFilmNoSpendReconciliation({store,project,stageId,definition,stoppedProof,now=Date.now()}){
 const spec=afterlifeStage(stageId),old=store.get('private-film-paid-intent',legacyIntentId(stageId)),q=old&&store.get('engine-test-quote',old.quoteId),stage=store.get('production-stage',hash(project.id+':'+stageId));
 if(project.customerId!==OWNER||project.title!==brief.title||project.durationMs!==30000||project.story!==AFTERLIFE_NARRATION||project.adminCommissioning?.ownerId!==ACTOR.id||project.adminCommissioning?.privateFilmId!==FILM_ID||project.adminCommissioning?.privateFilmAccountId!==definition.accountId||definition.id!==ENGINE_IDS[spec.modelId]||definition.modelId!==spec.modelId||!old||old.filmId!==FILM_ID||old.stageId!==stageId||old.state!=='claimed'||old.testId||old.commissioningRequestId||!Number.isSafeInteger(old.createdAt)||now-old.createdAt<0||now-old.createdAt>600000)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 // The legacy value contains a colon and was rejected by commissioning safeKey
 // before its transaction. Require its unused quote and all durable no-work proof.
 if(/^[A-Za-z0-9_-]{1,100}$/.test(old.id)||!q||q.usedBy||q.engineId!==definition.id||q.adminId!==ACTOR.id||q.input?.projectId!==project.id||q.input?.stageId!==stageId||!stage||stage.projectId!==project.id||stage.customerId!==OWNER||stage.stageId!==stageId||stage.modelId!==spec.modelId||stage.state!=='planned'||stage.attemptId||(stage.attempts??0)!==0||stage.result)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 const requestId=privateFilmCommissioningRequestId(stageId);
 if(store.get('private-film-paid-intent',replacementIntentId(stageId))||store.get('engine-test-command',hash('engine-test:'+ACTOR.id+':'+old.id))||store.get('engine-test-command',hash('engine-test:'+ACTOR.id+':'+requestId)))fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 for(const t of store.all('engine-test'))if(t.requestId===old.id||t.requestId===requestId||t.quoteId===old.quoteId||t.input?.projectId===project.id&&t.input?.stageId===stageId)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 for(const kind of ['admin-native-test','production-attempt'])for(const t of store.all(kind))if(t.projectId===project.id&&t.stageId===stageId)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 for(const c of store.all('engine-command')){
  if(c.runtimeId){const history=store.get('engine-runtime-history',c.runtimeId);if(!history)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');if(history.engineId===definition.id&&(!Number.isSafeInteger(history.startedAt)||history.startedAt>=old.createdAt))fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');}
  else if(c.engineId===definition.id){
   // Registry preparation claims have no runtime/timestamp. Admit that shape
   // only with its exact consumed prepare quote and original binding proof.
   const preparation=store.all('engine-quote').some(q=>q.action==='prepare'&&q.engineId===definition.id&&q.usedBy===c.id&&typeof q.id==='string'&&c.binding===hash(JSON.stringify([definition.id,q.id])));
   if(!preparation)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
  }else if(!c.engineId)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 }
 if(!stoppedProof||stoppedProof.filmTrialApproved!==true||stoppedProof.filmId!==FILM_ID||stoppedProof.account!=='basm1998ali'||stoppedProof.engineId!==definition.id||stoppedProof.accountId!==definition.accountId||stoppedProof.modelId!==definition.modelId||stoppedProof.status!=='stopped'||stoppedProof.cloudStopped!==true||typeof stoppedProof.appId!=='string'||!/^ap-[A-Za-z0-9_-]+$/.test(stoppedProof.appId)||stoppedProof.boundAppId!==stoppedProof.appId||!Number.isSafeInteger(stoppedProof.stoppedAt)||stoppedProof.stoppedAt<old.createdAt||stoppedProof.stoppedAt>now||now-stoppedProof.stoppedAt>600000)fail('PRIVATE_FILM_NO_SPEND_UNCONFIRMED');
 return {old,reconciliation:{reason:'Legacy request ID rejected by safeKey before durable commissioning claim',definitiveNoSpend:true,oldRequestId:old.id,commissioningRequestId:requestId,replacementIntentId:replacementIntentId(stageId),quoteUnused:true,stageAttempts:0,appId:stoppedProof.appId,cloudStopped:true,stoppedAt:stoppedProof.stoppedAt,at:now}};
}

export function afterlifeStage(stageId){
 if(stageId==='voice:narration')return {stageId,kind:'voice',subjectId:'narration',modelId:'habibi-msa',deps:[]};
 if(stageId==='character_image:man:0')return {stageId,kind:'character_image',subjectId:'man',angleIndex:0,modelId:'flux2-klein-4b',deps:['voice:narration']};
 const parts=String(stageId).split(':'),[kind,shotId]=parts;
 if(parts.length!==2||!['scene_image','animate'].includes(kind)||!brief.shots.some(s=>s.id===shotId))fail('PRIVATE_FILM_STAGE_INVALID');
 return {stageId,kind,subjectId:shotId,modelId:kind==='scene_image'?'qwen-image-edit-2511':'wan22-i2v-a14b',deps:kind==='scene_image'?['character_image:man:0']:['scene_image:'+shotId]};
}
export function createPrivateFilmPlan(voiceId){
 if(typeof voiceId!=='string'||!/^[a-f0-9]{64}$/.test(voiceId))fail('PRIVATE_FILM_VOICE_REQUIRED');
 const actor=brief.anchors.find(a=>a.id==='character-main'),room=brief.anchors.find(a=>a.id==='room-main');
 return validateProductionPlan({id:FILM_ID,story:AFTERLIFE_NARRATION,durationMs:30000,orientation:'portrait',seed:42,videoResolution:'720p',visualStyle:'Photorealistic restrained cinema, contemporary Iraq, soft natural lighting, reflective and humane, plain unlettered surfaces.',referenceIds:[],
  characters:[{id:'man',name:'الرجل العراقي',description:actor.description,age:40,face:'An olive-complexioned oval face, short black hair with gray temples, short neat beard.',body:'Average build and height; natural human proportions.',wardrobe:'The same charcoal cotton button shirt and dark trousers.',props:[],referenceIds:[],angles:['front'],voice:{engineId:'habibi-msa',voiceId,locale:'ar-MSA'},relationships:[],environment:room.description,visualStyle:brief.anchors.find(a=>a.id==='visual-style').description,expression:'Quiet reflective expression, eyes visible.',pose:'Seated naturally near the window; upper body and room architecture visible.'}],
  narrators:[{id:'narrator',name:'الراوي',voice:{engineId:'habibi-msa',voiceId,locale:'ar-MSA'}}],utterances:[{id:'narration',characterId:null,narratorId:'narrator',role:'narration',text:AFTERLIFE_NARRATION,startMs:0,endMs:30000,intentionalRepeat:false,repeatOf:null,allowOverlap:false}],
  chapters:[{id:'chapter',title:brief.title,startMs:0,endMs:30000}],scenes:brief.shots.map(s=>({id:'scene-'+s.id,chapterId:'chapter',startMs:s.targetStartMs,endMs:s.targetEndMs,description:s.description})),
  shots:brief.shots.map(s=>({id:s.id,sceneId:'scene-'+s.id,chapterId:'chapter',startMs:s.targetStartMs,endMs:s.targetEndMs,prompt:s.prompt,location:['empty-chair','clock','phone','window'].includes(s.id)?room.description:s.id==='hands'?'A warm quiet room, close view of the hands only.':'A peaceful real-world road at dawn.',characterIds:['clock','phone','window','hands'].includes(s.id)?['man']:[],referenceIds:[],utteranceIds:['narration'],eventIds:['event-'+s.id],characterMotion:s.action,cameraMotion:s.camera,lighting:s.id==='clock'||s.id==='phone'?'Soft practical night light':s.id==='hands'?'Warm natural window light':'Soft dawn light',time:s.id==='clock'||s.id==='phone'?'night':'dawn',era:'Present day',visualStyle:'Restrained photorealistic cinema',framing:s.id==='hands'?'Extreme close-up of hands only':'Medium to wide as described',soundEffects:[],allowText:false,requestedText:null,videoModelId:'wan22-i2v-a14b',generationMode:'image_to_video',requires_lip_sync:false,motionPlan:{start:s.description,development:s.action,end:s.id==='phone'?'The phone rests lowered in his hand.':s.id==='window'?'He is peacefully facing the dawn light.':s.id==='empty-chair'?'The empty chair remains beside the gently moving curtain.':s.id==='hands'?'The two hands rest together in a reassuring hold.':s.id==='road'?'The camera has advanced along the peaceful road.':'His gaze rests thoughtfully on the clock.',camera:s.camera},motionBeats:[]}))});
}

async function projectOf(store){const record=store.get('private-film-project',FILM_ID),p=record&&store.get('production-project',record.projectId);if(!p||p.customerId!==OWNER||p.title!==brief.title||p.durationMs!==30000||p.adminCommissioning?.ownerId!==ACTOR.id||p.adminCommissioning?.privateFilmId!==FILM_ID||p.story!==AFTERLIFE_NARRATION)fail('PRIVATE_FILM_PROJECT_REQUIRED');return p;}
function stageRow(store,p,stageId){const s=store.get('production-stage',hash(p.id+':'+stageId));if(!s||s.projectId!==p.id||s.customerId!==OWNER)fail('PRIVATE_FILM_STAGE_INVALID');return s;}
async function checkedAsset(store,p,stageId){const s=stageRow(store,p,stageId);if(s.state!=='completed'||s.result?.assetIds?.length!==1)fail('PRIVATE_FILM_STAGE_INCOMPLETE');const a=store.get('production-asset',s.result.assetIds[0]);if(!a||a.customerId!==OWNER||a.projectId!==p.id||a.attemptId!==s.attemptId)fail('PRIVATE_FILM_ASSET_SCOPE_INVALID');await readProductionFile(a.path,a.sha256);return a;}
async function checkedNarration(store,p){const audio=await checkedAsset(store,p,'voice:narration'),film=store.get('private-film-project',FILM_ID);if(audio.kind!=='audio'||audio.spokenText!==AFTERLIFE_NARRATION||audio.durationMs>30000||audio.profileId!==film.voiceProfileId||audio.request?.modelId!=='habibi-msa'||audio.request?.locale!=='ar-MSA')fail('PRIVATE_FILM_NARRATION_REVIEW_REQUIRED');const profile=await createVoiceProfiles({store}).get({customerId:OWNER,projectId:p.id,profileId:film.voiceProfileId});if(audio.profileFingerprint!==profile.fingerprint)fail('PRIVATE_FILM_VOICE_CHANGED');return audio;}
async function initialize(store){
 const existing=store.get('private-film-project',FILM_ID);if(existing){const p=await projectOf(store);return {initialized:true,reused:true,projectId:p.id,paidOperations:0};}
 if(store.all('engine-runtime').some(r=>!r.cloudStopped))fail('PRIVATE_FILM_BUSY');
 const msa=store.get('engine-definition',ENGINE_IDS['habibi-msa']);if(!msa||msa.modelId!=='habibi-msa')fail('PRIVATE_FILM_ENGINE_REQUIRED');
 const sourceEvidence=await read(path.join(folder,'speech-habibi-msa-round-1-voice-evidence.json')),voices=createVoiceProfiles({store});
 const source=store.get('voice-profile',process.env.PRIVATE_FILM_SOURCE_VOICE_PROFILE||sourceEvidence.sourceVoiceProfileId);
 if(!source||source.customerId!==OWNER||source.modelId!=='habibi-msa'||source.approved!==true)fail('PRIVATE_FILM_VOICE_REQUIRED');await voices.get({customerId:OWNER,projectId:source.projectId,profileId:source.id});
 const engine=createProductionEngine({store,allowExecution:false}),draft=await engine.create(OWNER,{requestId:FILM_ID,title:brief.title,story:AFTERLIFE_NARRATION,durationMs:30000});
 const voice=await voices.create({actor:ACTOR,customerId:OWNER,projectId:draft.id,narrator:true,narratorId:'narrator',characterId:null,name:'راوي الحياة ما بعد الموت',approved:true,referenceAssetId:source.referenceAssetId,modelId:'habibi-msa',version:source.version,revision:source.revision,locale:'ar-MSA',gender:'male',tone:'Deep, slightly gravelly, clear and reflective; desired tone, not a verified voice-quality claim.',settings:{seed:42,speakingRate:0.9}});
 const plan=createPrivateFilmPlan(voice.id),p=store.get('production-project',draft.id);
 await store.transaction(async()=>{store.put('production-project',{...p,plan,adminCommissioning:{ownerId:ACTOR.id,privateFilmId:FILM_ID,privateFilmAccountId:msa.accountId,referenceIds:[]},state:'planned',updatedAt:Date.now()});for(const stageId of ['voice:narration','character_image:man:0',...brief.shots.map(s=>'scene_image:'+s.id),...brief.shots.map(s=>'animate:'+s.id)]){const spec=afterlifeStage(stageId);store.put('production-stage',{...spec,id:hash(p.id+':'+stageId),projectId:p.id,customerId:OWNER,state:'planned',attempts:0});}store.put('private-film-project',{id:FILM_ID,projectId:p.id,customerId:OWNER,voiceProfileId:voice.id,sourceVoiceProfileId:source.id,narrationSHA256:brief.narrationSHA256,createdAt:Date.now()});store.audit('private_film_initialized',p.id,{filmId:FILM_ID,narrationSHA256:brief.narrationSHA256,paidOperations:0});});
 await write(path.join(work,'project.json'),{filmId:FILM_ID,projectId:p.id,customerId:OWNER,voiceProfileId:voice.id,narrationSHA256:brief.narrationSHA256,referenceVoiceQualityApproved:false});return {initialized:true,projectId:p.id,voiceProfileId:voice.id,paidOperations:0};
}

export async function runPrivateAfterlifeFilm(argv=process.argv.slice(2)){
 const [command='status',subject,leaseTag='1']=argv;if(!['init','status','prepare','quote','execute','recover','reconcile-no-spend','review-image','assemble','stop'].includes(command)||subject!==undefined&&!KEY.test(subject)||!/^[A-Za-z0-9_-]{1,40}$/.test(leaseTag))fail('PRIVATE_FILM_COMMAND_INVALID');
 const store=new Store(folder,masterKey(folder,{create:false}));let commissioning,registry,runner,activeEngineId,activeTestId,paidInFlight=0,cleanupPromise;
 const statePath=process.env.PRIVATE_FILM_WATCHDOG_PATH,manifestPath=process.env.PRIVATE_FILM_MANIFEST_PATH;
 const control=async status=>{if(statePath)await write(statePath+'.control.json',{mainStatus:status,stopRequested:true});};
 const readControl=()=>statePath?read(statePath+'.control.json').catch(e=>{if(e.code==='ENOENT')return {};throw e;}):{};
 async function stopOnly(){if(!statePath||!manifestPath)return {cloudStopped:false};const args=['-X','utf8',path.join(repo,'scripts/private-model-stop-only.py'),statePath,manifestPath,...(paidInFlight===0?['--deployment-settled']:[])];try{const {stdout}=await exec(process.env.ENGINE_PYTHON||'python',args,{windowsHide:true,timeout:100000,maxBuffer:65536});const proof=JSON.parse(stdout.trim().split('\n').at(-1));emit({phase:'stop-only',...proof});return proof;}catch{return {cloudStopped:false};}}
 async function stopOnFailure(){if(cleanupPromise)return cleanupPromise;cleanupPromise=(async()=>{await control('failed');await commissioning?.close();const cloud=stopOnly();if(activeEngineId)try{if(activeTestId)await commissioning.dispatch(ACTOR,'admin.engine.test.stop',{id:activeEngineId,testId:activeTestId,approved:true});else await registry.dispatch(ACTOR,'admin.engine.stop',{id:activeEngineId,approved:true});}catch{/* Independent exact-App shutdown remains authoritative. */}const proof=await cloud;if(proof.cloudStopped!==true)fail('PRIVATE_FILM_STOP_UNCONFIRMED');return proof;})();return cleanupPromise;}
 try{
  if(command==='init'){emit(await initialize(store));return;}
  let p=await projectOf(store);
  if(command==='status'){emit({filmId:FILM_ID,projectId:p.id,voiceProfileId:store.get('private-film-project',FILM_ID).voiceProfileId,stages:store.all('production-stage').filter(s=>s.projectId===p.id).map(s=>({stageId:s.stageId,state:s.state,attemptId:s.attemptId??null,assets:(s.result?.assetIds??[]).map(id=>{const a=store.get('production-asset',id);return a?{id,path:a.path,kind:a.kind,durationMs:a.durationMs??null}:null;})})),final:store.get('private-film-result',FILM_ID)??null});return;}
  if(command==='assemble'){emit(await assemblePrivateFilm(store,p));return;}
  if(command==='reconcile-no-spend'){
   if(!statePath)fail('PRIVATE_FILM_LEASE_REQUIRED');const spec=afterlifeStage(subject),definition=store.get('engine-definition',ENGINE_IDS[spec.modelId]);if(!definition)fail('PRIVATE_FILM_ENGINE_REQUIRED');
   await store.transaction(async()=>{const {old,reconciliation}=assertPrivateFilmNoSpendReconciliation({store,project:p,stageId:subject,definition,stoppedProof:await read(statePath)});store.put('private-film-paid-intent',{...old,state:'definitive_no_spend',reconciliation});store.audit('private_film_rejected_request_reconciled',p.id,{stageId:subject,...reconciliation});});emit({reconciled:true,definitiveNoSpend:true,paidOperations:0,stageId:subject,commissioningRequestId:privateFilmCommissioningRequestId(subject)});return;
  }
  const underlying=createFluxPythonRunner({timeoutMs:1800000});
  const guarded=async(action,packet,event)=>{
   if(!['prepare','start','generate'].includes(action))return underlying(action,packet,event);
   const allowed=async()=>{if(!statePath||!manifestPath)fail('PRIVATE_FILM_LEASE_REQUIRED');const s=await read(statePath),m=await read(manifestPath),c=await readControl();if(s.filmTrialApproved!==true||s.filmId!==FILM_ID||m.filmId!==FILM_ID)fail('PRIVATE_FILM_LEASE_REQUIRED');assertPrivateWatchdogLiveness(s,{control:c,allowArmed:action==='prepare'});assertPrivateModelTrialBudget(s,m,{...packet,trialAction:action},Date.now(),c);};
   return runWithPrivateWatchdog(async()=>{paidInFlight++;try{return await underlying(action,action==='prepare'&&packet.definition?.modelId!=='flux2-klein-4b'?{...packet,privateReuseVerifiedWeights:true}:packet,event);}finally{paidInFlight--;}},{continueAllowed:allowed,onGuardFailure:stopOnFailure,onSettledAfterFailure:stopOnly});
  };
  const flux=createFluxServices({store,allowPaid:true,transport:createFluxModalTransport({store,runner:guarded,allowPaid:true})});
  const qwen=createQwenServices({store,allowPaid:true,transport:createQwenModalTransport({store,runner:guarded,allowPaid:true})});
  const wan=createPrivateTrialModelServices({modelId:'wan22-i2v-a14b',store,guardedRunner:guarded});
  const msa=createPrivateTrialModelServices({modelId:'habibi-msa',store,guardedRunner:guarded});
  registry=createEngineRegistry({store,adapter:createImageAdapterRouter([flux.registryAdapter,qwen.registryAdapter,wan.registryAdapter,msa.registryAdapter]),allowPaid:true});
  const quality=createImageQuality({store,assets:createFluxImageAssets({store})});
  runner=createAdminModelTestRunner({store,registry,adapters:{'flux2-klein-4b':flux.productionAdapter,'qwen-image-edit-2511':qwen.productionAdapter,'wan22-i2v-a14b':wan.productionAdapter,'habibi-msa':msa.productionAdapter},allowPaid:true,imageQuality:quality});commissioning=createEngineCommissioning({store,registry,testRunner:runner,allowPaid:true});
  if(command==='stop'){await stopOnFailure();return;}
  if(command==='prepare'){
   if(!Object.hasOwn(ENGINE_IDS,subject))fail('PRIVATE_FILM_MODEL_INVALID');const d=store.get('engine-definition',ENGINE_IDS[subject]);if(!d)fail('PRIVATE_FILM_ENGINE_REQUIRED');activeEngineId=d.id;
   const intentId=FILM_ID+'-prepare-'+subject+'-'+leaseTag;if(store.get('private-film-paid-intent',intentId))fail('PRIVATE_FILM_NO_REPEAT');
   const q=await registry.dispatch(ACTOR,'admin.engine.quote',{id:d.id,action:'prepare'});emit({phase:'prepare-quote',modelId:subject,missingBytes:q.missingBytes,dispatchAvailable:q.dispatchAvailable,blockers:q.blockers,estimate:q.estimate});if(!q.dispatchAvailable||q.missingBytes!==0)fail('PRIVATE_FILM_CACHED_WEIGHTS_REQUIRED');store.put('private-film-paid-intent',{id:intentId,filmId:FILM_ID,quoteId:q.id,createdAt:Date.now(),state:'claimed'});
   let result=await registry.dispatch(ACTOR,'admin.engine.prepare',{id:d.id,quoteId:q.id,requestId:intentId,approved:true});while(result.preparation?.cloudStopped!==true){if(['failed','uncertain','cancelled'].includes(result.preparation?.status))fail('PRIVATE_FILM_PREPARATION_FAILED');assertPrivateWatchdogLiveness(await read(statePath),{control:await readControl(),allowArmed:true});await wait(2000);assertPrivateWatchdogLiveness(await read(statePath),{control:await readControl(),allowArmed:true});result=await registry.dispatch(ACTOR,'admin.engine.status',{id:d.id});}if(result.preparation?.status!=='completed')fail('PRIVATE_FILM_PREPARATION_FAILED');emit({phase:'prepared',modelId:subject,cloudStopped:true});return;
  }
  const stage=afterlifeStage(subject),d=store.get('engine-definition',ENGINE_IDS[stage.modelId]);if(!d)fail('PRIVATE_FILM_ENGINE_REQUIRED');
  if(command==='review-image'){
   const a=await checkedAsset(store,p,subject);if(a.kind!=='image')fail('PRIVATE_FILM_IMAGE_REQUIRED');await approveImage(store,p,quality,a,{newReview:true});emit({reviewed:true,reviewerKind:'delegated_agent_visual',humanReviewed:false,assetId:a.id,sha256:a.sha256});return;
  }
  const existing=stageRow(store,p,subject);if(existing.state==='completed'&&command==='execute'){const a=await checkedAsset(store,p,subject);emit({phase:'reused',stageId:subject,assetId:a.id,path:a.path,gpuStarted:false});return;}
  if(subject!=='voice:narration'){
   await checkedNarration(store,p);
   p=await assignReferences(store,p,stage);await refreshKnownReviews(store,p,quality);
  }
  const input={projectId:p.id,stageId:subject},intentId=executionIntentId(store,subject),commissioningRequestId=privateFilmCommissioningRequestId(subject);
  if(command==='recover'){const intent=store.get('private-film-paid-intent',intentId);if(!intent?.testId)fail('PRIVATE_FILM_RECOVERY_UNAVAILABLE');const receipt=await runner.follow({definition:d,input,testId:intent.testId,adminId:ACTOR.id});if(!receipt.verified||!receipt.cloudStopped)fail('PRIVATE_FILM_RECOVERY_UNCONFIRMED');await saveStageResult(store,p,subject,receipt.testId,receipt.artifacts);emit({recovered:true,gpuStarted:false,testId:receipt.testId,stageId:subject});return;}
  const q=await commissioning.dispatch(ACTOR,'admin.engine.test.quote',{id:d.id,input});emit({phase:'test-quote',stageId:subject,modelId:stage.modelId,dispatchAvailable:q.dispatchAvailable,blockers:q.blockers,estimate:q.estimate});if(command==='quote')return;if(!q.dispatchAvailable)fail('PRIVATE_FILM_TEST_NOT_READY');
  if(store.get('private-film-paid-intent',intentId))fail('PRIVATE_FILM_NO_REPEAT');activeEngineId=d.id;store.put('private-film-paid-intent',{id:intentId,filmId:FILM_ID,stageId:subject,quoteId:q.id,commissioningRequestId,...(intentId!==legacyIntentId(subject)?{replacesIntentId:legacyIntentId(subject)}:{}),createdAt:Date.now(),state:'claimed'});
  const initial=await commissioning.dispatch(ACTOR,'admin.engine.test.execute',{id:d.id,quoteId:q.id,requestId:commissioningRequestId,approved:true});activeTestId=initial.latestTest?.id;store.put('private-film-paid-intent',{...store.get('private-film-paid-intent',intentId),testId:activeTestId??null});
  const continueAllowed=async()=>{if(!statePath)fail('PRIVATE_FILM_LEASE_REQUIRED');assertPrivateWatchdogLiveness(await read(statePath),{control:await readControl()});};
  let lastProgress;const result=await waitForCommissioningTest(initial,{observe:()=>commissioning.status({id:d.id,requestId:commissioningRequestId},ACTOR),continueAllowed,onGuardFailure:stopOnFailure,wait:()=>wait(2000),onProgress:t=>{const v=JSON.stringify([t.status,t.progress]);if(v!==lastProgress){lastProgress=v;emit({phase:'test',stageId:subject,status:t.status,progress:t.progress});}}});
  if(result.status!=='needs_review'||!result.cloudStopped||!result.artifacts?.length)fail('PRIVATE_FILM_STAGE_FAILED');await saveStageResult(store,p,subject,result.id,result.artifacts);await control('completed');emit({phase:'result',stageId:subject,testId:result.id,cloudStopped:true,artifacts:result.artifacts.map(a=>{const row=store.get('production-asset',a.id);return {id:a.id,path:row.path,kind:row.kind,durationMs:row.durationMs??null};})});
 }catch(error){if(['prepare','execute','stop'].includes(command))await stopOnFailure().catch(()=>{error.cleanupUnconfirmed=true;});throw error;}
 finally{await commissioning?.close();await commissioning?.drain();store.close();}
}

async function saveStageResult(store,p,stageId,testId,artifacts){const output=artifacts.map(a=>store.get('production-asset',a.id));if(output.some(a=>!a||a.customerId!==OWNER||a.projectId!==p.id))fail('PRIVATE_FILM_ASSET_SCOPE_INVALID');await write(path.join(work,stageId.replaceAll(':','-')+'-result.json'),{stageId,testId,cloudStopped:true,artifacts:output});}
async function assignReferences(store,p,stage){
 if(stage.kind==='character_image')return p;
 const anchor=await checkedAsset(store,p,'character_image:man:0');let refs=[anchor.id];
 if(stage.kind==='scene_image'&&stage.subjectId!=='clock'){const room=await checkedAsset(store,p,'scene_image:clock');refs=['phone','window'].includes(stage.subjectId)?[anchor.id,room.id]:stage.subjectId==='hands'?[anchor.id]:[room.id];}
 if(stage.kind==='animate')refs=[(await checkedAsset(store,p,'scene_image:'+stage.subjectId)).id];
 const shot=p.plan.shots.find(s=>s.id===stage.subjectId);let changed=false;const plan=structuredClone(p.plan);const man=plan.characters.find(c=>c.id==='man');if(man.referenceIds[0]!==anchor.id){man.referenceIds=[anchor.id];changed=true;}
 if(stage.kind==='scene_image'&&JSON.stringify(shot.referenceIds)!==JSON.stringify(refs)){plan.shots.find(s=>s.id===shot.id).referenceIds=refs;changed=true;}
 const declared=[...new Set([...plan.referenceIds,anchor.id,...refs])];if(declared.length!==plan.referenceIds.length){plan.referenceIds=declared;changed=true;}
 const updated={...p,plan:changed?validateProductionPlan(plan):p.plan,adminCommissioning:{...p.adminCommissioning,referenceIds:stage.kind==='animate'?refs:[]},revision:p.revision+(changed?1:0),updatedAt:Date.now()};await store.put('production-project',updated);return updated;
}
async function approveImage(store,p,quality,a,{newReview=false}={}){
 const proofId=hash(FILM_ID+':visual:'+a.id),existing=store.get('private-film-visual-review',proofId);if(!newReview&&(!existing?.approved||existing.sha256!==a.sha256||existing.reviewerKind!=='delegated_agent_visual'))return;
 await readProductionFile(a.path,a.sha256);const review=await quality.assess({customerId:OWNER,projectId:p.id,assetId:a.id,expectedWidth:720,expectedHeight:1280});if(review.status==='failed')fail('PRIVATE_FILM_IMAGE_REVIEW_FAILED');await quality.approve({actor:ACTOR,customerId:OWNER,projectId:p.id,assetId:a.id,reviewId:review.id,approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual'});
 if(newReview){store.put('private-film-visual-review',{id:proofId,filmId:FILM_ID,projectId:p.id,assetId:a.id,sha256:a.sha256,approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual',at:Date.now()});store.audit('private_film_delegated_visual_review',a.id,{filmId:FILM_ID,sha256:a.sha256,humanReviewed:false});}
}
async function refreshKnownReviews(store,p,quality){for(const r of store.all('private-film-visual-review').filter(r=>r.filmId===FILM_ID&&r.projectId===p.id&&r.approved)){const a=store.get('production-asset',r.assetId);if(!a||a.sha256!==r.sha256)fail('PRIVATE_FILM_REFERENCE_CHANGED');await approveImage(store,p,quality,a);}}

export function privateFilmAssemblyArgs({videoFiles,audioFile,audioDurationMs,output}){
 if(!Array.isArray(videoFiles)||videoFiles.length!==6||videoFiles.some(f=>typeof f!=='string')||typeof audioFile!=='string'||!Number.isSafeInteger(audioDurationMs)||audioDurationMs<=0||audioDurationMs>30000||typeof output!=='string')fail('PRIVATE_FILM_ASSEMBLY_INPUT_INVALID');
 const args=['-nostdin','-hide_banner','-v','error','-threads','2','-filter_complex_threads','2','-n'];for(const file of videoFiles)args.push('-i',file);args.push('-i',audioFile,'-f','lavfi','-i','anoisesrc=color=brown:amplitude=0.006:sample_rate=48000:duration=30:seed=42');
 const delay=Math.max(0,Math.min(600,30000-audioDurationMs-200));
 const filters=videoFiles.map((_,i)=>`[${i}:v]trim=start=0:duration=5,setpts=PTS-STARTPTS,fps=16,setsar=1[v${i}]`);
 filters.push('[v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0,fade=t=out:st=29.4:d=0.6[v]',`[6:a]aresample=48000,adelay=${delay}:all=1,apad=whole_dur=30,asplit=2[voice][key]`,'[7:a]highpass=f=100,lowpass=f=2000,afade=t=in:st=0:d=0.4,afade=t=out:st=29.4:d=0.6[ambient]','[ambient][key]sidechaincompress=threshold=0.01:ratio=5:attack=15:release=250[duck]','[voice][duck]amix=inputs=2:duration=longest:normalize=0,apad=whole_dur=30,atrim=duration=30[a]');
 args.push('-filter_complex',filters.join(';'),'-map','[v]','-map','[a]','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-r','16','-c:a','aac','-b:a','192k','-ar','48000','-t','30','-movflags','+faststart','-metadata','title=الحياة ما بعد الموت',output);return {args,narrationStartMs:delay};
}
async function assemblePrivateFilm(store,p){
 if(store.all('engine-runtime').some(r=>!r.cloudStopped))fail('PRIVATE_FILM_RESOURCES_NOT_STOPPED');const previous=store.get('private-film-result',FILM_ID);if(previous){await readProductionFile(previous.path,previous.sha256);return {...previous,reused:true};}
 const audio=await checkedNarration(store,p);const videos=[];for(const shot of brief.shots){const a=await checkedAsset(store,p,'animate:'+shot.id);if(a.kind!=='video'||Math.abs(a.durationMs-5000)>65||a.width!==720||a.height!==1280)fail('PRIVATE_FILM_VIDEO_DURATION_INVALID');videos.push(a);}
 await fs.mkdir(work,{recursive:true});const output=path.join(work,'الحياة ما بعد الموت.mp4'),pending=path.join(work,'film-final.pending.mp4');for(const file of [output,pending])if(await fs.stat(file).then(()=>true).catch(()=>false))fail('PRIVATE_FILM_LOCAL_RESULT_REQUIRES_REVIEW');
 const {args,narrationStartMs}=privateFilmAssemblyArgs({videoFiles:videos.map(a=>a.path),audioFile:audio.path,audioDurationMs:audio.durationMs,output:pending});await exec(process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg',args,{windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});const metadata=await verifyLocalVideo({file:pending,expectedDurationMs:30000,hasAudio:true});const bytes=await fs.readFile(pending),sha256=hash(bytes);await fs.rename(pending,output);const result={id:FILM_ID,projectId:p.id,customerId:OWNER,path:output,sha256,bytes:bytes.length,...metadata,narrationAssetId:audio.id,narrationSHA256:audio.sha256,narrationDurationMs:audio.durationMs,narrationStartMs,narrationUncut:true,narrationRespeeded:false,ambience:'Original local procedural brown-noise wind texture with speech ducking; not a field recording.',sourceAssetIds:videos.map(a=>a.id),published:false,createdAt:Date.now()};store.put('private-film-result',result);await write(path.join(work,'final-receipt.json'),result);return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPrivateAfterlifeFilm().catch(error=>{emit({ok:false,error:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PRIVATE_FILM_FAILED',cleanupUnconfirmed:error.cleanupUnconfirmed===true});process.exitCode=1;});
