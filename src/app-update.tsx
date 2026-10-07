import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {RefreshCw} from 'lucide-react';
import {releaseUrl,watchRelease} from './release-check';
import './app-update.css';
declare const __APP_VERSION__:string;
export function AppUpdate(){
 const [next,setNext]=useState('');
 useEffect(()=>watchRelease(__APP_VERSION__,new URL(import.meta.env.BASE_URL,window.location.href),setNext),[]);
 if(!next)return null;
 return createPortal(<div className="app-update" role="status" dir="rtl"><strong>إصدار جديد من مشهد متاح</strong><button type="button" onClick={()=>window.location.replace(releaseUrl(window.location.href,next))}><RefreshCw size={18}/>تحديث الآن</button><small>احفظ أي تعديل غير محفوظ ثم حدّث. حسابك ورصيدك يبقيان محفوظين.</small></div>,document.body);
}
