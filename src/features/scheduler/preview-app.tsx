import {useEffect,useState} from 'react';
import {CustomerHeader,type CustomerPage} from '../../app/customer-header';
import {PlanCards} from '../subscriptions/plan-cards';
import {reelsPlans} from '../../../shared/reels-plans';
import {MonthBoardView} from './month-board';
import {AccountSummary} from '../auth/account-settings';
import {ReelsSettings} from '../../app/settings-page';
import {previewRead,previewUpload,previewSaveCollection,previewSaveSettings,type PreviewSettings,type PreviewUpload} from './preview-store';
import type {PublishingCollection} from '../library/collection-store';
const defaults:PreviewSettings={theme:'dark',plan:'reels-60-3',startsAt:Date.parse('2026-10-17T00:00:00+03:00')};
export function PreviewApp(){
 const [page,setPage]=useState<CustomerPage>('schedule'),[settings,setSettings]=useState(defaults),[collection,setCollection]=useState<PublishingCollection>({id:'preview-queue',name:'جدول المعاينة',libraryVideos:[]}),[files,setFiles]=useState<PreviewUpload[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void previewRead().then(data=>{if(!active)return;if(data.collection)setCollection(data.collection);if(data.settings)setSettings(data.settings);setFiles(data.files);setReady(true);}).catch(()=>setError('تعذر فتح التخزين المحلي. لا تمسح بيانات المتصفح.'));return()=>{active=false;};},[]);
 const plan=reelsPlans.find(p=>p.code===settings.plan)??reelsPlans[1];
 async function saveSettings(next:PreviewSettings){try{await previewSaveSettings(next);setSettings(next);setError('');}catch(e){setError((e as Error).message);}}
 async function upload(file:File,onProgress:(s:string)=>void){onProgress('جارٍ حفظ الفيديو محلياً…');const saved=await previewUpload(file,plan.videoLimit);setFiles((await previewRead()).files);return {id:saved.id,file:saved.file};}
 async function save(next:PublishingCollection){const saved=await previewSaveCollection(next);setCollection(saved);setFiles((await previewRead()).files);}
 return <main className="reels-shell" data-theme={settings.theme} dir="rtl"><CustomerHeader page={page} onPage={setPage} preview/><p className="preview-label" role="status">الحفظ يعمل على هذا المتصفح فقط، ويبقى بعد تحديث الصفحة. لا نشر أو ربط حساب حقيقي أو رفع إلى Bunny في هذه المعاينة.</p>{error&&<p role="alert">{error}</p>}{!ready?<p role="status">جارٍ فتح الفيديوهات المحلية…</p>:page==='plans'?<PlanCards selected={settings.plan} onChoose={code=>{void saveSettings({...settings,plan:code});setError('اختيار باقة العرض فقط؛ ليس اشتراكاً مدفوعاً.');}}/>:page==='settings'?<ReelsSettings theme={settings.theme} onTheme={theme=>void saveSettings({...settings,theme})} onSubscription={()=>setPage('plans')} onConnections={()=>{}} accountPanel={<AccountSummary name="الحساب" signedIn={false}/> } connectionsPanel={<section><h2>ربط Buffer</h2><p>الربط بمفتاح API الشخصي متوفر في النظام. لا تدخل مفتاحك الحقيقي في هذه المعاينة المحلية.</p><a href="https://publish.buffer.com/settings/api" target="_blank" rel="noopener noreferrer" className="series-secondary">استخراج المفتاح</a><label>مفتاح API الشخصي<input type="password" disabled placeholder="الربط الحقيقي غير مفعّل في المعاينة" autoComplete="off"/></label><button disabled>تحقق واربط</button></section>}/>:<MonthBoardView collection={collection} collections={[collection]} subscription={{startsAt:settings.startsAt,expiresAt:settings.startsAt+30*86400000,videoLimit:plan.videoLimit}} remaining={Math.max(0,plan.videoLimit-files.length)} uploading={0} acceptedUploads={files.map(f=>({key:f.id,size:f.file.size,acceptedAt:f.acceptedAt}))} channels={plan.platforms.map(service=>({id:'preview-'+service,service,name:'حساب عرض · '+service}))} busy={false} uploadVideo={upload} onSave={save}/>}</main>;
}
