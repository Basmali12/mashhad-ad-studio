/** PRIVATE commissioning smoke-plan helper only. No store, SDK, UI or dispatch.
 * Apply only after confirmed resource stop; re-assess/re-approve source quality
 * at the new project revision. Functional smoke only, not a quality winner or
 * equal-duration comparison against the earlier five-second video attempt.
 */
import {validateProductionPlan} from '../services/film-engine/engine/production-plan.mjs';
import {hunyuanFramePlan} from '../services/film-engine/engine/hunyuan-prompt.mjs';
import {wanFramePlan} from '../services/film-engine/engine/wan-shot-plan.mjs';
import {hash} from '../services/film-engine/engine/store.mjs';
import {isDeepStrictEqual} from 'node:util';
const profiles={'wan22-i2v-a14b':{shotId:'private-wan-smoke',frames:wanFramePlan},hunyuanvideo15:{shotId:'private-hunyuan-smoke',frames:hunyuanFramePlan}};
const profileOfShot=s=>Object.entries(profiles).find(([,p])=>p.shotId===s.id);
const fail=code=>{throw Error('PRIVATE_VIDEO_'+code);};
const promptKey=v=>v.normalize('NFKC').toLocaleLowerCase('ar').replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
function makeShot(source,{modelId,shotId,startMs,sceneId,chapterId,repeatOf}){
 return {...source,id:shotId,sceneId,chapterId,startMs,endMs:startMs+1000,prompt:source.prompt,videoModelId:modelId,generationMode:'image_to_video',videoSelectionIntent:null,videoSelection:null,motionPlan:{...source.motionPlan},motionBeats:[],wanSegment:null,intentionalRepeatOf:repeatOf,utteranceIds:[],soundEffects:[],eventIds:[shotId+'-event'],requires_lip_sync:false,audioCue:null,transition:null,allowText:false,requestedText:null};
}
export function planPrivateVideoSmoke(project,{adminId,sourceShotId,modelId}={}){
 const profile=profiles[modelId];if(!profile)fail('MODEL_UNSUPPORTED');
 if(typeof adminId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(adminId)||!project||project.adminCommissioning?.ownerId!==adminId||project.customerId!==hash('film-customer:'+adminId))fail('PROJECT_REQUIRED');
 if(project.cancelRequested||project.cancelledAt||['cancelled','cancelling','deleted'].includes(project.state))fail('PROJECT_CANCELLED');
 const original=project.plan;validateProductionPlan(original,{modelSettings:original?.routing??{}});
 const base=original.shots.filter(s=>s.endMs<=10000),extras=original.shots.slice(base.length);
 if(!base.length||base.at(-1).endMs!==10000||base.some(profileOfShot)||extras.length>2||original.durationMs!==10000+extras.length*1000)fail('BASE_DURATION_REQUIRED');
 const source=base.find(s=>s.id===(sourceShotId??base[0].id));if(!source)fail('SOURCE_REQUIRED');
 const tailScene=original.scenes.find(s=>s.endMs===original.durationMs),tailChapter=original.chapters.find(c=>c.endMs===original.durationMs);
 if(!tailScene||!tailChapter||tailScene.chapterId!==tailChapter.id)fail('TIMELINE_REQUIRED');
 // Verify each existing extension against a real original source and the
 // deterministic helper contract, not merely a caller-chosen smoke ID.
 const prior=[...base],used=new Set();
 for(const [i,shot] of extras.entries()){
  const entry=profileOfShot(shot);if(!entry||used.has(entry[0]))fail('SMOKE_COLLISION');used.add(entry[0]);
  const repeated=prior.find(s=>s.id===shot.intentionalRepeatOf);let root=repeated;while(root&&profileOfShot(root))root=prior.find(s=>s.id===root.intentionalRepeatOf);
  const latest=prior.filter(s=>promptKey(s.prompt)===promptKey(root?.prompt??'')).at(-1);
  if(!root||!base.includes(root)||!latest||!isDeepStrictEqual(shot,makeShot(root,{modelId:entry[0],shotId:entry[1].shotId,startMs:10000+i*1000,sceneId:tailScene.id,chapterId:tailChapter.id,repeatOf:latest.id})))fail('SMOKE_COLLISION');prior.push(shot);
 }
 const existing=extras.find(s=>s.id===profile.shotId),metadata={shotId:profile.shotId,sourceShotId:source.id,framePlan:profile.frames(1000),purpose:'functional_smoke_only',equalDurationQualityBenchmark:false,sourceReapprovalRequired:true};
 if(existing){if(!isDeepStrictEqual(existing,makeShot(source,{modelId,shotId:profile.shotId,startMs:existing.startMs,sceneId:tailScene.id,chapterId:tailChapter.id,repeatOf:existing.intentionalRepeatOf})))fail('SMOKE_COLLISION');return {plan:original,changed:false,...metadata};}
 if(extras.length>=2)fail('SMOKE_COLLISION');
 const repeatOf=original.shots.filter(s=>promptKey(s.prompt)===promptKey(source.prompt)).at(-1).id,shot=makeShot(source,{modelId,shotId:profile.shotId,startMs:original.durationMs,sceneId:tailScene.id,chapterId:tailChapter.id,repeatOf}),durationMs=original.durationMs+1000;
 const plan={...original,durationMs,chapters:original.chapters.map(c=>c.id===tailChapter.id?{...c,endMs:durationMs}:c),scenes:original.scenes.map(s=>s.id===tailScene.id?{...s,endMs:durationMs}:s),shots:[...original.shots,shot]};
 validateProductionPlan(plan,{modelSettings:plan.routing??{}});
 return {plan,changed:true,...metadata};
}
/** Compatibility wrapper for the existing private Hunyuan-only harness. */
export function planPrivateHunyuanSmoke(project,options={}){try{return planPrivateVideoSmoke(project,{...options,modelId:'hunyuanvideo15'});}catch(error){if(error.message.startsWith('PRIVATE_VIDEO_'))throw Error(error.message.replace('PRIVATE_VIDEO_','PRIVATE_HUNYUAN_'),{cause:error});throw error;}}
