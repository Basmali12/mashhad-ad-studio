import {CustomerApp} from './customer-app';
import {SubscriptionGate} from '../features/subscriptions/subscription-gate';
import {MonthBoard} from '../features/scheduler/month-board';
import {SchedulePanel} from '../features/scheduler/schedule-panel';
import {useEffect,useState,lazy} from 'react';
import {PageBoundary} from '../shared/ui/page-boundary';
const Connections=lazy(()=>import('../features/buffer/legacy-connections').then(module=>({default:module.Connections})));
const PublishingBufferAccounts=lazy(()=>import('../features/buffer/buffer-accounts').then(module=>({default:module.PublishingBufferAccounts})));
const CloudInsights=lazy(()=>import('../features/publishing/cloud-insights').then(module=>({default:module.CloudInsights})));
import {SeriesLibrary} from '../features/library/library-page';
import {loadPublishingCollections,savePublishingCollection,type PublishingCollection} from '../features/library/collection-store';
import {prepareLibraryPublication} from '../features/publishing/library-automatic';
const PublishingHistory=lazy(()=>import('../features/publishing/publishing-history').then(module=>({default:module.PublishingHistory})));
import {publishingSaasMode} from '../shared/api/publishing-session';
import {ReelsSchedule} from '../features/scheduler/schedule-list';
const ReelsCalendar=lazy(()=>import('../features/scheduler/calendar').then(module=>({default:module.ReelsCalendar})));
import '../reels-calendar.css';
import {ReelsSettings} from './settings-page';
const ReelsSubscription=lazy(()=>import('../features/subscriptions/subscription-page').then(module=>({default:module.ReelsSubscription})));
import {Settings,ListVideo,CalendarDays,CalendarRange,Link2,History} from 'lucide-react';
type ReelsPage='library'|'calendar'|'schedule'|'connections'|'history'|'settings'|'subscription';
const navigation=[{id:'library',name:'قائمة النشر',icon:ListVideo},{id:'calendar',name:'التقويم',icon:CalendarDays},{id:'schedule',name:'الجدول',icon:CalendarRange},{id:'connections',name:'الحسابات',icon:Link2},{id:'history',name:'النتائج',icon:History}] as const;
export function Redesign(){return publishingSaasMode?<SubscriptionGate><CustomerApp/></SubscriptionGate>:<ReelsApp/>;}
function ReelsApp(){
 const [collections,setCollections]=useState<PublishingCollection[]>([]),[selected,setSelected]=useState('__general'),[page,setPage]=useState<ReelsPage>(()=>['social','buffer','youtube','connections'].some(k=>new URLSearchParams(location.search).has(k))?'connections':'library'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('mashhad-reels-theme')==='dark'?'dark':'light';}catch{return 'light';}});
 useEffect(()=>{document.documentElement.dataset.reelsTheme=theme;try{localStorage.setItem('mashhad-reels-theme',theme);}catch{/* private browsing may disable preferences */}},[theme]);
 useEffect(()=>{let live=true;void loadPublishingCollections().then(rows=>{if(live)setCollections(rows);}).catch(()=>{if(live)setError('تعذر قراءة قائمة النشر؛ لا تمسح بيانات المتصفح.');});return()=>{live=false;};},[]);
 async function save(next:PublishingCollection){setBusy(true);try{let saved:PublishingCollection={...next,updatedAt:Date.now()};saved=await savePublishingCollection(saved);setCollections(rows=>rows.some(p=>p.id===saved.id)?rows.map(p=>p.id===saved.id?saved:p):[...rows,saved]);if(!publishingSaasMode)for(const video of saved.libraryVideos??[])if(!video.publicationId&&!video.publishedAt&&!video.publishingError&&saved.publishTasks?.some(t=>t.id===video.taskId&&t.automaticPublishing))saved=await prepareLibraryPublication(saved,video,async p=>{await savePublishingCollection(p);});setCollections(rows=>rows.map(p=>p.id===saved.id?saved:p));}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}}
 const current=collections.find(p=>p.id===selected)??collections.find(p=>p.id==='__general');
 function openCollection(id:string){setSelected(id);setPage('library');}
 return <main className="reels-shell" data-theme={theme} dir="rtl" aria-label="مشهد — رفع وجدولة الريلز"><header className="reels-header"><strong>مشهد <small>رفع وجدولة الريلز</small></strong><nav aria-label="القائمة الرئيسية">{navigation.map(({id,name,icon:Icon})=><button key={id} aria-pressed={page===id} onClick={()=>setPage(id)}><Icon size={18} aria-hidden="true"/><span>{name}</span></button>)}</nav><div className="reels-header-actions"><button data-subscription-exempt aria-label="الإعدادات" aria-pressed={page==='settings'} onClick={()=>setPage('settings')}><Settings size={19}/><span>الإعدادات</span></button></div></header>{error&&<p className="series-error" role="alert">{error}</p>}
 {import.meta.env.DEV&&!publishingSaasMode&&<p className="library-note" role="status">معاينة التصميم فقط: تسجيل الدخول وربط مفاتيح الحسابات غير مفعّلين هنا.</p>}
 <PageBoundary key={page}>
 {page==='library'&&<><div className="reels-tools"><button className="series-secondary queue-calendar-button" onClick={()=>setPage('calendar')}><CalendarDays size={18}/> التقويم · ٣٠ يوم</button><span>ارفع الفيديوهات واضبط النشر اليومي من قائمة واحدة.</span></div>{current?<SeriesLibrary key={current.id} queueMode project={current} projects={collections} busy={busy} onSelect={setSelected} onSave={save}/>:<p role="status">جارٍ فتح قائمة النشر…</p>}{collections.filter(c=>c.id!==current?.id&&c.libraryVideos?.some(v=>!v.movedTo)).map(c=><details className="queue-saved-list" key={c.id}><summary>فيديوهات محفوظة · {c.name}</summary><SeriesLibrary queueMode project={c} projects={collections} busy={busy} onSelect={setSelected} onSave={save}/></details>)}</>}
 {page==='calendar'&&<ReelsCalendar collections={collections} onOpen={openCollection}/>}
 {page==='connections'&&<section className="reels-connections"><>{publishingSaasMode?<PublishingBufferAccounts/>:<Connections onBack={()=>setPage('library')}/>}</></section>}
 {page==='schedule'&&current&&(publishingSaasMode?<MonthBoard key={current.id} collection={current} collections={collections} busy={busy} onSave={save}/>:<><SchedulePanel key={current.id} collection={current} busy={busy} onSave={save}/><ReelsSchedule collections={collections} onOpen={openCollection}/></>)}
 {publishingSaasMode&&page==='history'&&<CloudInsights/>}
 {page==='settings'&&<ReelsSettings theme={theme} onTheme={setTheme} onSubscription={()=>setPage('subscription')} onConnections={()=>setPage('connections')}/>}
 {page==='subscription'&&<ReelsSubscription/>}
 {page==='history'&&<section className="reels-history"><h1>سجل النشر</h1>{!publishingSaasMode&&<PublishingHistory/>}<p>مواعيد الفيديوهات ونتائجها؛ سجلات النشر السابقة محفوظة.</p>{collections.flatMap(p=>(p.libraryVideos??[]).filter(v=>v.publicationId||v.publishedAt||v.publishingError).map(v=><article key={p.id+':'+v.id}><strong>{v.title}</strong><p>{v.publishedAt?'منشور':v.publishingError?'يحتاج مراجعة':'مجدول'}</p><button className="series-secondary" onClick={()=>{setSelected(p.id);setPage('library');}}>فتح الفيديو</button></article>))}{!collections.some(p=>p.libraryVideos?.some(v=>v.publicationId||v.publishedAt||v.publishingError))&&<p>لا توجد نتائج نشر محلية بعد.</p>}</section>}
 </PageBoundary>
 </main>;
}

