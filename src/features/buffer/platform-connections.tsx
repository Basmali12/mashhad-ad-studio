import {Check,Slash} from 'lucide-react';
import {PlatformBadge} from '../subscriptions/plan-cards';
import {connectionPlatforms,platformChannels,type DisplayChannel} from './platform-status';
import './platform-connections.css';
export function PlatformConnections({channels,loading=false}:{channels:DisplayChannel[];loading?:boolean}){
 return <div className="platform-connections" role="group" aria-label="حسابات النشر المرتبطة">{connectionPlatforms.map(platform=>{const rows=platformChannels(channels,platform),connected=rows.length>0;return <div key={platform} className={'platform-connection '+(loading?'is-loading':connected?'is-connected':'is-disconnected')} title={loading?'جارٍ فحص الربط':connected?rows.map(c=>c.name).join('، '):'غير مربوط'}><div className="platform-connection-icon"><PlatformBadge platform={platform}/>{!loading&&(connected?<Check className="platform-status-mark" size={14} aria-label="مربوط"/>:<Slash className="platform-disconnected-slash" size={35} aria-label="غير مربوط"/>)}</div><small>{loading?'جارٍ الفحص…':connected?rows.map(c=>c.name).join('، '):'غير مربوط'}</small></div>;})}</div>;
}
