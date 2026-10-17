import {addVisualProposal} from './redesign-visual';
import type {SeriesProject} from './redesign-data';
export function prepareGeneralEdit(project:SeriesProject,turnId:string,text:string){
 const source=[...(project.visualRequests??[])].reverse().find(r=>r.file&&r.jobId&&['ready','approved'].includes(r.status));
 const upload=[...(project.messages??[])].reverse().find(m=>m.image);
 const useUpload=!!upload&&(!source||upload.createdAt>(source.createdAt??0));
 if(!source&&!upload)return null;
 const next=addVisualProposal(project,{kind:'scene',name:'تعديل الصورة',description:text,prompt:'Edit the supplied reference image. Preserve every detail not explicitly requested for change, including existing people and their identities. Do not create a casting sheet or isolate characters. Apply this requested change: '+text,count:1,sourceRequestId:useUpload?null:source!.id},'reply-'+turnId);
 return {...next,visualRequests:next.visualRequests?.map((r,i)=>i===next.visualRequests!.length-1?{...r,editConfirmation:true,referenceFile:useUpload?upload!.image:undefined}:r),messages:[...(next.messages??[]),{id:'reply-'+turnId,replyTo:turnId,role:'assistant' as const,text:'هل تقصد تعديل الصورة الأخيرة بهذا الشكل: «'+text+'»؟ إذا صحيح قل نعم، وأعدّلها في Flow وأرجع لك النسخة الجديدة.',createdAt:Date.now()}]};
}
