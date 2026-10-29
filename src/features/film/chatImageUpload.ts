import type {FilmProject} from '../../../shared/film-contracts';
import type {FilmRequest} from './filmClient';
const messages:Record<string,string>={REFERENCE_SIZE:'الصورة أكبر من الحد المسموح: 4MB.',REFERENCE_TYPE:'اختر صورة JPEG أو PNG.',REFERENCE_DIMENSIONS:'أبعاد الصورة كبيرة؛ الحد 4096 بكسل لكل ضلع.',REFERENCE_INVALID:'تعذر قراءة الصورة؛ اختر JPEG أو PNG سليمة.',REFERENCE_LOCKED:'انتظر اكتمال المعالجة قبل تغيير الصورة.',REFERENCE_QUOTA:'مساحة الصور المرجعية ممتلئة؛ راجع الإدارة.'};
export function validateChatImage(file:File){if(!['image/png','image/jpeg'].includes(file.type))throw Error(messages.REFERENCE_TYPE);if(!file.size||file.size>4000000)throw Error(messages.REFERENCE_SIZE);}
/** One PUT only. A single read reconciles an interrupted response; never reuploads automatically. */
export async function uploadChatImage(file:File,project:FilmProject,call:FilmRequest,fetcher:typeof fetch=fetch):Promise<FilmProject>{
 validateChatImage(file);const ticket=await call('project.reference.ticket',{projectId:project.id});let saved=false,code='';
 try{const response=await fetcher(ticket.url,{method:'PUT',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':file.type},body:file,redirect:'error',signal:AbortSignal.timeout(30000)});saved=response.ok;if(!saved){const body=await response.json().catch(()=>null);code=typeof body?.error==='string'?body.error:'';}}catch{/* The server may already have saved it; read once below, without another upload. */}
 const latest:FilmProject=await call('project.get',{id:project.id});
 if(latest.reference&&(saved||latest.reference.uploadedAt!==project.reference?.uploadedAt))return latest;
 throw Error(messages[code]||'تعذر تأكيد رفع الصورة. صورتك باقية في الحقل؛ حدّث حالة المشروع قبل المحاولة مجدداً. لم يبدأ توليد فيديو.');
}
