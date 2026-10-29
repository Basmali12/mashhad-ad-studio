import {useEffect,useState,lazy} from 'react';
import {CustomerHeader,type CustomerPage} from './customer-header';
import {PageBoundary} from '../shared/ui/page-boundary';
import {ReelsSettings} from './settings-page';
import {MonthBoard} from '../features/scheduler/month-board';
import {loadPublishingCollections,savePublishingCollection,type PublishingCollection} from '../features/library/collection-store';
const Plans=lazy(()=>import('../features/subscriptions/cloud-subscription').then(m=>({default:m.CloudSubscription})));
const FilmGeneration=lazy(()=>import('../features/film/FilmEntry'));
export function CustomerApp(){
 const [page,setPage]=useState<CustomerPage>(()=>new URLSearchParams(location.search).has('buffer')?'settings':'schedule'),[collections,setCollections]=useState<PublishingCollection[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('mashhad-customer-theme')==='light'?'light':'dark';}catch{return 'dark';}});
 useEffect(()=>{document.documentElement.dataset.reelsTheme=theme;try{localStorage.setItem('mashhad-customer-theme',theme);localStorage.setItem('mashhad-reels-theme',theme);}catch{/* Theme storage is optional. */}},[theme]);
 useEffect(()=>{let active=true;void loadPublishingCollections().then(rows=>{if(active)setCollections(rows);}).catch(()=>{if(active)setError('تعذر قراءة فيديوهات حسابك؛ لا تمسح بيانات المتصفح.');});return()=>{active=false;};},[]);
 async function save(next:PublishingCollection){setBusy(true);setError('');try{const saved=await savePublishingCollection({...next,updatedAt:Date.now()});setCollections(rows=>rows.some(c=>c.id===saved.id)?rows.map(c=>c.id===saved.id?saved:c):[...rows,saved]);}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}}
 const collection=collections.find(c=>c.id==='__general')??collections[0];
 return <main className="reels-shell customer-shell" data-theme={theme} dir="rtl" aria-label="مشهد — رفع وجدولة الريلز"><CustomerHeader page={page} onPage={setPage}/>{error&&<p role="alert" className="series-error">{error}</p>}<PageBoundary key={page}>{page==='schedule'?(collection?<MonthBoard collection={collection} collections={collections} busy={busy} onSave={save}/>:<p role="status">جارٍ فتح جدول حسابك…</p>):page==='generate'?<section data-subscription-exempt><FilmGeneration onClose={()=>setPage('schedule')}/></section>:page==='plans'?<div data-subscription-dialog><Plans/></div>:<ReelsSettings theme={theme} onTheme={setTheme} onSubscription={()=>setPage('plans')} onConnections={()=>{}}/>}</PageBoundary></main>;
}
