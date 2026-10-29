import fs from 'node:fs/promises';
import path from 'node:path';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {id,hash} from './store.mjs';
export const REFERENCE_LIMIT=4000000;
export const REFERENCE_CUSTOMER_LIMIT=64*1024*1024;
const SAFE=/^[a-zA-Z0-9_-]{1,100}$/;
const editable=p=>p&&!p.textPending&&!p.referenceUploading&&!p.scenes?.some(s=>s.attempted)&&p.state!=='generating';
const dimensions=(width,height)=>{if(!width||!height||width>4096||height>4096||width*height>16000000)throw Error('REFERENCE_DIMENSIONS');return {width,height};};
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
/** Bounded structural validation before any image reaches the inference decoder. */
export function inspectReference(bytes,mime){
 if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>REFERENCE_LIMIT)throw Error('REFERENCE_SIZE');
 if(mime==='image/png'){
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('REFERENCE_TYPE');
  let offset=8,header=null,end=false;const compressed=[];
  while(offset+12<=bytes.length){const len=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(len>REFERENCE_LIMIT||offset+12+len>bytes.length)throw Error('REFERENCE_INVALID');const data=bytes.subarray(offset+8,offset+8+len);if(crc(bytes.subarray(offset+4,offset+8+len))!==bytes.readUInt32BE(offset+8+len))throw Error('REFERENCE_INVALID');
   if(!header){if(type!=='IHDR'||len!==13)throw Error('REFERENCE_INVALID');header={...dimensions(data.readUInt32BE(0),data.readUInt32BE(4)),depth:data[8],color:data[9]};if(header.depth!==8||![0,2,4,6].includes(header.color)||data[10]||data[11]||data[12])throw Error('REFERENCE_INVALID');}
   else if(type==='IHDR')throw Error('REFERENCE_INVALID');
   if(type==='IDAT')compressed.push(data);offset+=len+12;
   if(type==='IEND'){if(len||offset!==bytes.length)throw Error('REFERENCE_INVALID');end=true;break;}
  }
  if(!header||!end||!compressed.length)throw Error('REFERENCE_INVALID');const channels={0:1,2:3,4:2,6:4}[header.color],row=header.width*channels+1,expected=row*header.height;
  let pixels;try{pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch{throw Error('REFERENCE_INVALID');}if(pixels.length!==expected)throw Error('REFERENCE_INVALID');for(let i=0;i<pixels.length;i+=row)if(pixels[i]>4)throw Error('REFERENCE_INVALID');
  return {...dimensions(header.width,header.height),mime};
 }
 if(mime==='image/jpeg'){
  if(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('REFERENCE_TYPE');let offset=2,size=null,sos=false;
  while(offset<bytes.length-2){if(bytes[offset++]!==255)throw Error('REFERENCE_INVALID');while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217)break;if(marker===0||marker===216)throw Error('REFERENCE_INVALID');if(marker>=208&&marker<=215)continue;if(offset+2>bytes.length)throw Error('REFERENCE_INVALID');const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw Error('REFERENCE_INVALID');
   if([192,193,194].includes(marker)){if(length<8||bytes[offset+2]!==8)throw Error('REFERENCE_INVALID');size=dimensions(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3));}
   if(marker===218){sos=true;break;}offset+=length;
  }
  if(!size||!sos)throw Error('REFERENCE_INVALID');return {...size,mime};
 }
 throw Error('REFERENCE_TYPE');
}
export function createFilmReferences({store,secret,origin,origins,now,customerByteLimit=REFERENCE_CUSTOMER_LIMIT}){
 if(!Number.isSafeInteger(customerByteLimit)||customerByteLimit<REFERENCE_LIMIT||customerByteLimit>10*1024**3)throw Error('REFERENCE_QUOTA_CONFIGURATION');
 const signature=(key,expires)=>createHmac('sha256',secret).update('film-reference-upload\n'+key+'\n'+expires).digest('hex');
 const viewSignature=(key,expires)=>createHmac('sha256',secret).update('film-reference-view\n'+key+'\n'+expires).digest('hex');
 const filename=(projectId,referenceId)=>path.join(store.folder,'film-references',projectId,referenceId+'.image');
 async function owned(projectId,customerId){if(!SAFE.test(projectId||''))throw Error('NOT_FOUND');const p=await store.get('film-project',projectId);if(!p||p.customerId!==customerId)throw Error('NOT_FOUND');return p;}
 // Called only under the shared store transaction. Existing retained images are counted once
 // on upgrade, including superseded/unlinked files, never merely the current project pointer.
 async function usage(customerId){let value=await store.get('film-reference-usage',customerId);if(!value){let retainedBytes=0;for(const p of (await store.all('film-project')).filter(p=>p.customerId===customerId)){if(!SAFE.test(p.id))throw Error('REFERENCE_QUOTA_CONFIGURATION');const folder=path.join(store.folder,'film-references',p.id);let entries;try{entries=await fs.readdir(folder);}catch(e){if(e.code==='ENOENT')continue;throw Error('REFERENCE_QUOTA_CONFIGURATION');}for(const name of entries){const stat=await fs.lstat(path.join(folder,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('REFERENCE_QUOTA_CONFIGURATION');retainedBytes+=stat.size;if(!Number.isSafeInteger(retainedBytes))throw Error('REFERENCE_QUOTA_CONFIGURATION');}}value={id:customerId,retainedBytes,reservedBytes:0,initializedAt:now()};await store.put('film-reference-usage',value);}if(!Number.isSafeInteger(value.retainedBytes)||value.retainedBytes<0||!Number.isSafeInteger(value.reservedBytes)||value.reservedBytes<0)throw Error('REFERENCE_QUOTA_CONFIGURATION');return value;}
 async function issue(projectId,customerId){return store.transaction(async()=>{const p=await owned(projectId,customerId);if(!editable(p))throw Error('REFERENCE_LOCKED');const used=await usage(customerId);if(used.retainedBytes+used.reservedBytes+REFERENCE_LIMIT>customerByteLimit)throw Error('REFERENCE_QUOTA');for(const t of await store.all('film-reference-ticket'))if(t.expires<now())await store.delete('film-reference-ticket',t.id);const ticket={id:id(),projectId,customerId,expires:now()+120000,version:p.referenceVersion||0,consumed:false};await store.put('film-reference-ticket',ticket);return {url:origin+'/api/film-reference/'+ticket.id+'?expires='+ticket.expires+'&signature='+signature(ticket.id,ticket.expires),expires:ticket.expires,maxBytes:REFERENCE_LIMIT};});}
 async function data(p){if(!p.reference)return null;const bytes=await fs.readFile(filename(p.id,p.reference.id));if(hash(bytes)!==p.reference.sha256)throw Error('REFERENCE_INVALID');inspectReference(bytes,p.reference.mime);return 'data:'+p.reference.mime+';base64,'+bytes.toString('base64');}
 async function view(projectId,customerId){const p=await owned(projectId,customerId);if(!p.reference)throw Error('NOT_FOUND');const ticket={id:id(),customerId,projectId,referenceId:p.reference.id,expires:now()+120000};for(const old of await store.all('film-reference-view'))if(old.expires<now())await store.delete('film-reference-view',old.id);await store.put('film-reference-view',ticket);return {url:origin+'/api/film-reference-view/'+ticket.id+'?expires='+ticket.expires+'&signature='+viewSignature(ticket.id,ticket.expires),expires:ticket.expires};}
 async function remove(projectId,customerId){return store.transaction(async()=>{const p=await owned(projectId,customerId);if(!editable(p))throw Error('REFERENCE_LOCKED');p.reference=null;p.referenceVersion=(p.referenceVersion||0)+1;await store.put('film-project',p);return p;});}
 async function handle(req,res,url,secure){
  const isView=url.pathname.startsWith('/api/film-reference-view/');
  if(!isView&&!url.pathname.startsWith('/api/film-reference/'))return false;
  const reply=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(error));};
  const requestOrigin=req.headers.origin;if(!secure||(!isView&&!requestOrigin)||(requestOrigin&&!origins.includes(requestOrigin))){reply(403,{error:'REFERENCE_ACCESS_DENIED'});return true;}
  if(requestOrigin)res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');res.setHeader('Referrer-Policy','no-referrer');
  if(isView){try{const key=url.pathname.slice('/api/film-reference-view/'.length),expires=url.searchParams.get('expires'),sig=url.searchParams.get('signature');if(req.method!=='GET'||!SAFE.test(key)||!/^\d{13}$/.test(expires||'')||! /^[a-f0-9]{64}$/.test(sig||'')||!timingSafeEqual(Buffer.from(sig),Buffer.from(viewSignature(key,expires))))throw Error();const t=await store.get('film-reference-view',key),p=t?await owned(t.projectId,t.customerId):null;if(!t||t.expires!==Number(expires)||t.expires<=now()||p?.reference?.id!==t.referenceId)throw Error();const bytes=await fs.readFile(filename(p.id,t.referenceId));if(hash(bytes)!==p.reference.sha256)throw Error();res.writeHead(200,{'Content-Type':p.reference.mime,'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}catch{reply(403,{error:'REFERENCE_ACCESS_DENIED'});}return true;}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','PUT, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Max-Age','60');res.writeHead(204);res.end();return true;}
  let ticket,claimed=false,file;
  try{
   const key=url.pathname.slice('/api/film-reference/'.length),expires=url.searchParams.get('expires'),sig=url.searchParams.get('signature');
   if(req.method!=='PUT'||!SAFE.test(key)||!/^\d{13}$/.test(expires||'')||! /^[a-f0-9]{64}$/.test(sig||'')||!timingSafeEqual(Buffer.from(sig),Buffer.from(signature(key,expires))))throw Error('REFERENCE_ACCESS_DENIED');
   await store.transaction(async()=>{ticket=await store.get('film-reference-ticket',key);if(!ticket||ticket.consumed||ticket.expires!==Number(expires)||ticket.expires<=now())throw Error('REFERENCE_ACCESS_DENIED');const p=await owned(ticket.projectId,ticket.customerId);if(!editable(p)||(p.referenceVersion||0)!==ticket.version)throw Error('REFERENCE_LOCKED');const used=await usage(ticket.customerId);if(used.retainedBytes+used.reservedBytes+REFERENCE_LIMIT>customerByteLimit)throw Error('REFERENCE_QUOTA');used.reservedBytes+=REFERENCE_LIMIT;await store.put('film-reference-usage',used);await store.put('film-reference-reservation',{id:ticket.id,customerId:ticket.customerId,projectId:ticket.projectId,bytes:REFERENCE_LIMIT,state:'reserved',createdAt:now()});ticket.consumed=true;await store.put('film-reference-ticket',ticket);p.referenceUploading=ticket.id;await store.put('film-project',p);claimed=true;});
   const mime=req.headers['content-type'];if(!['image/png','image/jpeg'].includes(mime))throw Error('REFERENCE_TYPE');if(Number(req.headers['content-length'])>REFERENCE_LIMIT)throw Error('REFERENCE_SIZE');
   const parts=[];let count=0;for await(const part of req){count+=part.length;if(count>REFERENCE_LIMIT)throw Error('REFERENCE_SIZE');parts.push(part);}const bytes=Buffer.concat(parts),metadata=inspectReference(bytes,mime),referenceId=id();file=filename(ticket.projectId,referenceId);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
   await store.transaction(async()=>{const p=await owned(ticket.projectId,ticket.customerId);if(p.referenceUploading!==ticket.id||(p.referenceVersion||0)!==ticket.version||p.scenes?.some(s=>s.attempted)||p.textPending)throw Error('REFERENCE_LOCKED');const reservation=await store.get('film-reference-reservation',ticket.id),used=await usage(ticket.customerId);if(reservation?.state!=='reserved'||used.reservedBytes<REFERENCE_LIMIT)throw Error('REFERENCE_QUOTA_CONFIGURATION');used.reservedBytes-=REFERENCE_LIMIT;used.retainedBytes+=bytes.length;await store.put('film-reference-usage',used);await store.put('film-reference-reservation',{...reservation,state:'committed',actualBytes:bytes.length,referenceId,finishedAt:now()});await store.put('film-reference-retained',{id:referenceId,customerId:ticket.customerId,projectId:ticket.projectId,size:bytes.length,createdAt:now()});p.reference={id:referenceId,...metadata,size:bytes.length,sha256:hash(bytes),uploadedAt:now()};p.referenceVersion=ticket.version+1;delete p.referenceUploading;await store.put('film-project',p);});
   file=null;reply(200,{saved:true});
  }catch(e){reply(e.message==='REFERENCE_ACCESS_DENIED'?403:400,{error:/^REFERENCE_[A-Z_]+$/.test(e.message)?e.message:'REFERENCE_UPLOAD_FAILED',message:e.message==='REFERENCE_QUOTA'?'بلغت مساحة الصور المرجعية المتاحة لحسابك. راجع الإدارة؛ لم تُحذف صورك.':'تعذر حفظ الصورة المرجعية. النسخة السابقة محفوظة؛ حدّث حالة المشروع.'});}
  finally{let removed=true;if(file)try{await fs.unlink(file);}catch(e){removed=e.code==='ENOENT';}if(claimed)await store.transaction(async()=>{const p=await owned(ticket.projectId,ticket.customerId);if(p.referenceUploading===ticket.id){delete p.referenceUploading;await store.put('film-project',p);}const reservation=await store.get('film-reference-reservation',ticket.id);if(reservation?.state==='reserved'&&removed){const used=await usage(ticket.customerId);if(used.reservedBytes<REFERENCE_LIMIT)throw Error('REFERENCE_QUOTA_CONFIGURATION');used.reservedBytes-=REFERENCE_LIMIT;await store.put('film-reference-usage',used);await store.put('film-reference-reservation',{...reservation,state:'released',finishedAt:now()});}});}
  return true;
 }
 return {issue,view,data,remove,handle};
}
