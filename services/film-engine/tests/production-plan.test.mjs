import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProductionPlan,stagesForPlan,validateProductionRouting,VOICE_ENGINE_LOCALES} from '../engine/production-plan.mjs';

function fixture(){return {
 id:'wallet-story',story:'حسن يجد محفظة في شارع عراقي معاصر ويسلمها لصاحبها.',durationMs:60000,referenceIds:['hassan-ref','courtyard-ref'],
 characters:[
  {id:'hassan',name:'حسن',description:'شاب عراقي واقعي',age:28,face:'عينان بنيتان ولحية قصيرة',body:'متوسط الطول',wardrobe:'قميص أزرق',props:[{id:'wallet',description:'محفظة جلد بنية صغيرة ومسطحة'}],referenceIds:['hassan-ref'],angles:['front','profile'],voice:{engineId:'habibi-irq',voiceId:'hassan-voice',locale:'ar-IQ'},relationships:[{characterId:'abu-ali',description:'جار أكبر منه سناً'}]},
  {id:'abu-ali',name:'أبو علي',description:'رجل عراقي واقعي',age:62,face:'شعر رمادي وتجاعيد خفيفة',body:'نحيف',wardrobe:'قميص بيج',props:[],referenceIds:[],angles:['front'],voice:{engineId:'habibi-irq',voiceId:'abu-ali-voice',locale:'ar-IQ'},relationships:[]},
 ],
 utterances:[
  {id:'line-one',characterId:'hassan',text:'عمي، هاي محفظتك؟ لقيتها يم الباب.',startMs:4000,endMs:14000},
  {id:'line-two',characterId:'abu-ali',text:'إي ابني، شكراً إلك. كنت أدور عليها.',startMs:17000,endMs:28000},
 ],
 shots:[
  {id:'find',startMs:0,endMs:10000,prompt:'Hassan notices a small flat brown wallet beside a doorway, picks it up and addresses his neighbour.',characterIds:['hassan'],propIds:['wallet'],referenceIds:['courtyard-ref'],utteranceIds:['line-one'],eventIds:['wallet-found']},
  {id:'ask',startMs:10000,endMs:20000,prompt:'The neighbour turns toward Hassan and recognizes the wallet while Hassan holds it flat in his hand.',characterIds:['hassan','abu-ali'],propIds:['wallet'],referenceIds:[],utteranceIds:['line-one','line-two'],eventIds:['owner-recognizes']},
  {id:'return',startMs:20000,endMs:30000,prompt:'Hassan hands the wallet to the neighbour, who checks its familiar worn corner.',characterIds:['hassan','abu-ali'],propIds:['wallet'],referenceIds:[],utteranceIds:['line-two'],eventIds:['wallet-returned']},
  {id:'leave',startMs:30000,endMs:45000,prompt:'The neighbour places the wallet safely in his shirt pocket, smiles and gestures toward the courtyard.',characterIds:['abu-ali'],propIds:['wallet'],referenceIds:[],utteranceIds:[],eventIds:['wallet-secured']},
  {id:'end',startMs:45000,endMs:60000,prompt:'The two neighbours walk into the courtyard together; the camera follows their unhurried movement.',characterIds:['hassan','abu-ali'],propIds:[],referenceIds:[],utteranceIds:[],eventIds:['neighbours-depart']},
 ],
};}
const copy=value=>structuredClone(value);

test('normalizes a sixty-second storyboard without mutating character identities or original input',()=>{
 const raw=fixture(),before=copy(raw),plan=validateProductionPlan(raw);
 assert.equal(plan.durationMs,60000);assert.equal(plan.shots.at(-1).endMs,60000);assert.equal(plan.characters[0].voice.voiceId,'hassan-voice');assert.deepEqual(raw,before);
 assert.equal(plan.routing.animationModelId,'wan22-i2v-a14b');assert.equal(plan.routing.fallbackEnabled,false);assert.equal(plan.routing.fallbackAnimationModelId,null);
});

