import type {IncomingMessage,ServerResponse} from 'node:http';
import {open,mkdir,unlink} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {localMediaRequest} from './bunny-preview-server';
import {localAuthenticatedStorage,recordStagedAsset,privateStorageDirectory} from './bunny-local-store';
import {persistLocalAsset} from './bunny-local-convex';
import {makeFunctionReference} from 'convex/server';
interface Progress {subject:string;phase:'receiving'|'uploading'|'verifying'|'saved'|'failed';loaded:number;total:number;updatedAt:number}
const jobs=new Map<string,Progress>();
export function mediaSignature(type:string,head:Uint8Array){const bytes=Buffer.from(head);return type==='video/mp4'?bytes.subarray(4,8).toString()==='ftyp':type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;}
export async function bunnyUploadRequest(req:IncomingMessage,res:ServerResponse,host:string,saas=false){
 const route=req.url?.split('?')[0];if(!['/api/bunny-upload','/api/bunny-progress'].includes(route??''))return false;
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(!localMediaRequest(req,host)||req.headers.origin!==`http://${host}`||req.method!=='POST'){res.statusCode=403;res.end(JSON.stringify({error:'غير مصرح.'}));return true;}
 const id=String(req.headers['x-upload-id']??'');if(!/^[a-f0-9-]{36}$/.test(id)){res.statusCode=400;res.end(JSON.stringify({error:'هوية رفع غير صالحة.'}));return true;}
 let context:Awaited<ReturnType<typeof localAuthenticatedStorage>>;try{context=await localAuthenticatedStorage(req.headers.authorization,saas);}catch{res.statusCode=401;res.end(JSON.stringify({error:'سجّل الدخول بحسابك.'}));return true;}
 if(route==='/api/bunny-progress'){const job=jobs.get(id);if(job&&job.subject!==context.subject){res.statusCode=403;res.end('{}');return true;}const value=job?{phase:job.phase,loaded:job.loaded,total:job.total}:null;res.end(JSON.stringify(value));return true;}
 const ticketId=saas?String(req.headers['x-upload-ticket']??''):undefined;
 if(saas){try{const ticket=await context.client!.query(makeFunctionReference<'query'>('publishingUploadTickets:inspect'),{id:ticketId});if(ticket.subject!==context.subject||ticket.size!==Number(req.headers['content-length'])||ticket.type!==req.headers['content-type'])throw Error();}catch{res.statusCode=403;res.end(JSON.stringify({error:'طلب الرفع منتهي أو لا يخص الحساب.'}));return true;}}
 const type=String(req.headers['content-type']),size=Number(req.headers['content-length']);
 if(!['video/mp4','image/jpeg','image/png','image/webp'].includes(type)||!Number.isSafeInteger(size)||size<12||size>1024*1024*1024||jobs.has(id)){res.statusCode=400;res.end(JSON.stringify({error:'ملف غير صالح أو طلب رفع متكرر.'}));return true;}
 for(const [key,job] of jobs)if(job.updatedAt<Date.now()-3600000)jobs.delete(key);
 const progress:Progress={subject:context.subject,phase:'receiving',loaded:0,total:size,updatedAt:Date.now()};jobs.set(id,progress);
 const directory=join(privateStorageDirectory,'temporary-uploads'),path=join(directory,randomUUID()+'.upload');let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{const {config,subject,storage}=context;await mkdir(directory,{recursive:true});handle=await open(path,'wx',0o600);const hash=createHash('sha256');let head=Buffer.alloc(0);
  for await(const part of req){const bytes=Buffer.from(part);progress.loaded+=bytes.length;progress.updatedAt=Date.now();if(progress.loaded>size)throw Error('الحجم غير مطابق.');if(head.length<32)head=Buffer.concat([head,bytes.subarray(0,32-head.length)]);hash.update(bytes);await handle.writeFile(bytes);}
  await handle.close();handle=undefined;if(progress.loaded!==size||!mediaSignature(type,head))throw Error('نوع الملف أو حجمه غير مطابق.');
  const sha256=hash.digest('hex'),blob=await openAsBlob(path,{type});progress.phase='uploading';progress.loaded=0;
  const asset=await storage.upload(subject,blob,sha256,n=>{progress.loaded=n;progress.updatedAt=Date.now();if(n===size)progress.phase='verifying';});
  const staged={...asset,id:asset.sha256,zone:config.zone,createdAt:Date.now()};await recordStagedAsset(staged);const convexId=await persistLocalAsset(staged,ticketId);progress.phase='saved';progress.updatedAt=Date.now();res.end(JSON.stringify({id:asset.sha256,convexId,sha256:asset.sha256,size:asset.size,type:asset.type,verified:true}));
 }catch{progress.phase='failed';progress.updatedAt=Date.now();res.statusCode=503;res.end(JSON.stringify({error:'تعذر إكمال حفظ النسخة؛ الملف الأصلي يبقى محفوظًا عندك. لا تكرر النشر.'}));}
 finally{await handle?.close();await unlink(path).catch(()=>{});}return true;
}
