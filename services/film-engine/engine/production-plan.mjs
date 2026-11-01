/**
 * Pure storyboard contract: no model imports, provider calls, I/O or inference.
 * Parent must verify reference ownership before using the normalized plan.
 * An eventual trusted adapter receives {plan, stage, previouslyVerifiedArtifacts}
 * and returns one scoped artifact receipt; a descriptor never authorizes spend.
 * One voice stage produces a continuous utterance, even across several shots.
 * Sync may use timed slices of that same artifact, never regenerate its words.
 * Merge places each original voice artifact once on the absolute timeline.
 */
export const PRODUCTION_PLAN_VERSION='mashhad-production-plan-v1';
export const VOICE_ENGINE_LOCALES=Object.freeze({
 'habibi-msa':Object.freeze(['ar','ar-MSA']),
 'habibi-irq':Object.freeze(['ar-IQ']),
 'habibi-egy':Object.freeze(['ar-EG']),
 'audar-tts-v1-flash':Object.freeze(['ar','en']),
});
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const own=(value,key)=>Object.hasOwn(value,key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code,field){const error=Error(code);error.code=code;error.field=field;throw error;}
function object(value,field){if(!record(value))fail('INVALID_PRODUCTION_PLAN',field);return value;}
function keys(value,allowed,field){if(Object.keys(value).some(key=>!allowed.includes(key)))fail('INVALID_PRODUCTION_PLAN',field);}
function id(value,field){if(typeof value!=='string'||!ID.test(value))fail('INVALID_PRODUCTION_ID',field);return value;}
function text(value,field,max=4000){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('INVALID_PRODUCTION_TEXT',field);return value.trim();}
function list(value,field,max=100){if(!Array.isArray(value)||value.length>max)fail('INVALID_PRODUCTION_PLAN',field);return value;}
function referenceId(value,field){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value))fail('INVALID_PRODUCTION_ID',field);return value;}
function uniqueIds(value,field,validate=id){const values=list(value??[],field).map(v=>validate(v,field));if(new Set(values).size!==values.length)fail('DUPLICATE_PRODUCTION_ID',field);return values;}
function integer(value,field,min=0,max=3600000){if(!Number.isSafeInteger(value)||value<min||value>max)fail('INVALID_PRODUCTION_TIMELINE',field);return value;}
function flag(value,field){if(value!==undefined&&typeof value!=='boolean')fail('INVALID_PRODUCTION_PLAN',field);return value===true;}
const spokenKey=value=>value.normalize('NFKC').toLocaleLowerCase('ar').replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
const visualFields=(raw,names,field)=>Object.fromEntries(names.map(name=>[name,raw[name]==null?null:text(raw[name],field+'.'+name,2000)]));
export function validateProductionRouting(settings={}){
 object(settings,'modelSettings');keys(settings,['characterImageModelId','sceneImageModelId','imageEditModelId','animationModelId','fallbackAnimationModelId','fallbackEnabled'],'modelSettings');
 const output={characterImageModelId:settings.characterImageModelId??'flux2-klein-4b',sceneImageModelId:settings.sceneImageModelId??'flux2-klein-4b',imageEditModelId:settings.imageEditModelId??'qwen-image-edit-2511',animationModelId:settings.animationModelId??'wan22-i2v-a14b',fallbackAnimationModelId:settings.fallbackAnimationModelId??null,fallbackEnabled:flag(settings.fallbackEnabled,'modelSettings.fallbackEnabled')};
 if(output.characterImageModelId!=='flux2-klein-4b'||output.sceneImageModelId!=='flux2-klein-4b'||output.imageEditModelId!=='qwen-image-edit-2511'||!['wan22-i2v-a14b','hunyuanvideo15'].includes(output.animationModelId))fail('INVALID_MODEL_ROUTING','modelSettings');
 if(output.fallbackAnimationModelId!==null&&!['wan22-i2v-a14b','hunyuanvideo15'].includes(output.fallbackAnimationModelId))fail('INVALID_MODEL_ROUTING','modelSettings.fallbackAnimationModelId');
 if(output.fallbackEnabled&&(!output.fallbackAnimationModelId||output.fallbackAnimationModelId===output.animationModelId))fail('INVALID_MODEL_ROUTING','modelSettings.fallbackAnimationModelId');
 return output;
}

