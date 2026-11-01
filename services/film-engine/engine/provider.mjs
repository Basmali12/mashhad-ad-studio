import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import os from 'node:os';
import {ROOT} from './config.mjs';
export function providerEnvironment(input,base=process.env) {
 const env={...base};
 for(const key of Object.keys(env))if(key.startsWith('ENGINE_')||key.startsWith('PG')||(key.endsWith('_API_KEY')||['DATABASE_URL','HF_TOKEN','HUGGING_FACE_HUB_TOKEN'].includes(key)))delete env[key];
 if(input.credentials?.mode!=='local_profile'&&input.source?.mode!=='local_profile')for(const key of Object.keys(env))if(key.startsWith('MODAL_'))delete env[key];
 // SDK 1.6.2 and the verified primary/destination environments use 2025.06.
 // Pin the SDK's local override; never mutate workspace settings or inherit an
 // operator profile's incompatible builder during a different account deploy.
 env.MODAL_IMAGE_BUILDER_VERSION='2025.06';
 return env;
}
// Credentials are sent over a private pipe, never argv, stdout, HTTP responses, or logs.
export class ModalProvider {
 constructor(python=process.env.ENGINE_PYTHON) {
  const candidates=[path.join(ROOT,'../.venv-engine',process.platform==='win32'?'Scripts/python.exe':'bin/python'),...(process.platform==='win32'?[path.join(os.homedir(),'AppData/Local/Programs/Python/Python313/python.exe')]:[])];
  this.python=python||candidates.find(p=>existsSync(p))||'python';
 }
 call(action,input,onEvent=(_event)=>{},timeout=90000,signal=undefined) {
  if(['generate','session'].includes(action))return Promise.reject(Error('ENGINE_NOT_CONFIGURED'));
  return new Promise((resolve,reject)=>{
   const child=spawn(this.python,['-X','utf8',path.join(ROOT,'modal_bridge.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:providerEnvironment(input)});
   child.stdout.setEncoding('utf8');
   let buffer='',result,failed=false;
   const timer=setTimeout(()=>{failed=true;child.kill();reject(Error('PROVIDER_TIMEOUT_STATE_UNKNOWN'));},timeout);timer.unref();
   const abort=()=>{failed=true;child.kill();reject(Error('CANCELLED_STATE_REQUIRES_RECONCILIATION'));};signal?.addEventListener('abort',abort,{once:true});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action,...input})+'\n');
   child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>180000000){child.kill();return reject(Error('PROVIDER_OUTPUT_LIMIT'));}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const v=JSON.parse(line);if(v.type==='event')onEvent(v.data);if(v.type==='result')result=v.data;if(v.type==='error')failed=true;}catch{/* Ignore library output; never forward raw output. */}}});
   child.stderr.on('data',()=>{}); // SDK exceptions may include sensitive context; deliberately discarded.
   child.once('error',()=>{clearTimeout(timer);reject(Error('PYTHON_OR_MODAL_UNAVAILABLE'));});
   child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(code||failed||result===undefined)reject(Error('MODAL_OPERATION_FAILED_CHECK_PERMISSIONS'));else resolve(result);});
  });
 }
 session() { throw Error('ENGINE_NOT_CONFIGURED'); }
}
