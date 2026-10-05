import {useQuery} from 'convex/react';
import {Wallet} from 'lucide-react';
import {api} from '../convex/_generated/api';
import {topupPhone} from '../shared/topup';
const usd=(n:number)=>`$${(n/1_000_000).toFixed(4)}`;
export function AiWallet(){
 const data=useQuery(api.wallets.aiMine);
 if(!data)return <div role="status">جارٍ تحميل رصيد المناقشة…</div>;
 const text=`أريد شحن رصيد مناقشة الذكاء الاصطناعي في مشهد. معرّفي: ${data.publicId??'لم أنشئ معرّف محفظة بعد'}`;
 return <section className="film-budget"><strong><Wallet size={16}/> محفظة المناقشة والتخطيط</strong><dl><div><dt>الرصيد المتاح لكل محادثاتك</dt><dd dir="ltr">{usd(data.availableMicros)}</dd></div>{data.heldMicros>0&&<div><dt>محجوز / غير محسوم</dt><dd dir="ltr">{usd(data.heldMicros)}</dd></div>}<div><dt>الاستخدام المسجّل الكلي</dt><dd dir="ltr">{usd(data.spentMicros)}</dd></div></dl><small>رصيد استخدام داخل مشهد، منفصل عن نقاط الفيديو ورصيد مزود الذكاء الاصطناعي. تُحسب الكلفة من الاستخدام وتعرفة الموديل؛ تُحجز كلفة الطلب مؤقتًا ثم يُخصم الاستخدام المسجّل فقط.</small>{data.availableMicros<=0&&<p role="status">اشحن رصيد المناقشة للمتابعة.</p>}<a className="studio-secondary" href={`https://wa.me/${topupPhone.replace(/\D/g,'')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">طلب شحن رصيد المناقشة عبر واتساب</a><details><summary>سجل رصيد المناقشة</summary>{data.ledger.map((e,i)=><p key={`${e.createdAt}-${i}`}>{e.note} <b dir="ltr">{usd(e.amountMicros)}</b> · <span dir="ltr">{new Date(e.createdAt).toLocaleString('en-GB')}</span></p>)}{!data.ledger.length&&<p>لا توجد حركات بعد.</p>}</details></section>;
}
