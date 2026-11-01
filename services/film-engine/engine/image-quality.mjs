import {randomUUID} from 'node:crypto';
import {hash} from './store.mjs';
import {productionId} from './production-artifacts.mjs';

/** Local evidence and human decisions never certify generated identity automatically. */
export function createImageQuality({store,assets,now=Date.now,visualInspector=null}){
 const key=(p,a)=>hash('image-quality:'+p+':'+a);
 const privateOwner='owner-private-flux-test',privateFilm='afterlife-20261101';
 async function privateVisualScope(c){
  const p=c.project,a=c.row,accountId=p.adminCommissioning?.privateFilmAccountId;
  if(p.customerId!==hash('film-customer:'+privateOwner)||p.adminCommissioning?.ownerId!==privateOwner||p.adminCommissioning?.privateFilmId!==privateFilm||p.title!=='الحياة ما بعد الموت'||p.durationMs!==30000||p.cancelRequested||p.cancelledAt||['cancelled','cancelling','deleted'].includes(p.state)||!productionId(accountId)||!a||a.customerId!==p.customerId||a.projectId!==p.id||a.kind!=='image'||a.status!=='completed'||a.sha256!==c.image.sha256||!/^[a-f0-9]{64}$/.test(c.image.sha256)||!['flux-image-assets-v1','qwen-image-assets-v1'].includes(a.generatedBy)||!['flux2-klein-4b','qwen-image-edit-2511'].includes(a.request?.modelId))return false;
  const account=await store.get('account',accountId);
  return !!account&&account.workspace==='basm1998ali'&&!!account.credentials&&account.unlinked!==true;
 }
 async function acceptedForAnimation(c){
  const a=c.review?.approval;
  if(a?.humanReviewed===true)return true;
  return a?.humanReviewed===false&&a?.reviewerKind==='delegated_agent_visual'&&a?.method==='delegated_agent_visual'&&a?.by===privateOwner&&a?.approvedForAnimation===true&&a?.identityVerified===false&&['dimensions','characterMapping','references'].every(k=>c.review.checks?.[k]===true)&&await privateVisualScope(c);
 }
 async function context({customerId,projectId,assetId}){
  if(!productionId(customerId)||!productionId(projectId)||!productionId(assetId))throw Error('NOT_FOUND');
  const project=await store.get('production-project',projectId);if(!project||project.customerId!==customerId)throw Error('NOT_FOUND');
  return {project,image:await assets.loadReference({customerId,projectId,assetId}),row:await store.get('production-asset',assetId)};
 }
 function castFor(p,r,id){if(r?.characterId)return [r.characterId];if(r?.shotId)return p.plan?.shots?.find(s=>s.id===r.shotId)?.characterIds||[];return (p.plan?.characters||[]).filter(c=>c.referenceIds?.includes(id)).map(c=>c.id);}
 function safe(r){if(!r)return null;return {id:r.reviewId,assetId:r.assetId,sha256:r.sha256,status:r.status,characterIds:r.characterIds,checks:r.checks,visual:r.visual,createdAt:r.createdAt,approval:r.approval||null};}
 async function assess(input){
  const {project,image,row}=await context(input),actual=castFor(project,row,input.assetId),requested=input.characterIds??actual;
  if(!Array.isArray(requested)||new Set(requested).size!==requested.length||requested.some(id=>!productionId(id)||!project.plan?.characters?.some(c=>c.id===id)))throw Error('IMAGE_CHARACTER_MAPPING_INVALID');
  const checks={dimensions:(!input.expectedWidth||image.width===input.expectedWidth)&&(!input.expectedHeight||image.height===input.expectedHeight),characterMapping:requested.length===actual.length&&requested.every(id=>actual.includes(id)),references:true};
  for(const id of row?.request?.referenceIds||[])await assets.loadReference({customerId:input.customerId,projectId:input.projectId,assetId:id});
  if(input.requirements?.referenceBindings!==undefined){
   const bindings=input.requirements.referenceBindings;
   if(!Array.isArray(bindings)||bindings.length>128)checks.references=false;
   else for(const binding of bindings){
    if(!binding||!row?.request?.referenceIds?.includes(binding.assetId)||binding.characterId!==null&&(!actual.includes(binding.characterId)||!castFor(project,await store.get('production-asset',binding.assetId),binding.assetId).includes(binding.characterId)))checks.references=false;
   }
  }
  let visual={status:'unverified',source:'unavailable',checks:{}};
  if(visualInspector){try{const evidence=await visualInspector({bytes:image.bytes,mime:image.mime,width:image.width,height:image.height,characterIds:[...requested],requirements:input.requirements||{}}),result={};for(const n of ['faces','identity','anatomy','props','text'])result[n]=typeof evidence?.checks?.[n]==='boolean'?evidence.checks[n]:null;visual={status:Object.values(result).includes(false)?'failed':Object.values(result).every(v=>v===true)?'passed':'unverified',source:'local_inspector',checks:result};}catch{visual={status:'unverified',source:'local_inspector_unavailable',checks:{}};}}
  const status=Object.values(checks).some(v=>v!==true)||visual.status==='failed'?'failed':visual.status==='passed'?'passed':'unverified';
  const r={id:key(input.projectId,input.assetId),reviewId:randomUUID(),planFingerprint:hash(JSON.stringify(project.plan||{})),projectRevision:project.revision??null,customerId:input.customerId,projectId:input.projectId,assetId:input.assetId,sha256:image.sha256,status,characterIds:[...requested],checks,visual,createdAt:now(),approval:null};
  await store.put('production-image-quality',r);await store.audit('production_image_assessed',input.assetId);return safe(r);
 }
 async function current(input){const c=await context(input),r=await store.get('production-image-quality',key(input.projectId,input.assetId));if(r&&(r.customerId!==input.customerId||r.projectId!==input.projectId||r.sha256!==c.image.sha256))throw Error('IMAGE_REVIEW_STALE');if(r){if(r.projectRevision!==(c.project.revision??null)||r.planFingerprint!==hash(JSON.stringify(c.project.plan||{})))throw Error('IMAGE_REVIEW_STALE');const cast=castFor(c.project,c.row,input.assetId);if(cast.length!==r.characterIds.length||cast.some(id=>!r.characterIds.includes(id)))throw Error('IMAGE_REVIEW_STALE');}return {...c,review:r};}
 async function approve(input){
  const actor=input.actor;if(!actor||actor.isAdmin!==true&&actor.customerId!==input.customerId)throw Error('FORBIDDEN');
  const c=await current(input),{review}=c;if(!review||review.reviewId!==input.reviewId)throw Error('IMAGE_REVIEW_REQUIRED');if(review.status==='failed')throw Error('IMAGE_QUALITY_FAILED');
  let approval;
  if(input.reviewerKind==='delegated_agent_visual'){
   if(actor.isAdmin!==true||actor.id!==privateOwner||input.approved!==true||input.humanReviewed!==false||!['dimensions','characterMapping','references'].every(k=>review.checks?.[k]===true)||!await privateVisualScope(c))throw Error('IMAGE_PRIVATE_VISUAL_REVIEW_REQUIRED');
   approval={approved:true,humanReviewed:false,reviewerKind:'delegated_agent_visual',by:actor.id,method:'delegated_agent_visual',approvedForAnimation:true,identityVerified:false,at:now(),sha256:review.sha256,note:'Private delegated visual review only; identity and semantic quality are not guaranteed.'};
  }else{
   if(input.approved!==true||input.humanReviewed!==true)throw Error('IMAGE_HUMAN_REVIEW_REQUIRED');
   approval={approved:true,humanReviewed:true,by:actor.id||actor.customerId||'administrator',method:'human_review',at:now(),sha256:review.sha256};
  }
  const r={...review,approval};await store.put('production-image-quality',r);await store.audit('production_image_approved',input.assetId);return safe(r);
 }
 async function approved(input){const c=await current(input),r=c.review;if(!r||r.status==='failed'||r.approval?.approved!==true||!await acceptedForAnimation(c)||r.approval.sha256!==c.image.sha256)throw Error(r?.status==='failed'?'IMAGE_QUALITY_FAILED':'IMAGE_REVIEW_REQUIRED');return c;}
 async function selectCharacterReferences({customerId,projectId,characterId}){
  const p=await store.get('production-project',projectId);if(!p||p.customerId!==customerId||!p.plan?.characters?.some(c=>c.id===characterId))throw Error('NOT_FOUND');const out=[];
  for(const r of await store.all('production-character-reference'))if(r.customerId===customerId&&r.projectId===projectId&&r.characterId===characterId){try{const c=await approved({customerId,projectId,assetId:r.assetId});out.push({assetId:r.assetId,characterId,angle:r.angle,sha256:c.image.sha256,mime:c.image.mime,width:c.image.width,height:c.image.height,approved:true,approvalMethod:c.review.approval.method,humanReviewed:c.review.approval.humanReviewed===true,reviewerKind:c.review.approval.reviewerKind??'human',identityVerified:false});}catch(e){if(!['IMAGE_REVIEW_REQUIRED','IMAGE_QUALITY_FAILED'].includes(e.message))throw e;}}
  return out.sort((a,b)=>Number(!['mainface','front'].includes(a.angle))-Number(!['mainface','front'].includes(b.angle)));
 }
 async function getAnimationInput(input){
  const c=await approved(input);if(c.project.cancelRequested||['cancelled','cancelling','deleted'].includes(c.project.state))throw Error('PRODUCTION_CANCELLED');const cast=castFor(c.project,c.row,input.assetId),requested=input.characterIds??cast;if(!Array.isArray(requested)||requested.length!==cast.length||new Set(requested).size!==requested.length||requested.some(id=>!cast.includes(id)))throw Error('IMAGE_CHARACTER_MAPPING_INVALID');
  for(const characterId of requested){const refs=await selectCharacterReferences({...input,characterId});if(!refs.some(r=>['mainface','front'].includes(r.angle)))throw Error('IMAGE_PRIMARY_ANCHOR_REQUIRED');}
  const result={assetId:input.assetId,mime:c.image.mime,width:c.image.width,height:c.image.height,sha256:c.image.sha256,characterIds:[...requested],approved:true,approvalMethod:c.review.approval.method,humanReviewed:c.review.approval.humanReviewed===true,reviewerKind:c.review.approval.reviewerKind??'human',identityVerified:false};if(input.includeBytes===true)result.bytes=c.image.bytes;return result;
 }
 return {assess,approve,selectCharacterReferences,getAnimationInput,async get(input){return safe((await current(input)).review);}};
}
