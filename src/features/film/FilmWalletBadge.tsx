import {useEffect,useState} from 'react';
import {useAuth} from '@clerk/react';
import {useFilmRequest} from './useFilmRequest';
import {compactWalletUSD} from './walletDisplay';
/** Read-only balance. Never requests a session, starts a rental, or changes accounting. */
export default function FilmWalletBadge(){
 const {userId}=useAuth(),request=useFilmRequest();
 const [balance,setBalance]=useState<{owner:string;micros:number|null}|null>(null);
 useEffect(()=>{
  if(!userId)return;
  let disposed=false,pending=false;
  const refresh=async()=>{if(pending||document.visibilityState==='hidden')return;pending=true;try{const wallet=await request('wallet');if(!disposed)setBalance({owner:userId,micros:Number.isSafeInteger(wallet?.balanceMicroUSD)&&wallet.balanceMicroUSD>=0?wallet.balanceMicroUSD:null});}catch{if(!disposed)setBalance({owner:userId,micros:null});}finally{pending=false;}};
  void refresh();const timer=window.setInterval(()=>void refresh(),10000);document.addEventListener('visibilitychange',refresh);
  return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[userId,request]);
 const value=compactWalletUSD(balance&&balance.owner===userId?balance.micros:null);
 return <span className="customer-wallet-badge" dir="ltr" aria-label={'رصيد المحفظة '+value} title="رصيد استئجار المحركات — عرض مختصر بثلاث خانات عشرية">{value}</span>;
}
