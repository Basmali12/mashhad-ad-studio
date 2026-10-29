import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';

export function composerGeometry(layoutHeight:number,visualHeight:number,offsetTop:number,baseline:number,focused:boolean){
 const keyboardOpen=focused&&baseline-visualHeight>100;
 return {keyboardOpen,inset:keyboardOpen?Math.max(0,layoutHeight-visualHeight-offsetTop):0};
}
export default function ChatComposer({value,onChange,onSend,onImage,disabled,sendDisabled,imageDisabled,children}:{value:string;onChange:(v:string)=>void;onSend:()=>void;onImage:(file:File)=>void;disabled:boolean;sendDisabled:boolean;imageDisabled:boolean;children?:ReactNode}){
 const textarea=useRef<HTMLTextAreaElement>(null),picker=useRef<HTMLInputElement>(null),footer=useRef<HTMLElement>(null);
 const [viewport,setViewport]=useState({keyboardOpen:false,inset:0});
 useLayoutEffect(()=>{const el=textarea.current;if(!el)return;el.style.height='auto';const max=Math.min(190,window.innerHeight*.28);el.style.height=Math.max(34,Math.min(el.scrollHeight,max))+'px';el.style.overflowY=el.scrollHeight>max?'auto':'hidden';},[value]);
 useEffect(()=>{
  let baseline=window.visualViewport?.height||innerHeight;
  const update=()=>{const view=window.visualViewport,focused=!!footer.current?.contains(document.activeElement),height=view?.height||innerHeight;if(!focused)baseline=height;const next=composerGeometry(innerHeight,height,view?.offsetTop||0,baseline,focused);setViewport(next);document.documentElement.toggleAttribute('data-film-keyboard',next.keyboardOpen);};
  const view=window.visualViewport;view?.addEventListener('resize',update);view?.addEventListener('scroll',update);window.addEventListener('resize',update);document.addEventListener('focusin',update);document.addEventListener('focusout',update);update();
  return()=>{view?.removeEventListener('resize',update);view?.removeEventListener('scroll',update);window.removeEventListener('resize',update);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);document.documentElement.removeAttribute('data-film-keyboard');};
 },[]);
 useEffect(()=>{const el=footer.current,parent=el?.closest<HTMLElement>('.film-chat-workspace');if(!el||!parent)return;const measure=()=>parent.style.setProperty('--film-composer-height',el.getBoundingClientRect().height+'px');measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>{observer.disconnect();parent.style.removeProperty('--film-composer-height');};},[]);
 return <footer ref={footer} className={'film-composer-wrap film-composer-dock'+(viewport.keyboardOpen?' keyboard-open':'')} style={{bottom:viewport.keyboardOpen?viewport.inset+8:undefined}}>
  <input ref={picker} type="file" accept="image/png,image/jpeg" className="film-sr-only" tabIndex={-1} aria-label="رفع صورة للمحادثة" disabled={imageDisabled} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onImage(file);}}/>
  <form className="film-composer" onSubmit={e=>{e.preventDefault();onSend();}}>
   <button type="button" aria-label="إرفاق صورة" disabled={imageDisabled} onClick={()=>picker.current?.click()}>+</button>
   <div className="film-composer-content">{children}<label className="film-sr-only" htmlFor="film-chat-message">رسالتك للمخرج</label><textarea ref={textarea} id="film-chat-message" rows={1} maxLength={10000} value={value} onChange={e=>onChange(e.target.value)} placeholder="اكتب فكرتك…" disabled={disabled}/></div>
   <button className="film-primary" aria-label="إرسال الرسالة" disabled={sendDisabled}>↑</button>
  </form>
 </footer>;
}
