import type {FilmRequest} from './filmClient';
import {filmEndpoint} from './filmEndpoint';
export function filmTransport(headers:()=>Promise<Record<string,string>>,active:()=>boolean,fetcher:typeof fetch=fetch):FilmRequest{
 return async(operation,input={},requestId=crypto.randomUUID())=>{
  const authorization=await headers();if(!active())throw Error('تغيّر الحساب؛ لم يُرسل الطلب.');
  const response=await fetcher(filmEndpoint('/api/mashhad-film'),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{...authorization,'Content-Type':'application/json'},body:JSON.stringify({operation,input,requestId})});
  if(!active())throw Error('تغيّر الحساب؛ لم تُعرض بيانات الجلسة السابقة.');
  if(!response.ok){
   // Never echo an upstream message/body: it may contain private diagnostics.
   const errors:Record<string,string>={ENGINE_NOT_CONFIGURED:'إنتاج الفيديو متوقف إلى حين إعداد محرك جديد. حساباتك وملفاتك ورصيدك محفوظة؛ لم يبدأ تشغيل مدفوع.',INVALID_INPUT:'راجع الحقول المطلوبة؛ رُفض تنسيق الطلب قبل التنفيذ.',INVALID_TOKEN_FORMAT:'أدخل Token ID الذي يبدأ بـ ak- وToken Secret الذي يبدأ بـ as-، كل واحد في حقله، دون أمر الطرفية.',FORBIDDEN:'هذه العملية للمسؤول فقط.',BUSY:'الخدمة مشغولة بطلبات أخرى؛ لم تُعَد المحاولة تلقائياً.',UNAUTHENTICATED:'انتهت جلسة الدخول؛ سجّل الدخول من جديد.',AUTH_UNAVAILABLE:'تعذر التحقق من جلسة الدخول حالياً.',ORIGIN_DENIED:'رابط لوحة الإدارة غير معتمد؛ افتح رابط الأدمن الرسمي.'};
   let code='';try{const data=await response.json();if(typeof data?.error==='string'&&Object.hasOwn(errors,data.error))code=data.error;}catch{/* No raw response in UI or logs. */}
   throw Error(response.status===401?errors.UNAUTHENTICATED:code?errors[code]:`تعذر إتمام الطلب (HTTP ${response.status}). لا إعادة تلقائية؛ حدّث الحالة قبل إعادة التنفيذ.`);
  }
  return response.json();
 };
}
