import {UserButton,useUser,useClerk,useSession} from '@clerk/react';
import {useState,type ReactNode} from 'react';
import {CircleUserRound,LogOut} from 'lucide-react';
import './account-settings.css';
export function AccountSummary({name,email,signedIn=false,busy=false,error,onSignOut,children}:{name:string;email?:string;signedIn?:boolean;busy?:boolean;error?:string;onSignOut?:()=>void;children?:ReactNode}){
 return <div className="settings-account"><div className="settings-account-identity"><span className="settings-account-icon"><CircleUserRound size={27} aria-hidden="true"/></span><div><strong>{name}</strong>{email&&<p dir="auto">{email}</p>}<small>{signedIn?'حساب مسجّل الدخول':'لا توجد جلسة متصلة في المعاينة المحلية'}</small></div></div><div className="settings-account-actions">{children}<button type="button" className="settings-signout" data-subscription-exempt disabled={!signedIn||busy||!onSignOut} onClick={onSignOut} title={!signedIn?'يتفعّل عند تسجيل الدخول بالحساب الحقيقي':undefined}><LogOut size={18} aria-hidden="true"/>{busy?'جارٍ تسجيل الخروج…':'تسجيل الخروج'}</button></div>{error&&<p role="alert">{error}</p>}</div>;
}
export function AccountSettings(){
 const {user,isLoaded}=useUser(),{signOut}=useClerk(),{session}=useSession();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function logout(){if(busy||!session)return;setBusy(true);setError('');try{await signOut({sessionId:session.id,redirectUrl:location.origin+location.pathname});}catch{setError('تعذر تسجيل الخروج. حاول مرة أخرى.');setBusy(false);}}
 return !isLoaded?<p role="status">جارٍ قراءة الحساب…</p>:<AccountSummary name={user?.fullName??'حسابك'} email={user?.primaryEmailAddress?.emailAddress} signedIn={!!user&&!!session} busy={busy} error={error} onSignOut={()=>void logout()}><UserButton showName/></AccountSummary>;
}
