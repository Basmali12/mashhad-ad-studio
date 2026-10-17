import {studioImage} from './retired-studio-api';
import {imageEditPrompt} from '../shared/image-edit-prompt';
import type {SeriesProject} from './redesign-data';
export interface VisualProposal {kind:'character'|'place'|'scene';name:string;description:string;prompt:string;count:number;sourceRequestId:string|null}
export interface VisualRequest extends VisualProposal {id:string;editConfirmation?:boolean;referenceFile?:File;referenceStorageId?:string;messageId?:string;createdAt?:number;status:'draft'|'awaiting_generation'|'generating'|'ready'|'approved'|'rejected'|'failed';instructions:string;jobId?:string;file?:File;transparent?:boolean;error?:string;recovery?:'check_connection'|'resume'|'review'}
export function addVisualProposal(project:SeriesProject,proposal:VisualProposal,messageId?:string):SeriesProject{
 if(!Number.isInteger(proposal.count)||proposal.count<1||proposal.count>12||proposal.prompt.length>8000)throw new Error('طلب الصورة غير صالح.');
 if(proposal.sourceRequestId&&!project.visualRequests?.some(r=>r.id===proposal.sourceRequestId&&r.file&&r.jobId))throw new Error('الصورة الأصلية المطلوبة للتعديل غير موجودة.');
 return {...project,visualRequests:[...(project.visualRequests??[]),{...proposal,id:crypto.randomUUID(),messageId,createdAt:Date.now(),status:'draft',instructions:project.instructions??''}]};
}
export function approveVisual(project:SeriesProject,id:string):SeriesProject{
 const request=project.visualRequests?.find(r=>r.id===id);
 if(!request?.file||request.status!=='ready'||request.count!==1)throw new Error('اختر شخصية منفردة أولًا قبل الاعتماد.');
 if(request.kind==='character'&&!request.transparent)throw new Error('أزل الخلفية أولًا، ثم راجع الشخصية واعتمدها.');
 const asset={id:request.id,name:request.name,description:request.description,image:request.file,updatedAt:Date.now()};
 return {...project,visualRequests:project.visualRequests?.map(r=>r.id===id?{...r,status:'approved'}:r),...(request.kind==='character'?{characters:[...project.characters,asset]}:request.kind==='place'?{places:[...(project.places??[]),{id:request.id,name:request.name,description:request.description,references:[{id:request.id,label:request.name,file:request.file}],updatedAt:Date.now()}]}:{sceneImages:[...(project.sceneImages??[]),asset]})};
}
class VisualOperationError extends Error {constructor(message:string,readonly code?:string){super(message);}}
export async function imageOperation(body:object){if(!import.meta.env.DEV)return studioImage(body);const response=await fetch('/api/series-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let result;try{result=await response.json();}catch{throw new Error('خدمة الصور المحلية غير متاحة.');}if(!response.ok||result.error)throw new VisualOperationError(result.error??'تعذر توليد الصورة.',result.code);return result;}
export function visualRecovery(request:VisualRequest):'check_connection'|'resume'|'review'{
 return request.recovery??(!request.jobId&&request.error?.includes('يحتاج تفعيل الخدمة')?'check_connection':'resume');
}
export async function checkVisualConnection(project:SeriesProject,id:string,onSave:(p:SeriesProject)=>Promise<void>){
 const request=project.visualRequests?.find(r=>r.id===id);
 if(!request||request.status!=='failed'||visualRecovery(request)!=='check_connection')throw new Error('هذا الطلب لا يحتاج فحص الربط.');
 const result=await imageOperation({op:'check'});
 const next={...project,visualRequests:project.visualRequests?.map(r=>r.id===id?{...r,recovery:result.ready?'resume' as const:'check_connection' as const,error:result.ready?'تفعّلت الخدمة. اضغط إكمال التوليد؛ موافقتك على البرومبت محفوظة.':result.message??'خدمة الصور الخاصة لم تتفعّل بعد.'}:r)};
 await onSave(next);return next;
}
export function approvePrompt(project:SeriesProject,id:string):SeriesProject{
 const request=project.visualRequests?.find(r=>r.id===id);
 if(!request||request.status!=='draft'||!request.prompt.trim())throw new Error('البرومبت غير جاهز.');
 return {...project,visualRequests:project.visualRequests?.map(r=>r.id===id?{...r,status:'awaiting_generation'}:r)};
}
export function selectCandidate(project:SeriesProject,id:string,index:number):SeriesProject{
 const source=project.visualRequests?.find(r=>r.id===id);
 if(!source?.file||!source.jobId||source.status!=='ready'||source.count<=1||!Number.isInteger(index)||index<1||index>source.count)throw new Error('رقم الشخصية غير صالح.');
 return addVisualProposal(project,{kind:source.kind,name:source.name+' '+index,description:source.description,count:1,sourceRequestId:id,prompt:`Extract ONLY candidate number ${index} from the supplied contact sheet. Preserve that exact face, body and clothes. One full-body portrait, no numbers, no other characters, plain background. ${source.description}`});
}
export async function removeCharacterBackground(file:File):Promise<File>{
 const {removeBackground}=await import('@imgly/background-removal');
 const blob=await removeBackground(file,{device:'cpu',model:'isnet_quint8',output:{format:'image/png'},proxyToWorker:false});
 const bitmap=await createImageBitmap(blob);
 try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('تعذر فحص الشفافية.');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let clear=0,solid=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]<20)clear++;if(pixels[i]>230)solid++;}if(clear<100||solid<100)throw new Error('لم نحصل على شخصية شفافة سليمة.');return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.png',{type:'image/png'});}finally{bitmap.close();}
}
export async function generateVisual(project:SeriesProject,id:string,onSave:(p:SeriesProject)=>Promise<void>){
 const request=project.visualRequests?.find(r=>r.id===id);if(!request||!['awaiting_generation','generating','failed'].includes(request.status))throw new Error('وافق على البرومبت أولًا.');
 if(request.status==='failed'&&visualRecovery(request)!=='resume')throw new Error(request.error??'أكمل ربط Flow قبل التوليد.');
 let next=project;
 async function update(patch:Partial<VisualRequest>){next={...next,visualRequests:next.visualRequests?.map(r=>r.id===id?{...r,...patch}:r)};await onSave(next);}
 try{
  await update({status:'generating',error:undefined,recovery:undefined});
  let referenceStorageId=request.referenceStorageId;
  if(request.referenceFile&&!referenceStorageId&&!request.jobId){
   const bitmap=await createImageBitmap(request.referenceFile);
   let data:string;
   try{const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context)throw new Error('تعذر تجهيز المرجع.');context.drawImage(bitmap,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/jpeg',0.85).split(',')[1];}finally{bitmap.close();}
   referenceStorageId=(await imageOperation({op:'uploadReference',data,type:'image/jpeg',name:'chat-reference.jpg'})).storageId;await update({referenceStorageId});
  }
  const source=project.visualRequests?.find(r=>r.id===request.sourceRequestId);
  const format=request.count>1?(request.kind==='character'?`CASTING OPTIONS, not a character consistency sheet. Create one image containing EXACTLY ${request.count} different people with distinctly different faces, numbered 1 through ${request.count}. They are alternative actors for the SAME story role, NOT ${request.count} poses or views of one actor, NOT clones or near-identical faces. The role, ethnicity, age range, period and clothing requirements apply to every candidate; vary facial identity visibly: face shape, jaw, nose, eyes, eyebrows, hairline and facial hair. Changing only expressions, poses or clothes is insufficient. Use equal-size separate cells${request.count===4?' in a 2 by 2 grid':''}, one person per cell, identical framing and lighting, clear recognizable faces, no dominant oversized portrait. Each character isolated on a clean plain white background. No scenery, no overlapping bodies.`:`Create one contact sheet with EXACTLY ${request.count} DIFFERENT numbered candidates, numbered 1 through ${request.count}. Separate equal-size cells, no overlapping bodies. No scenery.`):request.kind==='character'?'Single isolated full-body character. No scenery, no props obscuring the body. Plain white background suitable for precise background removal.':'';
  const prompt=[request.instructions,request.prompt,source||referenceStorageId?'':format].filter(Boolean).join('\n\n');
  const jobId=request.jobId??(await imageOperation({op:'generate',key:request.id,prompt:source||referenceStorageId?imageEditPrompt(prompt):prompt,sourceJobId:source?.jobId,sourceStorageId:referenceStorageId})).jobId;
  await update({jobId});
  const deadline=Date.now()+12*60000;
  while(Date.now()<deadline){const result=await imageOperation({op:'status',jobId});if(result.status==='completed'&&result.data){const bytes=Uint8Array.from(atob(result.data),(c:string)=>c.charCodeAt(0));const file=new File([bytes],request.name+'.'+(result.type==='image/png'?'png':result.type==='image/webp'?'webp':'jpg'),{type:result.type});await update({status:'ready',file});return next;}if(['failed','login','uncertain','stopped'].includes(result.status))throw new VisualOperationError('Flow أوقف الطلب. يحتاج مراجعة اتصال الحساب وحالة الصورة قبل المتابعة.','REVIEW_REQUIRED');await new Promise(resolve=>setTimeout(resolve,5000));}
  throw new Error('الصورة ما زالت قيد المتابعة. يمكنك متابعة نفس الطلب دون إعادة توليده.');
 }catch(e){await update({status:'failed',error:e instanceof Error?e.message:'تعذر توليد الصورة.',recovery:e instanceof VisualOperationError&&['SERVICE_NOT_ACTIVE','SERVICE_UNAVAILABLE'].includes(e.code??'')?'check_connection':e instanceof VisualOperationError&&e.code==='REVIEW_REQUIRED'?'review':'resume'});return next;}
}

