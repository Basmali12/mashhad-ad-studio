import {statfs,readdir,lstat,readFile} from 'node:fs/promises';
import {freemem,totalmem} from 'node:os';
import {join} from 'node:path';
import type {BunnyConfig} from './bunny-storage';
import {unavailableInfrastructure,type Infrastructure,type BunnyUsage,type ServerUsage} from '../shared/infrastructure';
export async function readBunnyUsage(config:BunnyConfig,fetcher:typeof fetch=fetch):Promise<BunnyUsage>{
 const result:BunnyUsage={status:'ok',observedAt:Date.now(),bytes:0,files:0,videoBytes:0,videoFiles:0,requests:0};
 const pending=[''],seen=new Set<string>(),start=Date.now();let consumed=0;
 try{while(pending.length){
  if(result.requests>=100||Date.now()-start>15000||consumed>8*1024*1024){result.status='partial';result.reason='قراءة جزئية؛ وصل الفحص إلى حد الأمان.';break;}
  const path=pending.shift()!;if(seen.has(path))continue;seen.add(path);result.requests++;
  const response=await fetcher(config.endpoint.replace(/\/$/,'')+'/'+encodeURIComponent(config.zone)+'/'+path,{headers:{AccessKey:config.accessKey},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok||!response.body)throw Error('Bunny unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;consumed+=next.value.length;if(size>2*1024*1024||consumed>8*1024*1024){await reader.cancel();throw Error('Listing too large');}chunks.push(next.value);}}finally{reader.releaseLock();}
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if(!Array.isArray(rows))throw Error('Invalid listing');
  for(const raw of rows){
   if(!raw||typeof raw!=='object')throw Error('Invalid entry');
   const row=raw as {ObjectName?:unknown;Length?:unknown;IsDirectory?:unknown};
   if(typeof row.ObjectName!=='string'||!row.ObjectName||['.','..'].includes(row.ObjectName)||/[\\/]/.test(row.ObjectName)||row.ObjectName.includes('\0')||typeof row.IsDirectory!=='boolean')throw Error('Invalid name');
   if(row.IsDirectory){if(pending.length>=10000)throw Error('Too many directories');pending.push(path+encodeURIComponent(row.ObjectName)+'/');continue;}
   if(typeof row.Length!=='number'||!Number.isSafeInteger(row.Length)||row.Length<0)throw Error('Invalid length');
   result.files!++;result.bytes!+=row.Length;if(/\.(mp4|mov|webm|m4v)$/i.test(row.ObjectName)){result.videoFiles!++;result.videoBytes!+=row.Length;}
   if(!Number.isSafeInteger(result.bytes))throw Error('Unsafe size');
  }
 }
 result.observedAt=Date.now();return result;
 }catch{return {...unavailableInfrastructure().bunny,requests:result.requests};}
}
export async function readServerUsage(directory:string):Promise<ServerUsage>{
 try{
  const disk=await statfs(directory),memoryTotalBytes=totalmem();let memoryAvailableBytes=freemem();
  try{const mem=await readFile('/proc/meminfo','utf8'),match=/^MemAvailable:\s+(\d+) kB$/m.exec(mem);if(match)memoryAvailableBytes=Number(match[1])*1024;}catch{/* Portable fallback is free RAM. */}
  let temporaryUploadBytes=0,temporaryUploadFiles=0;const entries=await readdir(directory,{withFileTypes:true});
  if(entries.length>10000)throw Error('Spool too large');
  for(const entry of entries){if(!entry.isFile()||entry.isSymbolicLink())continue;try{const file=await lstat(join(directory,entry.name));if(file.isFile()&&!file.isSymbolicLink()){temporaryUploadBytes+=file.size;temporaryUploadFiles++;}}catch{/* Upload may finish during this read. */}}
  return {status:'ok',observedAt:Date.now(),diskTotalBytes:disk.blocks*disk.bsize,diskUsedBytes:(disk.blocks-disk.bfree)*disk.bsize,diskAvailableBytes:disk.bavail*disk.bsize,memoryTotalBytes,memoryAvailableBytes,serviceRssBytes:process.memoryUsage().rss,temporaryUploadBytes,temporaryUploadFiles};
 }catch{return unavailableInfrastructure().server;}
}
// One refresh at a time, at most once per minute. No periodic/background scan.
export function infrastructureReader(config:BunnyConfig,directory:string,fetcher:typeof fetch=fetch){
 let cached:Infrastructure|undefined,expires=0,inflight:Promise<Infrastructure>|undefined;
 return async()=>{
  if(cached&&Date.now()<expires)return cached;if(inflight)return inflight;
  inflight=Promise.all([readBunnyUsage(config,fetcher),readServerUsage(directory)]).then(([bunny,server])=>{cached={bunny,server,cacheSeconds:60};expires=Date.now()+60000;return cached;}).finally(()=>{inflight=undefined;});return inflight;
 };
}
