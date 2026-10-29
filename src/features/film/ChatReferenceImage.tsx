import {useEffect,useState} from 'react';
import type {FilmRequest} from './filmClient';
import {isFailure} from './filmClient';
export default function ChatReferenceImage({request,projectId,uploadedAt}:{request:FilmRequest;projectId:string;uploadedAt:number}){
 const [url,setUrl]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{let active=true;setUrl('');setError(false);void request('project.reference.view',{projectId}).then(result=>{if(isFailure(result))throw Error();if(active)setUrl(result.url);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[request,projectId,uploadedAt]);
 return error?<span className="film-attachment-note">تعذرت معاينة الصورة المحفوظة؛ حدّث المحادثة دون إعادة رفعها.</span>:url?<img className="film-chat-reference" src={url} alt="الصورة المرجعية المرفقة للمناقشة" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={()=>setError(true)} hidden={error}/>:<span className="film-attachment-note">{error?'تعذرت معاينة الصورة المحفوظة؛ حدّث المحادثة دون إعادة رفعها.':'جارٍ جلب الصورة…'}</span>;
}
