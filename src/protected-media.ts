export type MediaProgress={loaded:number;total:number};
type Progress=(progress:MediaProgress)=>void;
type Loader=(signal:AbortSignal,progress:Progress)=>Promise<Blob>;
type Entry={promise:Promise<Blob>;controller:AbortController;listeners:Set<Progress>;progress?:MediaProgress;blob?:Blob};
// Session-scoped memory only. Cards and the player share one authenticated download.
export class ProtectedMediaCache{
 private entries=new Map<string,Entry>();
 private bytes=0;
 private active=0;
 private waiters:(()=>void)[]=[];
 private disposed=false;
 async get(id:string,loader:Loader,signal?:AbortSignal,progress?:Progress):Promise<Blob>{
  if(this.disposed||signal?.aborted)throw new DOMException('Cancelled','AbortError');
  let entry=this.entries.get(id);
  if(!entry){
   const controller=new AbortController(),listeners=new Set<Progress>();
   entry={promise:Promise.resolve(new Blob()),controller,listeners};const current=entry;
   current.promise=(async()=>{
    if(this.active>=3)await new Promise<void>(resolve=>this.waiters.push(resolve));
    if(this.disposed)throw new DOMException('Cancelled','AbortError');
    this.active++;
    try{const blob=await loader(controller.signal,p=>{current.progress=p;for(const listener of listeners)listener(p)});current.blob=blob;this.bytes+=blob.size;this.trim();return blob;}
    finally{this.active--;this.waiters.shift()?.();}
   })().catch(error=>{if(this.entries.get(id)===current)this.entries.delete(id);throw error});
   this.entries.set(id,current);
  }else{this.entries.delete(id);this.entries.set(id,entry);}
  const current=entry;if(progress){current.listeners.add(progress);if(current.progress)progress(current.progress);}
  try{return await new Promise<Blob>((resolve,reject)=>{const cancel=()=>reject(new DOMException('Cancelled','AbortError'));signal?.addEventListener('abort',cancel,{once:true});current.promise.then(resolve,reject).finally(()=>signal?.removeEventListener('abort',cancel));});}
  finally{if(progress)current.listeners.delete(progress);}
 }
 private trim(){for(const [id,entry] of this.entries){if(this.bytes<=64*1024*1024)break;if(entry.blob){this.bytes-=entry.blob.size;this.entries.delete(id);}}}
 dispose(){this.disposed=true;for(const entry of this.entries.values())entry.controller.abort();this.entries.clear();this.bytes=0;for(const resolve of this.waiters.splice(0))resolve();}
}
async function bounded<T>(signal:AbortSignal,task:(signal:AbortSignal)=>Promise<T>,timeoutMs:number):Promise<T>{
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(new Error('انتهت مهلة تحميل الفيديو؛ تحقق من الاتصال وأعد المحاولة.')),timeoutMs);
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 try{return await new Promise<T>((resolve,reject)=>{const fail=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',fail,{once:true});if(controller.signal.aborted){fail();return;}task(controller.signal).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',fail));});}
 finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
export async function downloadProtectedMedia(endpoint:string,getToken:()=>Promise<string|null>,signal:AbortSignal,progress:Progress,timeoutMs=45000){
 const token=await bounded(signal,()=>getToken(),timeoutMs);if(!token)throw new Error('يحتاج تسجيل دخول.');
 const metadata=await bounded(signal,async s=>{const response=await fetch(`${endpoint}&metadata=1`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:s});if(!response.ok)throw new Error(response.status===401?'انتهت الجلسة؛ سجّل الدخول مجددًا.':'تعذر تحميل الملف المحمي. أعد المحاولة.');return response.json() as Promise<{size:number;type:string}>;},timeoutMs);
 const {size,type}=metadata;if(!Number.isSafeInteger(size)||size<=0||size>100*1024*1024||!['video/mp4','image/png','image/jpeg','image/webp'].includes(type))throw new Error('بيانات الملف غير صالحة.');
 progress({loaded:0,total:size});const parts:Blob[]=[];
 for(let offset=0;offset<size;offset+=8*1024*1024){const part=await bounded(signal,async s=>{const response=await fetch(`${endpoint}&offset=${offset}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:s});if(!response.ok)throw new Error('انقطع تنزيل الملف المحمي. أعد المحاولة.');return response.blob();},timeoutMs);if(part.size!==Math.min(8*1024*1024,size-offset))throw new Error('التحميل غير مكتمل؛ أعد المحاولة.');parts.push(part);progress({loaded:offset+part.size,total:size});}
 return new Blob(parts,{type});
}
