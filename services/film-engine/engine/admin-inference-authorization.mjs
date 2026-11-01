import {hash} from './store.mjs';

const KEY=/^[A-Za-z0-9_-]{1,100}$/;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const adminRequestDigest=v=>hash(JSON.stringify(canonical(v))??'undefined');
const digest=adminRequestDigest;
const fail=()=>{throw Error('ENGINE_TEST_AUTHORIZATION_REQUIRED');};
const accountBinding=a=>adminRequestDigest({id:a.id,workspace:a.workspace??null,credentials:a.credentials??null,unlinked:a.unlinked===true});

// Separately scoped owner-approved private film; never a browser input flag.
// Exact text lock comes from scripts/private-afterlife-film-plan.mjs.
export const PRIVATE_AFTERLIFE_NARRATION_SHA256='51496889c92714e6f90be82ac3ec15f790e3952206a326e1ce3e44bea34d799b';
export function privateAfterlifeFilmScope({project,definition,account,adminId}){
 return adminId==='owner-private-flux-test'&&project?.adminCommissioning?.ownerId===adminId&&project.customerId===hash('film-customer:'+adminId)&&project.adminCommissioning.privateFilmId==='afterlife-20261101'&&!!definition?.accountId&&project.adminCommissioning.privateFilmAccountId===definition.accountId&&account?.id===definition.accountId&&account?.workspace==='basm1998ali'&&!!account.credentials&&!account.unlinked&&project.title==='الحياة ما بعد الموت'&&project.durationMs===30000&&project.plan?.durationMs===30000&&!project.cancelRequested&&!project.cancelledAt&&!['cancelled','cancelling','deleted'].includes(project.state);
}
export function administrativeVoicePolicy({project,definition,account,adminId,stage}){
 const ordinary={privateFilm:false,maxTextCharacters:300,maxDurationMs:10000,authorization:null},u=project?.plan?.utterances?.find(v=>v.id===stage?.subjectId);
 if(!privateAfterlifeFilmScope({project,definition,account,adminId})||definition.modelId!=='habibi-msa'||stage?.kind!=='voice'||!Array.isArray(project.plan.utterances)||project.plan.utterances.length!==1||!u||u.role!=='narration'||u.characterId!==null||!u.narratorId||u.startMs!==0||u.endMs!==30000||u.speechChunks?.length||typeof u.text!=='string'||hash(u.text)!==PRIVATE_AFTERLIFE_NARRATION_SHA256)return ordinary;
 const narrator=project.plan.narrators?.find(v=>v.id===u.narratorId);if(narrator?.voice?.engineId!=='habibi-msa'||narrator.voice.locale!=='ar-MSA')return ordinary;
 return {privateFilm:true,maxTextCharacters:600,maxDurationMs:30000,authorization:{privateFilmId:'afterlife-20261101',ownerId:adminId,accountId:definition.accountId,narrationSHA256:PRIVATE_AFTERLIFE_NARRATION_SHA256,maxTextCharacters:600,maxDurationMs:30000}};
}
function assertVoicePolicy({project,definition,account,adminId,stage,snapshot,request}){
 if(stage?.kind!=='voice')return;
 const u=project?.plan?.utterances?.find(v=>v.id===stage.subjectId),policy=administrativeVoicePolicy({project,definition,account,adminId,stage});
 if(!u||typeof u.text!=='string'||u.text.length>policy.maxTextCharacters||u.endMs-u.startMs>policy.maxDurationMs||u.endMs<=u.startMs||digest(snapshot?.privateFilmVoice??null)!==digest(policy.authorization))fail();
 if(request&&(typeof request.text!=='string'||request.text.length>policy.maxTextCharacters||policy.privateFilm&&(request.utteranceId!==u.id||hash(request.text)!==PRIVATE_AFTERLIFE_NARRATION_SHA256)))fail();
}

/** The original approved commissioning command, not a caller-supplied boolean.
 * These records are server-owned. No customer quote, charge or credit is made.
 */
