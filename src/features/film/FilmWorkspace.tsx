import type {FilmRequest} from './filmClient';
import DirectorConversation from './DirectorConversation';
import RentalServers from './RentalServers';
import './film.css';
/** Existing customer shell, new production contracts. Rental admission remains independent. */
export default function FilmWorkspace({request,onClose,preview=false,view='chat',onNavigate}:{request:FilmRequest;onClose?:()=>void;preview?:boolean;view?:'chat'|'projects'|'servers';onNavigate?:(view:'chat'|'servers'|'files',id?:string)=>void}){
 return <><div style={{display:view==='servers'?'none':undefined}}><DirectorConversation request={request} onClose={onClose} preview={preview} visible={view!=='servers'} onNavigate={onNavigate}/></div>{view==='servers'&&<RentalServers request={request} onClose={onClose}/>}</>;
}
