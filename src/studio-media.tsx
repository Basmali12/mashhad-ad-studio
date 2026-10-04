import {useEffect,useRef,useState} from 'react';
import type {Id} from '../convex/_generated/dataModel';
import {cloudError,useCloud} from './cloud';
export function useMedia(id:Id<'_storage'>|undefined,enabled=true){
 const cloud=useCloud(),loader=useRef(cloud?.getFile),[state,setState]=useState({id:'',url:'',error:''});
 useEffect(()=>{loader.current=cloud?.getFile},[cloud?.getFile]);
 useEffect(()=>{if(!id||!enabled||!loader.current)return;const abort=new AbortController();let url='';loader.current(id,abort.signal).then(blob=>{if(abort.signal.aborted)return;url=URL.createObjectURL(blob);setState({id,url,error:''});}).catch(e=>{if(!abort.signal.aborted)setState({id,url:'',error:cloudError(e)});});return()=>{abort.abort();if(url)URL.revokeObjectURL(url)}},[id,enabled]);
 return state.id===id&&enabled?state:{url:'',error:''};
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
