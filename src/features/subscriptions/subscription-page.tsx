import {publishingSaasMode} from '../../shared/api/publishing-session';
import {CloudSubscription} from './cloud-subscription';
export function ReelsSubscription() { if (publishingSaasMode)
    return <CloudSubscription />; return <section className="reels-page reels-subscription"><h1>الاشتراك والرصيد</h1><article><h2>الباقات قيد التجهيز</h2><p>بعد تنفيذ نظام الاشتراكات، تظهر هنا الباقة الفعلية، تاريخ انتهائها، والفيديوهات المتبقية من حصتك.</p><p className="reels-muted">ماكو دفع مفعّل أو رصيد تجريبي محسوب على حسابك.</p></article></section>; }
