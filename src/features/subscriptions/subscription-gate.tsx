import {useState,type ReactNode} from 'react';
import {useMutation,useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {PlanCards,planContact} from './plan-cards';
export function SubscriptionGate({children}:{children:ReactNode}){
 const state=useQuery(api.reelsBilling.state,{}),choose=useMutation(api.reelsBilling.choosePlan);
 const active=state?.active&&state.active.expiresAt>Date.now();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function select(code:string){if(busy)return;setBusy(true);setError('');try{await choose({code});location.assign(planContact(code));}catch{setError('تعذر حفظ اختيار الباقة. حاول مرة أخرى.');}finally{setBusy(false);}}
 return <div onClickCapture={e=>{const target=e.target as HTMLElement;if(target.closest('[data-subscription-dialog],[data-subscription-exempt]'))return;if((!active||(state?.active?.expiresAt??0)<=Date.now())&&target.closest('button,a,input[type="file"]')){e.preventDefault();e.stopPropagation();setOpen(true);}}}>{children}{open&&!active&&<div className="subscription-overlay"><section className="subscription-dialog" role="dialog" aria-modal="true" aria-label="اختيار باقة الاشتراك" data-subscription-dialog><button className="plan-close" aria-label="إغلاق الباقات" onClick={()=>setOpen(false)}>×</button><PlanCards selected={state?.requestedPlan?.code} busy={busy||!state} error={error} onChoose={code=>void select(code)}/></section></div>}</div>;
}
