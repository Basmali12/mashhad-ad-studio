import {useAuth} from '@clerk/react';
import FilmWorkspace from './FilmWorkspace';
import {useFilmRequest} from './useFilmRequest';
export default function FilmEntry({onClose}:{onClose:()=>void}){
 const request=useFilmRequest(),{userId}=useAuth();
 return <FilmWorkspace key={userId} request={request} onClose={onClose}/>;
}
