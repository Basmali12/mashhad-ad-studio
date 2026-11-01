/** Publisher example based service policy, not an architectural duration claim. */
export const WAN_FPS=16,WAN_MAX_FRAMES=81,WAN_MAX_TIMELINE_MS=5000;
const english=v=>typeof v==='string'&&v.trim()&&v.length<=4000&&/[A-Za-z]/.test(v)&&!/[\u0600-\u06ff]/.test(v);
export function validateWanMotion(value){
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['start','development','end','camera'].includes(k))||!['start','development','end','camera'].every(k=>english(value[k])))throw Error('WAN_MOTION_PLAN_REQUIRED');
 return Object.fromEntries(['start','development','end','camera'].map(k=>[k,value[k].trim()]));
}
export function wanFramePlan(durationMs){
 if(!Number.isSafeInteger(durationMs)||durationMs<1||durationMs>WAN_MAX_TIMELINE_MS)throw Error('WAN_SHOT_SEGMENTATION_REQUIRED');
 const timelineFrames=Math.max(1,Math.round(durationMs*WAN_FPS/1000)),numFrames=Math.max(5,Math.ceil((timelineFrames-1)/4)*4+1);
 if(numFrames>WAN_MAX_FRAMES)throw Error('WAN_SHOT_SEGMENTATION_REQUIRED');return {fps:WAN_FPS,numFrames,timelineFrames,nativeDurationMs:Math.round(numFrames/WAN_FPS*1000)};
}
/** The director supplies distinct action beats. Never invent a repeated motion or
 * stretch a five-second example into an unverified ten-second inference. */
export function prepareWanStoryboard(plan,{modelId='wan22-i2v-a14b',maxTimelineMs=WAN_MAX_TIMELINE_MS,idPrefix='wan'}={}){
 const output=JSON.parse(JSON.stringify(plan)),shots=[];
 for(const [sourceIndex,shot] of plan.shots.entries()){
  if((shot.videoModelId??plan.routing.animationModelId)!==modelId){shots.push(shot);continue;}
  const duration=shot.endMs-shot.startMs,count=Math.ceil(duration/maxTimelineMs);
  if(count===1){shots.push({...shot,motionPlan:validateWanMotion(shot.motionPlan)});continue;}
  if(!Array.isArray(shot.motionBeats)||shot.motionBeats.length!==count||shot.intentionalRepeatOf)throw Error('WAN_SHOT_SEGMENTATION_REQUIRED');
  const beats=shot.motionBeats.map(validateWanMotion);for(let boundary=shot.startMs+maxTimelineMs;boundary<shot.endMs;boundary+=maxTimelineMs)if(shot.soundEffects.some(e=>e.startMs<boundary&&e.endMs>boundary))throw Error('WAN_EFFECT_TIMING_REPLAN_REQUIRED');if(new Set(beats.map(b=>JSON.stringify(b))).size!==beats.length)throw Error('WAN_REPEATED_MOTION_BEAT');
  for(let i=0;i<count;i++){
   const startMs=shot.startMs+i*maxTimelineMs,endMs=Math.min(shot.endMs,startMs+maxTimelineMs),motionPlan=beats[i];
   shots.push({...shot,id:`${idPrefix}-s${sourceIndex}-p${i}`,startMs,endMs,prompt:shot.prompt+`\nAction beat ${i+1}/${count}: ${motionPlan.start} Then ${motionPlan.development} Ends with ${motionPlan.end}`,
    characterMotion:motionPlan.development,cameraMotion:motionPlan.camera,motionPlan,motionBeats:[],wanSegment:{sourceShotId:shot.id,index:i,count},eventIds:i===0?shot.eventIds:[`${idPrefix}-event-${sourceIndex}-${i}`],intentionalRepeatOf:null,
    utteranceIds:plan.utterances.filter(u=>u.startMs<endMs&&u.endMs>startMs).map(u=>u.id),soundEffects:shot.soundEffects.filter(e=>e.startMs<endMs&&e.endMs>startMs).map(e=>({...e,startMs:Math.max(e.startMs,startMs),endMs:Math.min(e.endMs,endMs)}))});
  }
 }
 output.shots=shots;return output;
}
