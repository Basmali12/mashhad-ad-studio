/* global structuredClone, AbortController */
import {hash,id} from './store.mjs';

const KEY=/^[A-Za-z0-9_-]{1,100}$/;
const SHA=/^[a-f0-9]{64}$/;
const active=s=>['queued','running','uncertain'].includes(s?.status)&&s.cloudStopped!==true;
const fail=code=>{throw Error(code);};
const safeKey=v=>KEY.test(v??'')?v:fail('INVALID_ENGINE_TEST_INPUT');
const clone=v=>structuredClone(v);
const digest=v=>hash(JSON.stringify(v));
function sample(value={}){if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>16000)fail('INVALID_ENGINE_TEST_INPUT');return clone(value);}
const estimateValue=v=>Number.isSafeInteger(v)&&v>=0;
const progressValue=v=>v&&Number.isSafeInteger(v.completed)&&Number.isSafeInteger(v.total)&&v.total>0&&v.completed>=0&&v.completed<=v.total&&['steps','frames','samples','bytes','items'].includes(v.unit);

/** Real administrative commissioning seam. Provider dispatch is supplied by the
 * trusted native runner, never by HTTP evidence or publication flags. Local
 * tests inject fake runners; a browser cannot declare its own test successful.
 */
export function createEngineCommissioning({store,registry,policyFor=key=>registry.describe(key),testRunner=null,now=Date.now,allowPaid=false,onPublish=async()=>{},onUnpublish=async()=>{}}){
 const pending=new Set(),inFlight=new Set(),signals=new Map();
 let closed=false;
 const definition=async key=>{safeKey(key);const value=await store.get('engine-definition',key);if(!value)fail('NOT_FOUND');return value;};
 const policy=async e=>{const p=await policyFor(e.id);if(!p||p.id!==e.id||p.accountId!==e.accountId||p.revision!==e.revision||typeof p.fingerprint!=='string')fail('ENGINE_CONFIG_CHANGED');return p;};
 const ready=p=>({filesReady:p.inspection?.filesReady===true||p.filesReady===true,environmentReady:p.inspection?.environmentReady===true||p.environmentReady===true});
 function blockers(e,p,{includeExecution=true}={}){
  const flags=ready(p),b=[];
  if(!flags.filesReady)b.push('ENGINE_NOT_READY');
  if(!flags.environmentReady)b.push('ENGINE_DEPLOYMENT_REQUIRED');
  if(p.license?.allowed!==true)b.push(...(p.license?.blockers?.length?p.license.blockers:['ENGINE_LICENSE_REQUIRED']));
  if(p.runtimeStopped!==true)b.push('ENGINE_BUSY');
  if(includeExecution&&allowPaid!==true)b.push('PAID_DISABLED');
  if(!testRunner?.quote||!testRunner?.execute)b.push('ENGINE_TEST_RUNNER_UNAVAILABLE');
  if(!e.version||!p.manifestRevision||!p.softwareVersion||!p.dependenciesFingerprint)b.push('ENGINE_ENVIRONMENT_UNVERIFIED');
  return [...new Set(b)];
 }
 const binding=(e,p)=>digest({engineId:e.id,accountId:e.accountId,revision:e.revision,fingerprint:p.fingerprint,manifestRevision:p.manifestRevision,softwareVersion:p.softwareVersion,dependenciesFingerprint:p.dependenciesFingerprint,licenseEvidence:p.license?.evidenceDigest??null});
 const latest=async e=>{const link=await store.get('engine-test-latest',e.id);return link?await store.get('engine-test',link.testId):null;};
 const publicTest=t=>t?{id:t.id,requestId:t.requestId??null,projectId:t.input?.projectId??null,stageId:t.input?.stageId??null,engineId:t.engineId,accountId:t.accountId,settingsRevision:t.settingsRevision,status:t.status,cloudStopped:t.cloudStopped===true,progress:t.progress??null,error:t.error??null,artifacts:(t.artifacts??[]).map(a=>Object.fromEntries(['id','kind','sha256','mime','bytes','durationMs','width','height'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))),reviewed:t.reviewed===true,accepted:t.accepted===true,estimatedMicroUSD:t.estimatedMicroUSD,recordedProviderUSD:t.recordedProviderUSD??null,createdAt:t.createdAt,finishedAt:t.finishedAt??null}:null;
 async function snapshot(e,test){
  const p=await policy(e),flags=ready(p),t=test??await latest(e),approval=await store.get('engine-approval',e.id),currentBinding=binding(e,p),validTest=t?.binding===currentBinding,currentProof=flags.filesReady&&flags.environmentReady&&p.license?.allowed===true,approved=currentProof&&!!approval&&approval.binding===currentBinding&&approval.testId===t?.id&&t?.status==='passed'&&t.accepted===true,published=e.publication?.approved===true&&e.publication.tested===true&&e.publication.revision===e.revision&&e.publication.binding===currentBinding&&approved;
  const prep=await store.get('engine-preparation',e.id);
  let workflowState=!flags.filesReady?(prep?.cloudStopped===false?'preparing':'needs_preparation'):!flags.environmentReady?'files_ready':'awaiting_test';
  if(validTest){if(t.status==='needs_review')workflowState='needs_review';else if(t.status==='passed')workflowState='test_passed';else if(['failed','uncertain','cancelled'].includes(t.status))workflowState=t.status;else workflowState='testing';}
  if(approved)workflowState='approved';if(published)workflowState='published';
  return {engineId:e.id,settingsRevision:e.revision,workflowState,...flags,license:{allowed:p.license?.allowed===true,blockers:p.license?.blockers??[]},blockers:blockers(e,p,{includeExecution:false}),latestTest:publicTest(t),testCurrent:validTest,approval:{approved,testId:approved?approval.testId:null},publication:{published,approved:published,tested:published,revision:published?e.revision:null,testId:published?t.id:null}};
 }
 async function quote(actor,input){
  const e=await definition(input.id),p=await policy(e),testInput=sample(input.input),b=blockers(e,p),current=await latest(e);if(active(current))b.push('ENGINE_BUSY');
  const result=testRunner?.quote?await testRunner.quote({definition:e,input:testInput,adminId:actor.id}):null;
  if(result?.available!==true)b.push(...(result?.blockers?.length?result.blockers:['ENGINE_TEST_UNAVAILABLE']));
  const estimatedMicroUSD=result?.estimatedMicroUSD??null;if(!estimateValue(estimatedMicroUSD))b.push('ENGINE_TEST_ESTIMATE_UNAVAILABLE');
  const q={id:id(),engineId:e.id,accountId:e.accountId,settingsRevision:e.revision,adminId:actor.id,input:testInput,runnerSnapshot:result?.snapshot??null,binding:binding(e,p),fingerprint:p.fingerprint,estimatedMicroUSD,estimate:result?.estimate??{resourceWindowUSD:null,recordedUSD:null,note:'التقدير غير متاح؛ لا يبدأ اختبار.'},expiresAt:now()+300000,dispatchAvailable:!b.length,blockers:[...new Set(b)],createdAt:now()};
  await store.put('engine-test-quote',q);
  return {id:q.id,engineId:q.engineId,settingsRevision:q.settingsRevision,estimatedMicroUSD:q.estimatedMicroUSD,estimate:q.estimate,expiresAt:q.expiresAt,dispatchAvailable:q.dispatchAvailable,blockers:q.blockers};
 }
 async function recordReceipt(testId,receipt,{localRecovery=false}={}){
  return store.transaction(async()=>{
   const t=await store.get('engine-test',testId);if(!t)return;
   const adoptingLocal=localRecovery===true&&t.status==='failed'&&t.dispatched===true&&t.cloudStopped===true&&!t.verified&&t.reviewed!==true&&t.accepted!==true&&!t.cancelRequested&&!t.cancelledAt;
   if(['passed','failed','cancelled','needs_review'].includes(t.status)&&!adoptingLocal)return;
   const scoped=receipt?.testId===t.id&&receipt.engineId===t.engineId&&receipt.accountId===t.accountId&&receipt.settingsRevision===t.settingsRevision;
   const verified=scoped&&receipt.verified===true&&receipt.cloudStopped===true&&Array.isArray(receipt.artifacts)&&receipt.artifacts.length>0&&receipt.artifacts.length<=32&&receipt.artifacts.every(a=>KEY.test(a.id??'')&&['image','video','audio','alignment'].includes(a.kind)&&SHA.test(a.sha256??'')&&(!Object.hasOwn(a,'bytes')||Number.isSafeInteger(a.bytes)&&a.bytes>0));
   if(!verified){t.status=scoped&&receipt.cloudStopped===true?'failed':'uncertain';t.cloudStopped=scoped&&receipt.cloudStopped===true;t.error='ENGINE_TEST_OUTPUT_UNVERIFIED';}
   else{t.status='needs_review';t.cloudStopped=true;t.verified=true;t.artifacts=clone(receipt.artifacts);t.error=null;t.finishedAt=now();t.receiptHash=digest(receipt);t.runId=receipt.runId??null;t.recordedProviderUSD=Number.isFinite(receipt.recordedProviderUSD)&&receipt.recordedProviderUSD>=0?receipt.recordedProviderUSD:null;}
   await store.put('engine-test',t);
  });
 }
 async function recordError(testId,cause){await store.transaction(async()=>{const t=await store.get('engine-test',testId);if(!t||['passed','cancelled','needs_review'].includes(t.status))return;const stopped=(cause?.definitiveNoSpend===true||cause?.executionFailed===true)&&cause?.cloudStopped===true;t.status=stopped?'failed':'uncertain';t.cloudStopped=stopped;t.error=stopped?'ENGINE_TEST_FAILED':'ENGINE_TEST_STATE_UNKNOWN';t.finishedAt=stopped?now():null;await store.put('engine-test',t);});}
 function launch(e,t){
  const controller=new AbortController();signals.set(t.id,controller);inFlight.add(t.id);
  const work=(async()=>{
   const claimed=await store.transaction(async()=>{const row=await store.get('engine-test',t.id);if(!row||row.dispatched)return null;row.dispatched=true;row.status='running';await store.put('engine-test',row);return row;});if(!claimed)return;
   const onProgress=async value=>{if(!progressValue(value))return;await store.transaction(async()=>{const row=await store.get('engine-test',t.id);if(row?.status==='running'){row.progress=clone(value);await store.put('engine-test',row);}});};
   try{const receipt=await testRunner.execute({definition:e,input:t.input,testId:t.id,adminId:t.adminId,quote:{snapshot:t.runnerSnapshot??null},onProgress,signal:controller.signal});await recordReceipt(t.id,receipt);}catch(cause){await recordError(t.id,cause);}
  })().finally(()=>{inFlight.delete(t.id);signals.delete(t.id);pending.delete(work);});pending.add(work);
 }
 async function execute(actor,input){
  if(input.approved!==true)fail('ENGINE_APPROVAL_REQUIRED');safeKey(input.requestId);safeKey(input.quoteId);
  const commandId=hash('engine-test:'+actor.id+':'+input.requestId),commandBinding=digest([input.id,input.quoteId]);
  const claim=await store.transaction(async()=>{
   const old=await store.get('engine-test-command',commandId);if(old){if(old.binding!==commandBinding)fail('IDEMPOTENCY_CONFLICT');return {prior:true,test:await store.get('engine-test',old.testId)};}
   const e=await definition(input.id),p=await policy(e),q=await store.get('engine-test-quote',input.quoteId);if(!q||q.engineId!==e.id||q.adminId!==actor.id||q.usedBy||q.expiresAt<=now())fail('ENGINE_TEST_QUOTE_EXPIRED');
   if(q.binding!==binding(e,p)||q.accountId!==e.accountId||q.settingsRevision!==e.revision)fail('ENGINE_CONFIG_CHANGED');if(!q.dispatchAvailable||blockers(e,p).length||!estimateValue(q.estimatedMicroUSD))fail('ENGINE_TEST_NOT_READY');if(active(await latest(e)))fail('ENGINE_BUSY');
   const t={id:id(),engineId:e.id,accountId:e.accountId,settingsRevision:e.revision,binding:q.binding,adminId:actor.id,input:q.input,runnerSnapshot:q.runnerSnapshot??null,quoteId:q.id,estimatedMicroUSD:q.estimatedMicroUSD,requestId:input.requestId,status:'queued',cloudStopped:false,createdAt:now(),artifacts:[],reviewed:false,accepted:false};
   q.usedBy=t.id;await store.put('engine-test-quote',q);await store.put('engine-test',t);await store.put('engine-test-latest',{id:e.id,testId:t.id});await store.put('engine-test-command',{id:commandId,binding:commandBinding,testId:t.id});await store.audit('engine_test_requested',e.id);return {prior:false,e,test:t};
  });
  if(!claim.prior&&!closed)launch(claim.e,claim.test);return snapshot(await definition(input.id),claim.test);
 }
 async function status(input,actor=null){
  const e=await definition(input.id);let t;if(input.requestId){safeKey(input.requestId);safeKey(actor?.id);const command=await store.get('engine-test-command',hash('engine-test:'+actor.id+':'+input.requestId));if(!command)fail('NOT_FOUND');t=await store.get('engine-test',command.testId);if(!t||input.testId&&input.testId!==t.id)fail('NOT_FOUND');}else t=input.testId?await store.get('engine-test',safeKey(input.testId)):await latest(e);if(t&&t.engineId!==e.id)fail('NOT_FOUND');
  const localRecovery=t?.status==='failed'&&t.dispatched===true&&t.cloudStopped===true&&!t.verified&&testRunner?.recoveryAvailable&&await testRunner.recoveryAvailable({definition:e,input:t.input,testId:t.id,adminId:t.adminId});
  if(t&&(active(t)||localRecovery)&&!inFlight.has(t.id)&&testRunner?.follow){try{const receipt=await testRunner.follow({definition:e,input:t.input,testId:t.id,adminId:t.adminId});if(receipt)await recordReceipt(t.id,receipt,{localRecovery:!!localRecovery});}catch{/* Reads never redispatch or overwrite uncertain evidence. */}t=await store.get('engine-test',t.id);}
  return snapshot(e,t);
 }
 async function review(actor,input){
  if(input.approved!==true||typeof input.accept!=='boolean')fail('ENGINE_APPROVAL_REQUIRED');safeKey(input.testId);
  const inspected=await definition(input.id),inspectedPolicy=await policy(inspected),candidate=await store.get('engine-test',input.testId);if(!candidate||candidate.engineId!==inspected.id)fail('NOT_FOUND');if(candidate.binding!==binding(inspected,inspectedPolicy))fail('ENGINE_CONFIG_CHANGED');if(!candidate.verified||!candidate.cloudStopped||!['needs_review','passed','failed'].includes(candidate.status)||!candidate.artifacts.length)fail('ENGINE_TEST_REVIEW_REQUIRED');
  if(testRunner?.reviewOutput)await testRunner.reviewOutput({definition:inspected,input:candidate.input,testId:candidate.id,adminId:candidate.adminId,accept:input.accept});
  return store.transaction(async()=>{const e=await definition(input.id),p=await policy(e),t=await store.get('engine-test',input.testId);if(!t||t.engineId!==e.id)fail('NOT_FOUND');if(t.binding!==binding(e,p))fail('ENGINE_CONFIG_CHANGED');if(!t.verified||!t.cloudStopped||!['needs_review','passed','failed'].includes(t.status)||!t.artifacts.length)fail('ENGINE_TEST_REVIEW_REQUIRED');t.reviewed=true;t.accepted=input.accept;t.status=input.accept?'passed':'failed';t.error=input.accept?null:'ENGINE_TEST_REJECTED';t.reviewedAt=now();t.reviewedBy=actor.id;await store.put('engine-test',t);await store.delete('engine-approval',e.id);delete e.publication;await store.put('engine-definition',e);await onUnpublish(e);await store.audit('engine_test_reviewed',e.id);return snapshot(e,t);});
 }
 async function approve(actor,input){
  if(input.approved!==true)fail('ENGINE_APPROVAL_REQUIRED');safeKey(input.testId);
  return store.transaction(async()=>{const e=await definition(input.id),p=await policy(e),t=await store.get('engine-test',input.testId);if(!t||t.engineId!==e.id)fail('NOT_FOUND');if(t.binding!==binding(e,p))fail('ENGINE_CONFIG_CHANGED');if(blockers(e,p,{includeExecution:false}).length||t.status!=='passed'||!t.verified||!t.reviewed||!t.accepted||!t.cloudStopped)fail('ENGINE_TEST_APPROVAL_BLOCKED');const current=await latest(e);if(current?.id!==t.id)fail('ENGINE_TEST_STALE');await store.put('engine-approval',{id:e.id,testId:t.id,binding:t.binding,accountId:e.accountId,revision:e.revision,approved:true,approvedBy:actor.id,approvedAt:now()});await store.audit('engine_approved',e.id);return snapshot(e,t);});
 }
 async function publish(actor,input){
  if(input.approved!==true)fail('ENGINE_APPROVAL_REQUIRED');return store.transaction(async()=>{const e=await definition(input.id),p=await policy(e),t=await latest(e),approval=await store.get('engine-approval',e.id),bound=binding(e,p);if(blockers(e,p,{includeExecution:false}).length||!approval||approval.binding!==bound||approval.testId!==t?.id||t.status!=='passed'||!t.accepted||!t.verified||!t.cloudStopped)fail('ENGINE_PUBLICATION_BLOCKED');e.publication={approved:true,tested:true,revision:e.revision,binding:bound,testId:t.id,accountId:e.accountId,modelId:e.modelId,manifestRevision:p.manifestRevision,softwareVersion:p.softwareVersion,dependenciesFingerprint:p.dependenciesFingerprint,licenseEvidence:p.license?.evidenceDigest??null,publishedBy:actor.id,publishedAt:now()};await store.put('engine-definition',e);await onPublish(e,e.publication);await store.audit('engine_published',e.id);return snapshot(e,t);});
 }
 async function unpublish(input){if(input.approved!==true)fail('ENGINE_APPROVAL_REQUIRED');return store.transaction(async()=>{const e=await definition(input.id);delete e.publication;await store.put('engine-definition',e);await onUnpublish(e);await store.audit('engine_unpublished',e.id);return snapshot(e);});}
 async function stop(input){if(input.approved!==true)fail('ENGINE_APPROVAL_REQUIRED');const e=await definition(input.id),t=await latest(e);if(input.testId){safeKey(input.testId);if(t?.id!==input.testId)fail('ENGINE_TEST_STALE');}if(!t||!active(t))return snapshot(e,t);signals.get(t.id)?.abort();if(!testRunner?.stop)fail('ENGINE_TEST_STATE_UNKNOWN');try{const result=await testRunner.stop({definition:e,input:t.input,testId:t.id,adminId:t.adminId});if(result?.testId!==t.id||result.engineId!==e.id||result.accountId!==t.accountId||result.cloudStopped!==true)fail('ENGINE_TEST_STATE_UNKNOWN');await store.transaction(async()=>{const row=await store.get('engine-test',t.id);if(row?.status!=='needs_review'&&row?.status!=='passed'){row.status='cancelled';row.cloudStopped=true;row.finishedAt=now();row.error=null;await store.put('engine-test',row);}});}catch{await recordError(t.id,{});}return status({id:e.id,testId:t.id});}
 return {pending,async drain(){await Promise.all([...pending]);},async recover(){for(const t of await store.all('engine-test'))if(active(t)&&!inFlight.has(t.id)){t.status='uncertain';t.error='ENGINE_TEST_STATE_UNKNOWN';await store.put('engine-test',t);}},async close(){closed=true;for(const controller of signals.values())controller.abort();},status,async dispatch(actor,operation,input={}){if(actor?.isAdmin!==true)fail('FORBIDDEN');safeKey(actor.id);if(operation==='admin.engine.test.quote')return quote(actor,input);if(operation==='admin.engine.test.execute')return execute(actor,input);if(operation==='admin.engine.test.status')return status(input,actor);if(operation==='admin.engine.test.review')return review(actor,input);if(operation==='admin.engine.test.stop')return stop(input);if(operation==='admin.engine.approve')return approve(actor,input);if(operation==='admin.engine.publish')return publish(actor,input);if(operation==='admin.engine.unpublish')return unpublish(input);fail('INVALID_INPUT');}};
}
