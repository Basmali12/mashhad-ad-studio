import {useRef,useState} from 'react';
import {useAction,useQuery} from 'convex/react';
import {Music2} from 'lucide-react';
import {api} from '../convex/_generated/api';
import {cloudError} from './cloud';

export function TikTokSettings(){
 return import.meta.env.VITE_BUFFER_ENABLED==='true'?<ConnectedTikTokSettings/>:<TikTokCard/>;
}
function TikTokCard(){
 return <section className="social-card social-tiktok" aria-label="ربط تيك توك"><div className="social-heading"><Music2 size={23}/><strong>تيك توك</strong><span>غير مرتبط</span></div><p>أضف حساب تيك توك الخاص بك في Buffer، ثم اربط Buffer بمشهد من القسم أعلاه.</p><a className="studio-secondary" href="https://publish.buffer.com/settings/channels" target="_blank" rel="noreferrer">ربط تيك توك عبر Buffer</a></section>;
}
function ConnectedTikTokSettings(){
 const state=useQuery(api.buffer.state),sync=useAction(api.buffer.sync),begin=useAction(api.buffer.begin);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 const accounts=state?.channels.filter(channel=>channel.service==='tiktok')??[];
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   if(state?.connected)await sync({});
   else{const url=await begin({origin:window.location.origin});window.location.assign(url);}
  }catch(e){setError(cloudError(e));}finally{lock.current=false;setBusy(false);}
 }
 return <section className="social-card social-tiktok" aria-label="ربط تيك توك"><div className="social-heading"><Music2 size={23}/><strong>تيك توك</strong><span>{state===undefined?'جارٍ التحقق…':accounts.length?'مرتبط عبر Buffer':'غير مرتبط'}</span></div><p>اضغط ربط تيك توك، ثم اختر إضافة قناة TikTok داخل Buffer. بعد إكمال الربط ارجع إلى مشهد وحدّث الحسابات.</p><div className="buffer-actions"><a className="studio-secondary" href="https://publish.buffer.com/settings/channels" target="_blank" rel="noreferrer">{accounts.length?'إدارة ربط تيك توك':'ربط تيك توك'}</a><button type="button" className="studio-secondary" disabled={busy||!state?.configured} onClick={()=>void refresh()}>{busy?'جارٍ العمل…':state?.connected?'تحديث حسابات تيك توك':'ربط Buffer بمشهد'}</button></div>{accounts.map(account=><p key={account.id}><strong dir="auto">{account.name}</strong></p>)}{state?.needsReconnect&&<p role="alert">انتهى تصريح Buffer؛ أعد ربطه من القسم أعلاه.</p>}{error&&<p className="studio-error" role="alert">{error}</p>}<p className="studio-fine">تختار حساب تيك توك عند نشر الفيديو عبر Buffer. الربط وحده لا ينشر أي فيديو.</p></section>;
}
