import {useRef, type Dispatch, type FormEvent, type SetStateAction} from 'react';
import {motion, useReducedMotion} from 'motion/react';
import {Sparkles, Store, Layers, Plus, Minus, ArrowUpLeft, AlertTriangle, Wallet, Timer, UploadCloud, Images} from 'lucide-react';
import type {AdForm} from './data';
import type {FlowOption} from '../shared/pipeline';
import type {PlaceReference} from './place-photos';
import {useMedia} from './studio-media';

type Source={image:string;name:string;duration?:number};
interface AdFormProps {
 form:AdForm;setForm:Dispatch<SetStateAction<AdForm>>;
 count:number;setCount:Dispatch<SetStateAction<number>>;
 option:FlowOption|undefined;options:FlowOption[];setChoice:(choice:FlowOption|null)=>void;
 source:Source|null;sourceDuration:number|undefined;onCancelSource:()=>void;
 references:PlaceReference[];useImages:boolean;imagesDisabled:boolean;onUseImages:(checked:boolean)=>void;onPhotos:()=>void;
 noBalance:boolean;totalPoints:number|undefined;online:boolean;logoEnabled:boolean;onWallet:()=>void;
 busy:boolean;sending:boolean;disabled:boolean;error:string;message:string;
 onGenerate:(e:FormEvent)=>void;onSave:()=>void;onNew:()=>void;
}

function ReferenceThumbnail({reference}:{reference:PlaceReference}){const media=useMedia(reference.storageId);return <div className="ad-reference-thumb">{media.url?<img src={media.url} alt={`صورة المكان ${reference.slot+1}`}/>:<Images size={22}/>}<small>{reference.slot+1}</small>{media.error&&<span title={media.error} aria-label="تعذر تحميل صورة المكان">!</span>}</div>}

