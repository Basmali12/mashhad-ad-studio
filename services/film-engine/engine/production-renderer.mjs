import {hash} from './store.mjs';
import {createFinalFilmComposer} from './final-film-composer.mjs';

/** Local edit decisions and explicit FFmpeg assembly. Voice is generated once
 * per utterance; chapter mixing slices that original audio on absolute time.
 * This is soundtrack alignment, not a claim of generated lip synchronization.
 */
export function createProductionRenderer({store,assembly,speechMerge=null,cinematicSync=null,soundEffects=null,quality=null}){
 const composer=soundEffects&&quality?createFinalFilmComposer({store,assembly}):null;
 const asset=async(p,id)=>{const a=await store.get('production-asset',id);if(!a||a.customerId!==p.customerId||a.projectId!==p.id)throw Error('PRODUCTION_ASSET_SCOPE');return a;};
 const result=(scope,assetIds)=>({...scope,cloudStopped:true,actualMicroUSD:0,definitiveNoSpend:true,result:{assetIds}});
 async function soundtrack(p){
  const timeline=await store.get('production-cinematic-timeline',p.id);if(timeline?.customerId===p.customerId&&timeline.planRevision===p.revision){if(timeline.needsReview)throw Object.assign(Error('CINEMATIC_TIMELINE_REVIEW_REQUIRED'),{needsReview:true});return timeline.timeline.audioTracks;}
  const narration=[];for(const u of p.plan.utterances){const stage=await store.get('production-stage',hash(p.id+':voice:'+u.id)),a=await asset(p,stage?.result?.assetIds?.[0]);
   if(!Number.isSafeInteger(a.durationMs)||a.durationMs<1||a.durationMs>u.endMs-u.startMs+80)throw Error('PRODUCTION_AUDIO_TIMING_REPLAN_REQUIRED');
   narration.push({assetId:a.id,startMs:u.startMs,endMs:Math.min(u.endMs,u.startMs+a.durationMs),sourceOffsetMs:0});
  }return narration;
 }
 return {finalComposer:!!composer,version:'local-timeline-renderer-v2',billingMode:'local_server',async estimate({stage,plan}){
  if(['timeline_sync','alignment_merge'].includes(stage.kind)){if(!cinematicSync)return {available:false,estimatedMicroUSD:null};return cinematicSync.estimate({stage,plan});}
  if(stage.kind==='voice_merge'){if(!speechMerge)return {estimatedMicroUSD:null,available:false,blockers:['PRODUCTION_ADAPTER_UNAVAILABLE']};return {estimatedMicroUSD:0};}
  if(stage.kind==='quality'){if(!quality)return {estimatedMicroUSD:null,available:false};return {estimatedMicroUSD:0};}
  if(!['sync','effects','merge'].includes(stage.kind))throw Error('PRODUCTION_ADAPTER_UNAVAILABLE');
  if(!soundEffects&&stage.kind==='effects'&&plan.shots.find(s=>s.id===stage.subjectId)?.soundEffects.some(e=>!e.assetId))return {estimatedMicroUSD:null,available:false,blockers:['PRODUCTION_EFFECT_ASSET_REQUIRED']};
  // Existing server CPU: no additional provider operation is dispatched. Model
  // cost estimates remain separate and unavailable until adapters are installed.
  return {estimatedMicroUSD:0};
 },async execute({scope,stage,plan,inputs,onProgress,signal}){
  if(signal?.aborted)throw Object.assign(Error('PRODUCTION_CANCELLED'),{definitiveNoSpend:true});
  if(['timeline_sync','alignment_merge'].includes(stage.kind)){if(!cinematicSync)throw Error('PRODUCTION_ADAPTER_UNAVAILABLE');return cinematicSync.execute({scope:{...scope,stageId:stage.stageId},stage,plan,inputs,onProgress,signal});}
  if(stage.kind==='sync'&&stage.deps?.includes('timeline_sync')){if(!cinematicSync)throw Error('PRODUCTION_ADAPTER_UNAVAILABLE');return cinematicSync.renderShot({scope,stage,plan,inputs});}
  if(stage.kind==='voice_merge'){if(!speechMerge)throw Error('PRODUCTION_ADAPTER_UNAVAILABLE');return speechMerge.execute({scope:{...scope,stageId:stage.stageId},stage,plan,inputs});}
  const p=await store.get('production-project',scope.projectId);if(!p||p.customerId!==scope.customerId||p.cancelRequested)throw Error('PRODUCTION_CANCELLED');
  if(stage.kind==='quality'){if(!quality)throw Error('PRODUCTION_ADAPTER_UNAVAILABLE');const assetId=inputs.find(i=>i.stageId==='merge')?.result?.assetIds?.[0];if(!assetId)throw Error('PRODUCTION_ASSET_SCOPE');await onProgress({completed:0,total:1,unit:'items'});const intentionalSilenceIntervals=(await Promise.all(plan.shots.map(s=>store.get('production-edit',hash(p.id+':effects:'+s.id))))).filter(e=>e?.customerId===p.customerId&&e.projectId===p.id).flatMap(e=>(e.silenceWindows??[]).map(w=>({startMs:w.startMs,endMs:w.endMs})));const report=await quality.inspect({intentionalSilenceIntervals,projectId:p.id,customerId:p.customerId,assetId,expectedDurationMs:p.measuredDurationMs??p.durationMs,expectedAudio:plan.utterances.length>0,...(p.width&&p.height?{expectedWidth:p.width,expectedHeight:p.height}:plan.orientation?{expectedWidth:plan.orientation==='portrait'?720:1280,expectedHeight:plan.orientation==='portrait'?1280:720}:{})});if(report.needsReview)throw Object.assign(Error('FINAL_QUALITY_REVIEW_REQUIRED'),{needsReview:true,definitiveNoSpend:true});await onProgress({completed:1,total:1,unit:'items'});return result(scope,[assetId]);}
  if(stage.kind==='merge'&&composer)return composer.compose({scope,stage,plan,inputs,onProgress,signal});
  if(['sync','effects'].includes(stage.kind)){
   const shot=plan.shots.find(s=>s.id===stage.subjectId),source=inputs.find(i=>i.stageId.startsWith(stage.kind==='sync'?'animate:':'sync:'))?.result?.assetIds?.[0],a=await asset(p,source);
   const edit=await store.get('production-edit',hash(p.id+':sync:'+shot.id));if(Math.abs(a.durationMs-((edit?.endMs??shot.endMs)-(edit?.startMs??shot.startMs)))>80)throw Error('PRODUCTION_VIDEO_TIMING_REPLAN_REQUIRED');
   if(stage.kind==='sync')await soundtrack(p);
   if(stage.kind==='effects'&&soundEffects){const actualEdit=edit??{startMs:shot.startMs,endMs:shot.endMs,videoAssetId:a.id},compiled=await soundEffects.compile({scope,shot,edit:actualEdit,plan});await store.put('production-edit',{projectId:p.id,customerId:p.customerId,shotId:shot.id,...actualEdit,id:hash(p.id+':'+stage.stageId),videoAssetId:a.id,utteranceIds:shot.utteranceIds,effects:compiled.tracks,silenceWindows:compiled.silenceWindows??[],needsReview:compiled.needsReview,reviewReasons:compiled.reviewReasons});if(compiled.needsReview)throw Object.assign(Error('SFX_EVENT_REVIEW_REQUIRED'),{needsReview:true,definitiveNoSpend:true});await onProgress({completed:1,total:1,unit:'items'});return result(scope,[a.id]);}
   const effects=shot.soundEffects.map(e=>edit?{...e,startMs:edit.startMs+e.startMs-shot.startMs,endMs:edit.startMs+e.endMs-shot.startMs}:e);if(effects.some(e=>e.endMs>(edit?.endMs??shot.endMs)))throw Object.assign(Error('CINEMATIC_EFFECT_WINDOW_REVIEW_REQUIRED'),{needsReview:true});
   for(const effect of effects){if(!effect.assetId)throw Error('PRODUCTION_EFFECT_ASSET_REQUIRED');await asset(p,effect.assetId);}
   await store.put('production-edit',{id:hash(p.id+':'+stage.stageId),projectId:p.id,customerId:p.customerId,shotId:shot.id,startMs:edit?.startMs??shot.startMs,endMs:edit?.endMs??shot.endMs,videoAssetId:a.id,utteranceIds:shot.utteranceIds,effects});
   await onProgress({completed:1,total:1,unit:'items'});return result(scope,[a.id]);
  }
  if(stage.kind!=='merge')throw Error('PRODUCTION_ADAPTER_UNAVAILABLE');
  const chapter=stage.scope==='chapter'?plan.chapters.find(c=>c.id===stage.subjectId):null;
  const sources=inputs.filter(i=>chapter?i.stageId.startsWith('effects:'):i.stageId.startsWith('chapter_merge:')).map(i=>i.result?.assetIds?.[0]);
  if(!sources.length||sources.some(s=>!s))throw Error('PRODUCTION_ASSET_SCOPE');
  // Bound FFmpeg inputs, using durable nested groups for arbitrarily large
  // chapters. Completed groups are content-addressed and reused on restart.
  let level=sources,depth=0;const base=hash(p.id+':'+stage.stageId).slice(0,24);
  while(level.length>64){const next=[];for(let i=0;i<level.length;i+=64){const group=await assembly.assembleGroup({projectId:p.id,customerId:p.customerId,groupId:base+'-'+depth+'-'+i,assetIds:level.slice(i,i+64)});next.push(group.assetId);}level=next;depth++;}
  const measured=await store.get('production-cinematic-timeline',p.id),chapterClips=chapter&&measured&&measured.planRevision===p.revision?measured.timeline.shots.filter(s=>s.chapterId===chapter.id):[],chapterStart=chapterClips[0]?.startMs??chapter?.startMs,chapterEnd=chapterClips.at(-1)?.endMs??chapter?.endMs;
  const narration=chapter?(await soundtrack(p)).filter(t=>t.startMs<chapterEnd&&t.endMs>chapterStart):undefined,effects=chapter?(await Promise.all(plan.shots.filter(s=>s.chapterId===chapter.id).map(async s=>{const edit=await store.get('production-edit',hash(p.id+':effects:'+s.id));return (edit?.effects??s.soundEffects).map(e=>({assetId:e.assetId,startMs:e.startMs,endMs:e.endMs,sourceOffsetMs:0}));}))).flat():undefined;
  const merged=await assembly.assembleGroup({projectId:p.id,customerId:p.customerId,groupId:base+'-final',assetIds:level,...(chapter?{narration,effects,timelineStartMs:chapterStart}:{})});
  if(signal?.aborted)throw Error('PRODUCTION_CANCELLED');await onProgress({completed:sources.length,total:sources.length,unit:'items'});return result(scope,[merged.assetId]);
 }};
}
