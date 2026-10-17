import {SiteBanner} from '../banner/site-banner';
import {storageApi} from '../../shared/api/storage-api';
import {useEffect,useState,type ReactNode} from 'react';
import {ClerkProvider,SignIn,SignUp,UserButton,useAuth,useUser} from '@clerk/react';
import {arSA} from '@clerk/localizations';
import {ConvexReactClient,useConvexAuth,useMutation,useQuery} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {api} from '../../../convex/_generated/api';
import {connectPublishingCloud} from '../../shared/api/publishing-session';
import {publishingHeaders} from '../../shared/api/publishing-session';
const url=import.meta.env.DEV&&import.meta.env.VITE_PUBLISHING_TEST_CONVEX_URL?import.meta.env.VITE_PUBLISHING_TEST_CONVEX_URL:import.meta.env.VITE_CONVEX_URL;
const valid=typeof url==='string'&&(/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url)||import.meta.env.DEV&&url==='http://127.0.0.1:43240');
const client=valid?new ConvexReactClient(url):null,key=import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string|undefined;
function TenantSession({children,administratorOnly=false}:{children:ReactNode;administratorOnly?:boolean}){
 const {isLoaded,isSignedIn,userId,getToken,sessionClaims}=useAuth(),{user}=useUser(),{isAuthenticated,isLoading}=useConvexAuth(),register=useMutation(api.publishingUsers.register),ownerAllowed=useQuery(api.access.allowed,administratorOnly&&isAuthenticated?{}:'skip'),[readyUser,setReadyUser]=useState<string|null>(null),[error,setError]=useState(''),[storageError,setStorageError]=useState('');
 useEffect(()=>{setReadyUser(null);setError('');setStorageError('');if(!isAuthenticated||!client||administratorOnly&&ownerAllowed!==true)return;let active=true;let disconnect:(()=>void)|undefined;void register({}).then(async()=>{if(!active||!client)return;disconnect=connectPublishingCloud(client,()=>sessionClaims?.aud==='convex'?getToken():getToken({template:'convex'}));if(active)setReadyUser(userId??null);try{const headers=await publishingHeaders();const response=await fetch(storageApi('/api/bunny-media'),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error('Storage unavailable');}catch{if(active)setStorageError('تعذر الاتصال بخدمة التخزين. إدارة الحسابات متاحة؛ رفع الملفات ومعاينتها يحتاج اتصال التخزين.');}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;disconnect?.();};},[isAuthenticated,register,getToken,userId,sessionClaims?.aud,administratorOnly,ownerAllowed]);
 if(!isLoaded||isLoading)return <main className="auth-screen" role="status">جارٍ التحقق من حسابك…</main>;
 if(!isSignedIn)return <main className="reels-login" dir="rtl"><h1>{administratorOnly?'مشهد · دخول الإدارة':'مشهد · حسابات النشر'}</h1><p>{import.meta.env.DEV?'معاينة محلية معزولة.':'الدخول للحسابات المصرح بها. الاشتراكات العامة غير مفعلة.'}</p>{!administratorOnly&&new URLSearchParams(location.search).has('sign-up')?<SignUp routing="hash" signInUrl="/"/>:<SignIn routing="hash" signUpUrl={administratorOnly?undefined:"/?sign-up=1"} forceRedirectUrl={administratorOnly?location.origin+location.pathname:undefined}/>}</main>;
 if(administratorOnly&&ownerAllowed===undefined)return <main className="auth-screen" role="status">جارٍ التحقق من صلاحية الإدارة…</main>;
 if(administratorOnly&&ownerAllowed!==true)return <main className="auth-screen" dir="rtl"><h1>غير مصرح بالدخول إلى لوحة الإدارة</h1><p role="alert">هذا الحساب لا يملك صلاحية الإدارة. بيانات الزبائن غير متاحة.</p><a href="https://iraqaistudio.com/">العودة إلى موقع الزبائن</a><UserButton/></main>;
 if(error)return <main className="auth-screen" dir="rtl"><p role="alert">{error}</p><UserButton/></main>;
 if(readyUser!==userId)return <main className="auth-screen" role="status">جارٍ فتح حافظات حسابك…</main>;
 return <div key={userId}>{administratorOnly&&<div className="reels-account" dir="rtl"><span>{user?.fullName??'حساب النشر'}</span><UserButton/></div>}{storageError&&<p className="series-error" role="status" dir="rtl">{storageError}</p>}{children}</div>;
}
export function PublishingRoot({children,administratorOnly=false}:{children:ReactNode;administratorOnly?:boolean}){
 if(!client||!key)return <main className="auth-screen" dir="rtl" role="alert">إعداد حسابات النشر غير مكتمل. الدخول مغلق.</main>;
 return <ClerkProvider publishableKey={key} localization={arSA}><ConvexProviderWithClerk client={client} useAuth={useAuth}>{!administratorOnly&&<SiteBanner/>}<TenantSession administratorOnly={administratorOnly}>{children}</TenantSession></ConvexProviderWithClerk></ClerkProvider>;
}
