import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import type {Doc,Id} from '../convex/_generated/dataModel';
import type {FlowOption} from '../shared/pipeline';
import {canonical} from '../shared/editing';
import {root,read,persist,rpc,connection,exclusive,sleep} from './runtime';
import {browser,workspace,screenshot} from './browser';
import {configure,attachments,startFrame,media,waitAssets,download} from './flow';
import {capabilities} from './capabilities';
import {newProject} from './projects';
import {probe,decode,hashFile,alpha,wrapped,tools,command as mediaCommand} from './montage-media';
import {imageCapabilities} from './image-flow';
import {executeImage} from './image-service';
type Job=Doc<'pipelines'>;
type Checkpoint={clips:Record<string,{intent?:boolean;submitted?:boolean;projectPath?:string;assetId?:string;path?:string;hash?:string;framePath?:string;frameHash?:string;frameSourceHash?:string}>};
const command=process.argv[2]??'status';
if(command==='stop'){await persist('service-stop.json',{stop:true});await persist('montage-stop.json',{stop:true});console.log('Stop requested. Submitted Flow tasks may continue; no refund is guaranteed.');process.exit(0);}
if(command==='status'){const s=await read<{pid:number;running:boolean}>('service-status.json');let running=false;if(s?.running)try{process.kill(s.pid,0);running=true;}catch{/* stale PID */}console.log({running,status:s});process.exit(0);}
if(command!=='start')throw new Error('Use worker:start, worker:status or worker:stop');
const unlock=await exclusive(),cfg=await connection(),workerId=`${cfg.workerId}-${randomUUID().slice(0,8)}`;
await mediaCommand(tools.ffmpeg,['-version']);await mediaCommand(tools.ffprobe,['-version']);
await mkdir(resolve(root,'pipeline'),{recursive:true});await persist('service-stop.json',{stop:false});
let stopping=false,connectionLost=false,state='inspecting',options:FlowOption[]|undefined,observedAt:number|undefined,error:string|undefined;
const control=setInterval(()=>{void read<{stop:boolean}>('service-stop.json').then(s=>{if(s?.stop)stopping=true}).catch(()=>{stopping=true;})},500);
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
// Strip terminal escape sequences from diagnostics before storing them.
// eslint-disable-next-line no-control-regex
const safe=(e:unknown)=>String(e instanceof Error?e.message:e).replace(/\u001b\[[0-9;]*m/g,'').replace(/(?:https?|wss?):\/\/\S+/g,'[URL]').replace(/Bearer\s+\S+/gi,'[secret]').slice(0,1000);
async function presence(){await rpc('pipePresence',{workerId,state,options,observedAt,error});await persist('service-status.json',{pid:process.pid,running:!stopping,state,error,observedAt,updatedAt:new Date().toISOString()});}
const transient=(e:unknown)=>/fetch failed|Convex refused.*\((?:5\d\d|408|429)\)/i.test(safe(e))||(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)&&!e.message.includes('locator.'));
async function disconnected(e:unknown){if(!connectionLost)console.log('Convex connection lost; no generation retries:',safe(e));connectionLost=true;await persist('service-status.json',{pid:process.pid,running:true,state:'offline',error:safe(e),reconnecting:true,updatedAt:new Date().toISOString()});}
await presence();let pulsing=false;const pulse=setInterval(()=>{if(pulsing||connectionLost)return;pulsing=true;void presence().catch(async e=>{await disconnected(e);if(!transient(e))stopping=true;}).finally(()=>{pulsing=false;});},10000);
async function scan(){state='inspecting';await presence();try{const b=await browser();await b.page.keyboard.press('Escape');await b.page.keyboard.press('Escape');const editorPath=new URL(b.page.url()).pathname.match(/^(\/project\/[a-zA-Z0-9-]+)\/edit\/[a-zA-Z0-9-]+$/);if(editorPath){await b.page.goto(new URL(b.page.url()).origin+editorPath[1]);await b.page.locator('textarea:visible, [contenteditable="true"]:visible').waitFor({timeout:15000});}if(!new URL(b.page.url()).pathname.includes('/project/')){const last=await read<{projectPath:string}>('last-options.json');if(last&&/^\/project\/[a-zA-Z0-9-]+$/.test(last.projectPath)){await b.page.goto(new URL(b.page.url()).origin+last.projectPath);await b.page.locator('textarea:visible, [contenteditable="true"]:visible').waitFor({timeout:15000});}}options=await capabilities(b.page);observedAt=Date.now();try{const imageOptions=await imageCapabilities(b.page);await rpc('imagePresence',{options:imageOptions,observedAt:Date.now()});}catch(imageError){await rpc('imagePresence',{options:[],observedAt:Date.now(),error:safe(imageError)});console.log('Image settings unavailable:',safe(imageError));}state='online';error=undefined;await persist('capabilities.json',{options,observedAt});}catch(e){state='login';error=safe(e);console.log('Options unavailable:',error);}await presence();}
async function execute(jobId:Id<'pipelines'>){
 const identity={jobId,workerId,fence:randomUUID()};let j=await rpc<Job>('pipeClaim',identity),halt=false;
 const heartbeat=setInterval(()=>{void rpc<{stop:boolean;paused:boolean}>('pipeHeartbeat',identity).then(s=>{if(s.stop||s.paused)halt=true;}).catch(()=>{halt=true;})},10000);
 const stopped=()=>stopping||halt||connectionLost;
 const check=()=>{if(stopped())throw new Error('STOPPED: لا خطوات لاحقة؛ متابعة الأصل محفوظة.');};
 const journalName=`pipeline/${jobId}.json`,journal=await read<Checkpoint>(journalName)??{clips:{}};
 const dir=resolve(root,'pipeline',jobId);await mkdir(dir,{recursive:true});
 const save=()=>persist(journalName,journal);
 async function stage(stage:Job['stage']){check();await rpc('pipeStage',{...identity,stage});await persist('service-job.json',{jobId,stage,at:new Date().toISOString()});console.log(jobId,stage);}
 async function file(storageId:string,video=false){
  async function fetchPart(extra:object){const response=await fetch(`${cfg.site}/runner`,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json'},body:JSON.stringify({op:'pipeFile',args:{jobId,storageId,...extra}}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Protected attachment refused');return response;}
  const m=await (await fetchPart({metadata:true})).json() as {size:number;hash:string;type:string};if(!Number.isSafeInteger(m.size)||m.size<1||m.size>(video?100:10)*1024*1024||!(video?m.type==='video/mp4':['image/png','image/webp','image/jpeg'].includes(m.type)))throw new Error('Invalid image');const extension=video?'mp4':{'image/png':'png','image/webp':'webp','image/jpeg':'jpg'}[m.type];const path=resolve(dir,`${storageId}.${extension}`);try{if((await stat(path)).size===m.size&&await hashFile(path)===m.hash)return path;}catch{/* no cache */}const parts:Buffer[]=[];for(let offset=0;offset<m.size;offset+=8*1024*1024){check();parts.push(Buffer.from(await (await fetchPart({offset})).arrayBuffer()));}await writeFile(path+'.part',Buffer.concat(parts));if(await hashFile(path+'.part')!==m.hash)throw new Error('Image hash mismatch');await rename(path+'.part',path);return path;
 }
 try{
  // Validate montage before spending. Rendering failures can still be resumed without generation.
  const t=j.template.text;const lines=[...(t.name?wrapped(j.form.name):[]),...(t.address?wrapped(j.form.address):[]),...(t.phone?wrapped(j.form.phone):[])];if(lines.length>6)throw new Error('النص يتجاوز ستة أسطر؛ اختصره قبل التوليد.');
  if(j.template.logo.enabled){if(!j.logoId||!(await alpha(await file(j.logoId))).valid)throw new Error('الشعار غير شفاف؛ استبدله أو عطّله قبل التوليد.');}
  for(let i=0;i<j.clips.length;i++){
   check();j=await rpc<Job>('pipeGet',{jobId});let c=j.clips[i];if(c.state==='uploaded')continue;
   const cp=journal.clips[i]??(journal.clips[i]={});const promptText=`معرّف المشهد: ${jobId}-${i+1}\n${c.prompt}`;
   // A local intent survives even when its server acknowledgement was lost. Never click again.
   if(c.state==='pending'&&cp.intent){await rpc('pipeClip',{...identity,index:i,state:'intent',projectPath:cp.projectPath});await rpc('pipeClip',{...identity,index:i,state:'unknown'});c={...c,state:'unknown',projectPath:cp.projectPath};}
   if(c.state!=='downloaded'){
    const b=await browser();
    if(c.state==='pending'){
     if(state!=='online')throw new Error('LOGIN_REQUIRED: افتح مشروع Flow وأعد تشغيل Worker لتحديث الخيارات.');
     const continuation=(i>0&&!!j.form.continuationPrompts)||(i===0&&!!j.form.continuationSourceId);
     let frame:string|undefined;
     if(continuation){
      const previous=i===0?{state:'uploaded',storageId:j.form.continuationSourceId}:j.clips[i-1],prior=journal.clips[i-1]??(journal.clips[i-1]={});
      if(previous.state!=='uploaded'||!previous.storageId)throw new Error('CONTINUATION_SOURCE_MISSING: لم يُحفظ المقطع السابق؛ لا توليد تكملة.');
      if(!prior.path||!prior.hash||await hashFile(prior.path).catch(()=>null)!==prior.hash){prior.path=await file(previous.storageId,true);prior.hash=await hashFile(prior.path);await decode(prior.path);await save();}
      frame=resolve(dir,`start-frame-${i+1}.png`);
      if(cp.frameSourceHash!==prior.hash||!cp.frameHash||await hashFile(frame).catch(()=>null)!==cp.frameHash){
       // update=1 retains the last decoded frame of the original, without changing it.
       await mediaCommand(tools.ffmpeg,['-v','error','-sseof','-1','-i',prior.path,'-an','-vsync','0','-update','1','-y',frame]);
       await decode(frame);cp.framePath=frame;cp.frameHash=await hashFile(frame);cp.frameSourceHash=prior.hash;await save();
      }
     }
     const path=await newProject(b.page);
     if(i===0&&!continuation&&j.clips.length>1&&j.form.continuationPrompts){
      const quote=await configure(b.page,j.option.model,j.option.aspect,j.option.seconds,j.option.resolution,1,'frames');
      if(quote.model!==j.option.actualModel||quote.cost!==j.option.cost||await b.page.getByRole('button',{name:'بدء',exact:true}).count()!==1)throw new Error('CONTINUATION_UNSUPPORTED: خيارات التكملة أو كلفتها تختلف؛ لم يبدأ أي توليد.');
     }
     let p=await configure(b.page,j.option.model,j.option.aspect,j.option.seconds,j.option.resolution,1,continuation?'frames':'ingredients');
     if(frame){await startFrame(b.page,frame);p=await configure(b.page,j.option.model,j.option.aspect,j.option.seconds,j.option.resolution,1,'frames');}
     const actual={model:j.option.model,actualModel:p.model,seconds:p.seconds,resolution:p.resolution,aspect:p.aspect,cost:p.cost};if(canonical(actual)!==canonical(j.option))throw new Error('COST_CHANGED: تغيّرت الخيارات أو الكلفة؛ يلزم تفويض جديد من الواجهة.');
     const paths:string[]=[];if(!continuation){for(const id of j.referenceIds)paths.push(await file(id));await attachments(b.page,paths);}await (await workspace(b.page)).fill(promptText);
     if((await media(b.page)).length||await b.page.locator('flow-video-tile').count())throw new Error('IDENTITY_AMBIGUOUS: نتيجة سابقة داخل مشروع المقطع.');
     check();await stage('generating');cp.projectPath=path;cp.intent=true;await save();await rpc('pipeClip',{...identity,index:i,state:'intent',projectPath:path});check();
     // The sole paid click; never retry this block for an intent/submitted/unknown clip.
     const permission=await rpc<{stop:boolean;paused:boolean}>('pipeHeartbeat',identity);if(permission.stop||permission.paused)halt=true;check();await b.page.getByRole('button',{name:'بدء الإنشاء',exact:true}).click({timeout:2000});cp.submitted=true;await save();await rpc('pipeClip',{...identity,index:i,state:'submitted'});c={...c,state:'submitted',projectPath:path};
    }else{
     const path=c.projectPath??cp.projectPath;if(!path)throw new Error('FOLLOW_UP_REQUIRED: معرّف المشروع مفقود؛ لا إعادة توليد تلقائية.');const assetId=c.assetId??cp.assetId;await b.page.goto(new URL(b.page.url()).origin+path+(assetId?`/edit/${assetId}`:''));await b.page.locator('textarea:visible, [contenteditable="true"]:visible').waitFor({timeout:15000});await stage('generating');
    }
    const assets=await waitAssets(b.page,c.assetId?[c.assetId]:cp.assetId?[cp.assetId]:[],[],1,stopped,promptText,percent=>rpc('pipeClip',{...identity,index:i,state:'submitted',percent}).then(()=>undefined)),asset=assets[0];cp.assetId=asset.id;await save();await rpc('pipeClip',{...identity,index:i,state:'submitted',assetId:asset.id});await stage('downloading');
    const path=resolve(dir,`clip-${i+1}.mp4`);await download(b.context,asset,path+'.part',b.page);check();await probe(path+'.part');await decode(path+'.part');await rename(path+'.part',path);cp.path=path;cp.hash=await hashFile(path);await save();await rpc('pipeClip',{...identity,index:i,state:'downloaded',assetId:asset.id});
   }
   if(!cp.path||!cp.hash||await hashFile(cp.path)!==cp.hash)throw new Error('LOCAL_FILE_MISSING: استرجع الملف الأصلي؛ لا توليد جديد.');
   const m=await probe(cp.path);await decode(cp.path);if(m.duration<j.option.seconds-.04)throw new Error(`المصدر أقصر من الوحدة المطلوبة: ${m.duration} ث؛ لن يُكرر أو يُبطأ.`);if(Math.abs(m.width/m.height-(j.option.aspect==='16:9'?16/9:9/16))>.02)throw new Error('Source aspect mismatch');
   await stage('uploading');const key=`video:${cp.hash}`,ticket=await rpc<{storageId:string|null;url:string|null}>('pipeUpload',{...identity,index:i,key,size:m.size});let storageId=ticket.storageId;
   if(!storageId){check();const response=await fetch(ticket.url!,{method:'POST',headers:{'Content-Type':'video/mp4'},body:await readFile(cp.path),signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('UPLOAD_FAILED: الملف المحلي محفوظ؛ الاستئناف يرفع فقط.');storageId=(await response.json() as {storageId:string}).storageId;}
   await rpc('pipeFinish',{...identity,index:i,key,storageId,duration:m.duration,width:m.width,height:m.height});
  }
  check();const exportId=await rpc<string>('pipeExport',identity);await stage('montage');
  let e=await rpc<Doc<'exports'>|null>('pipeExportState',{jobId});
  if(e?.status!=='completed'){
   // A running editor owns its independent lease; do not start a second process.
   if(e?.lease&&e.lease.until>Date.now())throw new Error('EDITOR_BUSY: المونتاج السابق ما زال يملك القفل؛ استأنف بعد انتهائه.');
   const args=['--import',pathToFileURL(resolve(import.meta.dirname,'node_modules/tsx/dist/loader.mjs')).href,resolve(import.meta.dirname,'montage.ts'),'resume',exportId];if(process.argv.includes('--test-upload-failure'))args.push('--test-upload-failure');if(process.argv.includes('--test-pause-after-preparing'))args.push('--test-pause-after-preparing');
   const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let failure='',finished=false,exitCode:number|null=null;child.stdout.on('data',b=>console.log(b.toString().trim()));child.stderr.on('data',b=>{failure=(failure+b.toString()).slice(-1600);});child.on('error',err=>{failure=safe(err);finished=true;exitCode=1;});child.on('exit',code=>{exitCode=code;finished=true;});
   while(!finished){const latest=await rpc<Job>('pipeGet',{jobId});if(latest.stopRequested||latest.paused)halt=true;if(stopped()){await persist('montage-stop.json',{stop:true});}await sleep(1000);e=await rpc<Doc<'exports'>|null>('pipeExportState',{jobId});if(!stopped()&&e?.status==='uploading')await stage('uploading');}
   check();if(exitCode!==0)throw new Error(`MONTAGE_FAILED: ${safe(failure)}. المقاطع محفوظة؛ الاستئناف لا يعيد التوليد.`);
  }
  check();await rpc('pipeComplete',identity);console.log(jobId,'completed');
 }catch(e){if(transient(e)){await disconnected(e);await persist('montage-stop.json',{stop:true});}const diagnostic=safe(e);const job=await rpc<Job>('pipeGet',{jobId}).catch(()=>null);const uncertain=job?.clips.some(c=>['intent','unknown'].includes(c.state))||Object.values(journal.clips).some(c=>c.intent&&!c.submitted);
  const phase=stopped()?'stopped':uncertain?'uncertain':/LOGIN_REQUIRED|browserType.connectOverCDP/.test(diagnostic)?'login':'failed';await rpc('pipeStage',{...identity,stage:phase,error:diagnostic,pause:true}).catch(()=>undefined);
  try{if(j.mode==='generate'){const b=await browser();await screenshot(b.page,`pipeline-${jobId}-diagnostic.jpg`);}}catch{/* Diagnostics never trigger generation. */}console.log(jobId,phase,diagnostic);
  if(/COST_CHANGED/.test(diagnostic))await scan();else if(phase==='login'){state='login';error=diagnostic;await presence();}
 }finally{clearInterval(heartbeat);await rpc('pipeRelease',identity).catch(()=>undefined);}
}
async function standalone(exportId:string){
 await persist('service-job.json',{exportId,stage:'montage',at:new Date().toISOString()});
 const args=['--import',pathToFileURL(resolve(import.meta.dirname,'node_modules/tsx/dist/loader.mjs')).href,resolve(import.meta.dirname,'montage.ts'),'resume',exportId];if(process.argv.includes('--test-pause-after-preparing'))args.push('--test-pause-after-preparing');
 const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let finished=false;child.on('close',()=>{finished=true});child.on('error',()=>{finished=true});child.stdout.on('data',b=>console.log(b.toString().trim()));child.stderr.on('data',b=>console.log(safe(b.toString())));
 while(!finished){if(stopping||connectionLost)await persist('montage-stop.json',{stop:true});await sleep(500);}
}
try{
 await scan();let lastScan=Date.now();
 let backoff=3000,testDisconnect=process.argv.includes('--test-connection-failure-once');
 while(!stopping){try{if(testDisconnect){testDisconnect=false;throw new TypeError('fetch failed (intentional idle connection test)');}if(connectionLost){await presence();connectionLost=false;backoff=3000;console.log('Convex reconnected; continuing saved queue only.');}const id=await rpc<Id<'pipelines'>|null>('pipeNext',{});if(id)await execute(id);else{const imageId=await rpc<Id<'imageJobs'>|null>('imageNext',{});if(imageId){await executeImage(imageId,workerId,()=>stopping||connectionLost);continue;}const exportId=await rpc<string|null>('editPending',{});if(exportId)await standalone(exportId);else await sleep(2000);if(state==='online'&&Date.now()-lastScan>20*60*1000){await scan();lastScan=Date.now();}}}catch(e){if(!transient(e))throw e;await disconnected(e);await persist('montage-stop.json',{stop:true});await sleep(backoff);backoff=Math.min(30000,backoff*2);}}
}finally{clearInterval(control);clearInterval(pulse);state='offline';stopping=true;await persist('montage-stop.json',{stop:true});await presence().catch(()=>undefined);await unlock();}
process.exit(0);
