import React,{useEffect,useRef,useState} from 'react';
import {useFilmRequest} from './useFilmRequest';
import {isFailure} from './filmClient';
type Orientation='portrait'|'landscape'|null;
export default function FilmOrientationSettings(){
 const request=useFilmRequest(),[value,setValue]=useState<Orientation>(null),[busy,setBusy]=useState(true),[notice,setNotice]=useState(''),guard=useRef(false);
 useEffect(()=>{let active=true;void request('preferences.get').then(r=>{if(isFailure(r))throw Error();if(active)setValue(r.orientation);}).catch(()=>{if(active)setNotice('تعذر تحميل اختيارك؛ أعد فتح الإعدادات.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[request]);
 async function save(orientation:Orientation){if(guard.current)return;guard.current=true;setBusy(true);setNotice('');try{const r=await request('preferences.save',{orientation});if(isFailure(r))throw Error();setValue(r.orientation);setNotice('تم حفظ الاتجاه لحسابك.');}catch{setNotice('تعذر حفظ الاتجاه؛ حاول مجدداً.');}finally{guard.current=false;setBusy(false);}}
 return <article className="film-orientation-settings"><h2>اتجاه إنتاج الفيديو</h2><div role="group" aria-label="اتجاه إنتاج الفيديو">{([{value:null,label:'بدون اختيار'},{value:'portrait',label:'عمودي 9:16'},{value:'landscape',label:'أفقي 16:9'}] as const).map(o=><button key={o.label} aria-pressed={value===o.value} disabled={busy} onClick={()=>void save(o.value)}>{o.label}</button>)}</div><p>بدون اختيار، المخرج يسألك بالدردشة. الاتجاه المحفوظ يُستخدم للأفلام الجديدة تلقائياً.</p>{notice&&<small role="status">{notice}</small>}</article>;
}