test('a continuous utterance spans shots but has one voice stage; merge places its audio once',()=>{
 const plan=validateProductionPlan(fixture()),stages=stagesForPlan(plan),voice=stages.filter(s=>s.kind==='voice');
 assert.equal(voice.length,2);assert.equal(stages.filter(s=>s.id==='voice:line-one').length,1);
 assert.ok(stages.find(s=>s.id==='sync:find').deps.includes('voice:line-one'));assert.ok(stages.find(s=>s.id==='sync:ask').deps.includes('voice:line-one'));
 assert.equal(stages.find(s=>s.id==='merge').deps.filter(x=>x==='voice:line-one').length,1);
});

test('DAG is deterministic, topologically ordered and complete without executing models',()=>{
 const plan=validateProductionPlan(fixture()),stages=stagesForPlan(plan);assert.deepEqual(stagesForPlan(plan),stages);
 const seen=new Set();for(const stage of stages){assert.ok(stage.deps.every(dep=>seen.has(dep)),stage.id);assert.ok(!seen.has(stage.id));seen.add(stage.id);}
 assert.deepEqual(new Set(stages.map(s=>s.kind)),new Set(['analyze','plan','character_image','scene_image','animate','voice','sync','effects','merge','save']));
 assert.equal(stages.at(-1).id,'save');assert.equal(stages.filter(s=>s.kind==='character_image').length,3);
});

test('routing uses the fixed image/edit/video models and has no automatic fallback stages',()=>{
 const raw=fixture(),plan=validateProductionPlan(raw,{modelSettings:{fallbackAnimationModelId:'hunyuanvideo15',fallbackEnabled:true}}),stages=stagesForPlan(plan);
 assert.equal(stages.find(s=>s.id==='character_image:hassan:0').modelId,'qwen-image-edit-2511');
 assert.equal(stages.find(s=>s.id==='character_image:abu-ali:0').modelId,'flux2-klein-4b');
 assert.equal(stages.find(s=>s.id==='scene_image:find').modelId,'qwen-image-edit-2511');
 assert.ok(stages.filter(s=>s.kind==='animate').every(s=>s.modelId==='wan22-i2v-a14b'));
 assert.equal(stages.some(s=>s.modelId==='hunyuanvideo15'),false);
 const configured=validateProductionPlan(raw,{modelSettings:{animationModelId:'hunyuanvideo15'}});assert.ok(stagesForPlan(configured).filter(s=>s.kind==='animate').every(s=>s.modelId==='hunyuanvideo15'));
});

test('unconfigured, unknown or self-referencing fallback cannot enter the plan',()=>{
 for(const modelSettings of [{animationModelId:'unknown'},{fallbackEnabled:true},{fallbackEnabled:true,fallbackAnimationModelId:'wan22-i2v-a14b'},{characterImageModelId:'custom'},{endpoint:'https://private.invalid'}])assert.throws(()=>validateProductionPlan(fixture(),{modelSettings}),/INVALID_MODEL_ROUTING|INVALID_PRODUCTION_PLAN/);
});

test('shot timeline rejects gaps, overlaps, missing tail and invalid time units',()=>{
 for(const change of [p=>p.shots[1].startMs++,p=>p.shots[1].startMs--,p=>p.shots.at(-1).endMs--,p=>p.shots[0].startMs=1,p=>p.shots[0].endMs=.5,p=>p.durationMs='60000',p=>p.shots=[]]){const p=fixture();change(p);assert.throws(()=>validateProductionPlan(p),/INVALID_PRODUCTION_TIMELINE/);}
});

