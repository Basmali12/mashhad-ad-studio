import {InfrastructureCards} from './infrastructure-cards';
import type {Infrastructure} from '../../../shared/infrastructure';
import {Users,CalendarDays,CheckCircle2,TriangleAlert,RefreshCw,Radio} from 'lucide-react';
import type {AdminOverviewMetrics} from '../../../shared/admin-overview';
interface Data {infrastructure:Infrastructure;userCount:number;activeSubscriptions:number;expiredSubscriptions:number;registeredMediaBytes:number;productionPublishingEnabled:boolean;retentionEnabled:boolean;observedAt:number;overview:AdminOverviewMetrics}
export function AdminOverview({data,busy,onRefresh}:{data:Data;busy:boolean;onRefresh:()=>void}){
 const m=data.overview;
 const alerts=[{count:m.failed,text:'فيديوهات فشل نشرها — راجع إيصالاتها قبل أي إعادة إرسال.'},{count:m.unresolved,text:'فيديوهات تحتاج مراجعة؛ نتيجة النشر غير محسومة أو المهمة متوقفة.'},{count:m.reconnect,text:'روابط Buffer تحتاج تدخل الدعم للتحقق من المفتاح.'},{count:m.cleanupFailures,text:'ملفات تعذّر حذفها بعد مدة الاحتفاظ؛ النظام سيعيد المحاولة.'}].filter(a=>a.count>0);
 
 return <div className="admin-overview">
  <div className="admin-overview-top"><div><h2>وضع المنصة، بنظرة واحدة</h2><p>آخر قراءة: {new Date(data.observedAt).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})} · توقيت بغداد</p></div><button type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={16}/>{busy?'جارٍ التحديث…':'تحديث الملخص'}</button></div>
  <div className={'admin-publishing-state '+(data.productionPublishingEnabled?'is-running':'is-stopped')}><Radio size={20}/><div><strong>{data.productionPublishingEnabled?'النشر مفعّل':'النشر متوقف حالياً'}</strong><p>{data.productionPublishingEnabled?'راقب النتائج النهائية من الإيصالات؛ تفعيل النشر وحده لا يضمن اتصال كل حساب.':'إعدادات الإرسال أو عامل الجدولة مغلقة. هذا الملخص لا يغيّرها.'}</p></div></div>
  <div className="admin-summary-grid">
   <section className="admin-summary-card"><Users size={22}/><h3>الزبائن والاشتراكات</h3><dl><div><dt>المستخدمون</dt><dd>{data.userCount}</dd></div><div><dt>اشتراكات نشطة</dt><dd>{data.activeSubscriptions}</dd></div><div><dt>تنتهي خلال 7 أيام</dt><dd>{m.expiringSubscriptions}</dd></div><div><dt>سجلات اشتراكات منتهية</dt><dd>{data.expiredSubscriptions}</dd></div></dl></section>
   <section className="admin-summary-card"><CalendarDays size={22}/><h3>النشر اليوم والقادم</h3><dl><div><dt>مواعيد اليوم المنتظرة</dt><dd>{m.todayScheduled}</dd></div><div><dt>نُشرت اليوم بنجاح</dt><dd>{m.todayPublished}</dd></div><div><dt>فيديوهات قادمة</dt><dd>{m.upcoming}</dd></div><div><dt>إجمالي نجاح النشر</dt><dd>{m.published}</dd></div></dl><small>الفيديو يُحسب مرة لكل مهمة، بعد تأكيد جميع وجهاتها. الاختبارات مستبعدة.</small></section>

  </div>
  <InfrastructureCards data={data.infrastructure} registeredBytes={data.registeredMediaBytes} retention={data.retentionEnabled}/>
  <section className={'admin-alerts '+(alerts.length?'has-alerts':'')} aria-label="تنبيهات تحتاج متابعة"><h3>{alerts.length?<TriangleAlert size={20}/>:<CheckCircle2 size={20}/>}تنبيهات تحتاج متابعتك</h3>{alerts.length?<ul>{alerts.map(a=><li key={a.text}><b>{a.count}</b><span>{a.text}</span></li>)}</ul>:<p>ماكو تنبيهات مسجّلة تحتاج تدخلك حالياً.</p>}<small>الملخص من السجلات عند فتح اللوحة أو تحديثها؛ لا يفحص اتصال المنصات مباشرة.</small></section>
 </div>;
}
