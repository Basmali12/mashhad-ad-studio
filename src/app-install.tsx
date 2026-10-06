import {useEffect,useRef,useState} from 'react';
import {Download,Smartphone,X} from 'lucide-react';
import './app-install.css';
type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?:boolean}).standalone===true;
export function AppInstall({name='مشهد'}:{name?:string}){
 const [installed,setInstalled]=useState(isStandalone),[busy,setBusy]=useState(false),[hint,setHint]=useState('');
 const deferred=useRef<InstallEvent|null>(null),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const capture=(e:Event)=>{e.preventDefault();deferred.current=e as InstallEvent};
  const done=()=>{deferred.current=null;setInstalled(true);dialog.current?.close()};
  const mode=window.matchMedia('(display-mode: standalone)'),changed=()=>{if(isStandalone())done()};
  window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',done);mode.addEventListener('change',changed);
  if('serviceWorker' in navigator&&import.meta.env.PROD)void navigator.serviceWorker.register(new URL('sw.js',new URL(import.meta.env.BASE_URL,location.href)),{updateViaCache:'none'}).catch(()=>{/* Browser-menu installation remains available. */});
  return()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',done);mode.removeEventListener('change',changed)};
 },[]);
 function help(){const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);setHint(ios?'على iPhone أو iPad: افتح الرابط في Safari، اضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية» واضغط «إضافة».':'إذا لم تظهر نافذة التثبيت: افتح الرابط في Chrome أو Edge، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» من قائمة المتصفح. على Safari في Mac استخدم «إضافة إلى Dock».');dialog.current?.showModal()}
 async function install(){if(busy)return;const event=deferred.current;if(!event){help();return}setBusy(true);deferred.current=null;try{await event.prompt();const choice=await event.userChoice;if(choice.outcome==='accepted')setInstalled(true)}catch{help()}finally{setBusy(false)}}
 if(installed)return null;
 return <><div className="mashhad-install"><button type="button" disabled={busy} onClick={()=>void install()} aria-label={`تثبيت تطبيق ${name}`}><Download size={17}/>{busy?'جارٍ فتح التثبيت…':'تثبيت التطبيق'}</button></div><dialog className="mashhad-install-dialog" ref={dialog} dir="rtl" aria-labelledby="install-title"><button className="install-close" type="button" aria-label="إغلاق إرشادات التثبيت" onClick={()=>dialog.current?.close()}><X size={20}/></button><Smartphone size={32}/><h2 id="install-title">تثبيت {name}</h2><p>{hint}</p><small>يفتح التطبيق بنافذة مستقلة. تسجيل الدخول والحماية يبقيان كما هما، ويحتاج اتصالًا بالإنترنت.</small><button className="install-ok" type="button" onClick={()=>dialog.current?.close()}>فهمت</button></dialog></>;
}
