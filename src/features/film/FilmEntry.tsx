import {useAuth} from '@clerk/react';
import FilmWorkspace from './FilmWorkspace';
import {useFilmRequest} from './useFilmRequest';
export default function FilmEntry({onClose,view='chat',onNavigate}:{onClose:()=>void;view?:'chat'|'projects'|'servers';onNavigate?:(view:'chat'|'servers'|'files',projectId?:string)=>void}){
 const request=useFilmRequest(),{userId}=useAuth();
 return <FilmWorkspace key={userId} request={request} onClose={onClose} view={view} onNavigate={onNavigate}/>;
}
