import {useClerk} from '@clerk/react';
import {Film,Settings,Sun,Wallet,UserRound,Sparkles,Layers,Play,Plus,Minus,Store,UploadCloud,ArrowUpLeft} from 'lucide-react';
import {AdAmbient,AdShortcuts,CreativeHero} from './ad-creative';
import './studio.css';
import './ad-ai.css';
import './studio-theme.css';
export function GuestStudio(){
 const {openSignIn}=useClerk();
 const login=()=>void openSignIn();
 return <div className="studio-shell ad-studio guest-studio" onClickCapture={e=>{if((e.target as HTMLElement).closest('button,a,input,textarea,select')){e.preventDefault();e.stopPropagation();login()}}}>
  <div className="studio-glow"/><AdAmbient/>
  <header className="studio-header"><a className="studio-brand" href="#"><span><Film size={24}/></span><div>مشهد<small>فكرتك… تستحق مشهدًا</small></div></a><div className="header-actions"><button className="guest-login" type="button" aria-label="دخول / إنشاء حساب"><UserRound size={18}/><span>دخول / إنشاء حساب</span></button><button className="studio-icon studio-wallet" aria-label="محفظة النقاط"><Wallet size={17}/><span>—</span></button><button className="studio-icon" aria-label="الوضع الفاتح"><Sun size={19}/></button><button className="studio-icon" aria-label="إعدادات الاستوديو"><Settings size={21}/></button></div></header>
  <main className="studio-main"><AdShortcuts onPrompt={login} onFilm={login} onPhotos={login} onClips={login} onResults={login}/>
   <div className="guest-welcome"><Sparkles size={22}/><div><strong>فكرتك تستحق أن تُشاهد</strong><p>اكتشف مشهد، وسجّل الدخول عبر Google لتبدأ صناعة الفيديو.</p></div><button type="button">ابدأ الآن <ArrowUpLeft size={18}/></button></div>
   <div className="studio-workspace"><section className="studio-form ad-form"><div className="studio-panel ad-form-panel"><div className="ad-form-grid">
    <label className="ad-name"><span className="field-title"><span><Store size={17}/></span>اسم المحل أو الشركة</span><input readOnly placeholder="اسم علامتك التجارية، مثل: فن التقنية الحديثة"/></label>
    <div className="ad-prompt"><label htmlFor="guest-prompt" className="field-title"><span>02</span>وصف الفيديو</label><div className="ad-prompt-box"><textarea id="guest-prompt" readOnly rows={3} placeholder="صف فكرتك، المكان والشخصيات وما تريد أن يحدث…"/></div></div>
    <label className="ad-model"><span className="field-title"><span><Layers size={17}/></span>الموديل</span><select defaultValue="choose"><option value="choose">اختر موديل الفيديو</option></select></label>
    <label className="ad-dialect"><span className="field-title"><span>04</span>اللهجة</span><select defaultValue="iraqi"><option value="iraqi">العراقية</option></select></label>
    <div className="ad-count"><span className="field-title"><span>03</span>عدد المقاطع</span><div className="clip-counter"><small>اختر عدد مقاطع فكرتك</small><div><button type="button" aria-label="حذف مقطع"><Minus size={17}/></button><b>1</b><button type="button" aria-label="إضافة مقطع تكملة"><Plus size={17}/></button></div></div></div>
    <label className="ad-aspect"><span className="field-title"><span>07</span>مقاس الإعلان</span><select defaultValue="vertical"><option value="vertical">عمودي 9:16</option><option value="horizontal">أفقي 16:9</option></select></label>
    <label className="ad-quality"><span className="field-title"><span>HQ</span>الجودة والمدة المتاحة</span><select defaultValue="choose"><option value="choose">اختر الجودة والمدة بعد الدخول</option></select></label>
   </div><section className="ad-upload"><div className="field-title"><span>08</span>صور الشارع والمحل</div><button type="button" className="ad-upload-action"><UploadCloud size={32}/><strong>أضف صور مكانك لتقوية الإعلان</strong><small>صور الشارع والمحل والشخصيات</small></button></section>
   <button type="button" className="studio-generate ad-generate"><Sparkles size={25}/>توليد الإعلان<ArrowUpLeft size={25}/></button><p className="studio-fine">سجّل الدخول لمشاهدة التكلفة واستخدام رصيدك. تصفح الواجهة لا يشغّل توليدًا.</p>
   </div></section><CreativeHero/></div>
  </main><nav className="studio-bottom" aria-label="تبويبات مشهد">{[{name:'إعلان AI',icon:Sparkles},{name:'طلباتي',icon:Film},{name:'فيديو AI',icon:Play},{name:'أفلام AI',icon:Layers}].map((tab,i)=><button type="button" aria-current={i===0?'page':undefined} key={tab.name}><tab.icon size={25}/><span>{tab.name}</span></button>)}</nav>
 </div>;
}
