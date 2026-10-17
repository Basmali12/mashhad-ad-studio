import {useEffect,useRef,useState} from 'react';
import {Play} from 'lucide-react';
import {Player} from '../media/video-player';
import type {LibraryVideo} from './schedule-model';
export function MonthVideo({video,published,status}:{video:LibraryVideo;published:boolean;status?:string}){
 const element=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(!!video.file||!!video.url);
 useEffect(()=>{if(visible||!element.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});observer.observe(element.current);return()=>observer.disconnect();},[visible]);
 return <span ref={element} className="month-saved-video" title={video.title}><span className="month-video-thumb">{visible?<Player video={video} thumbnail/>:<Play size={15}/>}</span><span className="month-video-label"><strong>{video.title}</strong><small>{new Date(video.publishAt).toLocaleTimeString('ar-IQ',{timeZone:'Asia/Baghdad',hour:'numeric',minute:'2-digit'})}</small>{!published&&status&&<small>{status}</small>}</span><span className={'month-video-dot'+(published?' is-published':'')} aria-label={published?'منشور':status??'محفوظ فقط'}/></span>;
}
