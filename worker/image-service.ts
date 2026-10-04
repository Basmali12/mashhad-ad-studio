import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Doc,Id} from '../convex/_generated/dataModel';
import {root,read,persist,rpc,connection} from './runtime';
import {browser,workspace,screenshot} from './browser';
import {newProject} from './projects';
import {configureImage,imageAssets,attachImageReferences,waitImage,downloadImage} from './image-flow';
import {command,tools,decode,hashFile} from './montage-media';
import {canonical} from '../shared/editing';
import {validateFile,validateSignature} from '../shared/validation';
type Journal={intent?:boolean;submitted?:boolean;path?:string;hash?:string;type?:string;assetId?:string};
const safe=(e:unknown)=>String(e instanceof Error?e.message:e).replace(/(?:https?|wss?):\/\/\S+/g,'[URL]').replace(/Bearer\s+\S+/gi,'[secret]').slice(0,900);
export async function executeImage(jobId:Id<'imageJobs'>,workerId:string,stopping:()=>boolean){
 const identity={jobId,workerId,fence:randomUUID()},cfg=await connection();let job=await rpc<Doc<'imageJobs'>>('imageClaim',identity),halt=false;
 const pulse=setInterval(()=>{void rpc<{stop:boolean;paused:boolean}>('imageHeartbeat',identity).then(s=>{if(s.stop||s.paused)halt=true}).catch(()=>{halt=true})},10000);
 const stopped=()=>halt||stopping(),check=()=>{if(stopped())throw new Error('STOPPED: no later image steps')},dir=resolve(root,'images',jobId),journalName=`images/${jobId}.json`,cp=await read<Journal>(journalName)??{};
 await mkdir(dir,{recursive:true});const save=()=>persist(journalName,cp);
 async function progress(status:Doc<'imageJobs'>['status'],extra:object={}){check();await rpc('imageProgress',{...identity,status,...extra});await persist('service-job.json',{imageJobId:jobId,stage:status,at:new Date().toISOString()});}
 try{
  let localValid=false;if(cp.path&&cp.hash&&cp.type)try{localValid=(await stat(cp.path)).size>0&&await hashFile(cp.path)===cp.hash}catch{/* restore via original task */}
  if(!localValid){const b=await browser();
   if(!job.intentAt){if(cp.intent)throw new Error('IMAGE_INTENT_UNCERTAIN: server identity missing; never resubmit');const path=await newProject(b.page),actual=await configureImage(b.page,job.option.model,job.option.aspect);if(canonical(actual)!==canonical(job.option))throw new Error('IMAGE_COST_CHANGED: new authorization required');
    const paths:string[]=[];for(const id of job.referenceIds){check();const response=await fetch(`${cfg.site}/runner`,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json'},body:JSON.stringify({op:'imageFile',args:{jobId,storageId:id}}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('IMAGE_REFERENCE_FORBIDDEN');const bytes=Buffer.from(await response.arrayBuffer()),type=response.headers.get('Content-Type')?.split(';')[0]??'';validateFile(type,bytes.length,'image');validateSignature(bytes,type);const f=resolve(dir,`${id}.${type==='image/png'?'png':type==='image/webp'?'webp':'jpg'}`);await writeFile(f,bytes,{mode:0o600});paths.push(f);}
    await attachImageReferences(b.page,paths);await (await workspace(b.page)).fill(`معرف صورة مشهد: ${jobId}\n${job.prompt}`);const baselineIds=(await imageAssets(b.page)).map(a=>a.id);check();await progress('generating',{intent:true,projectPath:path,baselineIds});cp.intent=true;await save();
    const permission=await rpc<{stop:boolean;paused:boolean}>('imageHeartbeat',identity);if(permission.stop||permission.paused)halt=true;check();
    // The only paid click. An intent is never sent a second time.
    await b.page.getByRole('button',{name:'بدء الإنشاء',exact:true}).click({timeout:2000});cp.submitted=true;await save();await progress('generating',{submitted:true});job=await rpc<Doc<'imageJobs'>>('imageGet',{jobId});
   }else{if(!job.projectPath)throw new Error('IMAGE_PROJECT_MISSING: no resubmission');await b.page.goto(new URL(b.page.url()).origin+job.projectPath);await workspace(b.page);await progress('generating');}
   const asset=await waitImage(b.page,job.baselineIds??[],job.assetId??cp.assetId,stopped);cp.assetId=asset.id;await save();await progress('downloading',{assetId:asset.id});const path=resolve(dir,'result.image');const result=await downloadImage(b.context,asset,path+'.part');check();await decode(path+'.part');await rename(path+'.part',path);cp.path=path;cp.type=result.type;cp.hash=await hashFile(path);await save();
  }
  check();if(!cp.path||!cp.hash||!cp.type)throw new Error('IMAGE_LOCAL_FILE_MISSING');const bytes=await readFile(cp.path);validateFile(cp.type,bytes.length,'image');validateSignature(bytes,cp.type);if(await hashFile(cp.path)!==cp.hash)throw new Error('IMAGE_LOCAL_HASH_MISMATCH');await decode(cp.path);
  const raw=await command(tools.ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',cp.path]),dimensions=JSON.parse(raw.toString()) as {streams:Array<{width:number;height:number}>},m=dimensions.streams[0];if(!m||!m.width||!m.height)throw new Error('INVALID_IMAGE_DIMENSIONS');const expected=job.option.aspect.split(':').map(Number);if(Math.abs(m.width/m.height-expected[0]/expected[1])>.03)throw new Error('IMAGE_ASPECT_MISMATCH');
  await progress('uploading',cp.assetId?{assetId:cp.assetId}:{});const key=`image:${cp.hash}`,ticket=await rpc<{storageId:string|null;url:string|null}>('imageUpload',{...identity,key,type:cp.type,size:bytes.length});let storageId=ticket.storageId;
  if(!storageId){check();const response=await fetch(ticket.url!,{method:'POST',headers:{'Content-Type':cp.type},body:bytes,signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('IMAGE_UPLOAD_FAILED: resume uploads local result only');storageId=(await response.json() as {storageId:string}).storageId;}
  check();await rpc('imageFinish',{...identity,key,storageId,width:m.width,height:m.height});console.log(jobId,'image completed');
 }catch(e){const latest=await rpc<Doc<'imageJobs'>|null>('imageGet',{jobId}).catch(()=>null),status=stopped()?'stopped':/LOGIN_REQUIRED/.test(safe(e))?'login':latest?.intentAt&&!latest.assetId?'uncertain':'failed';await rpc('imageProgress',{...identity,status,error:safe(e),pause:true}).catch(()=>undefined);try{const b=await browser();await screenshot(b.page,`image-${jobId}-diagnostic.jpg`)}catch{/* no generation in diagnostics */}console.log(jobId,status,safe(e));
 }finally{clearInterval(pulse);await rpc('imageRelease',identity).catch(()=>undefined)}
}
