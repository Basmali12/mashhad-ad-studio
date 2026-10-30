import {useEffect,useState} from 'react';
import {useAuth} from '@clerk/react';
import {useFilmRequest} from './useFilmRequest';
import {compactWalletUSD} from './walletDisplay';
/** Read-only balance. Never requests a session, starts a rental, or changes accounting. */
export default function FilmWalletBadge(){
 const {userId}=useAuth(),request=useFilmRequest();
 const [balance,setBalance]=useState<{owner:string;micros:number|null;reserved:number}|null>(null);
 useEffect(()=>{
  if(!userId)return;
  let disposed=false,pending=false;
  const refresh=async()=>{if(pending||document.visibilityState==='hidden')return;pending=true;try{const wallet=await request('wallet');if(!disposed)setBalance({owner:userId,micros:Number.isSafeInteger(wallet?.balanceMicroUSD)&&wallet.balanceMicroUSD>=0?wallet.balanceMicroUSD:null,reserved:Number.isSafeInteger(wallet?.reservedMicroUSD)?wallet.reservedMicroUSD:0});}catch{if(!disposed)setBalance({owner:userId,micros:null,reserved:0});}finally{pending=false;}};
  void refresh();const timer=window.setInterval(()=>void refresh(),10000);document.addEventListener('visibilitychange',refresh);window.addEventListener('film-wallet-changed',refresh);
  return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('film-wallet-changed',refresh);};
 },[userId,request]);
 const value=compactWalletUSD(balance&&balance.owner===userId?balance.micros:null);
 return <span className="customer-wallet-badge" dir="ltr" aria-label={'الرصيد المتاح '+value+(balance?.reserved?'، محجوز مؤقتاً '+compactWalletUSD(balance.reserved):'')} title="الرصيد المتاح للدردشة والصور والتحليل واستئجار المحركات، بعد الحجوزات المؤقتة — ثلاث خانات عشرية">{value}</span>;
}
