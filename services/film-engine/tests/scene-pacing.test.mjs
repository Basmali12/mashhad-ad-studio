import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Arabic from '../engine/arabic-dialogue.cjs';
import {PACING_VERSION,scenePacing,pacingPrompt,PACING_PLAN_INSTRUCTION} from '../engine/scene-pacing.mjs';
import {createSceneEditor,idleTailCut,pacedArtifact} from '../engine/scene-editor.mjs';
import {createFilmMerger,fileDigest} from '../engine/film-merge.mjs';
const exec=promisify(execFile);
test('timing is chronological, hidden from spoken script, and retains deliberate silent action',()=>{
 const scene={prompt:'A man opens his suitcase.',audioContract:{mode:'dialogue'},pacing:{beats:[{start:0,end:3,action:'He opens the case.'},{start:3,end:10,action:'He passes the object and the other person reacts.'}]}};
 const pacing=scenePacing(scene,2);assert.equal(pacing.filmStartSeconds,20);assert.equal(pacing.tailPolicy,'trim_idle');assert.match(pacingPrompt(scene.prompt,pacing),/passes the object/);assert.match(pacingPrompt(scene.prompt,pacing),/around three seconds/);assert.match(PACING_PLAN_INSTRUCTION,/Preserve the requested era/);
 assert.equal(scenePacing({...scene,audioContract:{mode:'silent'}},0).tailPolicy,'keep');
 assert.throws(()=>scenePacing({...scene,pacing:{beats:[{start:3,end:5,action:'a'},{start:4,end:8,action:'b'}]}}),/INVALID_SCENE_PACING/);
 assert.throws(()=>scenePacing({...scene,pacing:{beats:[{start:0,end:11,action:'a'}]}}),/INVALID_SCENE_PACING/);
 assert.throws(()=>scenePacing({...scene,pacing:{beats:[{start:0,end:3,action:'a'},{start:5,end:10,action:'b'}]}}),/INVALID_SCENE_PACING/);
 const locked={language:'ar',dialect:'iraqi',lines:[{speaker:'حسن',text:'هلا بيك صديقي'}]};assert.deepEqual(Arabic.validate(locked).lines,locked.lines);const compiled=Arabic.compile(locked);assert.ok(!compiled.includes('After the final sentence, only quiet location ambience remains'));assert.match(compiled,/without invented dialogue/);
});
test('quiet alone never cuts action, stillness alone never cuts speech, internal pauses are retained',()=>{
 assert.equal(idleTailCut({duration:10,quiet:[{start:3,end:10}],still:[]}),null);
 assert.equal(idleTailCut({duration:10,quiet:[],still:[{start:0,end:10}]}),null);
 assert.equal(idleTailCut({duration:10,quiet:[{start:3,end:7}],still:[{start:0,end:10}]}),null);
 assert.equal(idleTailCut({duration:10,quiet:[{start:0,end:10}],still:[{start:0,end:10}]}),null);
 assert.equal(idleTailCut({duration:10,quiet:[{start:3,end:10}],still:[{start:6,end:10}]}),151/24);
 assert.equal(idleTailCut({duration:10,quiet:[{start:9.5,end:10}],still:[{start:0,end:10}]}),null);
});
test('CPU edit produces verified MP4 and an immutable edited artifact, merges edited duration, preserves originals and rejects tampering',async t=>{
 const ffmpeg=process.env.ENGINE_FFMPEG_BIN||'ffmpeg';try{await exec(ffmpeg,['-version'],{windowsHide:true});}catch{t.skip('Existing FFmpeg unavailable; no binary downloaded');return;}
 const folder=await fs.mkdtemp(path.join(tmpdir(),'pacing-cpu-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const job={id:randomUUID(),tenantId:'owner',projectId:randomUUID(),result:{videoVerified:true}},scene={jobId:job.id,status:'done',audioContract:{mode:'dialogue'},pacing:{version:PACING_VERSION,tailPolicy:'trim_idle'}},project={id:job.projectId,customerId:'owner',scenes:[scene]};
 const dir=path.join(folder,'artifacts',job.id);await fs.mkdir(dir,{recursive:true});const source=path.join(dir,'video.mp4');
 // Synthetic tone then silence tests the measurement boundary; it is not generated speech.
 await exec(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=4','-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=1','-af','apad','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source],{windowsHide:true});
 job.result.sha256=await fileDigest(source);const original=job.result.sha256,store={folder,get:async(kind,id)=>kind==='job'&&id===job.id?job:null};
 const editor=createSceneEditor({ffmpeg}),edit=await editor.prepare({store,project,scene,job});assert.equal(edit.status,'trimmed');assert.ok(edit.durationSeconds>=2&&edit.durationSeconds<2.2);assert.equal(edit.nativeAudio,true);assert.equal(await fileDigest(source),original);
 const artifact=await pacedArtifact(store,job,edit);assert.match(artifact.frame,/paced-last-frame.png$/);assert.equal(await fileDigest(artifact.frame),edit.frameSHA);
 scene.edit=edit;const merged=await createFilmMerger({ffmpeg,ffprobe:path.join(folder,'no-ffprobe')}).merge({store,project});assert.ok(merged.duration<2.2);assert.equal(merged.audio,true);assert.equal(await fileDigest(source),original);
 await assert.rejects(editor.prepare({store,project:{...project,customerId:'other'},scene,job}),/OWNERSHIP/);
 await fs.appendFile(artifact.file,'corrupt');await assert.rejects(pacedArtifact(store,job,edit),/SOURCE_CHANGED/);
});
test('explicit hold and historical plans never invoke tooling or alter artifacts',async()=>{
 const editor=createSceneEditor({ffmpeg:'must-not-be-launched'});
 assert.equal((await editor.prepare({scene:{},job:{},project:{},store:{}})).reason,'authored_hold_or_legacy');
 assert.equal((await editor.prepare({scene:{pacing:{version:PACING_VERSION,tailPolicy:'keep'}},job:{},project:{},store:{}})).status,'kept');
});
