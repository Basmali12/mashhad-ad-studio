import {useEffect,useRef,useState} from 'react';
import type {Id} from '../convex/_generated/dataModel';
import {cloudError,useCloud} from './cloud';
export function useMedia(id:Id<'_storage'>|undefined,enabled=true){
 const cloud=useCloud(),loader=useRef(cloud?.getFile),[state,setState]=useState({id:'',url:'',error:'',loaded:0,total:0}),[attempt,setAttempt]=useState(0);
 useEffect(()=>{loader.current=cloud?.getFile},[cloud?.getFile]);
 useEffect(()=>{if(!id||!enabled||!loader.current)return;const abort=new AbortController();let url='';setState({id,url:'',error:'',loaded:0,total:0});loader.current(id,abort.signal,p=>{if(!abort.signal.aborted)setState({id,url:'',error:'',...p})}).then(blob=>{if(abort.signal.aborted)return;url=URL.createObjectURL(blob);setState({id,url,error:'',loaded:blob.size,total:blob.size});}).catch(e=>{if(!abort.signal.aborted)setState({id,url:'',error:cloudError(e),loaded:0,total:0});});return()=>{abort.abort();if(url)URL.revokeObjectURL(url)}},[id,enabled,attempt]);
 return {...(state.id===id&&enabled?state:{url:'',error:'',loaded:0,total:0}),retry:()=>setAttempt(n=>n+1)};
}
export async function lastFrame(blob:Blob){
 const video=document.createElement('video'),url=URL.createObjectURL(blob);video.muted=true;video.preload='auto';
 try{return await new Promise<string>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('تعذر استخراج لقطة الفيديو. حاول فتحه أولًا.')),20000);
  const fail=()=>{clearTimeout(timer);reject(new Error('الفيديو غير قابل للقراءة.'));};video.onerror=fail;
  video.onloadedmetadata=()=>{if(!Number.isFinite(video.duration)||video.duration<=0){fail();return;}video.currentTime=Math.max(0,video.duration-.04);};
  video.onseeked=()=>{try{const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d')!.drawImage(video,0,0);clearTimeout(timer);resolve(c.toDataURL('image/jpeg',.85));}catch{fail();}};video.src=url;
 });}finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
