import {useCallback,useMemo,useRef} from 'react';
import {useAuth} from '@clerk/react';
import {publishingHeaders} from '../../shared/api/publishing-session';
import {filmTransport} from './filmTransport';
export function useFilmRequest(){
 const {userId}=useAuth(),current=useRef(userId);current.current=userId;
 const active=useCallback(()=>!!userId&&current.current===userId,[userId]);
 return useMemo(()=>filmTransport(publishingHeaders,active),[active]);
}
