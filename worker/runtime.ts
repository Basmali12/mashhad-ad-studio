import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {platformConfig} from './platform';
export const root=platformConfig().root;
export const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function read<T>(name:string):Promise<T|null>{try{return JSON.parse(await readFile(resolve(root,name),'utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export async function persist(name:string,value:unknown){await mkdir(root,{recursive:true});const target=resolve(root,name),temporary=`${target}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});await rename(temporary,target);}
export async function exclusive(){await mkdir(root,{recursive:true});const path=resolve(root,'worker.lock');try{const handle=await open(path,'wx');await handle.writeFile(String(process.pid));await handle.close();}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const pid=Number(await readFile(path,'utf8'));try{process.kill(pid,0);}catch{await unlink(path);return exclusive();}throw new Error('Worker already running. Use worker:status or worker:stop.',{cause:error});}return async()=>{await unlink(path).catch(()=>undefined)};}
export interface Config{site:string;token:string;workerId:string}
export async function connection(){const config=await read<Config>('connection.secret');if(!config||config.site!=='https://capable-cuttlefish-575.convex.site')throw new Error('Run npm run worker:setup on Development first.');return config;}
export async function rpc<T>(op:string,args:unknown):Promise<T>{const config=await connection();const response=await fetch(`${config.site}/runner`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({op,args}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Convex refused ${op} (${response.status}). No generation retry.`);return response.json() as Promise<T>;}
