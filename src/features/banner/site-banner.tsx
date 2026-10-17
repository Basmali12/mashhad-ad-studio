import {Component,useEffect,useRef,useState,type ReactNode} from 'react';
import {useQuery} from 'convex/react';
import {X} from 'lucide-react';
import {api} from '../../../convex/_generated/api';
import {storageApi} from '../../shared/api/storage-api';
import './site-banner.css';
class BannerBoundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?null:this.props.children;}}
export function SiteBanner(){return <BannerBoundary><ConnectedBanner/></BannerBoundary>;}
function ConnectedBanner(){const banner=useQuery(api.reelsBanner.active,{});if(!banner)return null;let url:string;try{url=storageApi('/api/site-banner')+'?revision='+encodeURIComponent(banner.revision);}catch{return null;}return <SiteBannerView revision={banner.revision} imageUrl={url}/>;}
export function SiteBannerView({revision,imageUrl}:{revision:string;imageUrl:string}){
 const [dismissed,setDismissed]=useState(''),[failed,setFailed]=useState(''),[loaded,setLoaded]=useState(''),close=useRef<HTMLButtonElement>(null),visible=dismissed!==revision&&failed!==revision;
 useEffect(()=>{if(!visible||loaded!==revision)return;const previous=document.activeElement as HTMLElement|null;close.current?.focus();return ()=>{if(previous?.isConnected)previous.focus();};},[revision,visible,loaded]);
 if(!visible)return null;
 return <div className="site-banner-overlay" style={{visibility:loaded===revision?'visible':'hidden'}} aria-hidden={loaded!==revision} dir="rtl" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setDismissed(revision);}if(e.key==='Tab'){e.preventDefault();close.current?.focus();}}}><section className="site-banner-dialog" role="dialog" aria-modal="true" aria-label="إعلان مشهد"><button ref={close} type="button" className="site-banner-close" aria-label="إغلاق الإعلان" onClick={()=>setDismissed(revision)}><X size={22}/></button><img src={imageUrl} alt="إعلان مشهد" draggable={false} onLoad={()=>setLoaded(revision)} onError={()=>setFailed(revision)}/></section></div>;
}