test('each timed utterance is bound to every overlapping shot and cannot silently disappear',()=>{
 const p=fixture();p.shots[1].utteranceIds=['line-two'];assert.throws(()=>validateProductionPlan(p),/DIALOGUE_SHOT_TIMING_MISMATCH/);
 const missing=fixture();missing.shots[0].utteranceIds=['unknown-line'];assert.throws(()=>validateProductionPlan(missing),/UNKNOWN_UTTERANCE/);
 const wrong=fixture();wrong.utterances[0].endMs=61000;assert.throws(()=>validateProductionPlan(wrong),/INVALID_PRODUCTION_TIMELINE/);
});

test('overlapping dialogue requires two explicit flags and one character cannot speak twice simultaneously',()=>{
 const p=fixture();p.utterances[1].startMs=9000;p.shots[0].utteranceIds.push('line-two');assert.throws(()=>validateProductionPlan(p),/OVERLAPPING_DIALOGUE/);
 p.utterances[0].allowOverlap=true;p.utterances[1].allowOverlap=true;assert.doesNotThrow(()=>validateProductionPlan(p));
 p.utterances[1].characterId='hassan';assert.throws(()=>validateProductionPlan(p),/OVERLAPPING_DIALOGUE/);
});

test('speaker and voice stay locked in CharacterBible; unsupported dialect or per-line override rejects',()=>{
 for(const change of [p=>p.utterances[0].characterId='missing',p=>p.utterances[0].voiceId='other',p=>p.characters[0].voice.engineId='unknown',p=>p.characters[0].voice.locale='ar-EG']){const p=fixture();change(p);assert.throws(()=>validateProductionPlan(p),/UNKNOWN_CHARACTER|INVALID_PRODUCTION_PLAN|INVALID_VOICE_ROUTE/);}
 assert.deepEqual(VOICE_ENGINE_LOCALES['habibi-irq'],['ar-IQ']);
});

test('Habibi MSA and Egyptian and Audar declared locale routes are accepted without claiming synthesis',()=>{
 for(const [engineId,locale] of [['habibi-msa','ar'],['habibi-egy','ar-EG'],['audar-tts-v1-flash','ar'],['audar-tts-v1-flash','en']]){const p=fixture();p.characters[0].voice={engineId,locale,voiceId:'voice-one'};assert.doesNotThrow(()=>validateProductionPlan(p));}
});

test('exact repeated lines require explicit intentional repeat referencing the prior line',()=>{
 const p=fixture();p.utterances.push({id:'line-repeat',characterId:'hassan',text:p.utterances[0].text,startMs:32000,endMs:35000});p.shots[3].utteranceIds=['line-repeat'];assert.throws(()=>validateProductionPlan(p),/DUPLICATE_UTTERANCE/);
 p.utterances.at(-1).intentionalRepeat=true;p.utterances.at(-1).repeatOf='line-one';assert.doesNotThrow(()=>validateProductionPlan(p));
 p.utterances.at(-1).repeatOf='line-two';assert.throws(()=>validateProductionPlan(p),/DUPLICATE_UTTERANCE/);
});

test('event IDs and repeated visual prompts cannot repeat accidentally',()=>{
 const p=fixture();p.shots[1].eventIds=['wallet-found'];assert.throws(()=>validateProductionPlan(p),/DUPLICATE_STORY_EVENT/);
 p.shots[1].intentionalRepeatOf='find';assert.doesNotThrow(()=>validateProductionPlan(p));
 const repeated=fixture();repeated.shots[1].prompt=repeated.shots[0].prompt;assert.throws(()=>validateProductionPlan(repeated),/DUPLICATE_STORY_EVENT/);
 const fake=fixture();fake.shots[1].intentionalRepeatOf='future';assert.throws(()=>validateProductionPlan(fake),/INVALID_STORY_REPEAT/);
});

test('reference IDs must be declared and safe; ownership remains caller responsibility',()=>{
 for(const change of [p=>p.characters[0].referenceIds=['unknown'],p=>p.shots[0].referenceIds=['unknown'],p=>p.referenceIds=['../secret'],p=>p.referenceIds=['ref','ref']]){const p=fixture();change(p);assert.throws(()=>validateProductionPlan(p),/UNDECLARED_REFERENCE|INVALID_PRODUCTION_ID|DUPLICATE_PRODUCTION_ID/);}
});

