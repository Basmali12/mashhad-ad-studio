import {useAuth} from '@clerk/react';
import {useCallback,useEffect,useRef,useState} from 'react';
import {FileVideo,Download,Trash2,X} from 'lucide-react';
import type {FilmFile} from '../../../shared/film-contracts';
import type {FilmRequest} from './filmClient';
import {dateBaghdad,isFailure} from './filmClient';
import {useFilmRequest} from './useFilmRequest';
import {FilmMedia} from './FilmMedia';
import FilmDialog from './FilmDialog';
import FilmThumbnail from './FilmThumbnail';
import {finalFilmFiles} from './finalFilmFiles';
import './film.css';
export function FilmFiles({request,highlightProject=null}:{request:FilmRequest;highlightProject?:string|null}){
 const [files,setFiles]=useState<FilmFile[]>([]),[loading,setLoading]=useState(true),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState<FilmFile|null>(null),[watching,setWatching]=useState<FilmFile|null>(null),[busy,setBusy]=useState(false),guard=useRef(false),mounted=useRef(true);
 const highlighted=useRef<HTMLElement|null>(null),scrolledProject=useRef<string|null>(null);
 useEffect(()=>{if(!loading&&highlightProject&&scrolledProject.current!==highlightProject&&highlighted.current){highlighted.current.scrollIntoView({block:'center',behavior:'smooth'});scrolledProject.current=highlightProject;}},[loading,highlightProject,files]);
 const refresh=useCallback(async()=>{try{const result=await request('files.list');if(isFailure(result)||!Array.isArray(result))throw Error();if(!mounted.current)return;setFiles(finalFilmFiles(result));setNotice('');}catch{if(mounted.current)setNotice('تعذر جلب ملفاتك. أعد تحديث القائمة؛ لا يعاد توليد أي فيديو.');}finally{if(mounted.current)setLoading(false);}},[request]);
 useEffect(()=>{mounted.current=true;void refresh();const t=window.setInterval(()=>{if(document.visibilityState!=='hidden'&&!guard.current)void refresh();},30000);return()=>{mounted.current=false;clearInterval(t);};},[refresh]);
 async function download(file:FilmFile){if(guard.current)return;guard.current=true;setBusy(true);try{const ticket=await request('files.ticket',{id:file.id,download:true});if(isFailure(ticket))throw Error(ticket.message);if(!mounted.current)return;const link=document.createElement('a');link.href=ticket.url;link.download='mashhad-video.mp4';link.referrerPolicy='no-referrer';link.click();}catch{setNotice('تعذر تنزيل الفيديو؛ قد تكون مدة حفظه انتهت. حدّث القائمة.');}finally{guard.current=false;setBusy(false);}}
 async function remove(){if(!deleting||guard.current)return;guard.current=true;setBusy(true);try{const result=await request('files.delete',{id:deleting.id,approved:true});if(isFailure(result))throw Error(result.message);setDeleting(null);await refresh();}catch(error){setNotice(error instanceof Error?error.message:'تعذر حذف الملف. حدّث حالته قبل المحاولة.');}finally{guard.current=false;setBusy(false);}}
 return <section className="film-workspace film-files" dir="rtl">
  <header className="film-files-heading"><h1><FileVideo size={24}/> ملفات الفيديو</h1><button disabled={busy||loading} onClick={()=>void refresh()}>تحديث</button></header>
  <p className="film-retention-note" role="note"><strong>تنبيه:</strong> الفيديوهات محفوظة داخل منصتنا لمدة <b>7 أيام فقط</b>. احتفظ بنسخة في هاتفك قبل حذفها نهائياً.</p>
  {notice&&<p className="film-notice" role="alert">{notice}</p>}
  {loading?<p role="status">جارٍ جلب الفيديوهات المحفوظة…</p>:!files.length?<div className="film-empty"><FileVideo size={38}/><p>لا توجد فيديوهات مولّدة محفوظة حالياً.</p></div>:<div className="film-file-grid">
   {files.map(file=><article ref={file.projectId===highlightProject?highlighted:undefined} className={'film-card film-file'+(file.projectId===highlightProject?' is-new-video':'')} key={file.id}>
    {file.projectId===highlightProject&&<small className="film-new-video-label">فيديوك الجديد</small>}
    <FilmThumbnail request={request} id={file.id} title={file.name} onOpen={()=>setWatching(file)}/>
    <div className="film-file-caption"><h2 title={file.name}>{file.name}</h2><div className="film-file-actions">
     <button disabled={busy} className="film-file-download" aria-label={'تنزيل '+file.name} title="تنزيل" onClick={()=>void download(file)}><Download size={18}/></button>
     <button disabled={busy} className="film-file-delete" aria-label={'حذف '+file.name} title="حذف" onClick={()=>setDeleting(file)}><Trash2 size={18}/></button>
    </div></div>
   </article>)}
  </div>}
  {watching&&<FilmDialog label={'مشاهدة '+watching.name} onCancel={()=>setWatching(null)}>
   <header className="film-file-viewer-header"><h2>{watching.name}</h2><button aria-label="إغلاق الفيديو" title="إغلاق" onClick={()=>setWatching(null)}><X size={20}/></button></header>
   <FilmMedia key={watching.id} request={request} fileId={watching.id} projectId={watching.projectId} index={watching.index} auto playOnLoad/>
   <small>الحذف التلقائي: {dateBaghdad(watching.expiresAt)}</small>
  </FilmDialog>}
  {deleting&&<FilmDialog label="حذف الفيديو نهائياً" onCancel={()=>{if(!busy)setDeleting(null);}}><h2>حذف «{deleting.name}»؟</h2><p>سيُحذف الفيديو من تخزين المنصة ومكتبتك نهائياً. نزّل نسختك أولاً؛ لا يمكن استعادته أو إعادة توليده تلقائياً.</p><button disabled={busy} className="film-danger" onClick={()=>void remove()}>حذف نهائي</button><button disabled={busy} onClick={()=>setDeleting(null)}>إلغاء</button></FilmDialog>}
 </section>;

}
export default function FilmFilesEntry({highlightProject=null}:{highlightProject?:string|null}){const request=useFilmRequest(),{userId}=useAuth();return <FilmFiles key={userId} request={request} highlightProject={highlightProject}/>;}
