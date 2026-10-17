import {useState} from 'react';
import {useQuery,useMutation} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {PlanCards,PlatformBadge,planContact} from './plan-cards';
import {reelsPlans} from '../../../shared/reels-plans';
export function CloudSubscription(){
 const state=useQuery(api.reelsBilling.state,{}),choose=useMutation(api.reelsBilling.choosePlan);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function subscribe(code:string){setBusy(true);try{await choose({code});location.assign(planContact(code));}catch{setError('تعذر حفظ طلب الاشتراك.');}finally{setBusy(false);}}
 return <section className="reels-page">{!state?<p role="status">جارٍ قراءة الاشتراك…</p>:<>{state.active&&<article className="subscription-summary"><h1>{reelsPlans.find(p=>p.code===state.active!.planCode)?.name??'اشتراكك الحالي'}</h1><strong>المتبقي {state.remaining} / {state.active.videoLimit} فيديو</strong><p>مقبول {state.uploaded} · رفع جارٍ {state.uploading} · منشور {state.used}</p><div className="plan-platforms">{state.active.platforms.map(p=><PlatformBadge key={p} platform={p}/>)}</div><p>ينتهي {new Date(state.active.expiresAt).toLocaleDateString('ar-IQ',{timeZone:'Asia/Baghdad'})}</p></article>}<PlanCards selected={state.requestedPlan?.code} busy={busy} error={error} onChoose={code=>void subscribe(code)}/></>}</section>;
}
