import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
declare const __APP_VERSION__:string;
export function AppUpdate(){const [next,setNext]=useState('');
 useEffect(()=>{let active=true,running=false;const controller=new AbortController();async function check(){if(running||document.visibilityState==='hidden')return;running=true;try{const base=new URL(import.meta.env.BASE_URL,window.location.href),response=await fetch(new URL(`version.json?t=${Date.now()}`,base),{cache:'no-store',signal:controller.signal});if(!response.ok)return;const data=await response.json() as {version?:unknown};if(active&&typeof data.version==='string'&&data.version!==__APP_VERSION__)setNext(data.version)}catch{/* retry when online */}finally{running=false}}void check();const timer=window.setInterval(()=>void check(),60000);document.addEventListener('visibilitychange',check);window.addEventListener('online',check);return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check);window.removeEventListener('online',check)}},[]);
 if(!next)return null;
 return <div className="app-update" role="status"><span>تحديث جديد لمشهد متاح</span><button type="button" onClick={()=>{const url=new URL(window.location.href);url.searchParams.set('app-version',next);window.location.replace(url.href)}}><RefreshCw size={17}/>تحديث النظام</button><small>يُعاد فتح الموقع بالإصدار الجديد. احفظ الحقول غير المحفوظة أولًا.</small></div>;
}