test('stable prop identifiers cannot become a different object or undeclared prop',()=>{
 const p=fixture();p.characters[1].props=[{id:'wallet',description:'حقيبة كبيرة'}];assert.throws(()=>validateProductionPlan(p),/PROP_IDENTITY_CHANGED/);
 const unknown=fixture();unknown.shots[0].propIds=['bag'];assert.throws(()=>validateProductionPlan(unknown),/UNKNOWN_PROP/);
 const same=fixture();same.characters[1].props=copy(same.characters[0].props);assert.doesNotThrow(()=>validateProductionPlan(same));
});

test('Bible rejects duplicate characters, invalid relationships, missing age and wrong shape',()=>{
 for(const change of [p=>p.characters[1].id='hassan',p=>p.characters[0].relationships[0].characterId='unknown',p=>delete p.characters[0].age,p=>p.characters[0].age=-1,p=>p.characters[0].voice=null,p=>p.characters[0].angles=[],p=>p.characters[0].referenceURL='https://private.invalid',p=>p.shots[0].eventIds=[]]){const p=fixture();change(p);assert.throws(()=>validateProductionPlan(p),/DUPLICATE_PRODUCTION_ID|INVALID_CHARACTER_BIBLE|INVALID_PRODUCTION_PLAN|INVALID_STORY_EVENT/);}
});

test('output is safely revalidated and contains no guessed revisions, readiness or generated artifacts',()=>{
 const p=validateProductionPlan(fixture());assert.deepEqual(validateProductionPlan(p,{modelSettings:p.routing}),p);assert.equal('ready' in p,false);assert.equal('artifacts' in p,false);assert.equal('revision' in p.routing,false);
 const invalid=fixture();invalid.apiKey='never-allowed';assert.throws(()=>validateProductionPlan(invalid),error=>error.code==='INVALID_PRODUCTION_PLAN'&&!error.message.includes('never-allowed'));
});

test('ten-minute mock plan has chapter/scene/shot hierarchy and progressive chapter merges',()=>{
 const p=fixture();p.durationMs=600000;p.utterances=[];
 p.chapters=[{id:'opening',startMs:0,endMs:300000,title:'البداية'},{id:'resolution',startMs:300000,endMs:600000,title:'الحل'}];
 p.scenes=[{id:'street',chapterId:'opening',startMs:0,endMs:150000,description:'الشارع'},{id:'courtyard',chapterId:'opening',startMs:150000,endMs:300000,description:'الباحة'},{id:'home',chapterId:'resolution',startMs:300000,endMs:600000,description:'البيت'}];
 p.shots=Array.from({length:20},(_,i)=>({id:'shot-'+i,startMs:i*30000,endMs:(i+1)*30000,prompt:'A distinct planned action number '+i,characterIds:['hassan'],propIds:[],referenceIds:[],utteranceIds:[],eventIds:['event-'+i],sceneId:i<5?'street':i<10?'courtyard':'home',chapterId:i<10?'opening':'resolution'}));
 const plan=validateProductionPlan(p),stages=stagesForPlan(plan);assert.equal(plan.durationMs,600000);assert.equal(plan.chapters.length,2);assert.equal(plan.scenes.length,3);assert.equal(plan.shots.length,20);
 const openingMerge=stages.find(s=>s.id==='chapter_merge:opening');assert.equal(openingMerge.scope,'chapter');assert.equal(openingMerge.deps.length,10);
 assert.ok(stages.indexOf(openingMerge)<stages.findIndex(s=>s.id==='scene_image:shot-10'));
 assert.deepEqual(stages.find(s=>s.id==='merge').deps,['chapter_merge:opening','chapter_merge:resolution']);
 const seen=new Set();for(const stage of stages){assert.ok(stage.deps.every(dep=>seen.has(dep)),stage.id);seen.add(stage.id);}
});