export async function administrativeConsent(store,{definition,input,testId,adminId,snapshot}){
 if(!KEY.test(testId??'')||!KEY.test(adminId??'')||!snapshot||typeof snapshot!=='object')fail();
 const test=await store.get('engine-test',testId),q=test?.quoteId?await store.get('engine-test-quote',test.quoteId):null;
 const command=test?.requestId?await store.get('engine-test-command',hash('engine-test:'+adminId+':'+test.requestId)):null;
 const project=input?.projectId?await store.get('production-project',input.projectId):null;
 const saved=await store.get('engine-definition',definition.id),account=await store.get('account',definition.accountId);
 const stage=project&&input?.stageId?await store.get('production-stage',hash(project.id+':'+input.stageId)):null;
 if(!saved||digest(saved)!==digest(definition)||!account||account.unlinked||!account.credentials||!project||project.customerId!==hash('film-customer:'+adminId)||project.adminCommissioning?.ownerId!==adminId||project.cancelRequested)fail();
 if(!test||test.engineId!==definition.id||test.accountId!==definition.accountId||test.adminId!==adminId||test.settingsRevision!==definition.revision||test.status!=='running'||test.dispatched!==true||test.cloudStopped===true||digest(test.input)!==digest(input)||digest(test.runnerSnapshot)!==digest(snapshot))fail();
 if(!q||q.engineId!==definition.id||q.accountId!==definition.accountId||q.settingsRevision!==definition.revision||q.adminId!==adminId||q.usedBy!==testId||q.dispatchAvailable!==true||q.binding!==test.binding||typeof q.fingerprint!=='string'||q.expiresAt<=test.createdAt||digest(q.input)!==digest(input)||digest(q.runnerSnapshot)!==digest(snapshot))fail();
 if(!command||command.testId!==testId||command.binding!==digest([definition.id,q.id])||(await store.get('engine-test-latest',definition.id))?.testId!==testId)fail();
 assertVoicePolicy({project,definition,account,adminId,stage,snapshot});
 return {test,quote:q,project,definitionDigest:adminRequestDigest(definition),accountDigest:accountBinding(account)};
}

export function nativeFluxRequest({request,references=[]}){
 return {mode:request.mode,prompt:request.prompt,width:request.settings.width,height:request.settings.height,seed:request.settings.seed,reference_images:references.map(r=>({assetId:r.assetId,mime:r.mime,sha256:r.sha256,base64:r.bytes.toString('base64')}))};
}

export function administrativeImageGrantKind(modelId){
 return modelId==='flux2-klein-4b'?'administrative-flux-v1':modelId==='qwen-image-edit-2511'?'administrative-qwen-v1':null;
}
export function nativeAdministrativeImageRequest({modelId,...built}){
 if(!administrativeImageGrantKind(modelId))fail();
 const value=nativeFluxRequest(built);
 if(modelId==='qwen-image-edit-2511'&&(value.reference_images.length<1||value.reference_images.length>3||!['edit','multi_reference'].includes(value.mode)||value.mode==='edit'&&value.reference_images.length!==1||value.mode==='multi_reference'&&value.reference_images.length<2))fail();
 return value;
}

// Each model requires its own authority; Audar/LatentSync are excluded.
export function administrativeGrantKind(modelId){
 return administrativeImageGrantKind(modelId)??({'wan22-i2v-a14b':'administrative-wan-v1','hunyuanvideo15':'administrative-hunyuan-v1','habibi-irq':'administrative-habibi-irq-v1','habibi-egy':'administrative-habibi-egy-v1','habibi-msa':'administrative-habibi-msa-v1'}[modelId]??null);
}
export function nativeAdministrativeRequest({modelId,...built}){
 if(administrativeImageGrantKind(modelId))return nativeAdministrativeImageRequest({modelId,...built});
 if(!administrativeGrantKind(modelId))fail();
 const {request,source}=built;
 if(!request||typeof request!=='object'||Array.isArray(request))fail();
 if(['wan22-i2v-a14b','hunyuanvideo15'].includes(modelId)){
  if(!request.settings||!['image_to_video','text_to_video'].includes(request.mode)||modelId==='wan22-i2v-a14b'&&request.mode!=='image_to_video'||request.mode==='image_to_video'&&!source||request.mode==='text_to_video'&&source)fail();
  return {mode:request.mode,prompt:request.prompt,width:request.settings.width,height:request.settings.height,seed:request.settings.seed,num_frames:request.settings.num_frames,fps:request.settings.fps,reference_images:source?[{assetId:source.assetId,mime:source.mime,sha256:source.sha256,base64:source.bytes.toString('base64')}]:[]};
 }
 // Preserve the exact approved voice, text and WAV reference. All deeper
 // ownership, rights, chunk and PCM checks remain at the speech boundary.
 if(!request.referenceAudio||!request.voiceProfileId||!request.voiceProfileFingerprint||typeof request.text!=='string'||request.text.length>600)fail();
 return request;
}

