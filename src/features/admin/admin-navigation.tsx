import {Cpu,CalendarDays,LayoutDashboard,UserRoundCheck,ShieldBan,Image,Users,Activity,Settings,Link} from 'lucide-react';
export type AdminArea='engines'|'schedule';
export type EngineTab='accounts'|'engines'|'customers'|'activity'|'settings';
export type ScheduleTab='overview'|'activation'|'bans'|'banner';
export function AdminAreas({value,onChange}:{value:AdminArea;onChange:(value:AdminArea)=>void}){
 return <nav className="admin-areas" aria-label="اختيار نظام الإدارة"><button type="button" aria-pressed={value==='engines'} onClick={()=>onChange('engines')}><Cpu size={19}/><span>محركات الأفلام</span></button><button type="button" aria-pressed={value==='schedule'} onClick={()=>onChange('schedule')}><CalendarDays size={19}/><span>مشهد — جدول الفيديوهات</span></button></nav>;
}
export function EngineNavigation({value,onChange}:{value:EngineTab;onChange:(value:EngineTab)=>void}){
 return <nav className="admin-bottom-nav engine-bottom-nav" aria-label="أقسام محركات الأفلام">{([{id:'accounts',name:'الحسابات',icon:Link},{id:'engines',name:'المحركات',icon:Cpu},{id:'customers',name:'العملاء',icon:Users},{id:'activity',name:'النشاط',icon:Activity},{id:'settings',name:'الإعدادات',icon:Settings}] as const).map(t=><button type="button" key={t.id} aria-pressed={value===t.id} onClick={()=>onChange(t.id)}><t.icon size={20}/><span>{t.name}</span></button>)}</nav>;
}
export function ScheduleNavigation({value,onChange}:{value:ScheduleTab;onChange:(value:ScheduleTab)=>void}){
 return <nav className="admin-bottom-nav" aria-label="أقسام مشهد وجدولة الفيديوهات">{([{id:'overview',name:'الملخص',icon:LayoutDashboard},{id:'activation',name:'الاشتراكات',icon:UserRoundCheck},{id:'bans',name:'الحظر',icon:ShieldBan},{id:'banner',name:'الإعلان',icon:Image}] as const).map(t=><button type="button" key={t.id} aria-pressed={value===t.id} onClick={()=>onChange(t.id)}><t.icon size={20}/><span>{t.name}</span></button>)}</nav>;
}
