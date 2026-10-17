import {createHash} from 'node:crypto';
export interface BunnyConfig {zone:string;endpoint:string;accessKey:string}
export interface BunnyAsset {subject:string;path:string;sha256:string;size:number;type:string;verified:true}
export function bunnyConfig(env:Record<string,string|undefined>):BunnyConfig|null{
 if(!env.BUNNY_STORAGE_ZONE||!env.BUNNY_STORAGE_ENDPOINT||!env.BUNNY_STORAGE_ACCESS_KEY)return null;
 return {zone:env.BUNNY_STORAGE_ZONE,endpoint:env.BUNNY_STORAGE_ENDPOINT,accessKey:env.BUNNY_STORAGE_ACCESS_KEY};
}
// Server-only adapter. No live wiring until a zone, access control and real acceptance exist.
export class BunnyStorage {
 #config:BunnyConfig; #fetch:typeof fetch;
 constructor(config:BunnyConfig,fetcher:typeof fetch=fetch){const endpoint=new URL(config.endpoint);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||!['storage.bunnycdn.com','de.storage.bunnycdn.com','ny.storage.bunnycdn.com','la.storage.bunnycdn.com','sg.storage.bunnycdn.com','syd.storage.bunnycdn.com','uk.storage.bunnycdn.com','se.storage.bunnycdn.com','jh.storage.bunnycdn.com'].includes(endpoint.hostname)||!/^[-a-zA-Z0-9]{1,64}$/.test(config.zone)||!config.accessKey)throw Error('إعداد التخزين غير صالح.');this.#config=config;this.#fetch=fetcher;}
 #url(subject:string,objectPath:string){const owner=createHash('sha256').update(subject).digest('hex');if(!objectPath.startsWith('media/'+owner+'/')||!/^media\/[a-f0-9]{64}\/[a-f0-9]{64}\.(mp4|jpg|png|webp)$/.test(objectPath))throw Error('مسار الملف غير مصرح.');return this.#config.endpoint.replace(/\/$/,'')+'/'+this.#config.zone+'/'+objectPath;}
 async upload(subject:string,blob:Blob,sha256:string,onProgress:(bytes:number)=>void=()=>{}):Promise<BunnyAsset>{
  if(!subject||!Number.isSafeInteger(blob.size)||blob.size<1||blob.size>1024*1024*1024||!/^[a-f0-9]{64}$/.test(sha256))throw Error('ملف غير صالح.');const extension={'video/mp4':'mp4','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[blob.type];if(!extension)throw Error('نوع غير مدعوم.');
  const path='media/'+createHash('sha256').update(subject).digest('hex')+'/'+sha256+'.'+extension,url=this.#url(subject,path),hash=createHash('sha256');let loaded=0;
  const stream=blob.stream().pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){loaded+=chunk.length;hash.update(chunk);onProgress(loaded);controller.enqueue(chunk);}}));
  let response:Response;try{response=await this.#fetch(url,{method:'PUT',headers:{AccessKey:this.#config.accessKey,Checksum:sha256.toUpperCase(),'Content-Type':blob.type,'Content-Length':String(blob.size)},body:stream,duplex:'half',redirect:'error',signal:AbortSignal.timeout(600000)} as RequestInit);}catch{throw Error('تعذر رفع الملف؛ الأصل محفوظ.');}
  if(!response.ok||loaded!==blob.size||hash.digest('hex')!==sha256)throw Error('رفع غير مؤكد؛ الأصل محفوظ.');
  await this.verify(subject,path,sha256,blob.size);return {subject,path,sha256,size:blob.size,type:blob.type,verified:true};
 }
 async read(subject:string,asset:BunnyAsset){if(asset.subject!==subject)throw Error('الملف لا يخص حسابك.');try{const response=await this.#fetch(this.#url(subject,asset.path),{headers:{AccessKey:this.#config.accessKey},redirect:'error',signal:AbortSignal.timeout(600000)});if(!response.ok||!response.body)throw Error();return response.body;}catch{throw Error('تعذرت قراءة الملف الخاص.');}}
 async readRange(subject:string,asset:BunnyAsset,start:number,end:number){
  if(asset.subject!==subject)throw Error('الملف لا يخص حسابك.');if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=asset.size)throw Error('نطاق الملف غير صالح.');
  const response=await this.#fetch(this.#url(subject,asset.path),{headers:{AccessKey:this.#config.accessKey,Range:`bytes=${start}-${end}`},redirect:'error',signal:AbortSignal.timeout(600000)});
  if(response.status!==206||!response.body||response.headers.get('Content-Range')!==`bytes ${start}-${end}/${asset.size}`)throw Error('نطاق النسخة غير مطابق.');return response.body;
 }
 async verify(subject:string,path:string,sha256:string,size:number){const stream=await this.read(subject,{subject,path,sha256,size,type:'',verified:true}),reader=stream.getReader(),hash=createHash('sha256');let length=0;try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>size)throw Error('حجم غير مطابق.');hash.update(part.value);}}finally{reader.releaseLock();}if(length!==size||hash.digest('hex')!==sha256)throw Error('النسخة لا تطابق الأصل؛ يمنع حذف الأصل.');}
 async removeVerified(subject:string,asset:BunnyAsset,confirmed:boolean){if(!confirmed||asset.subject!==subject||!asset.verified)throw Error('Deletion not authorized');const response=await this.#fetch(this.#url(subject,asset.path),{method:'DELETE',headers:{AccessKey:this.#config.accessKey},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok&&response.status!==404)throw Error('Deletion unconfirmed');return {deletedAt:Date.now()};}
 async removeAfterPublication(subject:string,asset:BunnyAsset,targets:string[],receipts:{targetId:string;status:string}[],confirmed:boolean){if(!confirmed||!asset.verified||asset.subject!==subject||!targets.length||new Set(targets).size!==targets.length||targets.some(id=>receipts.filter(r=>r.targetId===id&&r.status==='published').length!==1))throw Error('الحذف ممنوع حتى يتأكد نشر جميع الوجهات.');const response=await this.#fetch(this.#url(subject,asset.path),{method:'DELETE',headers:{AccessKey:this.#config.accessKey},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('تعذر تأكيد حذف النسخة؛ السجل محفوظ.');return {deletedAt:Date.now()};}
}
