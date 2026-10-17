import {useEffect,useState,type ReactNode} from 'react';
import {ClerkProvider,useAuth,useClerk,useSignIn,HandleSSOCallback} from '@clerk/react';
import {arSA} from '@clerk/localizations';
import {ConvexReactClient,useConvexAuth,useQuery} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {api} from '../../../convex/_generated/api';
import {subscriptionContact} from '../../../convex/subscriptionPolicy';
import '../../subscription-gate.css';
import {connectStudioApi} from '../../studio-api';
const url=import.meta.env.VITE_CONVEX_URL as string|undefined,key=import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string|undefined;
const client=url&&/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url)?new ConvexReactClient(url):null;
export function SubscriptionRequired({children}:{children?:ReactNode}){
 return <main className="subscription-screen" dir="rtl"><section className="subscription-card"><div className="subscription-brand">مشهد</div><h1>راسل الإدارة للاشتراك</h1><p>هذا الحساب غير مصرح له بالدخول.</p><a className="subscription-contact" href={subscriptionContact} target="_blank" rel="noopener noreferrer">تواصل عبر واتساب لتفعيل اشتراكك</a>{children}</section></main>;
}
function PersonalGate({children}:{children:ReactNode}){
 const {isLoaded,isSignedIn}=useAuth(),{isAuthenticated,isLoading}=useConvexAuth(),clerk=useClerk(),{signIn}=useSignIn();
 const allowed=useQuery(api.access.allowed,isAuthenticated?{}:'skip');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function google(){if(!signIn||busy)return;setBusy(true);setError('');try{const result=await signIn.sso({strategy:'oauth_google',redirectCallbackUrl:window.location.origin+'/?google-callback=1',redirectUrl:window.location.origin+'/',oidcPrompt:'select_account'});if(result.error)throw result.error;}catch{setError('تعذر فتح تسجيل Google. حاول مرة أخرى.');setBusy(false);}}
 if(new URLSearchParams(window.location.search).has('google-callback'))return <HandleSSOCallback navigateToApp={({decorateUrl})=>window.location.replace(decorateUrl(window.location.origin+'/'))} navigateToSignIn={()=>window.location.replace('/?auth-denied=1')} navigateToSignUp={()=>window.location.replace('/?auth-denied=1')}/>;
 if(new URLSearchParams(window.location.search).has('auth-denied'))return <SubscriptionRequired><a href="/">العودة لتسجيل Google</a></SubscriptionRequired>;
 if(!isLoaded||isLoading)return <div className="auth-screen" role="status">جارٍ التحقق من حسابك…</div>;
 if(!isSignedIn)return <main className="subscription-screen" dir="rtl"><section className="subscription-card"><div className="subscription-brand">مشهد · المشروع الخاص</div><h1>تسجيل الدخول</h1><p>سجّل عبر حساب Google المصرح له.</p><button className="subscription-contact" disabled={busy} onClick={()=>void google()}>الدخول عبر Google</button>{error&&<p role="alert">{error}</p>}</section></main>;
 if(allowed===undefined)return <div className="auth-screen" role="status">جارٍ التحقق من تصريح الدخول…</div>;
 if(!allowed)return <SubscriptionRequired><button className="subscription-contact" onClick={()=>void clerk.signOut({redirectUrl:window.location.origin+'/'})}>تغيير حساب Google</button></SubscriptionRequired>;
 return <ConnectedStudio>{children}</ConnectedStudio>;
}
function ConnectedStudio({children}:{children:ReactNode}){const [ready,setReady]=useState(false);useEffect(()=>{if(!client)return;const disconnect=connectStudioApi(client);setReady(true);return disconnect;},[]);return ready?children:<div role='status'>جارٍ توصيل الاستوديو…</div>;} 
export function PersonalRoot({children}:{children:ReactNode}){
 if(!client||!key)return <div className="auth-screen" role="alert">إعداد تسجيل الدخول غير مكتمل. الدخول مغلق.</div>;
 return <ClerkProvider publishableKey={key} localization={arSA}><ConvexProviderWithClerk client={client} useAuth={useAuth}><PersonalGate>{children}</PersonalGate></ConvexProviderWithClerk></ClerkProvider>;
}

