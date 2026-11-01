/** Owner-approved sequential private commissioning. Never serves HTTP or publishes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {execFileSync,execFile} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {Store,hash} from '../services/film-engine/engine/store.mjs';
import {masterKey} from '../services/film-engine/engine/keyring.mjs';
import {createFluxServices} from '../services/film-engine/engine/flux-integration.mjs';
import {createQwenServices,QWEN_MANIFEST,createImageAdapterRouter} from '../services/film-engine/engine/qwen-integration.mjs';
import {createFluxPythonRunner} from '../services/film-engine/engine/flux-modal-transport.mjs';
import {createQwenModalTransport} from '../services/film-engine/engine/qwen-modal-transport.mjs';
import {createEngineRegistry} from '../services/film-engine/engine/engine-registry.mjs';
import {createAdminModelTestRunner} from '../services/film-engine/engine/admin-model-test-runner.mjs';
import {createEngineCommissioning} from '../services/film-engine/engine/engine-commissioning.mjs';
import {waitForCommissioningTest,assertPrivateWatchdogLiveness,runWithPrivateWatchdog,retryPrivateRename} from './private-commissioning-observation.mjs';
import {assertPrivateModelTrialBudget} from '../services/film-engine/engine/private-model-trial-policy.mjs';
import {createPrivateTrialModelServices} from './private-trial-model-services.mjs';
import {planPrivateVideoSmoke} from './private-hunyuan-smoke-plan.mjs';
import {createFluxImageAssets} from '../services/film-engine/engine/flux-image-assets.mjs';
import {createImageQuality} from '../services/film-engine/engine/image-quality.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=path.resolve(repo,'../../work/flux-primary-gpu-round1');
const [command='status',modelId='qwen-image-edit-2511',attempt='1']=process.argv.slice(2);
const namespaces={'qwen-image-edit-2511':'qwen','wan22-i2v-a14b':'wan','hunyuanvideo15':'hunyuan','habibi-irq':'speech-habibi-irq','habibi-egy':'speech-habibi-egy','habibi-msa':'speech-habibi-msa'};
if(!['init','prepare','test','recover','status','stop'].includes(command)||!namespaces[modelId]||!/^\d{1,2}$/.test(attempt))throw Error('PRIVATE_TRIAL_COMMAND_INVALID');
const actor={id:'owner-private-flux-test',isAdmin:true},prefix=namespaces[modelId]+'-round-'+attempt;
const manifestPath=path.join(folder,prefix+'.json'),statePath=path.join(folder,prefix+'-watchdog.json');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function write(p,v){await fs.writeFile(p+'.pending',JSON.stringify(v,null,2)+'\n',{mode:0o600});await retryPrivateRename(()=>fs.rename(p+'.pending',p));}
const print=v=>process.stdout.write(JSON.stringify(v)+'\n');
async function control(mainStatus){await write(statePath+'.control.json',{mainStatus,stopRequested:true});}
let store,commissioning,registry,activeEngineId,activeTestId,cleanupPromise,paidInFlight=0;
async function readControl(){return read(statePath+'.control.json').catch(e=>{if(e.code==='ENOENT')return {};throw e;});}
async function continueAllowed(){try{const s=await read(statePath),c=await readControl();assertPrivateWatchdogLiveness(s,{control:c});}catch{throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');}}
async function stopOnlyAfterFailure(){
 const args=['-X','utf8',path.join(repo,'scripts/private-model-stop-only.py'),statePath,manifestPath,...(paidInFlight===0?['--deployment-settled']:[])];
 const result=await new Promise(resolve=>execFile(process.env.ENGINE_PYTHON||'python',args,{windowsHide:true,timeout:100000,maxBuffer:65536},(_error,stdout)=>{try{const value=JSON.parse(stdout.trim().split('\n').at(-1));resolve(value&&typeof value==='object'?value:{cloudStopped:false});}catch{resolve({cloudStopped:false});}}));
 print({phase:'private-stop-only',cloudStopped:result.cloudStopped===true,appStopConfirmed:result.appStopConfirmed===true,taskListZeroConfirmed:result.taskListZeroConfirmed===true,deploymentSettled:paidInFlight===0});return result;
}
async function stopOnGuardFailure(){
 if(cleanupPromise)return cleanupPromise;
 cleanupPromise=(async()=>{let controlError;try{await control('failed');}catch(error){controlError=error;}
  await commissioning?.close();
  // Start independent exact-App cleanup immediately, even if registry stop is
  // blocked on a still-unsettled preparation/deployment bridge operation.
  const providerStop=stopOnlyAfterFailure();
  const registryStop=(async()=>{
   if(activeEngineId&&activeTestId){
    const snapshot=await commissioning.dispatch(actor,'admin.engine.test.stop',{id:activeEngineId,testId:activeTestId,approved:true});
    if(snapshot.latestTest?.cloudStopped!==true){const native=store.get('admin-native-test',activeTestId);if(native?.engineId!==activeEngineId||!native.runId)throw Error('PRIVATE_TRIAL_STOP_UNCONFIRMED');await registry.dispatch(actor,'admin.engine.stop',{id:activeEngineId,expectedRunId:native.runId,approved:true});}
   }else if(activeEngineId&&registry)await registry.dispatch(actor,'admin.engine.stop',{id:activeEngineId,approved:true});
  })();
  const [stopped]=await Promise.allSettled([providerStop,registryStop]);
  if(controlError)throw controlError;
  if(stopped.status!=='fulfilled'||stopped.value.cloudStopped!==true)throw Error('PRIVATE_TRIAL_STOP_UNCONFIRMED');return stopped.value;
 })();return cleanupPromise;
}
try{
 store=new Store(folder,masterKey(folder,{create:false}));
 const underlying=createFluxPythonRunner({timeoutMs:1800000});
 const guarded=async(action,packet,event)=>{
  if(!['prepare','start','generate'].includes(action))return underlying(action,packet,event);
  const allowed=async()=>{const s=await read(statePath),m=await read(manifestPath),c=await readControl();assertPrivateWatchdogLiveness(s,{control:c,allowArmed:action==='prepare'});assertPrivateModelTrialBudget(s,m,{...packet,trialAction:action},Date.now(),c);};
  return runWithPrivateWatchdog(async()=>{paidInFlight++;try{return await underlying(action,action==='prepare'?{...packet,privateReuseVerifiedWeights:true}:packet,event);}finally{paidInFlight--;}},{continueAllowed:allowed,onGuardFailure:stopOnGuardFailure,onSettledAfterFailure:stopOnlyAfterFailure});
 };
 const selected=modelId==='qwen-image-edit-2511'?{...createQwenServices({store,allowPaid:true,transport:createQwenModalTransport({store,runner:guarded,allowPaid:true})}),manifest:QWEN_MANIFEST,resources:{gpu:'RTX-PRO-6000',cpu:4,ramGiB:128,minVramGiB:96,timeout:600,startupTimeout:300,idleSeconds:60}}:createPrivateTrialModelServices({modelId,store,guardedRunner:guarded,hunyuanLicenseAccepted:true});
 const flux=createFluxServices({store,allowPaid:false});
 registry=createEngineRegistry({store,adapter:createImageAdapterRouter([selected.registryAdapter,flux.registryAdapter]),allowPaid:true,licenseOptions:{hunyuanLicenseAccepted:true}});
 const runner=createAdminModelTestRunner({store,registry,adapters:{[modelId]:selected.productionAdapter},allowPaid:true});
 commissioning=createEngineCommissioning({store,registry,testRunner:runner,allowPaid:true});
 if(command==='init'){
  if(await fs.stat(manifestPath).then(()=>true).catch(()=>false))throw Error('PRIVATE_TRIAL_ALREADY_INITIALIZED');
  if(store.all('engine-runtime').some(r=>!r.cloudStopped))throw Error('PRIVATE_TRIAL_BUSY');
  const plan=await read(path.resolve(repo,'../../work/mashhad-weights-primary-20261031-attempt2/plan.json')),row=plan.models.find(r=>r.modelId===modelId);
  const credentials=JSON.parse(execFileSync('python',['-c',"import pathlib,tomllib,json;d=tomllib.loads((pathlib.Path.home()/'.modal.toml').read_text())['basm1998ali'];print(json.dumps({'tokenId':d['token_id'],'tokenSecret':d['token_secret']}))"],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}));
  if(!store.get('account',plan.accountId))store.put('account',{id:plan.accountId,name:'Primary private model validation',mode:'token',workspace:'basm1998ali',credentials:store.seal(credentials,plan.accountId)});
  let definition=store.get('engine-definition',row.engineId);
  if(!definition){definition={id:row.engineId,accountId:plan.accountId,name:'Private '+modelId+' validation',modelId,version:selected.manifest.version,...selected.resources,volume:plan.modelVolume,weightPath:`models/${modelId}/${row.engineId}`,hourMicros:3000000,revision:1};store.put('engine-definition',definition);}
  const resources=Object.fromEntries(['gpu','cpu','ramGiB','timeout','startupTimeout','idleSeconds'].map(k=>[k,definition[k]]));
  await write(manifestPath,{accountId:plan.accountId,engineId:row.engineId,modelId,workspace:'basm1998ali',appName:'mashhad-'+namespaces[modelId]+'-'+row.engineId.replaceAll('-','').slice(0,12),resources,createdAt:Date.now()});
  print({initialized:true,modelId,resources,paidOperations:0,statePath,manifestPath});
 }else{
  const m=await read(manifestPath),d=store.get('engine-definition',m.engineId),intentId=prefix+'-'+command;if(['prepare','test'].includes(command))activeEngineId=d.id;
  if(command==='prepare'){
   if(store.get('private-trial-paid-intent',intentId))throw Error('PRIVATE_TRIAL_NO_REPEAT');
   const q=await registry.dispatch(actor,'admin.engine.quote',{id:d.id,action:'prepare'});
   print({phase:'quote',missingBytes:q.missingBytes,dispatchAvailable:q.dispatchAvailable,blockers:q.blockers,estimate:q.estimate});
   if(!q.dispatchAvailable||q.missingBytes!==0)throw Error('PRIVATE_TRIAL_CACHED_WEIGHTS_REQUIRED');
   store.put('private-trial-paid-intent',{id:intentId,quoteId:q.id,createdAt:Date.now(),state:'claimed'});
   let result=await registry.dispatch(actor,'admin.engine.prepare',{id:d.id,quoteId:q.id,requestId:intentId,approved:true});
   while(result.preparation?.cloudStopped!==true){print({phase:'prepare',preparation:result.preparation});if(['failed','uncertain','cancelled'].includes(result.preparation?.status))throw Error('PRIVATE_TRIAL_PREPARATION_FAILED');await continueAllowed();await wait(5000);await continueAllowed();result=await registry.dispatch(actor,'admin.engine.status',{id:d.id});await continueAllowed();}
   if(result.preparation?.status!=='completed')throw Error('PRIVATE_TRIAL_PREPARATION_FAILED');
   print({phase:'prepare',engine:await registry.dispatch(actor,'admin.engine.inspect',{id:d.id})});
  }else if(command==='test'){
   if(store.get('private-trial-paid-intent',intentId))throw Error('PRIVATE_TRIAL_NO_REPEAT');
   let input;
   if(modelId.startsWith('habibi-')){
    const lines={'habibi-irq':'هلا بيكم، اليوم عدنا حكاية عراقية حلوة.','habibi-egy':'أهلاً بيكم، النهارده عندنا حكاية جميلة.','habibi-msa':'أهلاً بكم، اليوم نروي حكاية جميلة.'};
    const voice=await selected.createSpeechTestInput({runner,definition:d,actor,referenceDirectory:path.resolve(repo,'../../work/private-habibi-references'),text:lines[modelId],gender:'male',licensedFixturesApproved:true});input=voice.input;await write(path.join(folder,prefix+'-voice-evidence.json'),voice);
   }else{
   const sourceTest=store.get('admin-native-test','cf11c158-d442-46ef-863f-a46233a5d927');
   if(!sourceTest?.receipt?.verified)throw Error('PRIVATE_TRIAL_SOURCE_UNVERIFIED');
   const fd=store.get('engine-definition',sourceTest.engineId);
   store.audit('private_delegated_visual_review',sourceTest.id,{reviewerKind:'delegated_agent_visual',source:'owner approved sequential review; actual source image inspected'});
   if(modelId==='qwen-image-edit-2511')await runner.reviewOutput({definition:fd,input:{projectId:sourceTest.projectId,stageId:sourceTest.stageId},testId:sourceTest.id,adminId:actor.id,accept:true});
   let sourceId=sourceTest.receipt.artifacts.find(a=>a.kind==='image').id,subjectId='testshot1';
   const imageStage=store.get('production-stage',hash(sourceTest.projectId+':scene_image:testshot1'));
   if(modelId!=='qwen-image-edit-2511'){
    if(imageStage?.state!=='completed'||!imageStage.result?.assetIds?.[0])throw Error('PRIVATE_TRIAL_QWEN_RESULT_REQUIRED');sourceId=imageStage.result.assetIds[0];
    const editedTest=store.all('admin-native-test').find(t=>t.projectId===sourceTest.projectId&&t.receipt?.verified&&t.receipt.artifacts.some(a=>a.id===sourceId));
    if(!editedTest||!store.get('private-trial-visual-review',sourceId)?.approved)throw Error('PRIVATE_TRIAL_VISUAL_REVIEW_REQUIRED');
    if(modelId==='hunyuanvideo15'||modelId==='wan22-i2v-a14b'&&Number(attempt)>1){
     if(store.all('engine-runtime').some(r=>!r.cloudStopped))throw Error('PRIVATE_TRIAL_BUSY');
     const p=store.get('production-project',sourceTest.projectId),smoke=planPrivateVideoSmoke(p,{adminId:actor.id,sourceShotId:'testshot1',modelId});subjectId=smoke.shotId;
     if(smoke.changed){store.put('production-project',{...p,plan:smoke.plan,durationMs:smoke.plan.durationMs,revision:p.revision+1,updatedAt:Date.now()});store.put('private-trial-plan-review',{id:prefix,purpose:smoke.purpose,equalDurationQualityBenchmark:false,shotId:smoke.shotId,sourceShotId:smoke.sourceShotId,framePlan:smoke.framePlan,reviewerKind:'delegated_agent_visual',createdAt:Date.now()});}
     const quality=createImageQuality({store,assets:createFluxImageAssets({store})});await quality.assess({customerId:sourceTest.customerId,projectId:sourceTest.projectId,assetId:sourceId});
     print({phase:'private-smoke-plan',purpose:smoke.purpose,equalDurationQualityBenchmark:false,durationMs:1000,framePlan:smoke.framePlan});
    }
    await runner.reviewOutput({definition:store.get('engine-definition',editedTest.engineId),input:editedTest.input,testId:editedTest.id,adminId:actor.id,accept:true});
   }
   const stageId=(modelId==='qwen-image-edit-2511'?'scene_image:':'animate:')+subjectId;
   if(!store.get('production-stage',hash(sourceTest.projectId+':'+stageId)))store.put('production-stage',{id:hash(sourceTest.projectId+':'+stageId),customerId:sourceTest.customerId,projectId:sourceTest.projectId,stageId,subjectId,kind:modelId==='qwen-image-edit-2511'?'scene_image':'animate',deps:modelId==='qwen-image-edit-2511'?[]:['scene_image:testshot1'],modelId,state:'planned',attempts:0});
   input=await runner.createProject({definition:d,adminId:actor.id,input:{projectId:sourceTest.projectId,stageId,referenceIds:[sourceId]}});
   }
   const q=await commissioning.dispatch(actor,'admin.engine.test.quote',{id:d.id,input:{projectId:input.projectId,stageId:input.stageId}});
   print({phase:'test-quote',dispatchAvailable:q.dispatchAvailable,blockers:q.blockers,estimate:q.estimate});if(!q.dispatchAvailable)throw Error('PRIVATE_TRIAL_TEST_NOT_READY');
   store.put('private-trial-paid-intent',{id:intentId,quoteId:q.id,createdAt:Date.now(),state:'claimed'});
   const result=await commissioning.dispatch(actor,'admin.engine.test.execute',{id:d.id,quoteId:q.id,requestId:intentId,approved:true});
   activeTestId=result.latestTest?.id;
   const test=await waitForCommissioningTest(result,{observe:()=>commissioning.status({id:d.id,requestId:intentId},actor),continueAllowed,onGuardFailure:stopOnGuardFailure,onProgress:t=>print({phase:'test',status:t.status,progress:t.progress}),wait:()=>wait(2000)});
   if(test.status!=='needs_review'||!test.cloudStopped||!test.artifacts?.length)throw Error('PRIVATE_TRIAL_TEST_FAILED');
   const artifacts=test.artifacts.map(a=>store.get('production-asset',a.id));print({phase:'result',completed:true,cloudStopped:true,testId:test.id,artifacts});await write(path.join(folder,prefix+'-result.json'),{test,artifacts});await control('completed');
  }else if(command==='recover'){
   const link=store.get('engine-test-latest',d.id),t=link&&store.get('engine-test',link.testId);if(!t||t.adminId!==actor.id||!t.cloudStopped)throw Error('PRIVATE_TRIAL_RECOVERY_NOT_READY');
   const receipt=await runner.follow({definition:d,input:t.input,testId:t.id,adminId:actor.id});if(!receipt?.verified||!receipt.cloudStopped)throw Error('PRIVATE_TRIAL_RECOVERY_UNCONFIRMED');
   const artifacts=receipt.artifacts.map(a=>store.get('production-asset',a.id));await write(path.join(folder,prefix+'-recovered.json'),{receipt,artifacts});print({recovered:true,sameAttempt:true,gpuStarted:false,receipt,artifacts});
  }else if(command==='stop'){await control('failed');const stopped=await registry.dispatch(actor,'admin.engine.stop',{id:d.id,approved:true});print({stopRequested:true,scope:m.appName,engine:stopped});}
  else print({engine:await registry.dispatch(actor,'admin.engine.status',{id:d.id}),commissioning:await commissioning.status({id:d.id},actor)});
 }
}catch(error){if(error.message==='PRIVATE_TRIAL_WATCHDOG_STOP')await stopOnGuardFailure().catch(()=>{error.cleanupUnconfirmed=true;});if(!['init','status','recover'].includes(command))await control('failed').catch(()=>{});print({ok:false,error:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PRIVATE_TRIAL_FAILED',cleanupUnconfirmed:error.cleanupUnconfirmed===true});process.exitCode=1;}
finally{await commissioning?.close();await commissioning?.drain();store?.close();}
