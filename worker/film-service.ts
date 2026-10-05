import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Doc,Id} from '../convex/_generated/dataModel';
import {canonical} from '../shared/editing';
import {filmFailure,continuesScene} from '../shared/film-production';
import {root,read,persist,rpc,connection} from './runtime';
import {browser,workspace,screenshot} from './browser';
import {configure,attachments,startFrame,media,waitAssets,download} from './flow';
import {newProject} from './projects';
import {probe,decode,hashFile,tools,command} from './montage-media';
import {renderFilm} from './film-render';
import {filmEndFrame} from './film-frame';
type Job=Doc<'filmProductions'>;
type Local={intent?:boolean;submitted?:boolean;projectPath?:string;assetId?:string;path?:string;hash?:string};
type Journal={clips:Record<string,Local>;final?:{path:string;hash:string}};
export async function executeFilm(jobId:Id<'filmProductions'>,workerId:string,externalStop:()=>boolean,existingOnly=false){
 const cfg=await connection(),initial=await rpc<Job>('filmGet',{jobId});if(existingOnly&&initial.mode!=='existing')throw new Error('Existing-only mode refuses generation');
 const identity={jobId,workerId,fence:randomUUID()};let j=await rpc<Job>('filmClaim',identity),halt=false;const controller=new AbortController();
 const beat=setInterval(()=>{void rpc<{stop:boolean}>('filmHeartbeat',identity).then(s=>{if(s.stop||externalStop()){halt=true;controller.abort();}}).catch(()=>{halt=true;controller.abort();})},10000);
 const stopped=()=>halt||externalStop(),check=()=>{if(stopped())throw new Error('STOPPED: المقاطع محفوظة؛ لا خطوات لاحقة.')};
 const dir=resolve(root,'films',jobId),journalName=`films/${jobId}.json`;await mkdir(dir,{recursive:true});const journal=await read<Journal>(journalName)??{clips:{}};const save=()=>persist(journalName,journal);
 const stage=async(stage:Job['stage'],percent?:number)=>{check();await rpc('filmProgress',{...identity,stage,percent});};
 async function file(storageId:string){const fetchPart=async(extra:object)=>{const r=await fetch(`${cfg.site}/runner`,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json'},body:JSON.stringify({op:'filmFile',args:{jobId,storageId,...extra}}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Protected film file refused');return r;};const m=await(await fetchPart({metadata:true})).json() as {size:number;hash:string;type:string};const ext=({'video/mp4':'mp4','image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[m.type];if(!ext||!Number.isSafeInteger(m.size)||m.size<=0||m.size>(ext==='mp4'?100:10)*1024*1024)throw new Error('Invalid film source');const path=resolve(dir,`${storageId}.${ext}`);try{if((await stat(path)).size===m.size&&await hashFile(path)===m.hash)return path;}catch{/* download verified original */}const chunks:Buffer[]=[];for(let offset=0;offset<m.size;offset+=8*1024*1024){check();chunks.push(Buffer.from(await(await fetchPart({offset})).arrayBuffer()));}await writeFile(path+'.part',Buffer.concat(chunks),{mode:0o600});if(await hashFile(path+'.part')!==m.hash)throw new Error('Film source hash mismatch');await rename(path+'.part',path);return path;}
 async function upload(path:string,index:number,purpose:'source'|'frame'|'final',frameSlot?:number){
  check();const type=purpose==='frame'?'image/jpeg':'video/mp4',key=`${purpose==='frame'?'image':'video'}:${await hashFile(path)}`,size=(await stat(path)).size;
  const ticket=await rpc<{url:string|null;storageId:string|null}>('filmUpload',{...identity,index,purpose,key,size,type});let storageId=ticket.storageId;
  if(!storageId){if(purpose==='final'&&process.argv.includes('--test-upload-failure'))throw new Error('UPLOAD_FAILED: اختبار فشل الرفع؛ الملف محفوظ لإعادة الرفع فقط.');const r=await fetch(ticket.url!,{method:'POST',headers:{'Content-Type':type},body:await readFile(path),signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error('UPLOAD_FAILED: استأنف رفع الملف المحلي دون توليد.');storageId=(await r.json() as {storageId:string}).storageId;}
  const m=purpose==='frame'?undefined:await probe(path);await rpc('filmFinish',{...identity,index,purpose,key,storageId,frameSlot,...(m?{duration:m.duration,width:m.width,height:m.height,audio:m.audio}:{})});
 }
 try{
  for(let i=0;i<j.clips.length;i++){
   check();j=await rpc<Job>('filmGet',{jobId});let c=j.clips[i];const cp=journal.clips[i]??(journal.clips[i]={}),prompt=`معرّف مشهد الفيلم: ${jobId}-${i+1}\n${c.prompt}`;
   if(c.state==='pending'&&cp.intent){await rpc('filmClip',{...identity,index:i,state:'intent',projectPath:cp.projectPath});await rpc('filmClip',{...identity,index:i,state:'unknown'});c={...c,state:'unknown',projectPath:cp.projectPath};}
   if(c.state!=='uploaded'&&c.state!=='downloaded'){
    if(existingOnly)throw new Error('Existing-only executor cannot generate');const b=await browser();
    if(c.state==='pending'){
     if(!await rpc<boolean>('filmReviewCapacity',{jobId}))throw new Error('حد كلفة المراجعة لا يكفي؛ لم يبدأ توليد هذا المقطع.');
     let frame:string|undefined;
     const followsPrevious=i>0&&(c.part>0||continuesScene(j.plan,c.scene));
     if(followsPrevious||i===0&&j.previousFinalId){const previous=followsPrevious?j.clips[i-1]:undefined;if(previous&&(!previous.storageId||!previous.review?.passed))throw new Error('Previous scene is not approved');const source=await file(previous?.storageId??j.previousFinalId!);const duration=previous?.target??(await probe(source)).duration;frame=resolve(dir,`start-${i}.png`);await filmEndFrame(source,duration,frame,undefined,controller.signal);}
     const projectPath=await newProject(b.page);let p=await configure(b.page,j.option.model,j.option.aspect,j.option.seconds,j.option.resolution,1,frame?'frames':'ingredients');
     if(frame){await startFrame(b.page,frame);p=await configure(b.page,j.option.model,j.option.aspect,j.option.seconds,j.option.resolution,1,'frames');}else{const refs:string[]=[];for(const id of c.referenceIds)refs.push(await file(id));await attachments(b.page,refs);}
     if(canonical({model:j.option.model,actualModel:p.model,seconds:p.seconds,resolution:p.resolution,aspect:p.aspect,cost:p.cost})!==canonical(j.option))throw new Error('COST_CHANGED: راجع عرض السعر؛ لم تُرسل خيارات مختلفة.');
     await(await workspace(b.page)).fill(prompt);if((await media(b.page)).length||await b.page.locator('flow-video-tile').count())throw new Error('Task identity is ambiguous');
     await stage('generating');cp.intent=true;cp.projectPath=projectPath;await save();await rpc('filmClip',{...identity,index:i,state:'intent',projectPath});const permission=await rpc<{stop:boolean}>('filmHeartbeat',identity);if(permission.stop)halt=true;check();
     // Sole paid click. Persisted intents never enter this branch on recovery.
     await b.page.getByRole('button',{name:'بدء الإنشاء',exact:true}).click({timeout:2000});cp.submitted=true;await save();await rpc('filmClip',{...identity,index:i,state:'submitted'});c={...c,state:'submitted',projectPath};
    }else{const path=c.projectPath??cp.projectPath;if(!path)throw new Error('UNCERTAIN: لا معرف للمهمة الأصلية؛ لا إعادة توليد.');await b.page.goto(new URL(b.page.url()).origin+path+((c.assetId??cp.assetId)?`/edit/${c.assetId??cp.assetId}`:''));await workspace(b.page);await stage('generating');}
    const results=await waitAssets(b.page,c.assetId?[c.assetId]:cp.assetId?[cp.assetId]:[],[],1,stopped,prompt,percent=>rpc('filmClip',{...identity,index:i,state:'submitted',percent}).then(()=>undefined));const asset=results[0];cp.assetId=asset.id;await save();await rpc('filmClip',{...identity,index:i,state:'submitted',assetId:asset.id});await stage('downloading');
    const path=resolve(dir,`source-${i}.mp4`);await download(b.context,asset,path+'.part',b.page);await decode(path+'.part',controller.signal);await rename(path+'.part',path);cp.path=path;cp.hash=await hashFile(path);await save();await rpc('filmClip',{...identity,index:i,state:'downloaded',assetId:asset.id});c={...c,state:'downloaded'};
   }
   if(c.state==='downloaded'){
    if(!cp.path||!cp.hash||await hashFile(cp.path).catch(()=>null)!==cp.hash)throw new Error('المصدر المحلي مفقود؛ لا إعادة توليد تلقائية.');const m=await probe(cp.path);if(m.duration<j.option.seconds-.04||Math.abs(m.width/m.height-(j.option.aspect==='9:16'?9/16:16/9))>.02)throw new Error('Source duration or aspect mismatch');await stage('uploading');await upload(cp.path,i,'source');j=await rpc<Job>('filmGet',{jobId});c=j.clips[i];
   }
   if(!c.storageId)throw new Error('Source storage missing');const source=await file(c.storageId);cp.path=source;cp.hash=await hashFile(source);await save();
   if(!c.review?.passed){
    if(c.reviewState)throw new Error('مراجعة المشهد تحتاج قرارك؛ لا إعادة مراجعة مدفوعة تلقائية.');await stage('reviewing');
    for(const [n,t] of [c.sourceStart??0,(c.sourceStart??0)+Math.max(0,c.target-1/30)].entries()){const frame=resolve(dir,`review-${i}-${n}.jpg`);if(n===1)await filmEndFrame(source,(c.sourceStart??0)+c.target,frame,'scale=320:320:force_original_aspect_ratio=decrease',controller.signal);else await command(tools.ffmpeg,['-v','error','-ss',String(t),'-i',source,'-frames:v','1','-vf','scale=320:320:force_original_aspect_ratio=decrease','-q:v','7','-y',frame],undefined,undefined,controller.signal);if((await stat(frame)).size>40000)throw new Error('Review image too large');await upload(frame,i,'frame',n);}
    const timeline=resolve(dir,`timeline-${i}.jpg`),samples=Math.ceil(c.target);await command(tools.ffmpeg,['-v','error','-ss',String(c.sourceStart??0),'-i',source,'-t',String(c.target),'-vf',`fps=1,scale=160:160:force_original_aspect_ratio=decrease,pad=160:160:(ow-iw)/2:(oh-ih)/2,tile=4x${Math.ceil(samples/4)}:nb_frames=${samples}`,'-frames:v','1','-q:v','10','-y',timeline],undefined,undefined,controller.signal);if((await stat(timeline)).size>40000)throw new Error('Timeline review sheet too large');await upload(timeline,i,'frame',2);
    // Reference contact sheet is a private diagnostic image, never an overlay on the film.
    if(c.referenceIds.length){const refs=[];for(const id of c.referenceIds)refs.push(await file(id));const sheet=resolve(dir,`references-${i}.jpg`),args=['-v','error'];for(const path of refs)args.push('-i',path);const cells=refs.map((_,n)=>`[${n}:v]scale=160:160:force_original_aspect_ratio=decrease,pad=160:160:(ow-iw)/2:(oh-ih)/2,setsar=1[r${n}]`);const grid=refs.length===1?'[r0]scale=320:320[out]':refs.map((_,n)=>`[r${n}]`).join('')+`xstack=inputs=${refs.length}:layout=`+refs.map((_,n)=>`${n%4*160}_${Math.floor(n/4)*160}`).join('|')+':fill=black,scale=480:-2[out]';args.push('-filter_complex',[...cells,grid].join(';'),'-map','[out]','-frames:v','1','-q:v','10','-y',sheet);await command(tools.ffmpeg,args,undefined,undefined,controller.signal);if((await stat(sheet)).size>40000)throw new Error('Reference review sheet too large');await upload(sheet,i,'frame',3);}
    await rpc('filmReview',{...identity,index:i});j=await rpc<Job>('filmGet',{jobId});if(!j.clips[i].review?.passed)throw new Error('توقفت المتابعة؛ راجع المقطع بصريًا وصوته قبل قبول المتابعة.');
   }
  }
  j=await rpc<Job>('filmGet',{jobId});check();if(j.manualMerge&&!j.mergeRequested){await stage('ready');return;}let final=journal.final;
  if(!final||await hashFile(final.path).catch(()=>null)!==final.hash){await stage('montage');const sources=[];for(const c of j.clips)sources.push({path:await file(c.storageId!),start:c.sourceStart??0,duration:c.target});let last=-1;const tasks:Promise<unknown>[]=[];const result=await renderFilm(sources,j.option.aspect as '9:16'|'16:9',resolve(dir,'render'),percent=>{if(percent>=last+5||percent===99){last=percent;tasks.push(stage('montage',percent));}},controller.signal);await Promise.all(tasks);final={path:result.path,hash:result.hash};journal.final=final;await save();}
  await stage('verifying');await decode(final.path,controller.signal);const m=await probe(final.path);if(Math.abs(m.duration-j.settings.duration)>.1)throw new Error('Final duration does not match episode');
  if(process.argv.includes('--test-pause-after-render'))throw new Error('STOPPED: اختبار الاستئناف من ملف التصدير المحفوظ.');await stage('uploading');await upload(final.path,0,'final');console.log(jobId,'completed');
 }catch(e){const message=filmFailure(e),latest=await rpc<Job>('filmGet',{jobId}).catch(()=>null);if(latest?.stage!=='completed'){const uncertain=latest?.clips.some(c=>['intent','unknown'].includes(c.state));const phase=stopped()?'stopped':uncertain?'uncertain':/LOGIN_REQUIRED|connectOverCDP|تسجيل دخول/.test(message)?'login':'failed';await rpc('filmProgress',{...identity,stage:phase,error:message}).catch(()=>undefined);}if(j.mode==='generate')try{const b=await browser();await screenshot(b.page,`film-${jobId}-diagnostic.jpg`)}catch{/* no generation for diagnostics */}console.log(jobId,'paused',message);
 }finally{clearInterval(beat);await rpc('filmRelease',identity).catch(()=>undefined);}
}
