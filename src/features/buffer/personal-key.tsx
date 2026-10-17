import {PersonalChannels} from './personal-channels';
import './platform-connections.css';
import {ConvexError} from 'convex/values';
import {useState} from 'react';
import {useQuery,useAction,useMutation} from 'convex/react';
import {api} from '../../../convex/_generated/api';
const windows:Record<number,string>={900:'15 دقيقة',86400:'24 ساعة',2592000:'30 يومًا'};
export function PublishingBufferPersonal(){
 const state=useQuery(api.publishingBufferPersonal.state,{}),connect=useAction(api.publishingBufferPersonal.connect),sync=useAction(api.publishingBufferPersonal.sync),select=useMutation(api.publishingBufferPersonal.select),dryRun=useAction(api.publishingBufferPersonal.dryRun);
 const [key,setKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function run(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setMessage('');try{await fn();setMessage('اكتمل الفحص؛ لم يُرسل أي منشور.');}catch(e){setMessage(e instanceof ConvexError&&typeof e.data==='string'?e.data:'تعذر إكمال الطلب. تأكد من تفعيل اشتراكك أو راسل الدعم؛ لم نستخدم مفتاحاً بديلاً.');}finally{setBusy(false);}}
 return <section className="buffer-personal" aria-label="الربط بمفتاح API شخصي"><h2>الربط بمفتاح API شخصي</h2><a className="series-secondary" href="https://publish.buffer.com/settings/api" target="_blank" rel="noopener noreferrer">استخراج المفتاح</a>
 <form className="buffer-key-form" onSubmit={e=>{e.preventDefault();if(state?.locked)return;const pending=key;setKey('');void run(()=>connect({key:pending}));}}><label>المفتاح الشخصي<input type="password" aria-label="المفتاح الشخصي" autoComplete="off" spellCheck={false} value={key} placeholder={state?.locked?'المفتاح محفوظ ومقفل':'الصق مفتاح حسابك هنا'} maxLength={4096} onChange={e=>setKey(e.target.value)} disabled={busy||!state?.configured||state?.locked}/></label><button className="series-primary" disabled={busy||!state?.configured||state?.locked||!key.trim()}>تحقق واربط</button></form>
 {state?.locked&&<p role="status">لتغيير مفتاح Buffer يرجى مراسلة الدعم</p>}{state?.needsReview&&<p role="alert">الربط محفوظ ومقفل؛ يحتاج اعتماد الإدارة.</p>}{state?.suspended&&<p role="alert">النشر موقوف؛ يرجى مراسلة الدعم.</p>}{message&&<p role="status">{message}</p>}{!state?<p>جارٍ فحص الإعدادات…</p>:<>
 {!state.configured&&<p>مسار المفاتيح غير مفعّل بهذه البيئة؛ لا يستخدم أي مفتاح بديل.</p>}
 {state.connected&&<><p>حساب Buffer: {state.accountId} · المنظمات: {state.organizations.length}</p><button disabled={busy} onClick={()=>void run(()=>sync({}))}>فحص المفتاح وتحديث القنوات</button>
 </>}
 <PersonalChannels channels={state.channels??[]} selected={state.selectedChannelIds??[]} approved={state.approvedChannelIds??[]} blocked={!!state.needsReconnect||!!state.needsReview||!!state.suspended} busy={busy} onSelect={ids=>void run(()=>select({ids}))} onDryRun={channelId=>void run(()=>dryRun({channelId,metadata:{title:'اختبار محلي دون نشر',description:'اختبار تجهيز الحقول فقط',hashtags:[],categoryId:'22',madeForKids:false,privacy:'private',isAiGenerated:false}}))}/>
 {state.connected&&<>
 <strong>حصة هذا المفتاح وحده</strong>{state.quota?.windows.map(w=><p key={w.windowSeconds}>{windows[w.windowSeconds]}: {w.remaining} متبقي{w.capacity===undefined?'':` من ${w.capacity}`} · التجدد خلال {w.resetSeconds} ثانية من آخر قراءة</p>)}{state.quota&&<small>آخر قراءة: {new Date(state.quota.observedAt).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})}</small>}
 <p>{state.publishingEnabled?'النشر التلقائي مفعّل لحسابك للمواعيد الجديدة. المهام القديمة الموقوفة لا تُرسل تلقائياً.':'الإرسال الحقيقي موقوف لهذا الحساب؛ حفظ الموعد وحده لا ينشر الفيديو.'}</p></>}
 </>}
 </section>;
}