export function validateProductionPlan(input,{modelSettings={}}={}){
 object(input,'plan');keys(input,['id','schemaVersion','story','durationMs','referenceIds','characters','utterances','chapters','scenes','shots','routing','orientation','seed','visualStyle','videoResolution','narrators'],'plan');
 const orientation=input.orientation??null;if(orientation!==null&&!['portrait','landscape'].includes(orientation))fail('INVALID_PRODUCTION_PLAN','orientation');
 if(input.schemaVersion!==undefined&&input.schemaVersion!==PRODUCTION_PLAN_VERSION)fail('INVALID_PRODUCTION_PLAN','schemaVersion');
 const planId=id(input.id??'production-plan','id'),story=text(input.story,'story',1000000),durationMs=integer(input.durationMs,'durationMs',10000),referenceIds=uniqueIds(input.referenceIds,'referenceIds',referenceId),references=new Set(referenceIds),routing=validateProductionRouting(modelSettings);
 const ensureReferences=(values,field)=>{const result=uniqueIds(values,field,referenceId);if(result.some(v=>!references.has(v)))fail('UNDECLARED_REFERENCE',field);return result;};
 const contiguous=(sections,start,end,field)=>{let cursor=start;for(const section of sections){if(section.startMs!==cursor||section.endMs<=section.startMs)fail('INVALID_PRODUCTION_TIMELINE',field);cursor=section.endMs;}if(!sections.length||cursor!==end)fail('INVALID_PRODUCTION_TIMELINE',field);};
 const chapterIds=new Set(),chapters=list(input.chapters??[{id:'chapter-1',startMs:0,endMs:durationMs,title:'Chapter 1'}],'chapters',360).map((raw,index)=>{
  const field='chapters.'+index;object(raw,field);keys(raw,['id','startMs','endMs','title'],field);const chapterId=id(raw.id,field+'.id');if(chapterIds.has(chapterId))fail('DUPLICATE_PRODUCTION_ID',field);chapterIds.add(chapterId);
  return {id:chapterId,startMs:integer(raw.startMs,field+'.startMs',0,durationMs),endMs:integer(raw.endMs,field+'.endMs',1,durationMs),title:text(raw.title??chapterId,field+'.title',200)};
 });contiguous(chapters,0,durationMs,'chapters');
 const sceneIds=new Set(),scenes=list(input.scenes??chapters.map((c,i)=>({id:'scene-'+(i+1),chapterId:c.id,startMs:c.startMs,endMs:c.endMs,description:story})),'scenes',1000).map((raw,index)=>{
  const field='scenes.'+index;object(raw,field);keys(raw,['id','chapterId','startMs','endMs','description'],field);const sceneId=id(raw.id,field+'.id'),chapterId=id(raw.chapterId,field+'.chapterId');if(sceneIds.has(sceneId))fail('DUPLICATE_PRODUCTION_ID',field);sceneIds.add(sceneId);if(!chapterIds.has(chapterId))fail('UNKNOWN_CHAPTER',field+'.chapterId');
  const result={id:sceneId,chapterId,startMs:integer(raw.startMs,field+'.startMs',0,durationMs),endMs:integer(raw.endMs,field+'.endMs',1,durationMs),description:text(raw.description??story,field+'.description',30000)},chapter=chapters.find(c=>c.id===chapterId);
  if(result.startMs<chapter.startMs||result.endMs>chapter.endMs)fail('INVALID_PRODUCTION_TIMELINE',field);return result;
 });contiguous(scenes,0,durationMs,'scenes');for(const chapter of chapters)contiguous(scenes.filter(s=>s.chapterId===chapter.id),chapter.startMs,chapter.endMs,'scenes');
 const narratorIds=new Set(),narrators=list(input.narrators??[],'narrators',20).map((raw,index)=>{const f='narrators.'+index;object(raw,f);keys(raw,['id','name','voice'],f);const narratorId=id(raw.id,f+'.id');if(narratorIds.has(narratorId))fail('DUPLICATE_PRODUCTION_ID',f);narratorIds.add(narratorId);const v=object(raw.voice,f+'.voice');keys(v,['engineId','voiceId','locale'],f+'.voice');if(!own(VOICE_ENGINE_LOCALES,v.engineId)||!VOICE_ENGINE_LOCALES[v.engineId].includes(v.locale))fail('INVALID_VOICE_ROUTE',f);return {id:narratorId,name:text(raw.name,f+'.name',120),voice:{engineId:v.engineId,voiceId:referenceId(v.voiceId,f+'.voiceId'),locale:v.locale}};});
 const ids=new Set(),propDescriptions=new Map();
 const characters=list(input.characters,'characters',40).map((raw,index)=>{
  const field='characters.'+index;object(raw,field);keys(raw,['id','name','description','age','face','body','wardrobe','props','referenceIds','angles','voice','relationships','ageStage','environment','visualStyle','expression','pose'],field);
  const characterId=id(raw.id,field+'.id');if(ids.has(characterId))fail('DUPLICATE_PRODUCTION_ID',field+'.id');ids.add(characterId);
  if(raw.age!==null&&(!Number.isSafeInteger(raw.age)||raw.age<0||raw.age>120))fail('INVALID_CHARACTER_BIBLE',field+'.age');
  const voice=object(raw.voice,field+'.voice');keys(voice,['engineId','voiceId','locale'],field+'.voice');
  if(!own(VOICE_ENGINE_LOCALES,voice.engineId)||!VOICE_ENGINE_LOCALES[voice.engineId].includes(voice.locale))fail('INVALID_VOICE_ROUTE',field+'.voice');
  const props=list(raw.props??[],field+'.props').map((prop,i)=>{
   const where=field+'.props.'+i;object(prop,where);keys(prop,['id','description'],where);const key=id(prop.id,where+'.id'),description=text(prop.description,where+'.description',2000);
   if(propDescriptions.has(key)&&propDescriptions.get(key)!==description)fail('PROP_IDENTITY_CHANGED',where);propDescriptions.set(key,description);return {id:key,description};
  });
  if(new Set(props.map(p=>p.id)).size!==props.length)fail('DUPLICATE_PRODUCTION_ID',field+'.props');
  const angles=list(raw.angles??['front'],field+'.angles',12).map(a=>text(a,field+'.angles',100));if(!angles.length||new Set(angles).size!==angles.length)fail('INVALID_CHARACTER_BIBLE',field+'.angles');
  const relationships=list(raw.relationships??[],field+'.relationships').map((rel,i)=>{const where=field+'.relationships.'+i;object(rel,where);keys(rel,['characterId','description'],where);return {characterId:id(rel.characterId,where+'.characterId'),description:text(rel.description,where+'.description',1000)};});
  return {id:characterId,name:text(raw.name,field+'.name',120),description:text(raw.description,field+'.description'),age:raw.age,face:text(raw.face,field+'.face',2000),body:text(raw.body,field+'.body',2000),wardrobe:text(raw.wardrobe,field+'.wardrobe',2000),props,referenceIds:ensureReferences(raw.referenceIds,field+'.referenceIds'),angles,voice:{engineId:voice.engineId,voiceId:referenceId(voice.voiceId,field+'.voice.voiceId'),locale:voice.locale},relationships,...visualFields(raw,['ageStage','environment','visualStyle','expression','pose'],field)};
 });
 if(!characters.length&&!narrators.length)fail('INVALID_CHARACTER_BIBLE','characters');
 for(const c of characters)for(const rel of c.relationships)if(!ids.has(rel.characterId)||rel.characterId===c.id)fail('INVALID_CHARACTER_BIBLE','relationships');
 const spoken=new Map(),utteranceIds=new Set(),utterances=list(input.utterances??[],'utterances',1000).map((raw,index)=>{
  const field='utterances.'+index;object(raw,field);keys(raw,['id','characterId','text','startMs','endMs','repeatOf','intentionalRepeat','allowOverlap','narratorId','role','expression','speechChunks','speechPauses'],field);
  const utteranceId=id(raw.id,field+'.id'),narratorId=raw.narratorId==null?null:id(raw.narratorId,field+'.narratorId'),role=raw.role??(narratorId?'narration':'dialogue'),characterId=narratorId?null:id(raw.characterId,field+'.characterId');if(utteranceIds.has(utteranceId))fail('DUPLICATE_PRODUCTION_ID',field+'.id');if(!['dialogue','narration','vocal_event'].includes(role)||narratorId&&(!narratorIds.has(narratorId)||raw.characterId!=null)||role==='narration'&&!narratorId||role==='dialogue'&&narratorId)fail('INVALID_VOICE_ROUTE',field);if(!narratorId&&!ids.has(characterId))fail('UNKNOWN_CHARACTER',field+'.characterId');const speakerKey=narratorId?'narrator:'+narratorId:'character:'+characterId;
  const line=text(raw.text,field+'.text',30000),startMs=integer(raw.startMs,field+'.startMs',0,durationMs),endMs=integer(raw.endMs,field+'.endMs',1,durationMs);if(endMs<=startMs)fail('INVALID_PRODUCTION_TIMELINE',field);
  const intentionalRepeat=flag(raw.intentionalRepeat,field+'.intentionalRepeat'),allowOverlap=flag(raw.allowOverlap,field+'.allowOverlap'),repeatOf=raw.repeatOf==null?null:id(raw.repeatOf,field+'.repeatOf');
  const prior=spoken.get(speakerKey+'\n'+spokenKey(line));
  if((prior&&!intentionalRepeat)||intentionalRepeat&&(!repeatOf||!prior||prior.id!==repeatOf)||repeatOf&&!intentionalRepeat)fail('DUPLICATE_UTTERANCE',field);
  const expression=raw.expression==null?'neutral':text(raw.expression,field+'.expression',100),speechPauses=list(raw.speechPauses??[],field+'.speechPauses',1000).map(p=>{object(p,field);keys(p,['afterOffset','durationMs'],field);return {afterOffset:integer(p.afterOffset,field,1,line.length),durationMs:integer(p.durationMs,field,0,5000)};}),speechChunks=list(raw.speechChunks??[],field+'.speechChunks',1000).map((p,i)=>{object(p,field);keys(p,['index','text','startOffset','endOffset','pauseAfterMs'],field);const result={index:integer(p.index,field,0,999),text:typeof p.text==='string'?p.text:fail('INVALID_PRODUCTION_TEXT',field),startOffset:integer(p.startOffset,field,0,line.length),endOffset:integer(p.endOffset,field,1,line.length),pauseAfterMs:integer(p.pauseAfterMs??0,field,0,5000)};if(result.index!==i||line.slice(result.startOffset,result.endOffset)!==result.text||result.endOffset<=result.startOffset)fail('INVALID_PRODUCTION_PLAN',field);return result;});if(speechChunks.length&&(speechChunks.map(p=>p.text).join('')!==line||speechChunks.some((p,i)=>p.startOffset!==(i?speechChunks[i-1].endOffset:0))))fail('INVALID_PRODUCTION_PLAN',field);
  const result={id:utteranceId,characterId,narratorId,role,expression,speechChunks,speechPauses,text:line,startMs,endMs,intentionalRepeat,repeatOf,allowOverlap};spoken.set(speakerKey+'\n'+spokenKey(line),result);utteranceIds.add(utteranceId);return result;
 });
 for(let i=0;i<utterances.length;i++)for(let j=i+1;j<utterances.length;j++){
  const a=utterances[i],b=utterances[j];if(a.startMs<b.endMs&&b.startMs<a.endMs&&((a.narratorId?'narrator:'+a.narratorId:'character:'+a.characterId)===(b.narratorId?'narrator:'+b.narratorId:'character:'+b.characterId)||!a.allowOverlap||!b.allowOverlap))fail('OVERLAPPING_DIALOGUE','utterances');
 }
 const shotIds=new Set(),effectIds=new Set(),events=new Map(),prompts=new Map(),shots=list(input.shots,'shots',1000).map((raw,index)=>{
  const field='shots.'+index;object(raw,field);keys(raw,['id','chapterId','sceneId','startMs','endMs','prompt','characterIds','propIds','referenceIds','utteranceIds','eventIds','intentionalRepeatOf','location','characterMotion','cameraMotion','soundEffects','lighting','cameraAngle','framing','visualStyle','time','era','allowText','requestedText','characterEdits','motionPlan','motionBeats','wanSegment','videoModelId','generationMode','videoSelectionIntent','videoSelection','requires_lip_sync','audioCue','transition'],field);
  const shotId=id(raw.id,field+'.id');if(shotIds.has(shotId))fail('DUPLICATE_PRODUCTION_ID',field+'.id');shotIds.add(shotId);
  const startMs=integer(raw.startMs,field+'.startMs',0,durationMs),endMs=integer(raw.endMs,field+'.endMs',1,durationMs);if(endMs<=startMs)fail('INVALID_PRODUCTION_TIMELINE',field);
  const selectedScene=raw.sceneId===undefined?scenes.find(scene=>scene.startMs<=startMs&&scene.endMs>=endMs):scenes.find(scene=>scene.id===raw.sceneId);
  if(!selectedScene)fail('UNKNOWN_SCENE',field+'.sceneId');if(startMs<selectedScene.startMs||endMs>selectedScene.endMs)fail('INVALID_PRODUCTION_TIMELINE',field+'.sceneId');
  if(raw.chapterId!==undefined&&raw.chapterId!==selectedScene.chapterId)fail('UNKNOWN_CHAPTER',field+'.chapterId');
  const prompt=text(raw.prompt,field+'.prompt',8000),characterIds=uniqueIds(raw.characterIds,field+'.characterIds'),propIds=uniqueIds(raw.propIds,field+'.propIds'),lines=uniqueIds(raw.utteranceIds,field+'.utteranceIds'),eventIds=uniqueIds(raw.eventIds,field+'.eventIds');
  if(!eventIds.length)fail('INVALID_STORY_EVENT',field+'.eventIds');if(characterIds.some(c=>!ids.has(c)))fail('UNKNOWN_CHARACTER',field+'.characterIds');if(propIds.some(p=>!propDescriptions.has(p)))fail('UNKNOWN_PROP',field+'.propIds');if(lines.some(u=>!utteranceIds.has(u)))fail('UNKNOWN_UTTERANCE',field+'.utteranceIds');
  const intentionalRepeatOf=raw.intentionalRepeatOf==null?null:id(raw.intentionalRepeatOf,field+'.intentionalRepeatOf'),priorPrompt=prompts.get(spokenKey(prompt)),duplicateEvents=eventIds.filter(event=>events.has(event));
  if(intentionalRepeatOf&&(!shotIds.has(intentionalRepeatOf)||intentionalRepeatOf===shotId))fail('INVALID_STORY_REPEAT',field);
  if((priorPrompt||duplicateEvents.length)&&!intentionalRepeatOf)fail('DUPLICATE_STORY_EVENT',field);
  if(intentionalRepeatOf&&(!duplicateEvents.some(event=>events.get(event)===intentionalRepeatOf)&&priorPrompt!==intentionalRepeatOf))fail('INVALID_STORY_REPEAT',field);
  if(duplicateEvents.some(event=>events.get(event)!==intentionalRepeatOf)||priorPrompt&&priorPrompt!==intentionalRepeatOf)fail('INVALID_STORY_REPEAT',field);
  const location=raw.location==null?null:text(raw.location,field+'.location',2000),characterMotion=raw.characterMotion==null?null:text(raw.characterMotion,field+'.characterMotion',4000),cameraMotion=raw.cameraMotion==null?null:text(raw.cameraMotion,field+'.cameraMotion',2000);
  const soundEffects=list(raw.soundEffects??[],field+'.soundEffects',100).map((effect,i)=>{
   const where=field+'.soundEffects.'+i;object(effect,where);keys(effect,['id','description','startMs','endMs','assetId','category','layer','gainDb','duckingRequested','sourceOffsetMs','requested','eventAnchor'],where);const effectId=id(effect.id,where+'.id');if(effectIds.has(effectId))fail('DUPLICATE_PRODUCTION_ID',where+'.id');effectIds.add(effectId);
   const result={id:effectId,description:text(effect.description,where+'.description',2000),startMs:integer(effect.startMs??(effect.eventAnchor?startMs:undefined),where+'.startMs',startMs,endMs),endMs:integer(effect.endMs??(effect.eventAnchor?Math.min(endMs,startMs+effect.eventAnchor.durationMs):undefined),where+'.endMs',startMs,endMs)};
   if(effect.category!==undefined){if(!['vocal_event','ambience','foley','music','intentional_silence'].includes(effect.category))fail('INVALID_PRODUCTION_PLAN',where);result.category=effect.category;}if(effect.layer!==undefined){if(!['narration','dialogue','vocal_event','ambience','foley','music','intentional_silence'].includes(effect.layer))fail('INVALID_PRODUCTION_PLAN',where);result.layer=effect.layer;}if(effect.gainDb!==undefined){if(typeof effect.gainDb!=='number'||!Number.isFinite(effect.gainDb)||effect.gainDb< -60||effect.gainDb>0)fail('INVALID_PRODUCTION_PLAN',where);result.gainDb=effect.gainDb;}for(const key of ['duckingRequested','requested'])if(effect[key]!==undefined)result[key]=flag(effect[key],where+'.'+key);if(effect.sourceOffsetMs!==undefined)result.sourceOffsetMs=integer(effect.sourceOffsetMs,where,0,3600000);if(effect.eventAnchor!==undefined){object(effect.eventAnchor,where);keys(effect.eventAnchor,['eventId','offsetMs','durationMs'],where);const eventId=id(effect.eventAnchor.eventId,where);if(!eventIds.includes(eventId))fail('INVALID_STORY_EVENT',where);result.eventAnchor={eventId,offsetMs:integer(effect.eventAnchor.offsetMs??0,where,0,endMs-startMs),durationMs:integer(effect.eventAnchor.durationMs,where,1,endMs-startMs)};}
   if(result.endMs<=result.startMs)fail('INVALID_PRODUCTION_TIMELINE',where);if(effect.assetId!==undefined)result.assetId=referenceId(effect.assetId,where+'.assetId');return result;
  });
  for(const event of eventIds)events.set(event,shotId);prompts.set(spokenKey(prompt),shotId);
  const videoModelId=raw.videoModelId??null,generationMode=raw.generationMode??'image_to_video',videoSelectionIntent=raw.videoSelectionIntent??null;if(videoModelId!==null&&!['wan22-i2v-a14b','hunyuanvideo15'].includes(videoModelId)||!['image_to_video','text_to_video'].includes(generationMode)||videoSelectionIntent!==null&&!['quiet','complex_motion','cost'].includes(videoSelectionIntent))fail('INVALID_MODEL_ROUTING',field);let videoSelection=null;if(raw.videoSelection!=null){object(raw.videoSelection,field+'.videoSelection');keys(raw.videoSelection,['modelId','reason','source','automaticFallback'],field+'.videoSelection');if(raw.videoSelection.modelId!==videoModelId||raw.videoSelection.automaticFallback!==false)fail('INVALID_MODEL_ROUTING',field);videoSelection={modelId:videoModelId,reason:text(raw.videoSelection.reason,field,100),source:text(raw.videoSelection.source,field,100),automaticFallback:false};}
  const motion=value=>{object(value,field+'.motion');keys(value,['start','development','end','camera'],field+'.motion');return Object.fromEntries(['start','development','end','camera'].map(k=>[k,text(value[k],field+'.motion.'+k,4000)]));};
  const motionPlan=raw.motionPlan==null?null:motion(raw.motionPlan),motionBeats=list(raw.motionBeats??[],field+'.motionBeats',720).map(motion);let wanSegment=null;if(raw.wanSegment!=null){object(raw.wanSegment,field+'.wanSegment');keys(raw.wanSegment,['sourceShotId','index','count'],field+'.wanSegment');wanSegment={sourceShotId:id(raw.wanSegment.sourceShotId,field+'.wanSegment.sourceShotId'),index:integer(raw.wanSegment.index,field+'.wanSegment.index',0,719),count:integer(raw.wanSegment.count,field+'.wanSegment.count',1,720)};if(wanSegment.index>=wanSegment.count)fail('INVALID_PRODUCTION_PLAN',field);}
  const characterEdits=list(raw.characterEdits??[],field+'.characterEdits',40).map((edit,i)=>{const f=field+'.characterEdits.'+i;object(edit,f);keys(edit,['characterId','expression','pose','wardrobe','reason'],f);const characterId=id(edit.characterId,f+'.characterId');if(!characterIds.includes(characterId))fail('UNKNOWN_CHARACTER',f);const value={characterId,...visualFields(edit,['expression','pose','wardrobe','reason'],f)};if(value.wardrobe&&!value.reason)fail('INVALID_CHARACTER_BIBLE',f+'.reason');return value;});if(new Set(characterEdits.map(e=>e.characterId)).size!==characterEdits.length)fail('DUPLICATE_PRODUCTION_ID',field+'.characterEdits');
  const allowText=flag(raw.allowText,field+'.allowText'),requestedText=raw.requestedText==null?null:text(raw.requestedText,field+'.requestedText',1000);if(allowText!==!!requestedText)fail('INVALID_PRODUCTION_PLAN',field+'.requestedText');let audioCue=null;if(raw.audioCue!=null){object(raw.audioCue,field+'.audioCue');keys(raw.audioCue,['utteranceId','wordIndex','sentenceIndex'],field+'.audioCue');audioCue={utteranceId:id(raw.audioCue.utteranceId,field),wordIndex:raw.audioCue.wordIndex==null?null:integer(raw.audioCue.wordIndex,field,0,10000),sentenceIndex:raw.audioCue.sentenceIndex==null?null:integer(raw.audioCue.sentenceIndex,field,0,1000)};if(!utteranceIds.has(audioCue.utteranceId)||(audioCue.wordIndex===null)===(audioCue.sentenceIndex===null))fail('INVALID_PRODUCTION_TIMELINE',field+'.audioCue');}let transition=null;if(raw.transition!=null){object(raw.transition,field+'.transition');keys(raw.transition,['type','durationMs','requested'],field);if(!['cut','fade'].includes(raw.transition.type)||raw.transition.requested!==true)fail('INVALID_PRODUCTION_PLAN',field);transition={type:raw.transition.type,durationMs:integer(raw.transition.durationMs,field,0,Math.min(500,(endMs-startMs)/2)),requested:true};if(transition.type==='fade'&&!transition.durationMs)fail('INVALID_PRODUCTION_PLAN',field);}return {transition,audioCue,requires_lip_sync:flag(raw.requires_lip_sync,field+'.requires_lip_sync'),videoModelId,generationMode,videoSelectionIntent,videoSelection,motionPlan,motionBeats,wanSegment,allowText,requestedText,characterEdits,...visualFields(raw,['lighting','cameraAngle','framing','visualStyle','time','era'],field),id:shotId,chapterId:selectedScene.chapterId,sceneId:selectedScene.id,startMs,endMs,prompt,characterIds,propIds,referenceIds:ensureReferences(raw.referenceIds,field+'.referenceIds'),utteranceIds:lines,eventIds,intentionalRepeatOf,location,characterMotion,cameraMotion,soundEffects};
 });
 if(!shots.length)fail('INVALID_PRODUCTION_TIMELINE','shots');
 let cursor=0;for(const shot of shots){if(shot.startMs!==cursor)fail('INVALID_PRODUCTION_TIMELINE','shots');cursor=shot.endMs;
  const expected=utterances.filter(u=>u.startMs<shot.endMs&&u.endMs>shot.startMs).map(u=>u.id);if(expected.length!==shot.utteranceIds.length||expected.some(u=>!shot.utteranceIds.includes(u)))fail('DIALOGUE_SHOT_TIMING_MISMATCH','shots.'+shot.id);
 }if(cursor!==durationMs)fail('INVALID_PRODUCTION_TIMELINE','durationMs');
 const videoResolution=input.videoResolution??'720p';if(!['480p','720p'].includes(videoResolution))fail('INVALID_PRODUCTION_PLAN','videoResolution');
 const seed=input.seed==null?42:integer(input.seed,'seed',0,4294967295),visualStyle=input.visualStyle==null?null:text(input.visualStyle,'visualStyle',2000);return {schemaVersion:PRODUCTION_PLAN_VERSION,id:planId,story,durationMs,orientation,seed,visualStyle,videoResolution,referenceIds,characters,narrators,utterances,chapters,scenes,shots,routing};
}