test('duration accepts ten seconds through sixty minutes without assuming ten-second shots',()=>{
 for(const durationMs of [10000,3600000]){const p=fixture();p.durationMs=durationMs;p.utterances=[];p.shots=[{...p.shots[0],startMs:0,endMs:durationMs,utteranceIds:[]}];assert.equal(validateProductionPlan(p).durationMs,durationMs);}
 for(const durationMs of [9999,3600001]){const p=fixture();p.durationMs=durationMs;assert.throws(()=>validateProductionPlan(p),/INVALID_PRODUCTION_TIMELINE/);}
});

test('chapter and scene coverage must be contiguous and shot hierarchy cannot point to another chapter',()=>{
 const p=fixture();p.chapters=[{id:'first',startMs:0,endMs:30000,title:'First'},{id:'second',startMs:30000,endMs:60000,title:'Second'}];
 p.scenes=[{id:'a',chapterId:'first',startMs:0,endMs:30000,description:'A'},{id:'b',chapterId:'second',startMs:30000,endMs:60000,description:'B'}];
 assert.doesNotThrow(()=>validateProductionPlan(p));
 const wrong=copy(p);wrong.shots[0].chapterId='second';assert.throws(()=>validateProductionPlan(wrong),/UNKNOWN_CHAPTER/);
 const scene=copy(p);scene.scenes[0].endMs=29000;assert.throws(()=>validateProductionPlan(scene),/INVALID_PRODUCTION_TIMELINE/);
 const chapter=copy(p);chapter.chapters[1].startMs=30001;assert.throws(()=>validateProductionPlan(chapter),/INVALID_PRODUCTION_TIMELINE/);
 const crossing=copy(p);crossing.shots[2].sceneId='b';assert.throws(()=>validateProductionPlan(crossing),/INVALID_PRODUCTION_TIMELINE/);
});


test('explicit location, actor/camera movement and timed effects remain structured and scoped',()=>{
 const p=fixture();Object.assign(p.shots[0],{location:'A contemporary Baghdad courtyard',characterMotion:'Hassan reaches down and lifts the wallet.',cameraMotion:'Slow tracking movement toward the doorway.',soundEffects:[{id:'door-creak',description:'A wooden door creaks softly',startMs:1000,endMs:3000,assetId:'licensed-creak'}]});
 const plan=validateProductionPlan(p),shot=plan.shots[0];assert.equal(shot.location,p.shots[0].location);assert.equal(shot.characterMotion,p.shots[0].characterMotion);assert.equal(shot.cameraMotion,p.shots[0].cameraMotion);assert.deepEqual(shot.soundEffects,p.shots[0].soundEffects);assert.deepEqual(validateProductionPlan(plan,{modelSettings:plan.routing}),plan);
 const outOfShot=copy(p);outOfShot.shots[0].soundEffects[0].endMs=11000;assert.throws(()=>validateProductionPlan(outOfShot),/INVALID_PRODUCTION_TIMELINE/);
 const unsafe=copy(p);unsafe.shots[0].soundEffects[0].assetId='../unowned';assert.throws(()=>validateProductionPlan(unsafe),/INVALID_PRODUCTION_ID/);
 assert.equal(validateProductionRouting().animationModelId,'wan22-i2v-a14b');assert.throws(()=>validateProductionRouting({animationModelId:'private-model'}),/INVALID_MODEL_ROUTING/);
});


test('owned reference identifiers may be numeric-leading SHA256 values without relaxing entity IDs',()=>{
 const p=fixture(),digest='9'+'a'.repeat(63);p.referenceIds.push(digest);p.characters[0].referenceIds=[digest];p.shots[0].referenceIds=[digest];assert.equal(validateProductionPlan(p).characters[0].referenceIds[0],digest);
 p.characters[0].id='9invalid-entity';assert.throws(()=>validateProductionPlan(p),/INVALID_PRODUCTION_ID/);
});
