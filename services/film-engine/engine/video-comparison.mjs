import {hash} from './store.mjs';
import {productionId,resolveProductionAsset} from './production-artifacts.mjs';

/** Records measured evidence only; it never launches or repeats inference. */
export function createVideoComparisons({store,now=Date.now}){
 const metricNames=['inferenceSeconds','runtimeMs','customerChargeUSD','recordedProviderUSD'];
 const metricValue=v=>v===null||v===undefined?null:typeof v==='number'&&Number.isFinite(v)&&v>=0?v:(()=>{throw Error('VIDEO_COMPARISON_METRIC_INVALID');})();
 const safe=r=>({id:r.id,assetId:r.assetId,stageId:r.stageId,shotId:r.shotId,modelId:r.modelId,version:r.version,revision:r.revision,durationMs:r.durationMs,native:r.native,width:r.width,height:r.height,sourceImageProvided:r.sourceImageProvided,metrics:r.metrics,plannedMotionEndpoint:r.plannedMotionEndpoint,qualityReview:r.qualityReview,createdAt:r.createdAt,updatedAt:r.updatedAt});
 async function owned({customerId,projectId}){if(!productionId(customerId)||!productionId(projectId))throw Error('NOT_FOUND');const p=await store.get('production-project',projectId);if(!p||p.customerId!==customerId)throw Error('NOT_FOUND');return p;}
 async function record(input){
  const p=await owned(input);if(!productionId(input.attemptId)||!productionId(input.assetId))throw Error('NOT_FOUND');const a=await store.get('production-attempt',input.attemptId),asset=await resolveProductionAsset({store,...input});
  if(!a||a.projectId!==input.projectId||a.customerId!==input.customerId||a.stageId!==input.stageId||asset.attemptId!==input.attemptId||asset.stageId!==input.stageId||!['wan-video-assets-v1','hunyuan-video-assets-v1'].includes(asset.generatedBy))throw Error('VIDEO_COMPARISON_BINDING_INVALID');
  if(input.metrics!=null&&(typeof input.metrics!=='object'||Array.isArray(input.metrics)||Object.keys(input.metrics).some(k=>!metricNames.includes(k))))throw Error('VIDEO_COMPARISON_METRIC_INVALID');
  const id=hash('video-comparison:'+input.projectId+':'+input.attemptId),prior=await store.get('production-video-comparison',id);if(prior&&(prior.customerId!==input.customerId||prior.assetId!==input.assetId))throw Error('VIDEO_COMPARISON_BINDING_INVALID');
  const metrics={};for(const name of metricNames)metrics[name]=input.metrics&&Object.hasOwn(input.metrics,name)?metricValue(input.metrics[name]):prior?.metrics?.[name]??null;
  // Planned endpoints describe intent, not a visual claim that the endpoint was reached.
  const shot=p.plan?.shots?.find(s=>s.id===asset.shotId),endpoint=shot?.motionPlan?.end??shot?.motionEndpoint??shot?.endState??null,plannedMotionEndpoint=typeof endpoint==='string'?endpoint.slice(0,2000):null;
  const row={id,customerId:input.customerId,projectId:input.projectId,attemptId:input.attemptId,assetId:input.assetId,stageId:input.stageId,shotId:asset.shotId,modelId:asset.request.modelId,version:asset.request.version,revision:asset.request.revision,durationMs:asset.durationMs,native:asset.native,width:asset.width,height:asset.height,sourceImageProvided:!!asset.sourceAssetId,metrics,plannedMotionEndpoint,qualityReview:prior?.qualityReview??null,createdAt:prior?.createdAt??now(),updatedAt:now()};await store.put('production-video-comparison',row);return safe(row);
 }
 async function get(input){await owned(input);if(!productionId(input.id))throw Error('NOT_FOUND');const row=await store.get('production-video-comparison',input.id);if(!row||row.customerId!==input.customerId||row.projectId!==input.projectId)throw Error('NOT_FOUND');return safe(row);}
 async function review(input){
  await owned(input);if(!input.actor||input.actor.isAdmin!==true&&input.actor.customerId!==input.customerId)throw Error('FORBIDDEN');await get(input);if(input.humanReviewed!==true||!input.review||typeof input.review!=='object'||Array.isArray(input.review)||Object.keys(input.review).some(k=>!['identity','motion','deformation','endpointReached','notes'].includes(k)))throw Error('VIDEO_COMPARISON_REVIEW_INVALID');
  const checks={};for(const name of ['identity','motion','deformation','endpointReached']){const v=input.review[name];if(v!==undefined&&v!==null&&typeof v!=='boolean')throw Error('VIDEO_COMPARISON_REVIEW_INVALID');checks[name]=v??null;}if(input.review.notes!=null&&(typeof input.review.notes!=='string'||input.review.notes.length>2000))throw Error('VIDEO_COMPARISON_REVIEW_INVALID');
  const row=await store.get('production-video-comparison',input.id);row.qualityReview={...checks,notes:input.review.notes??null,source:'human_review',at:now()};row.updatedAt=now();await store.put('production-video-comparison',row);await store.audit('video_comparison_reviewed',input.id);return safe(row);
 }
 return {record,get,review,async list(input){await owned(input);return (await store.all('production-video-comparison')).filter(r=>r.customerId===input.customerId&&r.projectId===input.projectId).slice(-1000).map(safe);}};
}
