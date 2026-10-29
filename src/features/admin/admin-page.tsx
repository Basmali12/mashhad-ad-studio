import {BannerAdmin} from './site-banner';
import {AdminOverview} from './admin-overview';
import {adminPhaseNames} from '../../../shared/admin-overview';
import {SubscriptionActivation} from './subscription-activation';
import {BanPanel} from './ban-panel';
import {ShieldBan,UserRoundCheck,LayoutDashboard,Image,Cpu} from 'lucide-react';
import {useState,useEffect,useCallback,useRef,lazy,Suspense} from 'react';
import type {FunctionReturnType} from 'convex/server';
import {useMutation,useConvex} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {BufferSupport} from './buffer-support';
const FilmEngines=lazy(()=>import('../film/FilmAdminEntry'));
export function ReelsAdmin() {
    const client=useConvex(),[data,setData]=useState<FunctionReturnType<typeof api.reelsAdmin.snapshot>|null>(null),seed=useMutation(api.reelsBilling.seed),update=useMutation(api.reelsAdmin.updatePlan),configure=useMutation(api.reelsInsights.configure);
    const refreshing=useRef(false),[busy,setBusy]=useState(false);
    const [message,setMessage]=useState(''),[tab,setTab]=useState<'overview'|'activation'|'bans'|'banner'|'engines'>('overview');
    const refresh = useCallback(async () => { if(refreshing.current)return;refreshing.current=true;setBusy(true);setMessage('');try {
        setData(await client.action(api.reelsAdmin.snapshot, {}));
    }
    catch (e) {
        setMessage((e as Error).message);
    }finally{refreshing.current=false;setBusy(false);} }, [client]);
    useEffect(() => { void refresh(); }, [refresh]);
    async function run(work: () => Promise<unknown>) { setMessage(''); try {
        await work();
        await refresh();
        setMessage('حُفظ التغيير وسجل التدقيق.');
    }
    catch (e) {
        setMessage((e as Error).message);
    } }
    const tabs=<nav className="admin-tabs" role="tablist" aria-label="أقسام الإدارة">{([{id:'overview',name:'نظرة عامة',icon:LayoutDashboard},{id:'activation',name:'تفعيل الاشتراك',icon:UserRoundCheck},{id:'bans',name:'الحظر',icon:ShieldBan},{id:'banner',name:'الإعلان',icon:Image},{id:'engines',name:'محركات الأفلام',icon:Cpu}] as const).map(t=><button type="button" key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>setTab(t.id)}><t.icon size={18}/>{t.name}</button>)}</nav>;
    if(tab!=='overview')return <section className="reels-page"><h1>لوحة الإدارة</h1>{tabs}{tab==='engines'?<Suspense fallback={<p>جارٍ فتح إدارة المحركات…</p>}><FilmEngines/></Suspense>:tab==='activation'?<SubscriptionActivation/>:tab==='banner'?<BannerAdmin/>:<BanPanel/>}</section>;
    return <section className="reels-page"><h1>لوحة الإدارة</h1>{tabs}{message && <p role="status">{message}</p>}{!data ? <div><p>{busy?'جارٍ تحميل ملخص الإدارة…':'تعذر تحميل الملخص.'}</p><button type="button" disabled={busy} onClick={()=>void refresh()}>إعادة المحاولة</button></div> : <><AdminOverview data={data} busy={busy} onRefresh={()=>void refresh()}/><details className="admin-advanced"><summary>تشخيص متقدم وإعدادات الدعم</summary><p>التفاصيل التالية للدعم الفني. أعداد الحالات تخص محاولات النشر على المنصات، وقد تتعدد للفيديو الواحد.</p><p>المستخدمون {data.userCount} · اشتراكات نشطة {data.activeSubscriptions} · منتهية {data.expiredSubscriptions}</p><p>حجم الوسائط المسجل: {(data.registeredMediaBytes / 1024 / 1024).toFixed(2)} MB؛ ليس قراءة مباشرة من لوحة Bunny.</p><p>الإرسال الحقيقي: {data.productionPublishingEnabled ? 'مفعّل' : 'مغلق'} · استدعاءات الذكاء: مغلقة</p><div className="publishing-account-grid">{Object.entries(data.deliveryCounts).map(([phase, count]) => <article key={phase}>{adminPhaseNames[phase]??phase}: {count} <code dir="ltr">{phase}</code></article>)}</div><button onClick={() => void run(() => seed({}))}>تهيئة الباقات المبدئية دون دفع</button><BufferSupport /><h2>الباقات</h2>{data.plans.map(p => <form key={p.code} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => update({ code: p.code, name: String(f.get('name')), videoLimit: Number(f.get('limit')), platformLimit: Number(f.get('platforms')), priceCents: String(f.get('price')) === '' ? undefined : Math.round(Number(f.get('price')) * 100), enabled: f.get('enabled') === 'on' })); }}><label>الاسم<input name="name" defaultValue={p.name}/></label><label>الفيديوهات<input type="number" name="limit" min="1" defaultValue={p.videoLimit}/></label><label>عدد المنصات<input type="number" name="platforms" min="1" max="4" defaultValue={p.platformLimit}/></label><label>السعر بالدولار<input type="number" step="0.01" min="0" name="price" defaultValue={p.priceCents === undefined ? '' : p.priceCents / 100}/></label><label><input type="checkbox" name="enabled" defaultChecked={p.enabled}/> مفعلة</label><button>حفظ الباقة</button></form>)}
 <h2>المستخدمون</h2><p>للبحث والحظر ورفع الحظر، افتح تبويب الحظر.</p><h2>حدود Buffer</h2><p>يعرض أحدث {data.personalConnections.length} ربط من {data.personalConnectionCount}؛ الإجماليات تقرأ على دفعات عند التحديث.</p>{data.personalConnections.map(c => <article key={c.subject}><p>{c.accountId}: {c.channelCount} قنوات · {c.needsReconnect ? 'يحتاج ربطًا' : 'محفوظ'}</p>{c.quota.map(q => <p key={q.windowSeconds}>{q.windowSeconds}: {q.remaining}/{q.capacity ?? 'غير معروف'}</p>)}</article>)}<h2>ميزانية التحليل</h2><p>محجوز {data.ai.reservedMicros / 1000000}$ · مؤكد {data.ai.settledMicros / 1000000}$</p><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => configure({ limitMicros: Math.round(Number(f.get('budget')) * 1000000) })); }}><input name="budget" aria-label="أقصى ميزانية التحليل بالدولار" type="number" min="0" max="100" step="0.01" defaultValue={data.ai.limitMicros / 1000000}/><button>حفظ السقف · لا يفعّل النماذج</button></form><h2>سجل التدقيق</h2>{data.audit.map(a => <p key={a._id}>{a.operation} · {new Date(a.createdAt).toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' })}</p>)}</details></>}</section>;
}
