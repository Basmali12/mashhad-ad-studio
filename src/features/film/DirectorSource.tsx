import {useState} from 'react';
import {createDirectorClient,directorError,type DirectorState} from './directorClient';
import type {FilmRequest} from './filmClient';
/** Read-only paged original source; never reconstructs provider input from a display excerpt. */
export default function DirectorSource({state,request}:{state:DirectorState;request:FilmRequest}){
 const [page,setPage]=useState<{text:string;offset:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function read(offset:number){if(!state.source||busy)return;setBusy(true);setError('');try{setPage(await createDirectorClient(request).execute('production.source.get',{id:state.source.id,offset,limit:12000}));}catch(e){setError(directorError(e));}finally{setBusy(false);}}
 return <details><summary>نص القصة الأصلي{state.source?' — '+state.source.characters+' حرف محفوظ':''}</summary>{state.source?<><p>مصدر القصة محفوظ كاملاً بمعرف مستقل. عرض الصفحات لا يعيد الكتابة أو يبدأ طلب ذكاء اصطناعي.</p><button disabled={busy} onClick={()=>void read(0)}>عرض النص الأصلي</button>{page&&<><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{page.text}</p><button disabled={busy||page.offset===0} onClick={()=>void read(Math.max(0,page.offset-12000))}>السابق</button><button disabled={busy||page.offset+page.text.length>=state.source.characters} onClick={()=>void read(page.offset+page.text.length)}>التالي</button></>}</>:<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{state.originalText}</p>}{error&&<p role="alert">{error}</p>}</details>;
}
