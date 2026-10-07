export function newerRelease(candidate: unknown, current: string): candidate is string {
 if(typeof candidate!=='string')return false;
 const parse=(value:string)=>/^\d{4}\.\d{2}\.\d{2}\.\d+(?:-\d+)?$/.test(value)?value.split(/[.-]/).map(Number):null;
 const next=parse(candidate),installed=parse(current);
 if(!next||!installed)return false;
 for(let i=0;i<Math.max(next.length,installed.length);i++){
  const difference=(next[i]??0)-(installed[i]??0);
  if(difference)return difference>0;
 }
 return false;
}
export function releaseUrl(href:string,version:string,now=Date.now()):string{
 const url=new URL(href);
 url.searchParams.set('app-version',version);
 url.searchParams.set('update-check',String(now));
 return url.href;
}
export function watchRelease(current:string,base:URL,onUpdate:(version:string)=>void):()=>void{
 let active=true,request:AbortController|null=null;
 async function check(){
  if(!active||request||document.visibilityState==='hidden')return;
  const controller=new AbortController();request=controller;
  const timeout=window.setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch(new URL(`version.json?t=${Date.now()}`,base),{cache:'no-store',signal:controller.signal});
   if(!response.ok)return;
   const data=await response.json() as {version?:unknown};
   if(active&&newerRelease(data.version,current))onUpdate(data.version);
  }catch{/* An offline or timed-out check retries on the next event or interval. */}
  finally{window.clearTimeout(timeout);if(request===controller)request=null;}
 }
 const resume=()=>{void check()};
 resume();
 const timer=window.setInterval(resume,15000);
 document.addEventListener('visibilitychange',resume);
 for(const event of ['focus','pageshow','online'])window.addEventListener(event,resume);
 return()=>{active=false;request?.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',resume);for(const event of ['focus','pageshow','online'])window.removeEventListener(event,resume);};
}