/** Recheck model-specific grants at the actual transport boundary.
 * Audar and LatentSync remain excluded from administrative authority.
 */
export async function authorizeAdministrativeInference({store,definition,scope,runId,request,submission}){
 const g=await store.get('admin-native-authorization',scope.attemptId),a=await store.get('production-attempt',scope.attemptId),native=await store.get('admin-native-test',scope.attemptId);
 if(!administrativeGrantKind(definition.modelId)||!g||g.kind!==administrativeGrantKind(definition.modelId)||!a?.administrative||!native||g.testId!==scope.attemptId||g.engineId!==definition.id||g.accountId!==definition.accountId||g.modelId!==definition.modelId||g.runId!==runId||native.runId!==runId||native.engineId!==definition.id||native.accountId!==definition.accountId||native.adminId!==g.adminId||g.definitionDigest!==adminRequestDigest(definition))fail();
 const test=await store.get('engine-test',g.testId),q=g.quoteId?await store.get('engine-test-quote',g.quoteId):null,p=await store.get('production-project',scope.projectId),account=await store.get('account',definition.accountId),stage=await store.get('production-stage',hash(scope.projectId+':'+g.stageId));
 const history=await store.get('engine-runtime-history',runId),current=await store.get('engine-runtime',definition.id),command=await store.get('engine-command',hash('engine-start:'+g.testId));
 if(!p||p.id!==g.projectId||p.customerId!==scope.customerId||p.customerId!==hash('film-customer:'+g.adminId)||p.adminCommissioning?.ownerId!==g.adminId||p.cancelRequested||digest(p.plan)!==g.planFingerprint||!account||account.unlinked||accountBinding(account)!==g.accountDigest)fail();
 if(a.customerId!==scope.customerId||a.projectId!==p.id||a.stageId!==g.stageId||native.projectId!==p.id||native.customerId!==p.customerId||native.stageId!==g.stageId||adminRequestDigest(native.snapshot)!==adminRequestDigest(g.snapshot)||!stage||stage.attemptId!==g.testId||stage.customerId!==p.customerId||stage.projectId!==p.id||stage.modelId!==definition.modelId)fail();
 if(!test||test.adminId!==g.adminId||test.engineId!==g.engineId||test.accountId!==g.accountId||test.settingsRevision!==definition.revision||test.binding!==g.binding||test.quoteId!==g.quoteId||test.dispatched!==true||!['running','uncertain','needs_review','passed','failed'].includes(test.status)||!q||q.usedBy!==g.testId||q.adminId!==g.adminId||q.engineId!==g.engineId||q.accountId!==g.accountId||q.binding!==g.binding||q.dispatchAvailable!==true||adminRequestDigest(q.runnerSnapshot)!==adminRequestDigest(g.snapshot)||adminRequestDigest(test.runnerSnapshot)!==adminRequestDigest(g.snapshot)||adminRequestDigest(test.input)!==adminRequestDigest(g.input)||adminRequestDigest(q.input)!==adminRequestDigest(g.input))fail();
 const testCommand=await store.get('engine-test-command',hash('engine-test:'+g.adminId+':'+test.requestId));
 if(testCommand?.testId!==g.testId||testCommand.binding!==digest([definition.id,q.id])||(await store.get('engine-test-latest',definition.id))?.testId!==g.testId||!history||history.engineId!==g.engineId||history.accountId!==g.accountId||history.commandRequestId!==g.testId||history.rentalId||command?.runtimeId!==runId)fail();
 assertVoicePolicy({project:p,definition,account,adminId:g.adminId,stage,snapshot:g.snapshot,request:submission?request:null});
 if(submission&&(test.status!=='running'||test.cloudStopped===true||native.status!=='running'||a.status!=='running'||stage.state!=='running'||g.revoked===true||!current||current.runId!==runId||current.commandRequestId!==g.testId||current.accountId!==g.accountId||current.cloudStopped===true||current.stopRequestedAt!=null||!request||adminRequestDigest(request)!==g.nativeRequestDigest))fail();
 if(!submission&&g.revoked===true)fail();
 return {a,p};
}
