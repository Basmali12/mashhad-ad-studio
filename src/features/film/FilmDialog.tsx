import React,{useEffect,useRef} from 'react';
export default function FilmDialog({children,label,onCancel}:{children:React.ReactNode;label:string;onCancel:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current,previous=document.activeElement as HTMLElement|null;el?.showModal();return()=>{el?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="film-card film-dialog film-native-dialog" aria-label={label} onCancel={e=>{e.preventDefault();onCancel();}}>{children}</dialog>;
}
