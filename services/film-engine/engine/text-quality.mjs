import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {ROOT} from './config.mjs';
const repo=path.dirname(ROOT);
const POLICY='text-detection-and-local-repair-v1';
export async function replaceWithRetry(source,target){for(let n=0;;n++){try{return await fs.rename(source,target);}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||n===3)throw e;await new Promise(r=>setTimeout(r,50*2**n));}}}
export class TextQuality {
 constructor(folder,{python=process.env.ENGINE_TEXT_QC_PYTHON}={}){
  this.folder=folder;this.python=python||path.join(repo,'.venv-text',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  this.queue=Promise.resolve();this.readyUntil=0;
 }
 command(args,onEvent=(_event)=>{},timeout=900000){return new Promise((resolve,reject)=>{
  if(!path.isAbsolute(this.python)||!existsSync(this.python))return reject(Error('TEXT_QC_NOT_CONFIGURED'));
  const env={CUDA_VISIBLE_DEVICES:'',NVIDIA_VISIBLE_DEVICES:'void',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'};
  for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP','LANG','ENGINE_TEXT_DETECTOR_MODEL','ENGINE_TEXT_INPAINT_MODEL'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(this.python,['-X','utf8','-m','engine.video_text',...args],{cwd:repo,env,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  const stop=()=>{if(!child.pid||child.exitCode!==null)return;if(process.platform==='win32'){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});killer.on('error',()=>child.kill());}else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();}}};
  const timer=setTimeout(()=>{stop();reject(Error('TEXT_QC_TIMEOUT_ORIGINAL_PRESERVED'));},timeout);timer.unref();
  let buffer='',last=null;const observed=[];
  child.stdout.setEncoding('utf8');child.stderr.on('data',()=>{});
  child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>1000000){stop();return reject(Error('TEXT_QC_OUTPUT_LIMIT'));}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const value=JSON.parse(line);last=value;if(value.phase&&Number.isFinite(value.frames))observed.push(Promise.resolve(onEvent({kind:'progress',phase:value.phase,completed:value.frames,total:value.total,unit:'frames'})));}catch{}}});
  child.once('error',()=>{clearTimeout(timer);reject(Error('TEXT_QC_NOT_CONFIGURED'));});
  child.once('close',async code=>{clearTimeout(timer);try{await Promise.all(observed);code?reject(Error('TEXT_QC_FAILED_ORIGINAL_PRESERVED')):resolve(last);}catch{reject(Error('TEXT_QC_EVENT_RECORDING_FAILED'));}});
 });}
 async available(){
  if(this.readyUntil>Date.now())return {ready:true};
  const result=await this.command(['--capability'],()=>{},20000);
  if(!result?.ready||result.gpu!==false)throw Error('TEXT_QC_NOT_CONFIGURED');
  this.readyUntil=Date.now()+60000;return result;
 }
 process(job,result,onEvent=(_event)=>{}){
  const task=this.queue.then(()=>this.run(job,result,onEvent));this.queue=task.catch(()=>{});return task;
 }
 async run(job,result,onEvent){
  const folder=path.join(this.folder,'artifacts',job.id),source=path.join(folder,'video.mp4');
  const output=path.join(folder,'text-clean-candidate.mp4'),report=path.join(folder,'text-quality.json');
  if(result.textQuality?.status==='passed')return result;
  await this.available();await onEvent({kind:'phase_start',phase:'text_detection'});
  // Existing output requires recovery/inspection, never an automatic rerender.
  await this.command(['--source',source,'--output',output,'--report',report],onEvent);
  await onEvent({kind:'phase_end',phase:'text_detection'});
  await onEvent({kind:'phase_start',phase:'text_verification'});
  const quality=JSON.parse(await fs.readFile(report,'utf8'));
  if(quality.status!=='passed'){
   await onEvent({kind:'phase_error',phase:'text_verification',error_type:'GENERATION_SUCCEEDED_TEXT_REVIEW_REQUIRED'});
   return {...result,textQuality:{...quality,policy:POLICY},generationSucceeded:true};
  }
  // Detection only: retirement never rewrites user media or extracts continuation frames.
  await onEvent({kind:'phase_end',phase:'text_verification'});
  return {...result,textQuality:{...quality,policy:POLICY},generationSucceeded:true};
 }
}