export function AdGenerationForm(p:AdFormProps){const reduce=useReducedMotion(),prompt=useRef<HTMLTextAreaElement>(null);const {form,setForm,count,option,source}=p;
 return <motion.form className="studio-form ad-form" onSubmit={p.onGenerate} initial={reduce?false:{opacity:0,x:12}} animate={{opacity:1,x:0}} transition={{duration:.55,delay:.08}}>
  <div className="studio-panel ad-form-panel">
   <div className="ad-form-grid">
    <label className="ad-name"><span className="field-title"><span><Store size={17}/></span>اسم المحل أو الشركة</span><input required maxLength={120} placeholder="اسم علامتك التجارية، مثل: فن التقنية الحديثة" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
    <div className="ad-prompt"><label htmlFor="ad-description" className="field-title"><span>02</span>{source?'وصف التكملة':count>1?'وصف المقطع الأول':'وصف الفيديو'}</label>{source&&<div className="source-frame"><img src={source.image} alt="معاينة آخر لقطة من فيديو التكملة"/><div><strong>البداية من فيديو محفوظ</strong><p>{source.name}</p><small>ستبدأ التكملة من آخر إطار فعلي.</small><button type="button" onClick={p.onCancelSource}>إلغاء الربط</button></div></div>}<div className="ad-prompt-box"><textarea id="ad-description" ref={prompt} aria-label={source?'وصف التكملة':count>1?'وصف المقطع الأول':'وصف الفيديو'} required rows={3} maxLength={10000} placeholder="صف المكان والشخصيات، حركة الكاميرا وما يحدث في هذا المقطع…" value={form.prompt} onChange={e=>setForm(f=>({...f,prompt:e.target.value}))}/><span className="ad-character-count" dir="ltr">{form.prompt.length.toLocaleString('en-GB')}/10,000</span></div></div>
    <div className="ad-model"><label><span className="field-title"><span><Layers size={17}/></span>الموديل</span><select value={form.model} onChange={e=>{p.setChoice(null);setForm(f=>({...f,model:e.target.value}))}}>{['Omni Flash','Veo 3.1 Fast','Veo 3.1 Quality'].map(m=><option key={m}>{m}</option>)}</select></label></div>
    <div className="ad-dialect"><label><span className="field-title"><span>04</span>اللهجة</span><input aria-label="اللهجة المحفوظة" value={form.dialect} readOnly/><small>تُضبط اللغة واللهجة من الإعدادات.</small></label></div>
    <div className="ad-count"><span className="field-title"><span>03</span>عدد المقاطع</span><div className="clip-counter"><small>{source?'الجديد: ':''}{count.toLocaleString('en-GB')} × {option?.seconds??'…'} ثانية لكل مقطع</small><div><motion.button type="button" aria-label="حذف مقطع" disabled={count<=1} onClick={()=>p.setCount(n=>n-1)} whileTap={{scale:.94}}><Minus size={17}/></motion.button><b>{count.toLocaleString('en-GB')}</b><motion.button type="button" aria-label="إضافة مقطع تكملة" disabled={!option||option.seconds*(count+1)+(p.sourceDuration??0)>180||count>=(source?19:20)} onClick={()=>p.setCount(n=>n+1)} whileTap={{scale:.94}}><Plus size={17}/></motion.button></div></div></div>
    {Array.from({length:count-1},(_,i)=><motion.label className="continuation-field ad-continuation" key={i} initial={reduce?false:{opacity:0,height:0}} animate={{opacity:1,height:'auto'}}><span className="field-title"><span><Layers size={16}/></span>وصف تكملة المقطع {i+2}</span><textarea required rows={3} maxLength={10000} value={form.continuationPrompts?.[i]??''} placeholder="اكتب الحدث التالي فقط. سيبدأ من آخر إطار للمقطع السابق." onChange={e=>setForm(f=>{const prompts=[...(f.continuationPrompts??[])];prompts[i]=e.target.value;return {...f,continuationPrompts:prompts}})}/></motion.label>)}
    <label className="ad-aspect"><span className="field-title"><span>07</span>مقاس الإعلان</span><select value={form.aspect} onChange={e=>{p.setChoice(null);setForm(f=>({...f,aspect:e.target.value}))}}><option value="9:16">عمودي 9:16</option><option value="16:9">أفقي 16:9</option></select></label>
    <label className="ad-quality"><span className="field-title"><span>HQ</span>الجودة والمدة المتاحة</span><select aria-label="الجودة والمدة المتاحة" disabled={!p.options.length} value={option?JSON.stringify(option):''} onChange={e=>p.setChoice(JSON.parse(e.target.value) as FlowOption)}>{p.options.length?p.options.map(o=><option key={JSON.stringify(o)} value={JSON.stringify(o)}>{o.resolution} · {o.seconds} ثوانٍ لكل مقطع</option>):<option value="">بانتظار الخيارات المتاحة</option>}</select></label>
   </div>
   <section className="ad-upload" aria-label="صور الشارع والمحل"><div className="field-title"><span>08</span>صور الشارع والمحل<small>{p.references.length}/8</small><label className="studio-switch image-switch"><input type="checkbox" checked={p.useImages} disabled={p.imagesDisabled||!!source} onChange={e=>p.onUseImages(e.target.checked)}/><span>استخدام الصور لتقوية الإعلان <small>{form.aspect==='9:16'?'صور عمودية':'صور أفقية'}</small></span></label></div><div className="ad-upload-row"><button type="button" className="ad-upload-action" disabled={p.imagesDisabled} onClick={p.onPhotos}><UploadCloud size={32}/><strong>اضغط لرفع الصور أو إدارة مراجع المكان</strong><small>PNG، JPG، WebP · حتى 10 MB للصورة</small></button><div className="ad-reference-list">{p.references.slice(0,3).map(r=><ReferenceThumbnail key={r.storageId} reference={r}/>)}<motion.button className="ad-add-photos" type="button" aria-label="إضافة صور المكان" disabled={p.imagesDisabled} onClick={p.onPhotos} whileHover={{y:-2}}><Plus size={27}/><small>{p.references.length>3?`+${p.references.length-3} · إدارة الصور`:'إضافة صور'}</small></motion.button></div></div>{source&&<p className="studio-fine">التكملة تستخدم آخر لقطة من الفيديو؛ صور المكان تخص افتتاح إعلان جديد.</p>}</section>
   {p.noBalance&&<div className="ad-credit-warning" role="status"><AlertTriangle size={40}/><div><strong>رصيدك غير كافٍ!</strong><p>أضف رصيدًا إلى حسابك للمتابعة في توليد الفيديو.</p></div><motion.button type="button" onClick={p.onWallet} whileHover={{scale:1.02}} whileTap={{scale:.98}}><Wallet size={18}/>إضافة رصيد</motion.button></div>}
   <div className="generation-summary ad-summary"><span><strong><Sparkles size={22}/>{p.totalPoints??'…'} نقطة</strong><small>نقاط مشهد · تُحسب عند بدء كل مقطع</small></span><span><strong><Timer size={22}/>{option&&(!source||p.sourceDuration!==undefined)?option.seconds*count+(p.sourceDuration??0):'…'} ثانية</strong><small>المدة المطلوبة · {source?`أصل ${p.sourceDuration??'…'} + جديد ${option?option.seconds*count:'…'} ث`:`${count} ${count===1?'مقطع':'مقاطع'}`}</small></span><span><strong><Layers size={22}/>{option?option.cost*count:'…'}</strong><small>نقاط المصدر المتوقعة فقط</small></span></div>
   {p.error&&<div className="studio-error" role="alert">{p.error}</div>}{p.message&&<p role="status" className="studio-message">{p.message}</p>}
   <motion.button className="studio-generate ad-generate" type="submit" disabled={p.disabled} whileHover={p.disabled?undefined:{y:-1}} whileTap={p.disabled?undefined:{scale:.985}}><Sparkles size={27}/>{p.sending?'جارٍ إرسال الطلب…':'توليد الإعلان'}<ArrowUpLeft size={27}/></motion.button>
   <p className="studio-fine ad-consent">ضغطة التوليد تفوّض هذا الطلب وحده. {p.online?'الاستوديو جاهز لاستقباله.':'الطلب ينتظر اتصال الاستوديو؛ لم يبدأ التوليد.'} {p.logoEnabled?'الشعار الافتراضي يُضاف تلقائيًا.':'الشعار اختياري من الإعدادات.'}</p>
   <div className="draft-actions"><button type="button" disabled={p.busy} onClick={p.onSave}>حفظ المسودة</button><button type="button" disabled={p.busy} onClick={p.onNew}>إعلان جديد</button></div>
  </div>
 </motion.form>;
}
