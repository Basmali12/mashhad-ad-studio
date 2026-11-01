/** Account-scoped pinned model transport (FLUX, Qwen and Wan). Importing this module performs no SDK/network work. */
import {spawn} from 'node:child_process';
import {authorizeAdministrativeInference} from './admin-inference-authorization.mjs';
import {authorizeLatentSyncRequest,validateLatentSyncResult} from './latentsync-modal-transport.mjs';
import {voiceProfileFingerprint,inspectSpeechWav} from './voice-profiles.mjs';
import {prepareNarrationText} from './speech-text.mjs';
const synthesisText=(text,profile)=>profile?.modelId?.startsWith('habibi-')&&profile.settings?.textPolicy?prepareNarrationText(text,{policy:profile.settings.textPolicy}).text:text;
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {setTimeout,clearTimeout} from 'node:timers';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const MODELS=Object.freeze({
 'latentsync16':Object.freeze({package:'latentsync',manifestPath:'latentsync/manifest.json',version:'1.6',steps:3,unit:'steps',minReferences:0,maxReferences:0,cpu:2,ramGiB:8,prepareSeconds:3600}),
 ...Object.fromEntries(['habibi-irq','habibi-egy','habibi-msa','audar-tts-v1-flash'].map(id=>[id,Object.freeze({package:'speech',namespace:'speech-'+id,manifestPath:'speech/manifests/'+id+'.json',version:id==='audar-tts-v1-flash'?'V1-Flash':'0.1.1-specialized',steps:1,unit:'chunks',minReferences:0,maxReferences:0,cpu:2,ramGiB:8,prepareSeconds:3600})])),
 'hunyuanvideo15':Object.freeze({package:'hunyuan',version:'1.5',steps:50,minReferences:0,maxReferences:1,cpu:2,ramGiB:8,prepareSeconds:3600}),
 'wan22-i2v-a14b':Object.freeze({package:'wan',version:'2.2',steps:40,minReferences:1,maxReferences:1,cpu:2,ramGiB:8,prepareSeconds:3600}),
 'flux2-klein-4b':Object.freeze({package:'flux',version:'4B',steps:4,minReferences:0,maxReferences:4,cpu:2,ramGiB:8,prepareSeconds:3600}),
 'qwen-image-edit-2511':Object.freeze({package:'qwen',version:'2511',steps:40,minReferences:1,maxReferences:3,cpu:2,ramGiB:8,prepareSeconds:3600}),
});
const ID=/^[A-Za-z0-9_-]{1,100}$/;
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(canonical(v))).digest('hex');
const fail=code=>{throw Error(code);};
const live=v=>v&&v.cloudStopped!==true;
const preparationProgress=value=>{if(!value||typeof value!=='object')return null;const result={};for(const key of ['completedBytes','totalBytes','completedFiles','totalFiles'])if(Number.isSafeInteger(value[key])&&value[key]>=0)result[key]=value[key];if(result.completedBytes>result.totalBytes||result.completedFiles>result.totalFiles)return null;if(typeof value.phase==='string'&&/^[a-z_]{1,60}$/.test(value.phase))result.phase=value.phase;return Object.keys(result).length?result:null;};
const boundRuntime=(ctx,runId,value)=>{if(!value||typeof value!=='object'||[['engineId',ctx.definition.id],['accountId',ctx.definition.accountId],['runId',runId]].some(([k,v])=>value[k]!==undefined&&value[k]!==v))fail(ctx.errorPrefix+'_RESULT_UNCONFIRMED');return {...value,engineId:ctx.definition.id,accountId:ctx.definition.accountId,runId};};
const speechAccessError=v=>/^(?:FLUX_PREPARATION_FAILED|SPEECH_(?:CODEC_AUTHORIZATION_REQUIRED|COMPONENT_ACCESS_DENIED|COMPONENT_NOT_FOUND|COMPONENT_ACCESS_UNAVAILABLE))$/.test(v??'')?v:null;
const statusResult=v=>({...((speechAccessError(v?.error))?{error:v.error}:{}),status:v?.status??'unknown',progress:preparationProgress(v?.progress),cloudStopped:v?.cloudStopped===true});
export function fluxTransportEnvironment(base=process.env){
 const env={...base};for(const k of Object.keys(env))if(k.startsWith('MODAL_')||k.startsWith('ENGINE_')||k.startsWith('PG')||k.endsWith('_API_KEY')||['DATABASE_URL','HF_TOKEN','HUGGING_FACE_HUB_TOKEN'].includes(k))delete env[k];return env;
}
export function createFluxPythonRunner({python=process.env.ENGINE_PYTHON||'python',timeoutMs=1200000}={}){
 return (action,payload,onEvent=()=>{})=>new Promise((resolve,reject)=>{
  const child=spawn(python,['-X','utf8',path.join(ROOT,'flux_modal_bridge.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:fluxTransportEnvironment()});
  const speech=Object.hasOwn(MODELS,payload.definition?.modelId)&&MODELS[payload.definition.modelId].package==='speech';
  const errorPrefix=payload.definition?.modelId==='latentsync16'?'LATENTSYNC':speech?'SPEECH':payload.definition?.modelId==='hunyuanvideo15'?'HUNYUAN':payload.definition?.modelId==='wan22-i2v-a14b'?'WAN':payload.definition?.modelId==='qwen-image-edit-2511'?'QWEN':'FLUX',responseLimit=speech?64000000:['WAN','HUNYUAN','LATENTSYNC'].includes(errorPrefix)?96000000:24000000;
  let buffer='',result,done=false,eventWork=Promise.resolve();
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(Error(error.replace(/^FLUX_/,errorPrefix+'_')));else resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish('FLUX_STATE_UNKNOWN');},timeoutMs);timer.unref?.();
  child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>responseLimit){child.kill();finish('FLUX_RESPONSE_LIMIT');return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;try{message=JSON.parse(line);}catch{continue;}if(message.type==='event')eventWork=eventWork.then(()=>onEvent(message.data)).catch(()=>{child.kill();finish('FLUX_STATE_UNKNOWN');});if(message.type==='result')result=message.data;if(message.type==='error')result={transportError:/^(?:FLUX|QWEN|WAN|HUNYUAN|SPEECH|LATENTSYNC)_[A-Z_]{1,70}$/.test(message.data?.code)?message.data.code:'FLUX_STATE_UNKNOWN'};}});
  child.once('error',()=>finish('FLUX_PYTHON_UNAVAILABLE'));
  child.once('close',code=>{eventWork.then(()=>{if(code||result===undefined||result.transportError)finish(result?.transportError||'FLUX_STATE_UNKNOWN');else finish(null,result);}).catch(()=>finish('FLUX_STATE_UNKNOWN'));});
  child.stdin.end(JSON.stringify({action,...payload})+'\n');
 });
}
export function createModelModalTransport({modelId,store,runner=createFluxPythonRunner(),allowPaid=false,licenseAccepted=false,codecLicenseAccepted=false,faceModelRightsApproved=false,rightsEvidence=null,usageMode='commercial',researchOnly=false,now=Date.now}={}){
 const prefix=modelId==='latentsync16'?'LATENTSYNC':MODELS[modelId]?.package==='speech'?'SPEECH':modelId==='hunyuanvideo15'?'HUNYUAN':modelId==='wan22-i2v-a14b'?'WAN':modelId==='qwen-image-edit-2511'?'QWEN':'FLUX';
 const fail=code=>{throw Error(code.replace(/^FLUX_/,prefix+'_'));};
 const unknown=id=>{const error=Error(prefix+'_STATE_UNKNOWN');error.operationId=id;throw error;};
 const config=MODELS[modelId],MODEL=modelId;
 if(!config)fail('FLUX_MODEL_UNSUPPORTED');if(!store)fail('FLUX_STORE_REQUIRED');
 const namespace=config.namespace??config.package,recordKind=name=>namespace+'-'+name;
 const syncRights=()=>usageMode==='noncommercial_research'&&researchOnly===true&&licenseAccepted===true&&faceModelRightsApproved===true&&typeof rightsEvidence==='string'&&rightsEvidence.trim().length>=8;
 const licenseBlocker=()=>config.package==='latentsync'&&!syncRights()?'LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED':config.package==='hunyuan'&&licenseAccepted!==true?'HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED':MODEL==='audar-tts-v1-flash'&&(licenseAccepted!==true||codecLicenseAccepted!==true)?'SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED':null;
 async function context(definition,profile){
  if(!definition?.id||!ID.test(definition.id))fail('FLUX_SCOPE_INVALID');
  const saved=await store.get('engine-definition',definition.id);
  if(!saved||saved.modelId!==MODEL||hash(saved)!==hash(definition)||saved.version!==config.version)fail('FLUX_DEFINITION_CHANGED');
  if(!['RTX-PRO-6000','L40S'].includes(saved.gpu)||!Number.isSafeInteger(saved.cpu)||saved.cpu<1||saved.cpu>64||!Number.isSafeInteger(saved.ramGiB)||saved.ramGiB<1||saved.ramGiB>1024)fail('FLUX_SCOPE_INVALID');
  if(!ID.test(saved.accountId)||!ID.test(saved.volume||'')||saved.weightPath!==`models/${MODEL}/${saved.id}`)fail('FLUX_SCOPE_INVALID');
  const manifest=JSON.parse(await readFile(path.join(ROOT,config.manifestPath??path.join(config.package,'model-manifest.json')),'utf8'));
  if(manifest.modelId!==MODEL||manifest.version!==saved.version||!manifest.revision||!Array.isArray(manifest.files)||!manifest.files.length)fail('FLUX_MANIFEST_REQUIRED');
  if(profile?.manifest&&hash(profile.manifest)!==hash(manifest))fail('FLUX_PROFILE_CHANGED');
  const account=await store.get('account',saved.accountId);
  if(!account||account.unlinked||account.mode!=='token'||!account.credentials||!ID.test(account.workspace||''))fail('FLUX_ACCOUNT_UNAVAILABLE');
  return {definition:saved,account,manifest,errorPrefix:prefix,manifestFingerprint:hash(manifest),definitionFingerprint:hash(saved),appName:'mashhad-'+namespace+'-'+saved.id.replaceAll('-','').slice(0,12),resultsVolume:'mashhad-'+namespace+'-results-'+hash(saved.id).slice(0,16)};
 }
 function packet(ctx,extra={}){
  const secrets=store.open(ctx.account.credentials,ctx.account.id);
  if(!/^ak-[A-Za-z0-9_-]{8,200}$/.test(secrets.tokenId||'')||!/^as-[A-Za-z0-9_-]{8,200}$/.test(secrets.tokenSecret||''))fail('FLUX_ACCOUNT_UNAVAILABLE');
  return {...(config.package==='latentsync'?{faceModelRightsApproved:faceModelRightsApproved===true,rightsEvidence,usageMode,researchOnly:researchOnly===true}:{}),licenseAccepted:licenseAccepted===true,codecLicenseAccepted:codecLicenseAccepted===true,credentials:{tokenId:secrets.tokenId,tokenSecret:secrets.tokenSecret,expectedWorkspace:ctx.account.workspace},definition:ctx.definition,manifest:ctx.manifest,manifestFingerprint:ctx.manifestFingerprint,appName:ctx.appName,resultsVolume:ctx.resultsVolume,...extra};
 }
 async function call(action,ctx,extra={},onEvent){return runner(action,packet(ctx,extra),onEvent);}
 function paid(approved){if(config.package==='latentsync'&&!syncRights())fail('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED');if(MODEL==='audar-tts-v1-flash'&&(licenseAccepted!==true||codecLicenseAccepted!==true))fail('SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED');if(config.package==='hunyuan'&&licenseAccepted!==true)fail('HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED');if(!allowPaid)fail('FLUX_PAID_DISABLED');if(approved!==true)fail('FLUX_APPROVAL_REQUIRED');}
 async function runtime(ctx,runId){
  if(!ID.test(runId||''))fail('FLUX_SCOPE_INVALID');const r=await store.get('engine-runtime',ctx.definition.id);
  if(!r||r.engineId!==ctx.definition.id||r.accountId!==ctx.definition.accountId||r.runId!==runId)fail('FLUX_RUN_CHANGED');return r;
 }
 async function operation(ctx,{action,runId,requestId,payload,onProgress},work){
  if(!ID.test(requestId||'')||runId&&!ID.test(runId))fail('FLUX_SCOPE_INVALID');
  const key=hash([namespace+'-operation-v1',ctx.definition.id,action,runId??null,action==='start'?runId:requestId]),fingerprint=hash([ctx.definitionFingerprint,ctx.manifestFingerprint,payload??null]);
  const admission=await store.transaction(async()=>{if(action==='generate'&&payload?.scope){const candidate=await store.get('production-attempt',payload.scope.attemptId),grant=await store.get('admin-native-authorization',payload.scope.attemptId);if(candidate?.administrative===true||grant)await authorizeAdministrativeInference({store,definition:ctx.definition,scope:payload.scope,runId,request:payload.request,submission:true});}if(['start','generate'].includes(action)){
   const owned=await store.get('engine-runtime',ctx.definition.id),admission=await store.get(recordKind('runtime'),runId);
   if(!owned||owned.runId!==runId||owned.accountId!==ctx.definition.accountId||owned.cloudStopped===true||owned.stopRequestedAt!=null||admission?.admissionClosed)fail('FLUX_ADMISSION_CLOSED');
  }
  const old=await store.get(recordKind('operation'),key);if(old){if(old.fingerprint!==fingerprint)fail('FLUX_IDEMPOTENCY_CONFLICT');return {old};}const op={id:key,engineId:ctx.definition.id,accountId:ctx.definition.accountId,action,runId:runId??null,requestId,fingerprint,state:'dispatching',createdAt:now()};await store.put(recordKind('operation'),op);return {op};});
  if(admission.old){if(admission.old.state==='completed'){if(action==='generate')return call('observe_result',ctx,{runId,requestId,scope:payload.scope});return admission.old.result;}unknown(admission.old.id);}
  const op=admission.op;
  const record=async event=>{if(event?.kind==='progress'){const p=event.progress;if(!p||!Number.isSafeInteger(p.completed)||!Number.isSafeInteger(p.total)||p.total!==config.steps||p.completed<0||p.completed>config.steps||p.unit!==(config.unit??'steps'))fail('FLUX_PROGRESS_INVALID');await store.transaction(async()=>{const current=await store.get(recordKind('operation'),key);if(current.progress&&current.progress.completed>p.completed)fail('FLUX_PROGRESS_INVALID');await store.put(recordKind('operation'),{...current,progress:{completed:p.completed,total:config.steps,unit:config.unit??'steps'}});});await onProgress?.({completed:p.completed,total:config.steps,unit:config.unit??'steps'});return;}if(event?.kind==='function_call'&&typeof event.functionCallId==='string'&&/^fc-[A-Za-z0-9_-]+$/.test(event.functionCallId)){
   const cancellation=await store.transaction(async()=>{const current=await store.get(recordKind('operation'),key);await store.put(recordKind('operation'),{...current,functionCallId:event.functionCallId,appId:event.appId??null});const admission=runId?await store.get(recordKind('runtime'),runId):null;return {closed:admission?.admissionClosed===true,prepareCancelled:current.cancelRequested===true};});
   if(action==='prepare'&&cancellation.prepareCancelled){const cancelled=await call('cancel_preparation',ctx,{operationId:op.id,requestId,functionCallId:event.functionCallId,admissionClosed:true});await store.transaction(async()=>{const current=await store.get(recordKind('operation'),key);await store.put(recordKind('operation'),{...current,cancelResult:statusResult(cancelled)});});}
   if(cancellation.closed&&['start','generate'].includes(action))await call('cancel_call',ctx,{runId,requestId,functionCallId:event.functionCallId,appId:event.appId??null,admissionClosed:true});
  }};
  try{let result=await work(record,op);const after=await store.get(recordKind('operation'),key);if(action==='prepare'&&after.cancelRequested){const cancelled=after.cancelResult??(after.functionCallId?await call('cancel_preparation',ctx,{operationId:op.id,requestId,functionCallId:after.functionCallId,admissionClosed:true}):{status:'uncertain',cloudStopped:false});result={...statusResult(cancelled),operationId:op.id,functionCallId:after.functionCallId??null,cancelRequested:true};}await store.transaction(async()=>{const current=await store.get(recordKind('operation'),key);if(['start','generate'].includes(action)&&(await store.get(recordKind('runtime'),runId))?.admissionClosed)fail('FLUX_ADMISSION_CLOSED');const {imageBase64:ignored,videoBase64:ignoredVideo,audioBase64:ignoredAudio,...safeResult}=result??{};void ignored;void ignoredVideo;void ignoredAudio;await store.put(recordKind('operation'),{...current,state:'completed',result:safeResult,finishedAt:now()});});return result;}
  catch(error){const review=config.package==='latentsync'&&/^LATENTSYNC_(?:FACE|FACE_TRACK|AUDIO_VIDEO_TIMING)_REVIEW_REQUIRED$/.test(error?.message??'');await store.transaction(async()=>{const current=await store.get(recordKind('operation'),key);await store.put(recordKind('operation'),{...current,state:review?'failed':'uncertain',error:review?error.message:prefix+'_STATE_UNKNOWN',finishedAt:now()});});if(review)throw Object.assign(Error(error.message),{needsReview:true,operationId:op.id});unknown(op.id);}
 }
 async function inspect({definition,profile}){const ctx=await context(definition,profile);return call('inspect',ctx);}
 async function prepareQuote({definition,profile}){
  const ctx=await context(definition,profile),inspection=await call('inspect',ctx);
  const codecBlocker=MODEL==='audar-tts-v1-flash'&&inspection.codecAccess?.secretConfigured!==true&&inspection.codecAuthorized!==true&&inspection.ready!==true?'AUDAR_CODEC_AUTHORIZATION_REQUIRED':null;
  const missingFiles=ctx.manifest.files.filter(f=>!inspection.files?.some(g=>g.path===f.path&&g.size===f.size&&g.verified===true&&g.sha256===f.sha256));
  const q={id:randomUUID(),engineId:definition.id,accountId:definition.accountId,definitionFingerprint:ctx.definitionFingerprint,manifestFingerprint:ctx.manifestFingerprint,expectedBytes:ctx.manifest.files.reduce((n,f)=>n+f.size,0),missingBytes:missingFiles.reduce((n,f)=>n+f.size,0),fileCount:ctx.manifest.files.length,missingFiles:missingFiles.map(f=>({path:f.path,size:f.size,sha256:f.sha256})),estimate:{resourceWindowUSD:(config.cpu*.0000131+config.ramGiB*.00000222)*config.prepareSeconds,expectedSeconds:null,windowSeconds:config.prepareSeconds,cpu:config.cpu,ramGiB:config.ramGiB,recordedUSD:null,networkUSD:null,storageUSDPerMonth:ctx.manifest.files.reduce((n,f)=>n+f.size,0)/2**30*.09,buildUSD:null,pricing:{checked:'2026-10-31',url:'https://modal.com/pricing',cpuUSDPerCoreSecond:.0000131,ramUSDPerGiBSecond:.00000222,storageUSDPerGiBMonth:.09},note:'Approved preparation may deploy the CPU worker and a GPU class with zero warm containers; image build, CPU preparation, network and persistent storage may incur charges; no GPU is started; not an invoice cap.'},deploymentRequired:inspection.deploymentReady!==true,dispatchAvailable:!licenseBlocker()&&!codecBlocker,blockers:[licenseBlocker(),codecBlocker].filter(Boolean),expiresAt:now()+300000};
  await store.put(recordKind('prepare-quote'),q);return clone(q);
 }
 async function prepare({definition,profile,quoteId,requestId,approved}){
  paid(approved);const ctx=await context(definition,profile);
  const q=await store.get(recordKind('prepare-quote'),quoteId);
  if(q?.usedBy){const prior=await store.get(recordKind('operation'),q.usedBy);if(prior?.requestId!==requestId)fail('FLUX_PREPARE_QUOTE_USED');}
  if(!q||q.engineId!==definition.id||q.accountId!==definition.accountId||q.definitionFingerprint!==ctx.definitionFingerprint||q.manifestFingerprint!==ctx.manifestFingerprint||q.expiresAt<=now()||!q.dispatchAvailable)fail('FLUX_PREPARE_QUOTE_REQUIRED');
  return operation(ctx,{action:'prepare',requestId,payload:{quoteId}},async(record,op)=>{
   await store.transaction(async()=>{const quote=await store.get(recordKind('prepare-quote'),quoteId);if(quote.usedBy&&quote.usedBy!==op.id)fail('FLUX_PREPARE_QUOTE_USED');await store.put(recordKind('prepare-quote'),{...quote,usedBy:op.id,approvedAt:now()});});
   const value=await call('prepare',ctx,{operationId:op.id,requestId,paidApproved:true,missingFiles:q.missingFiles},record);
   return {...statusResult(value),operationId:op.id,functionCallId:value.functionCallId??null};
  });
 }
 async function observePreparation({definition,profile,operationId}){
  const ctx=await context(definition,profile),op=await store.get(recordKind('operation'),operationId);
  if(!op||op.engineId!==definition.id||op.accountId!==definition.accountId||op.action!=='prepare')fail('FLUX_SCOPE_INVALID');
  if(!op.functionCallId)fail('FLUX_STATE_UNKNOWN');
  if(op.cancelRequested)return cancelPreparation({definition,profile,operationId,approved:true});
  const value=await call('observe_preparation',ctx,{operationId,functionCallId:op.functionCallId,requestId:op.requestId});
  return {...statusResult(value),operationId,progress:preparationProgress(value.progress),...(value.inspection?{inspection:value.inspection}:{})};
 }
 async function cancelPreparation({definition,profile,operationId,approved}){
  if(approved!==true)fail('FLUX_APPROVAL_REQUIRED');const ctx=await context(definition,profile);
  let op=await store.get(recordKind('operation'),operationId);if(!op||op.engineId!==definition.id||op.accountId!==definition.accountId||op.action!=='prepare')fail('FLUX_SCOPE_INVALID');
  await store.transaction(async()=>{op=await store.get(recordKind('operation'),operationId);await store.put(recordKind('operation'),{...op,cancelRequested:true,cancelRequestedAt:now()});});
  if(!op.functionCallId)return {operationId,status:'uncertain',progress:null,cloudStopped:false,cancelRequested:true};
  const result=await call('cancel_preparation',ctx,{operationId,requestId:op.requestId,functionCallId:op.functionCallId,admissionClosed:true});return {...statusResult(result),operationId,cancelRequested:true};
 }
 async function start({definition,profile,runId,requestId=runId,approved}){
  paid(approved);const ctx=await context(definition,profile),r=await runtime(ctx,runId);
  if(!live(r)||r.stopRequestedAt!=null||!(await store.all('engine-command')).some(c=>c.runtimeId===runId))fail('FLUX_START_NOT_AUTHORIZED');
  return operation(ctx,{action:'start',runId,requestId,payload:{}},async(record)=>{
   await store.transaction(async()=>{const old=await store.get(recordKind('runtime'),runId);if(old?.admissionClosed)fail('FLUX_ADMISSION_CLOSED');await store.put(recordKind('runtime'),{id:runId,engineId:definition.id,accountId:definition.accountId,admissionClosed:false,requestId,createdAt:now()});});
   const result=await call('start',ctx,{runId,requestId,paidApproved:true},record);
   await store.transaction(async()=>{const old=await store.get(recordKind('runtime'),runId);await store.put(recordKind('runtime'),{...old,functionCallId:result.functionCallId,appId:result.appId??null});});
   return boundRuntime(ctx,runId,result);
  });
 }
 async function observe({definition,profile,runId}){
  const ctx=await context(definition,profile),r=await runtime(ctx,runId),local=await store.get(recordKind('runtime'),runId);
  if(local?.admissionClosed)return stop({definition,profile,runId,approved:true});
  const operations=(await store.all(recordKind('operation'))).filter(o=>o.engineId===definition.id&&o.runId===runId);
  const ids=[...new Set(operations.map(o=>o.functionCallId).filter(Boolean))];
  const value=boundRuntime(ctx,runId,await call('observe',ctx,{runId,requestId:local?.requestId??runId,functionCallId:local?.functionCallId??null,functionCallIds:ids,appId:local?.appId??null,admissionClosed:local?.admissionClosed===true,pendingUnknown:(!local&&!ids.length)||operations.some(o=>!o.functionCallId&&['dispatching','uncertain'].includes(o.state)),knownStopped:r.cloudStopped===true}));
  if(value.cloudStopped===true&&value.admissionClosed===true&&value.activeTasks===0)await store.transaction(async()=>{const old=await store.get(recordKind('runtime'),runId);await store.put(recordKind('runtime'),{...old,id:runId,engineId:definition.id,accountId:definition.accountId,admissionClosed:true,idleStoppedAt:now()});});
  return value;
 }
 async function stop({definition,profile,runId,approved}){
  if(approved!==true)fail('FLUX_APPROVAL_REQUIRED');const ctx=await context(definition,profile);await runtime(ctx,runId);
  await store.transaction(async()=>{const old=await store.get(recordKind('runtime'),runId);await store.put(recordKind('runtime'),{...old,id:runId,engineId:definition.id,accountId:definition.accountId,admissionClosed:true,stopRequestedAt:now()});});
  const local=await store.get(recordKind('runtime'),runId),operations=(await store.all(recordKind('operation'))).filter(o=>o.engineId===definition.id&&o.runId===runId);
  const result=await call('stop',ctx,{runId,appId:local.appId??null,functionCallIds:operations.map(o=>o.functionCallId).filter(Boolean),admissionClosed:true,pendingUnknown:operations.some(o=>!o.functionCallId&&['dispatching','uncertain'].includes(o.state))});
  return boundRuntime(ctx,runId,result);
 }
 async function generationContext({definition,profile,runId,scope,requestId,approved,request},requireSubmission=true){
  if(requireSubmission)paid(approved);const ctx=await context(definition,profile);if(requireSubmission)await runtime(ctx,runId);else{const old=await store.get('engine-runtime-history',runId),savedRun=(await store.all('production-model-run')).find(r=>r.runId===runId&&r.engineId===definition.id&&r.accountId===definition.accountId);if(!old&&!savedRun||old&&(old.engineId!==definition.id||old.accountId!==definition.accountId))fail('FLUX_RUN_CHANGED');}
  if(!scope||!['customerId','projectId','attemptId'].every(k=>ID.test(scope[k]||''))||requestId!==scope.attemptId)fail('FLUX_SCOPE_INVALID');
  const a=await store.get('production-attempt',scope.attemptId);
  if(a?.administrative===true){const authorized=await authorizeAdministrativeInference({store,definition:ctx.definition,scope,runId,request,submission:requireSubmission});return {ctx,...authorized};}
  const p=await store.get('production-project',scope.projectId),q=typeof a?.quoteId==='string'?await store.get('production-quote',a.quoteId):null,charge=typeof a?.chargeId==='string'?await store.get('production-charge',a.chargeId):null,run=await store.get('production-model-run',scope.attemptId),local=await store.get(recordKind('runtime'),runId);
  if(!p||p.customerId!==scope.customerId||!a||a.customerId!==scope.customerId||a.projectId!==p.id||!q?.approved||q.customerId!==scope.customerId||q.projectId!==p.id||!charge||charge.attemptId!==a.id||charge.customerId!==scope.customerId||charge.projectId!==p.id||!run||run.runId!==runId||run.engineId!==definition.id||run.accountId!==definition.accountId)fail('FLUX_GENERATION_NOT_AUTHORIZED');
  if(requireSubmission&&(p.cancelRequested||a.status!=='running'||charge.state!=='submitted'||local?.admissionClosed))fail('FLUX_GENERATION_NOT_AUTHORIZED');
  return {ctx,a,p};
 }
 async function generateSpeech(input,{ctx,p,a}){
  const {runId,scope,requestId}=input,request=input.request;
  const allowed=['text','referenceTranscript','voiceProfileId','voiceProfileFingerprint','characterId','narrator','utteranceId','locale','expression','referenceAudio','seed','narratorId','speakingRate'];
  if(!request||Object.keys(request).some(k=>!allowed.includes(k))||typeof request.text!=='string'||!request.text.trim()||request.text.length>600||Buffer.byteLength(request.text,'utf8')>1200||['\0','[',']','<|','|>'].some(v=>request.text.includes(v))||typeof request.referenceTranscript!=='string'||!request.referenceTranscript.trim()||request.referenceTranscript.length>2000||['\0','<|','|>'].some(v=>request.referenceTranscript.includes(v))||!ID.test(request.voiceProfileId||'')||!ID.test(request.utteranceId||'')||typeof request.narrator!=='boolean'||request.characterId!==null&&!ID.test(request.characterId||''))fail('SPEECH_REQUEST_INVALID');
  const profile=await store.get('voice-profile',request.voiceProfileId),binding=await store.get('voice-profile-binding',hash('voice-binding:'+scope.projectId+':'+(request.narrator?'narrator:'+(profile?.narratorId??'narrator'):request.characterId)));
  const localeByModel={'habibi-irq':'ar-IQ','habibi-egy':'ar-EG','habibi-msa':'ar-MSA','audar-tts-v1-flash':['ar','en']};
  if(!profile||profile.approved!==true||profile.customerId!==scope.customerId||profile.projectId!==scope.projectId||profile.modelId!==MODEL||profile.version!==ctx.definition.version||profile.revision!==ctx.manifest.revision||profile.locale!==request.locale||!(Array.isArray(localeByModel[MODEL])?localeByModel[MODEL]:[localeByModel[MODEL]]).includes(request.locale)||profile.characterId!==request.characterId||profile.narrator!==request.narrator||profile.fingerprint!==request.voiceProfileFingerprint||voiceProfileFingerprint(profile)!==profile.fingerprint||profile.referenceTranscript!==request.referenceTranscript||binding?.profileId!==profile.id||binding.fingerprint!==profile.fingerprint||binding.customerId!==scope.customerId||binding.projectId!==scope.projectId)fail('SPEECH_VOICE_PROFILE_INVALID');
  const utterance=p.plan?.utterances?.find(u=>u.id===request.utteranceId),speaker=request.narrator?p.plan?.narrators?.find(n=>n.id===utterance?.narratorId):p.plan?.characters?.find(c=>c.id===request.characterId),stage=(await store.all('production-stage')).find(s=>s.projectId===p.id&&s.stageId===a.stageId&&s.attemptId===a.id);
  const chunk=stage?.chunkIndex==null?null:utterance?.speechChunks?.find(c=>c.index===stage.chunkIndex),expectedText=utterance?synthesisText(chunk?.text??utterance.text,profile):undefined,expectedExpression=chunk?.expression??utterance?.expression??'neutral',expectedSeed=((profile.settings?.seed??42)+(stage?.chunkIndex??0))%4294967296;
  if(!utterance||!stage||stage.kind!=='voice'||stage.subjectId!==request.utteranceId||stage.chunkIndex!=null&&!chunk||expectedText!==request.text||utterance.characterId!==request.characterId||!!utterance.narratorId!==request.narrator||request.narrator&&(profile.narratorId??'narrator')!==utterance.narratorId||request.narratorId!==undefined&&request.narratorId!==utterance.narratorId||!speaker||![speaker.voice?.profileId,speaker.voice?.voiceId].includes(profile.id)||request.expression!==expectedExpression||!['neutral','laughs','curious','excited','sighs','exhales','mischievously','whispers','sarcastic'].includes(request.expression)||MODEL!=='audar-tts-v1-flash'&&request.expression!=='neutral'||!Number.isSafeInteger(request.seed)||request.seed!==expectedSeed||!/[\p{L}]/u.test(request.text))fail('SPEECH_UTTERANCE_INVALID');
  if((request.speakingRate??1)!==(profile.settings?.speakingRate??1)||!Number.isFinite(request.speakingRate??1)||(request.speakingRate??1)<0.85||(request.speakingRate??1)>1.15||MODEL==='audar-tts-v1-flash'&&(request.speakingRate??1)!==1)fail('SPEECH_VOICE_PROFILE_INVALID');
  const ref=request.referenceAudio,reference=ref?await store.get('voice-reference',ref.assetId):null;
  if(!ref||Object.keys(ref).some(k=>!['assetId','mime','base64','sha256'].includes(k))||ref.assetId!==profile.referenceAssetId||ref.mime!=='audio/wav'||ref.sha256!==profile.referenceSHA256||typeof ref.base64!=='string'||ref.base64.length>1400000||! /^[A-Za-z0-9+/]+={0,2}$/.test(ref.base64)||!reference||reference.customerId!==scope.customerId||reference.sha256!==ref.sha256||reference.transcript!==profile.referenceTranscript||reference.rightsAttestation?.confirmed!==true||!['consent','licensed'].includes(reference.rightsAttestation?.kind))fail('SPEECH_REFERENCE_INVALID');
  const bytes=Buffer.from(ref.base64,'base64');if(bytes.length>1048576||bytes.toString('base64')!==ref.base64||hash(bytes)!==ref.sha256)fail('SPEECH_REFERENCE_INVALID');
  const wav=inspectSpeechWav(bytes,{maxBytes:1048576,minDurationMs:5000,maxDurationMs:12000});if(wav.sampleRate!==16000||wav.channels!==1||wav.samples<80000||wav.samples>192000||reference.bytes!==bytes.length||['sampleRate','channels','samples','durationMs'].some(k=>reference[k]!==wav[k]))fail('SPEECH_REFERENCE_INVALID');
  const value=Object.fromEntries(Object.entries(request).filter(([k])=>!['referenceAudio','narratorId'].includes(k)));
  const result=await operation(ctx,{action:'generate',runId,requestId,payload:{scope,request},onProgress:input.onProgress},record=>call('generate',ctx,{runId,requestId,scope,request:{...value,referenceSHA256:ref.sha256},referenceAudioBase64:ref.base64,paidApproved:true},record));
  await validateSpeechResult(ctx,input,{p,a},result);return {...result,engineId:ctx.definition.id,accountId:ctx.definition.accountId,runId,scope:{...scope,...result.scope}};
 }
 async function validateSpeechResult(ctx,input,{p,a},result){
  const m=result?.metadata,scope=input.scope;if(!m||result.modelRevision!==ctx.manifest.revision||result.scope?.engineId!==ctx.definition.id||result.scope?.accountId!==ctx.definition.accountId||result.scope?.runId!==input.runId||result.scope?.requestId!==input.requestId||m.modelId!==MODEL||m.version!==ctx.definition.version||m.revision!==ctx.manifest.revision)fail('SPEECH_RESULT_SCOPE_INVALID');
  const profile=await store.get('voice-profile',m.voiceProfileId),u=p.plan?.utterances?.find(v=>v.id===m.utteranceId),stage=(await store.all('production-stage')).find(s=>s.projectId===p.id&&s.stageId===a.stageId&&s.attemptId===a.id),chunk=stage?.chunkIndex==null?null:u?.speechChunks?.find(c=>c.index===stage.chunkIndex),speaker=m.narrator?p.plan?.narrators?.find(n=>n.id===u?.narratorId):p.plan?.characters?.find(c=>c.id===m.characterId);
  if(!profile||!u||!stage||stage.kind!=='voice'||stage.subjectId!==u.id||stage.chunkIndex!=null&&!chunk||profile.customerId!==scope.customerId||profile.projectId!==scope.projectId||profile.approved!==true||voiceProfileFingerprint(profile)!==profile.fingerprint||profile.fingerprint!==m.voiceProfileFingerprint||profile.modelId!==MODEL||profile.version!==ctx.definition.version||profile.revision!==ctx.manifest.revision||profile.characterId!==m.characterId||profile.narrator!==m.narrator||profile.locale!==m.locale||u.characterId!==m.characterId||!!u.narratorId!==m.narrator||m.narrator&&(profile.narratorId??'narrator')!==u.narratorId||!speaker||![speaker.voice?.profileId,speaker.voice?.voiceId].includes(profile.id)||m.textSHA256!==hash(synthesisText(chunk?.text??u.text,profile))||m.referenceSHA256!==profile.referenceSHA256||m.referenceTranscriptSHA256!==hash(profile.referenceTranscript)||m.expression!==(chunk?.expression??u.expression??'neutral')||m.seed!==((profile.settings?.seed??42)+(stage.chunkIndex??0))%4294967296)fail('SPEECH_RESULT_SCOPE_INVALID');
  if((m.speakingRate??1)!==(profile.settings?.speakingRate??1))fail('SPEECH_RESULT_SCOPE_INVALID');
  if(typeof result.audioBase64!=='string'||result.audioBase64.length>45000000||! /^[A-Za-z0-9+/]+={0,2}$/.test(result.audioBase64))fail('SPEECH_RESULT_INVALID');const bytes=Buffer.from(result.audioBase64,'base64'),wav=inspectSpeechWav(bytes,{maxBytes:32*1024*1024,minDurationMs:1,maxDurationMs:120000});if(bytes.toString('base64')!==result.audioBase64||hash(bytes)!==result.sha256||m.sha256!==result.sha256||wav.sampleRate!==24000||wav.channels!==1||wav.samples!==m.numSamples||Math.abs(wav.durationMs-m.durationMs)>1)fail('SPEECH_RESULT_INVALID');
 }
 async function generate(input){
  const generation=await generationContext(input),{ctx}=generation,{runId,scope,requestId}=input,request=input.request;
  if(config.package==='speech')return generateSpeech(input,generation);
  if(config.package==='latentsync'){const proof=await authorizeLatentSyncRequest({store,request,scope,attempt:generation.a,project:generation.p}),proofRow={id:requestId,customerId:scope.customerId,projectId:scope.projectId,engineId:ctx.definition.id,accountId:ctx.definition.accountId,runId,request:proof,fingerprint:hash(proof)};await store.transaction(async()=>{const old=await store.get('latentsync-input-proof',requestId);if(old&&old.fingerprint!==proofRow.fingerprint)fail('LATENTSYNC_IDEMPOTENCY_CONFLICT');if(!old)await store.put('latentsync-input-proof',proofRow);});const result=await operation(ctx,{action:'generate',runId,requestId,payload:{scope,request},onProgress:input.onProgress},record=>call('generate',ctx,{runId,requestId,scope,request,paidApproved:true},record));validateLatentSyncResult({result,request:proof,manifest:ctx.manifest,scope,runId,definition:ctx.definition,audioDurationMs:(await store.get('production-asset',proof.audio.assetId)).durationMs});return {...result,engineId:ctx.definition.id,accountId:ctx.definition.accountId,runId,scope:{...scope,...result.scope}};}
  if(!request||typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>12000||request.prompt.includes('\0')||!Number.isSafeInteger(request.width)||!Number.isSafeInteger(request.height)||request.width<256||request.height<256||request.width>2048||request.height>2048||request.width%16||request.height%16||request.width*request.height>2048*1536||!Number.isSafeInteger(request.seed)||request.seed<0||request.seed>2147483647||Object.keys(request).some(k=>!(['wan','hunyuan'].includes(config.package)?['prompt','width','height','seed','mode','reference_images','num_frames','fps']:['prompt','width','height','seed','mode','reference_images']).includes(k)))fail('FLUX_REQUEST_INVALID');
  if(config.package==='qwen'&&![[720,1280],[1280,720]].some(([w,h])=>request.width===w&&request.height===h))fail('FLUX_REQUEST_INVALID');
  const refs=request.reference_images??[],mode=request.mode??(config.package==='hunyuan'?'text_to_video':config.package==='wan'?'image_to_video':config.minReferences?'edit':'text_to_image');
  if(!Array.isArray(refs)||refs.length<config.minReferences||refs.length>config.maxReferences||!(config.package==='hunyuan'?['text_to_video','image_to_video']:config.package==='wan'?['image_to_video']:['text_to_image','edit','multi_reference']).includes(mode)||config.minReferences>0&&mode==='text_to_image'||mode==='text_to_image'&&refs.length||mode==='edit'&&refs.length!==1||mode==='multi_reference'&&(refs.length<2||refs.length>config.maxReferences))fail('FLUX_REFERENCE_INVALID');
  if(config.package==='hunyuan'&&(mode==='text_to_video'&&refs.length!==0||mode==='image_to_video'&&refs.length!==1))fail('FLUX_REFERENCE_INVALID');
  const referenceImagesBase64=[];
  for(const ref of refs){
   if(!ref||Object.keys(ref).some(k=>!['assetId','mime','base64','sha256'].includes(k))||!ID.test(ref.assetId||'')||!['image/png','image/jpeg','image/webp'].includes(ref.mime)||typeof ref.base64!=='string'||ref.base64.length>5600000||! /^[A-Za-z0-9+/]+={0,2}$/.test(ref.base64))fail('FLUX_REFERENCE_INVALID');
   const bytes=Buffer.from(ref.base64,'base64');if(bytes.length<16||bytes.length>4000000||bytes.toString('base64')!==ref.base64||hash(bytes)!==ref.sha256)fail('FLUX_REFERENCE_INVALID');
   const png=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpeg=bytes[0]===255&&bytes[1]===216,webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
   if(ref.mime==='image/png'&&!png||ref.mime==='image/jpeg'&&!jpeg||ref.mime==='image/webp'&&!webp)fail('FLUX_REFERENCE_INVALID');
   const asset=await store.get('production-asset',ref.assetId),retained=await store.get('film-reference-retained',ref.assetId),binding=await store.get('production-reference-binding',hash('retained-image-reference:'+scope.customerId+':'+ref.assetId));
   const ownedAsset=asset&&asset.kind==='image'&&asset.status==='completed'&&asset.customerId===scope.customerId&&asset.projectId===scope.projectId&&asset.sha256===ref.sha256;
   const ownedUpload=retained?.customerId===scope.customerId&&binding?.customerId===scope.customerId&&binding.referenceId===ref.assetId&&binding.sha256===ref.sha256;
   if(!ownedAsset&&!ownedUpload)fail('FLUX_REFERENCE_NOT_OWNED');referenceImagesBase64.push(ref.base64);
  }
  const value={prompt:request.prompt,width:request.width,height:request.height,seed:request.seed,mode};
  if(['wan','hunyuan'].includes(config.package)){const grids=config.package==='hunyuan'?(mode==='image_to_video'?[[480,832],[848,480],[720,1264],[1280,720]]:[[480,848],[848,480],[720,1280],[1280,720]]):[[480,832],[832,480],[720,1280],[1280,720]],maxFrames=config.package==='hunyuan'?121:81,fps=config.package==='hunyuan'?24:16;if(!grids.some(([w,h])=>request.width===w&&request.height===h))fail('FLUX_REQUEST_INVALID');if(!Number.isSafeInteger(request.num_frames)||request.num_frames<5||request.num_frames>maxFrames||(request.num_frames-1)%4||request.fps!==fps)fail('FLUX_REQUEST_INVALID');Object.assign(value,{num_frames:request.num_frames,fps:request.fps});}
  const result=await operation(ctx,{action:'generate',runId,requestId,payload:{scope,request},onProgress:input.onProgress},record=>call('generate',ctx,{runId,requestId,scope,request:value,referenceImagesBase64,paidApproved:true},record));return {...result,engineId:ctx.definition.id,accountId:ctx.definition.accountId,runId,scope:{...scope,...result.scope}};
 }
 async function observeResult(input){
  const generation=await generationContext(input,false),{ctx}=generation;const result=await call('observe_result',ctx,{runId:input.runId,requestId:input.requestId,scope:input.scope});if(config.package==='speech')await validateSpeechResult(ctx,input,generation,result);if(config.package==='latentsync'){const proof=await store.get('latentsync-input-proof',input.requestId);if(!proof||proof.customerId!==input.scope.customerId||proof.projectId!==input.scope.projectId||proof.engineId!==ctx.definition.id||proof.accountId!==ctx.definition.accountId||proof.runId!==input.runId)fail('LATENTSYNC_RESULT_SCOPE_INVALID');validateLatentSyncResult({result,request:proof.request,manifest:ctx.manifest,scope:input.scope,runId:input.runId,definition:ctx.definition,audioDurationMs:(await store.get('production-asset',proof.request.audio.assetId)).durationMs});}return {...result,engineId:ctx.definition.id,accountId:ctx.definition.accountId,runId:input.runId,scope:{...input.scope,...result.scope}};
 }
 return {inspect,prepareQuote,prepare,observePreparation,cancelPreparation,start,observe,stop,generate,observeResult};
}

// Compatibility entry point: the caller cannot change this adapter's model.
export function createFluxModalTransport(options={}){return createModelModalTransport({...options,modelId:'flux2-klein-4b'});}
