import {buildWanRequest} from './wan-prompt.mjs';
import {validateWanMotion} from './wan-shot-plan.mjs';
import {hash} from './store.mjs';
export const HUNYUAN_MODEL_ID='hunyuanvideo15';
export function hunyuanFramePlan(durationMs){
 if(!Number.isSafeInteger(durationMs)||durationMs<1||durationMs>5000)throw Error('HUNYUAN_SHOT_SEGMENTATION_REQUIRED');const timelineFrames=Math.max(1,Math.round(durationMs*24/1000)),numFrames=Math.max(5,Math.ceil((timelineFrames-1)/4)*4+1);return {fps:24,numFrames,timelineFrames,nativeDurationMs:Math.round(numFrames/24*1000)};
}
export function buildHunyuanRequest({scope,shot,plan,sourceAsset=null,seed=42}){
 const mode=shot.generationMode??'image_to_video',frames=hunyuanFramePlan(shot.endMs-shot.startMs),resolution=plan.videoResolution??'720p';
 if(!['text_to_video','image_to_video'].includes(mode)||!['portrait','landscape'].includes(plan.orientation)||!['480p','720p'].includes(resolution)||!scope||!['customerId','projectId','attemptId'].every(k=>/^[A-Za-z0-9_-]{1,100}$/.test(scope[k]||''))||!Number.isSafeInteger(seed)||seed<0||seed>4294967295)throw Error('HUNYUAN_INVALID_REQUEST');
 const portrait=plan.orientation==='portrait',width=resolution==='720p'?(portrait?720:1280):(portrait?480:848),height=resolution==='720p'?(portrait?(mode==='image_to_video'?1264:1280):720):(portrait?(mode==='image_to_video'?832:848):480);
 let prompt,structured;
 if(mode==='image_to_video'){
  // Reuse reference/character checks; Hunyuan has its own 480p grid and temporal settings.
  const base=buildWanRequest({scope,shot,plan:{...plan,videoResolution:resolution==='480p'?'480p':'720p'},sourceAsset,seed});prompt=base.prompt;structured=base.structured;
  if(sourceAsset.width<width||sourceAsset.height<height)throw Error('HUNYUAN_SOURCE_ORIENTATION_MISMATCH');
 }else{
  if(sourceAsset)throw Error('HUNYUAN_GENERATION_MODE_MISMATCH');const motion=validateWanMotion(shot.motionPlan),characters=plan.characters.filter(c=>shot.characterIds.includes(c.id));
  prompt=[`Create one continuous realistic shot. Setting: ${shot.prompt}. Location: ${shot.location??'as described'}.`,`Initial state: ${motion.start}`,`Action progression: ${motion.development}`,`Final state: ${motion.end}`,`Camera path: ${motion.camera}`,...characters.map(c=>`Character ${c.id}: ${c.description}; face ${c.face}; body ${c.body}; clothing ${shot.characterEdits?.find(e=>e.characterId===c.id)?.wardrobe??c.wardrobe}; props ${c.props.map(p=>p.description).join('; ')}.`),'Natural motion and plain unmarked surfaces without captions, titles or newly added lettering.'].join('\n');
  structured={shotId:shot.id,sceneId:shot.sceneId,characters:characters.map(c=>({id:c.id,name:c.name,face:c.face,body:c.body,wardrobe:c.wardrobe})),motion,location:shot.location,timelineStartMs:shot.startMs,timelineEndMs:shot.endMs,retainedReferenceIds:characters.flatMap(c=>c.referenceIds),identityConditioned:false};
 }
 if(prompt.length>12000)throw Error('HUNYUAN_PROMPT_TOO_LONG');
 const settings={width,height,timeline_width:resolution==='720p'?(portrait?720:1280):(portrait?480:848),timeline_height:resolution==='720p'?(portrait?1280:720):(portrait?848:480),seed,num_frames:frames.numFrames,fps:24,num_inference_steps:50,guidance_scale:6,dtype:'bfloat16',resolution,timelineDurationMs:shot.endMs-shot.startMs};
 return {modelId:HUNYUAN_MODEL_ID,mode,prompt,settings,sourceAssetId:sourceAsset?.assetId??null,sourceSHA256:sourceAsset?.sha256??null,referenceIds:sourceAsset?[sourceAsset.assetId]:[],structured:{...structured,generationMode:mode,identityConditioned:mode==='image_to_video',selection:shot.videoSelection??null},nativeDurationMs:frames.nativeDurationMs,fingerprint:hash(JSON.stringify({scope,mode,prompt,settings,source:sourceAsset?.sha256??null}))};
}
