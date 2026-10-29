import {useEffect,useState} from 'react';
import {useAuth} from '@clerk/react';
import {publishingHeaders} from '../../shared/api/publishing-session';
import {useFilmRequest} from './useFilmRequest';
import {filmEndpoint} from './filmEndpoint';
import FilmAdmin from './FilmAdmin';
import './film.css';
export default function FilmAdminEntry(){
 const request=useFilmRequest(),{userId}=useAuth(),[state,setState]=useState<'loading'|'allowed'|'denied'>('loading');
 useEffect(()=>{let alive=true;setState('loading');void(async()=>{try{const headers=await publishingHeaders();const response=await fetch(filmEndpoint('/api/mashhad-film/access'),{method:'POST',credentials:'omit',redirect:'error',headers:{...headers,'Content-Type':'application/json'},body:'{}'});const value=await response.json();if(alive)setState(response.ok&&value.isAdmin===true?'allowed':'denied');}catch{if(alive)setState('denied');}})();return()=>{alive=false;};},[userId]);
 return <section className="film-workspace" dir="rtl" aria-label="إدارة محركات الأفلام">{state==='allowed'?<FilmAdmin key={userId} request={request}/>:<p role={state==='denied'?'alert':'status'}>{state==='loading'?'جارٍ التحقق من صلاحية إدارة المحركات…':'تعذر التحقق من الإدارة أو اتصال خدمة الأفلام. لم يبدأ تشغيل جديد.'}</p>}</section>;
}
