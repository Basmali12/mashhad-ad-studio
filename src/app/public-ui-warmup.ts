import {allowPublicWarmup,warmPublicUi,type WarmAsset} from '../../shared/public-ui-warmup';
declare const __APP_VERSION__:string;
let started=false;
/** Public static bytes only. Never import/execute a lazy module or call an authenticated API here. */
export function startPublicUiWarmup(){
 if(started||!['http:','https:'].includes(location.protocol))return;started=true;
 const connection=()=> (navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
 if(!allowPublicWarmup(connection()))return;
 const controller=new AbortController(),signal=controller.signal;
 window.addEventListener('pagehide',()=>controller.abort(),{once:true});
 const stop=()=>signal.aborted||document.hidden||!allowPublicWarmup(connection());
 const idle=()=>new Promise<void>(resolve=>{
  let idleId:number|undefined;
  const done=()=>{clearTimeout(timer);if(idleId!==undefined)window.cancelIdleCallback?.(idleId);signal.removeEventListener('abort',done);resolve();};
  const timer=window.setTimeout(()=>{if(window.requestIdleCallback)idleId=window.requestIdleCallback(done,{timeout:2500});else done();},500);
  signal.addEventListener('abort',done,{once:true});
 });
 const prefetch=(asset:WarmAsset)=>new Promise<void>(resolve=>{
  if(stop()){resolve();return;}
  const link=document.createElement('link');link.rel='prefetch';link.as=asset.kind==='image'?'image':asset.kind==='style'?'style':'script';link.href=new URL(asset.url,location.href).href;link.setAttribute('fetchpriority','low');link.referrerPolicy='no-referrer';
  const done=()=>{clearTimeout(timer);link.onload=null;link.onerror=null;link.remove();signal.removeEventListener('abort',done);resolve();};
  const timer=window.setTimeout(done,6000);link.onload=done;link.onerror=done;signal.addEventListener('abort',done,{once:true});document.head.append(link);
 });
 const start=()=>{if(stop())return;void warmPublicUi({version:__APP_VERSION__,idle,prefetch,stop,manifest:async()=>{
  const response=await fetch(new URL('./ui-warmup.json',location.href),{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
  if(!response.ok||Number(response.headers.get('Content-Length')||0)>8192)throw Error('WARMUP_UNAVAILABLE');const body=await response.text();if(body.length>8192)throw Error('WARMUP_LIMIT');return JSON.parse(body);
 }}).catch(()=>{/* Optional background optimization must never affect login or navigation. */});};
 if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
}
