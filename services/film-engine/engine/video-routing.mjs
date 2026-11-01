const MODELS=['wan22-i2v-a14b','hunyuanvideo15'];
/** Planning choice only. Failures never invoke this router to retry another provider. */
export function selectProductionVideoRoutes(plan,{availableModels=MODELS,benchmarks=[]}={}){
 return {...plan,shots:plan.shots.map(shot=>{
  const mode=shot.generationMode??'image_to_video';let modelId=shot.videoModelId??plan.routing.animationModelId,reason=shot.videoModelId?'explicit_shot':'configured_primary',source='configured';
  if(!MODELS.includes(modelId)||!['text_to_video','image_to_video'].includes(mode))throw Error('INVALID_MODEL_ROUTING');
  if(mode==='text_to_video'){if(shot.videoModelId&&shot.videoModelId!=='hunyuanvideo15')throw Error('VIDEO_MODE_UNSUPPORTED');modelId='hunyuanvideo15';reason='text_to_video_supported';}
  else if(!shot.videoModelId&&shot.videoSelectionIntent==='quiet'&&availableModels.includes('hunyuanvideo15')){modelId='hunyuanvideo15';reason='quiet_scene_candidate';source='unverified_heuristic';}
  else if(!shot.videoModelId&&shot.videoSelectionIntent==='complex_motion'){modelId='wan22-i2v-a14b';reason='complex_motion_candidate';source='unverified_heuristic';}
  else if(!shot.videoModelId&&shot.videoSelectionIntent==='cost'){
   reason='no_comparable_cost_evidence';source='unverified';const samples=benchmarks.filter(b=>availableModels.includes(b.modelId)&&MODELS.includes(b.modelId)&&b.generationMode===mode&&b.resolution===(plan.videoResolution??'720p')&&b.reviewed===true&&Math.abs(b.durationMs-(shot.endMs-shot.startMs))<=80&&typeof b.customerChargeUSD==='number'&&Number.isFinite(b.customerChargeUSD)&&b.customerChargeUSD>=0);
   if(MODELS.every(id=>samples.some(b=>b.modelId===id))){const averages=MODELS.map(id=>({id,perSecond:samples.filter(b=>b.modelId===id).reduce((n,b)=>n+b.customerChargeUSD/(b.durationMs/1000),0)/samples.filter(b=>b.modelId===id).length})).sort((a,b)=>a.perSecond-b.perSecond);modelId=averages[0].id;reason='historical_comparable_customer_cost';source='historical_measurement';}
  }
  return {...shot,generationMode:mode,videoModelId:modelId,videoSelection:{modelId,reason,source,automaticFallback:false}};
 })};
}
