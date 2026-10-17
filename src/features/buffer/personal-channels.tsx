import {Slash} from 'lucide-react';
import {PlatformBadge} from '../subscriptions/plan-cards';
import {connectionPlatforms,platformChannels,channelConnected,type DisplayChannel} from './platform-status';
import './platform-connections.css';
export function PersonalChannels({channels,selected,approved,blocked,busy,onSelect,onDryRun}:{channels:DisplayChannel[];selected:string[];approved:string[];blocked:boolean;busy:boolean;onSelect:(ids:string[])=>void;onDryRun:(id:string)=>void}){
 return <div className="buffer-platforms">{connectionPlatforms.map(platform=>{
  const rows=platformChannels(channels,platform),connected=rows.some(c=>channelConnected(c,blocked));
  return <article className="buffer-platform-card" key={platform}><header className="buffer-platform-heading"><h3>{{facebook:'فيسبوك',instagram:'إنستغرام',tiktok:'تيكتوك',youtube:'يوتيوب'}[platform]}</h3><span className={'buffer-platform-badge'+(!connected?' is-disconnected':'')}><PlatformBadge platform={platform}/>{!connected&&<Slash size={30} aria-label="غير مربوط"/>}</span></header>{!rows.length?<p>غير مربوط · لا يوجد حساب لهذه المنصة.</p>:rows.map(c=><div className="buffer-channel-row" key={c.id}><label>{c.avatar&&<img src={c.avatar} width={40} height={40} alt="" referrerPolicy="no-referrer"/>}<span>{c.name} · {channelConnected(c,blocked)?'مربوط':c.isLocked?'غير متاح':'يحتاج مراجعة الربط'}</span><input type="checkbox" aria-label={'اختيار '+c.name} checked={selected.includes(c.id)} disabled={busy||!channelConnected(c,blocked)||!approved.includes(c.id)} onChange={e=>onSelect(e.target.checked?[...selected,c.id]:selected.filter(id=>id!==c.id))}/></label><details><summary>فحص تجهيز النشر</summary><button disabled={busy||!channelConnected(c,blocked)||!approved.includes(c.id)||!selected.includes(c.id)} onClick={()=>onDryRun(c.id)}>اختبار دون إرسال</button></details></div>)}</article>;
 })}</div>;
}
