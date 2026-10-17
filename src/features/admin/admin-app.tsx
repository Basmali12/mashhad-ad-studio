import {AppInstall} from '../../app/app-install';
import './admin.css';
import {PageBoundary} from '../../shared/ui/page-boundary';
import {ReelsAdmin} from './admin-page';

export function AdminApp(){
 return <><AppInstall name="مشهد الإدارة" iconSrc="./mashhad-admin-icon-v1-192.png"/><main className="reels-shell" dir="rtl" aria-label="لوحة إدارة مشهد المستقلة"><header className="reels-header"><strong className="admin-brand"><img src="./mashhad-admin-icon-v1-192.png" alt="" width={36} height={36}/> مشهد · الإدارة</strong><a href="https://iraqaistudio.com/" target="_blank" rel="noopener noreferrer">فتح موقع الزبائن</a></header><PageBoundary><ReelsAdmin/></PageBoundary></main></>;
}
