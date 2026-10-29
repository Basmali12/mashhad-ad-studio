import type {FilmRequest} from './filmClient';
import {filmEndpoint} from './filmEndpoint';
export function filmTransport(headers:()=>Promise<Record<string,string>>,active:()=>boolean,fetcher:typeof fetch=fetch):FilmRequest{
 return async(operation,input={},requestId=crypto.randomUUID())=>{
  const authorization=await headers();if(!active())throw Error('تغيّر الحساب؛ لم يُرسل الطلب.');
  const response=await fetcher(filmEndpoint('/api/mashhad-film'),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{...authorization,'Content-Type':'application/json'},body:JSON.stringify({operation,input,requestId})});
  if(!active())throw Error('تغيّر الحساب؛ لم تُعرض بيانات الجلسة السابقة.');
  if(!response.ok)throw Error(response.status===401?'انتهت جلسة الدخول؛ سجّل الدخول من جديد.':'خدمة الأفلام غير متاحة؛ لا تعِد طلباً مدفوعاً تلقائياً.');
  return response.json();
 };
}
