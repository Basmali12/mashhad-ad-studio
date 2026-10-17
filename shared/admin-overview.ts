export interface AdminOverviewMetrics {
 expiringSubscriptions:number;todayScheduled:number;todayPublished:number;published:number;failed:number;upcoming:number;unresolved:number;reconnect:number;cleanupFailures:number;
}
export function emptyAdminOverview():AdminOverviewMetrics{return {expiringSubscriptions:0,todayScheduled:0,todayPublished:0,published:0,failed:0,upcoming:0,unresolved:0,reconnect:0,cleanupFailures:0};}
// One video job, regardless of the number of destination receipts. Baghdad is UTC+3.
export function summarizeAdminJob(job:{dryRun:boolean;cancelled:boolean;dueAt:number},rows:{phase:string;providerId?:string;updatedAt:number}[],at:number){
 const result={todayScheduled:0,todayPublished:0,published:0,failed:0,upcoming:0,unresolved:0};
 if(job.dryRun||job.cancelled||!rows.length)return result;
 const day=Math.floor((at+10800000)/86400000)*86400000-10800000;
 if(rows.every(r=>r.phase==='published'&&r.providerId)){
  result.published=1;const finished=Math.max(...rows.map(r=>r.updatedAt));if(finished>=day&&finished<day+86400000)result.todayPublished=1;
 }else{
  if(rows.some(r=>r.phase==='failed'))result.failed=1;
  if(rows.some(r=>r.phase==='uncertain'||r.phase==='paused'))result.unresolved=1;
  if(!result.failed&&!result.unresolved&&rows.some(r=>['queued','retry','leased','sending','accepted'].includes(r.phase))){
   if(job.dueAt>=at)result.upcoming=1;
   if(job.dueAt>=day&&job.dueAt<day+86400000)result.todayScheduled=1;
  }
 }
 return result;
}
export const adminPhaseNames:Record<string,string>={queued:'في انتظار الموعد',retry:'بانتظار إعادة المحاولة',leased:'قيد التجهيز',sending:'جارٍ الإرسال',accepted:'استلمه مزوّد النشر',published:'نشر مؤكد',failed:'فشل',uncertain:'نتيجة غير محسومة',dry_run:'اختبار دون نشر',cancelled:'ملغى',paused:'متوقف للمراجعة'};
