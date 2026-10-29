import type {ReactNode} from 'react';
import {Settings,Clapperboard,CalendarDays,Server,FileVideo} from 'lucide-react';
import './customer-shell.css';
export type CustomerPage='schedule'|'plans'|'settings'|'generate'|'films'|'servers'|'files';
export function CustomerHeader({page,onPage,preview=false,wallet}:{page:CustomerPage;onPage:(page:CustomerPage)=>void;preview?:boolean;wallet?:ReactNode}){
 return <header className="reels-header customer-header"><strong className="customer-brand"><span className="customer-brand-title"><span className="mashhad-logo-stage" role="img" aria-label="أيقونة مشهد"><span className="mashhad-logo-coin" aria-hidden="true"><span className="mashhad-logo-face"><img src="./mashhad-icon-192.png" alt="" width="44" height="44"/></span><span className="mashhad-logo-face mashhad-logo-back"><img src="./mashhad-icon-192.png" alt="" width="44" height="44"/></span></span></span><span>مشهد</span>{wallet}</span><small>رفع وجدولة الريلز{preview?' · معاينة محلية':''}</small></strong><button data-subscription-exempt className="customer-settings-button" aria-label="الإعدادات" title="الإعدادات" aria-pressed={page==='settings'} onClick={()=>onPage(page==='settings'?'schedule':'settings')}><Settings size={17} aria-hidden="true"/></button></header>;
}

export function CustomerBottomNav({page,onPage}:{page:CustomerPage;onPage:(page:CustomerPage)=>void}){
 const tabs=[{id:'generate' as const,label:'توليد الفيديو',short:'توليد',Icon:Clapperboard},{id:'schedule' as const,label:'الجدول',short:'الجدول',Icon:CalendarDays},{id:'servers' as const,label:'السيرفرات',short:'السيرفرات',Icon:Server},{id:'files' as const,label:'ملفات الفيديو',short:'الملفات',Icon:FileVideo}];
 return <nav className="customer-bottom-nav" aria-label="التنقل الرئيسي">{tabs.map(({id,label,short,Icon})=><button key={id} data-subscription-exempt aria-label={label} aria-current={page===id?'page':undefined} onClick={()=>onPage(id)}><Icon size={21} aria-hidden="true"/><span>{short}</span></button>)}</nav>;
}