export function stagesForPlan(input,{referenceConditioningModelId=null,imageEditModelId=null,voiceChunking=false,cinematicSync=false,finalComposer=false}={}){
 if(referenceConditioningModelId!==null&&referenceConditioningModelId!=='flux2-klein-4b')fail('INVALID_MODEL_ROUTING','referenceConditioningModelId');
 if(imageEditModelId!==null&&imageEditModelId!=='qwen-image-edit-2511')fail('INVALID_MODEL_ROUTING','imageEditModelId');
 const plan=validateProductionPlan(input,{modelSettings:input.routing??{}}),stages=[{id:'analyze',kind:'analyze',deps:[]},{id:'plan',kind:'plan',deps:['analyze']}],images=new Map();
 for(const c of plan.characters){const ids=[];for(let i=0;i<c.angles.length;i++){
  const stageId='character_image:'+c.id+':'+i,primary='character_image:'+c.id+':0';ids.push(stageId);stages.push({id:stageId,kind:'character_image',deps:(referenceConditioningModelId||imageEditModelId)&&i>0?['plan',primary]:['plan'],modelId:imageEditModelId&&(i>0||c.referenceIds.length)?imageEditModelId:referenceConditioningModelId??(c.referenceIds.length?plan.routing.imageEditModelId:plan.routing.characterImageModelId),subjectId:c.id,angleIndex:i});
 }images.set(c.id,ids);}
 for(const u of plan.utterances){const c=u.narratorId?plan.narrators.find(c=>c.id===u.narratorId):plan.characters.find(c=>c.id===u.characterId),chunks=u.speechChunks??[],merge=voiceChunking&&(chunks.length>1||chunks.some(c=>c.pauseAfterMs>0));if(merge){const deps=[];for(const chunk of chunks){const key='voice_chunk:'+u.id+':'+chunk.index;deps.push(key);stages.push({id:key,kind:'voice',deps:['plan'],modelId:c.voice.engineId,subjectId:u.id,chunkIndex:chunk.index});}stages.push({id:'voice:'+u.id,kind:'voice_merge',deps,subjectId:u.id});}else stages.push({id:'voice:'+u.id,kind:'voice',deps:['plan'],modelId:c.voice.engineId,subjectId:u.id,...(voiceChunking?{chunkIndex:0}:{})});}
 if(cinematicSync){for(const u of plan.utterances){const chunks=u.speechChunks??[],merge=voiceChunking&&(chunks.length>1||chunks.some(c=>c.pauseAfterMs>0));if(merge){const deps=chunks.map(c=>'align_chunk:'+u.id+':'+c.index);for(const chunk of chunks)stages.push({id:'align_chunk:'+u.id+':'+chunk.index,kind:'align',deps:['voice_chunk:'+u.id+':'+chunk.index],modelId:'latentsync16',subjectId:u.id,chunkIndex:chunk.index});stages.push({id:'align:'+u.id,kind:'alignment_merge',deps:[...deps,'voice:'+u.id],subjectId:u.id});}else stages.push({id:'align:'+u.id,kind:'align',deps:['voice:'+u.id],modelId:'latentsync16',subjectId:u.id,chunkIndex:0});}stages.push({id:'timeline_sync',kind:'timeline_sync',deps:[...plan.shots.map(s=>'animate:'+s.id),...plan.utterances.flatMap(u=>['voice:'+u.id,'align:'+u.id])]});}
 for(const s of plan.shots){
  const imageId='scene_image:'+s.id,animateId='animate:'+s.id,syncId='sync:'+s.id,effectsId='effects:'+s.id;
  if(s.generationMode!=='text_to_video')stages.push({id:imageId,kind:'scene_image',deps:['plan',...s.characterIds.flatMap(c=>images.get(c))],modelId:imageEditModelId&&(s.characterIds.length||s.referenceIds.length)?imageEditModelId:referenceConditioningModelId??(s.referenceIds.length?plan.routing.imageEditModelId:plan.routing.sceneImageModelId),subjectId:s.id});
  stages.push({id:animateId,kind:'animate',deps:s.generationMode==='text_to_video'?['plan']:[imageId],modelId:s.videoModelId??plan.routing.animationModelId,subjectId:s.id});
  if(cinematicSync&&s.requires_lip_sync)stages.push({id:'lip_sync:'+s.id,kind:'lip_sync',deps:[animateId,'timeline_sync',...s.utteranceIds.flatMap(u=>['voice:'+u,'align:'+u])],modelId:'latentsync16',subjectId:s.id});
  stages.push({id:syncId,kind:'sync',deps:[cinematicSync&&s.requires_lip_sync?'lip_sync:'+s.id:animateId,...s.utteranceIds.map(u=>'voice:'+u),...(cinematicSync?['timeline_sync']:[])],subjectId:s.id});
  stages.push({id:effectsId,kind:'effects',deps:[syncId],subjectId:s.id});
  const chapter=plan.chapters.find(c=>c.id===s.chapterId);
  if(s.endMs===chapter.endMs)stages.push({id:'chapter_merge:'+chapter.id,kind:'merge',scope:'chapter',deps:[...plan.shots.filter(shot=>shot.chapterId===chapter.id).map(shot=>'effects:'+shot.id),...plan.utterances.filter(u=>u.startMs<chapter.endMs&&u.endMs>chapter.startMs).map(u=>'voice:'+u.id)],subjectId:chapter.id});
 }
 stages.push({id:'merge',kind:'merge',scope:'film',deps:[...plan.chapters.map(c=>'chapter_merge:'+c.id),...plan.utterances.map(u=>'voice:'+u.id)]});
 if(finalComposer)stages.push({id:'quality',kind:'quality',deps:['merge']});
 stages.push({id:'save',kind:'save',deps:finalComposer?['merge','quality']:['merge']});
 // Fallback is metadata for an explicitly configured future decision, never an
 // extra DAG node, an automatic retry or a second paid generation attempt.
 if(cinematicSync){const pending=[...stages],sorted=[],seen=new Set();while(pending.length){const at=pending.findIndex(s=>s.deps.every(d=>seen.has(d)));if(at<0)fail('INVALID_PRODUCTION_TIMELINE','stageDependencies');const [stage]=pending.splice(at,1);sorted.push(stage);seen.add(stage.id);}return sorted;}
 return stages;
}
