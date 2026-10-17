import {Component,Suspense,type ReactNode} from 'react';

// A failed lazy chunk must leave navigation available and allow a safe reload.
export class PageBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(this.state.failed)return <section role="alert"><p>تعذّر فتح الصفحة. حدّثها وحاول مرة ثانية.</p><button className="series-secondary" onClick={()=>window.location.reload()}>إعادة تحميل الصفحة</button></section>;
  return <Suspense fallback={<p role="status">جارٍ فتح الصفحة…</p>}>{this.props.children}</Suspense>;
 }
}
