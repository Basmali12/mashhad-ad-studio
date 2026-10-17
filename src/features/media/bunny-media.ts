import {validateReelFile} from './reels-video';
export interface BunnyUploadResult {id:string;sha256:string;size:number;type:string;verified:boolean;convexId:string}
import {storageApi} from '../../shared/api/storage-api';
import {publishingHeaders} from '../../shared/api/publishing-session';
import {publishingSaasMode} from '../../shared/api/publishing-session';
import {cloudUploadTicket,cancelUploadTicket} from './upload-ticket';
// Upload quota is finalized server-side only after the file hash is verified.

export async function uploadBunnyFile(file:File,onProgress:(text:string)=>void):Promise<BunnyUploadResult>{

 await validateReelFile(file);return uploadBunnyWithTicket(file,onProgress);
}
export async function uploadBunnyWithTicket(file:File,onProgress:(text:string)=>void,preparedTicket?:import('../../../convex/_generated/dataModel').Id<'publishingUploadTickets'>):Promise<BunnyUploadResult>{
 const id=crypto.randomUUID(),xhr=new XMLHttpRequest(),headers=await publishingHeaders(),ticket=preparedTicket??(publishingSaasMode?await cloudUploadTicket(file):undefined);let polling:number|undefined,checking=false;
 try{return await new Promise<BunnyUploadResult>((resolve,reject)=>{
  xhr.open('POST',storageApi('/api/bunny-upload'));xhr.setRequestHeader('Content-Type',file.type);xhr.setRequestHeader('X-Upload-Id',id);xhr.timeout=900000;
  for(const [name,value] of Object.entries(headers))xhr.setRequestHeader(name,value);if(ticket)xhr.setRequestHeader('X-Upload-Ticket',ticket);
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress('نقل الملف '+Math.round(e.loaded/e.total*100)+'%');};
  polling=window.setInterval(()=>{if(checking)return;checking=true;void publishingHeaders().then(fresh=>fetch(storageApi('/api/bunny-progress'),{method:'POST',headers:{...fresh,'X-Upload-Id':id}})).then(r=>r.json()).then(p=>{if(p?.phase==='uploading')onProgress('رفع إلى Bunny '+Math.round(p.loaded/p.total*100)+'%');if(p?.phase==='verifying')onProgress('التحقق من سلامة النسخة…');}).catch(()=>{}).finally(()=>{checking=false;});},3000);
  xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300||!result.verified||!result.convexId)throw Error(result.error??'لم يتأكد حفظ الملف.');resolve(result);}catch(e){reject(e);}};
  xhr.onerror=xhr.ontimeout=xhr.onabort=()=>reject(Error('تعذر إكمال الرفع؛ الأصل محفوظ.'));xhr.send(file);
 });}catch(e){if(ticket)await cancelUploadTicket(ticket).catch(()=>{});throw e;}finally{if(polling!==undefined)window.clearInterval(polling);}
}
export async function bunnyMedia(id:string){
 const headers=await publishingHeaders(),response=await fetch(storageApi('/api/bunny-media'),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({key:id})});if(!response.ok)throw Error('تعذر فتح النسخة الخاصة.');const rows=await response.json() as {id:string;url:string;retentionDeleteAt?:number}[];const asset=rows.find(a=>a.id===id);if(!asset)throw Error('النسخة غير متاحة؛ الأصل محفوظ.');return asset;
}

export async function bunnyPreviewUrl(id:string){return (await bunnyMedia(id)).url;}
export async function downloadBunnyFile(id:string){
 const {url}=await bunnyMedia(id),link=document.createElement('a');
 link.href=url+'&download=1';link.rel='noreferrer';link.download='video.mp4';
 document.body.appendChild(link);link.click();link.remove();
}
