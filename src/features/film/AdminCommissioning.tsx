/* eslint-disable @typescript-eslint/no-explicit-any -- server validates the existing admin DTOs. */
import React,{useEffect,useRef,useState} from 'react';
import AdminVideoTest from './AdminVideoTest';
import {setupCall} from './accountSetupModel';
import {type FilmRequest,stateLabel,usd} from './filmClient';
import {phaseLabel} from './FilmGeneration';

export default function AdminCommissioning({request,accounts,onRefresh}:{request:FilmRequest;accounts:any[];onRefresh:()=>Promise<void>}){
 const [accountId,setAccountId]=useState(''),[slotId,setSlotId]=useState(''),[status,setStatus]=useState<any>(null),[quote,setQuote]=useState<any>(null),[video,setVideo]=useState(''),[reviewed,setReviewed]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[follow,setFollow]=useState(0),[submissionPending,setSubmissionPending]=useState(false),[stopId,setStopId]=useState(''),[videoJobId,setVideoJobId]=useState('');
 const guard=useRef(false),awaiting=useRef(false),refreshed=useRef('');
 const account=accounts.find(a=>a.id===accountId),slots=(account?.slots||[]).filter((s:any)=>!s.retired),slot=slots.find((s:any)=>s.id===slotId);
 const call=(op:Parameters<FilmRequest>[0],input:Record<string,unknown>={})=>setupCall(request,op,input);
 const run=async(fn:()=>Promise<void>)=>{if(guard.current)return;guard.current=true;setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'تعذر إكمال الخطوة؛ لا إعادة تلقائية.');}finally{guard.current=false;setBusy(false);}};
 useEffect(()=>{
  if(!slotId)return;let alive=true,running=false;
  const poll=async()=>{if(running)return;running=true;try{if(stopId){const stopped=await setupCall(request,'admin.operation.status',{id:stopId});if(stopped.confirmed===true&&alive){setStopId('');await onRefresh();}}const value=await setupCall(request,'admin.test.status',{id:slotId});if(!alive)return;setStatus(value);
   if(value.id||value.cloudStopped===true){awaiting.current=false;setSubmissionPending(false);}
   const settled=['completed','failed','stopped','needs_review'].includes(value.status)&&value.cloudStopped===true;
   if(settled||value.status==='not_started'&&!awaiting.current)clearInterval(timer);
   if(settled&&value.id&&refreshed.current!==value.id){await onRefresh();refreshed.current=value.id;}
  }catch{if(alive)setNotice('تعذر تحديث الحالة مؤقتاً؛ نتابع نفس الاختبار دون إعادة تشغيله.');}finally{running=false;}};
  const timer=setInterval(()=>void poll(),4000);void poll();return()=>{alive=false;clearInterval(timer);};
 },[slotId,request,follow,stopId,onRefresh]);
 const inFlight=!!status&&!['not_started','completed','failed','stopped','needs_review'].includes(status.status)||!!status&&status.status!=='not_started'&&status.cloudStopped!==true;
 return <section className="film-card film-commissioning"><h3>تجهيز المحرك واختباره ونشره</h3>
  <p>كل الخطوات من هنا. الأوزان تبقى في التخزين الدائم؛ مكتبات CUDA وPyTorch وLTX تُبنى داخل صورة Modal عند اختبار التشغيل، وتُعاد الاستفادة من الصورة المحفوظة.</p>
  <ol className="film-commission-steps"><li>ربط الحساب وفحصه</li><li>تجهيز الأوزان والتحقق منها</li><li>محرك خاص</li><li>بناء المكتبات واختبار فيديو</li><li>معاينة الصورة والصوت</li><li>نشر للزبائن</li></ol>
  <label>الحساب<select value={accountId} onChange={e=>{setAccountId(e.target.value);setSlotId('');setStatus(null);setVideo('');setQuote(null);setReviewed(false);}} disabled={busy||inFlight}><option value="">اختر حساباً محفوظاً</option>{accounts.filter(a=>!a.unlinked).map(a=><option key={a.id} value={a.id}>{a.label||a.workspace}{a.weightsReady?' — الأوزان جاهزة':' — يحتاج تجهيز الأوزان'}</option>)}</select></label>
  {account&&!account.weightsReady&&<p className="film-warning">الحساب مربوط، لكن الأوزان غير معتمدة بعد. أكمل تجهيز الحساب أعلاه؛ لا يبدأ اختبار GPU ولا يظهر للزبائن الآن.</p>}
  {account?.weightsReady&&<>
   <label>المحرك<select value={slotId} onChange={e=>{setSlotId(e.target.value);setStatus(null);setVideo('');setQuote(null);setReviewed(false);}} disabled={busy||inFlight}><option value="">اختر محركاً أو أنشئ محركاً خاصاً</option>{slots.map((s:any)=><option key={s.id} value={s.id}>{s.name} — {s.published?'منشور':'خاص'}</option>)}</select></label>
   {!slot&&slots.length<2&&<form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{const made=await call('admin.slot.save',{accountId,name:String(d.get('name')),hourPriceUSD:String(d.get('price')),gpu:'RTX-PRO-6000'});await onRefresh();setSlotId(made.id);});}}>
    <label>اسم المحرك<input name="name" required maxLength={120} defaultValue={account.label||account.workspace}/></label><label>سعر الإيجار بالدولار / ساعة<input name="price" defaultValue="3" required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?"/></label><button disabled={busy}>حفظ محرك خاص — بدون تشغيل</button>
   </form>}
   {slot&&<><p>{slot.gpu} · CPU 4 · RAM 96GiB · {usd(slot.hourMicros)} / ساعة · {slot.published?'منشور':'غير ظاهر للزبائن'}</p>
    <AdminVideoTest busy={busy||inFlight||submissionPending||account.activeCount>0} onQuote={input=>void run(async()=>{await call('admin.account.activate',{accountId});setQuote(await call('admin.test.quote',{id:slot.id,...input}));await onRefresh();})}/>
    {quote&&<section className="film-warning"><h4>الموافقة على اختبار التشغيل</h4><p>فيديو واحد 10 ثوانٍ، مع الصوت الأصلي. يشمل بناء المكتبات وتهيئة GPU عند الحاجة. تقدير نافذة الحوسبة: {typeof quote.estimate?.resourceWindowUSD==='number'?`$${quote.estimate.resourceWindowUSD.toFixed(3)}`:'غير متاح'}؛ البناء والتخزين إضافيان إن انطبقا، وليس سقف فاتورة مضموناً.</p><button disabled={busy} onClick={()=>void run(async()=>{const approved=quote;setQuote(null);setVideo('');setVideoJobId('');setReviewed(false);awaiting.current=true;setSubmissionPending(true);setStatus({status:'queued',cloudStopped:false});try{await call('admin.test.execute',{quoteId:approved.id,approved:true});}finally{setFollow(v=>v+1);}})}>أوافق — اختبار واحد فقط</button><button disabled={busy} onClick={()=>setQuote(null)}>إلغاء</button></section>}
    {status&&<section className="film-setup-status" aria-live="polite"><h4>{status.status==='not_started'?'جاهز لطلب اختبار التشغيل':stateLabel(status.status)}</h4>{inFlight&&<><progress aria-label="متابعة أحداث الاختبار الفعلية"/><button disabled={busy||!!stopId||!status.id} className="film-danger" onClick={()=>void run(async()=>{const stopped=await call('admin.slot.stop',{id:slot.id,approved:true});if(stopped.confirmed===false)setStopId(stopped.id);setFollow(v=>v+1);await onRefresh();})}>إلغاء الاختبار وإيقاف موارد هذا المحرك</button></>}<p>المرحلة: {phaseLabel(status.events?.at(-1)?.phase)}</p><p>زمن التشغيل المسجل: {typeof status.elapsedSeconds==='number'?`${Math.round(status.elapsedSeconds)} ثانية`:'غير متاح بعد'} · كلفة المورد المسجلة: {typeof status.recordedCost==='number'?`$${status.recordedCost}`:'غير متاحة'}</p>{status.error&&<p>تعذر إكمال الاختبار أو اعتماد الجودة. النتيجة محفوظة؛ لم تبدأ إعادة تلقائية. <bdi>{status.error}</bdi></p>}
     {status.videoVerified&&status.cloudStopped&&<button disabled={busy} onClick={()=>void run(async()=>{const ticket=await call('admin.test.ticket',{id:slot.id,jobId:status.id});setVideo(ticket.url);setVideoJobId(status.id);setReviewed(false);})}>معاينة فيديو الاختبار</button>}
     {video&&videoJobId===status.id&&<video controls playsInline preload="metadata" src={video} onEnded={()=>setNotice('راجع الصورة والصوت، ثم علّم مربع المراجعة قبل النشر.')} onError={()=>{setVideo('');setNotice('انتهى رابط المعاينة أو تعذر تشغيله؛ اطلب معاينة جديدة دون إعادة توليد.');}}/>}
     {status.ready&&<><label className="film-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>شاهدت نتيجة الاختبار وراجعت الصورة والصوت</label><button disabled={busy||!reviewed||!video||videoJobId!==status.id||account.activeCount>0} onClick={()=>void run(async()=>{await call('admin.test.publish',{id:slot.id,jobId:status.id,reviewed:true});await onRefresh();setStatus({...status,published:true,locked:false});setNotice('تم نشر المحرك وفتح الحجز للزبائن. GPU متوقف؛ يبدأ فقط عندما يستأجره الزبون.');})}>اعتماد الاختبار ونشر المحرك للزبائن</button></>}
     {status.published&&<p>المحرك منشور · {status.locked?'الحجوزات مقفلة':'متاح للحجز'}. النشر لا يُبقي GPU شغالاً.</p>}
    </section>}
   </>}
  </>}
  {notice&&<p role="status" className="film-notice">{notice}</p>}
 </section>;
}
