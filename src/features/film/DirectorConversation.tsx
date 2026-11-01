import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {FilmProject,FilmWallet} from '../../../shared/film-contracts';
import {type FilmRequest,usd} from './filmClient';
import {blockerLabel,createDirectorClient,directorError,localId,nextPlanAction,type DirectorState,type ProductionOffer,type ProductionProject,type ProductionSummary,type TextIntent} from './directorClient';
import ChatComposer from './ChatComposer';
import ProjectHistory from './ProjectHistory';
import DirectorSource from './DirectorSource';
import ProductionView,{DirectorPlanCard} from './ProductionView';
import {uploadChatImage,validateChatImage} from './chatImageUpload';

type Conversation=ProductionSummary&{legacy?:boolean};
const historyProject=(p:Conversation)=>({id:p.id,name:p.title,state:p.state,pinned:p.pinned,archived:p.archived,messages:[],scenes:[]} as unknown as FilmProject);
function remember(id:string|null){if(typeof window==='undefined')return;const url=new URL(window.location.href);if(id)url.searchParams.set('filmProject',id);else url.searchParams.delete('filmProject');window.history.replaceState(window.history.state,'',url);}
function selectedURL(){if(typeof window==='undefined')return null;const id=new URL(window.location.href).searchParams.get('filmProject');return id&&/^[A-Za-z0-9_-]{1,100}$/.test(id)?id:null;}
const terminal=new Set(['completed','failed','uncertain','cancelled']);

export default function DirectorConversation({request,onClose,onNavigate,preview=false,visible=true}:{request:FilmRequest;onClose?:()=>void;onNavigate?:(view:'chat'|'servers'|'files',id?:string)=>void;preview?:boolean;visible?:boolean}){
 const client=useMemo(()=>createDirectorClient(request),[request]);
 const [project,setProject]=useState<ProductionProject|null>(null),[director,setDirector]=useState<DirectorState|null>(null),[legacy,setLegacy]=useState<FilmProject|null>(null),[rows,setRows]=useState<Conversation[]>([]),[wallet,setWallet]=useState<FilmWallet|null>(null),[chat,setChat]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[history,setHistory]=useState(false),[canvas,setCanvas]=useState(false),[offer,setOffer]=useState<TextIntent|null>(null),[productionOffer,setProductionOffer]=useState<ProductionOffer|null>(null),[uncertain,setUncertain]=useState(false),[image,setImage]=useState<File|null>(null),[imageURL,setImageURL]=useState(''),[quotedMessage,setQuotedMessage]=useState('');
 const mounted=useRef(true),guard=useRef(false),current=useRef({project,director,legacy}),end=useRef<HTMLDivElement>(null),creation=useRef(localId()),submission=useRef<string|null>(null),productionIntent=useRef(localId());current.current={project,director,legacy};
 const legacyIds=useRef(new Set<string>()),imageContainer=useRef<FilmProject|null>(null);
 useEffect(()=>{if(!image){setImageURL('');return;}const url=URL.createObjectURL(image);setImageURL(url);return()=>URL.revokeObjectURL(url);},[image]);
 const loadRows=useCallback(async(archived=false)=>{
  const [modern,old]=await Promise.all([client.execute<ProductionSummary[]>('production.list',{archived}),client.execute<FilmProject[]>('projects.list',{archived})]);
  const modernIds=new Set(modern.map(p=>p.id));
  for(const p of old)if(!modernIds.has(p.id))legacyIds.current.add(p.id);
  const values=[...modern.map(p=>({...p,legacy:false})),...old.filter(p=>!modernIds.has(p.id)).map(p=>({id:p.id,title:p.name,durationMs:p.seconds*1000,state:p.state,revision:0,pinned:p.pinned,archived:p.archived,legacy:true}))];
  return values.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
 },[client]);
 const refreshWallet=useCallback(async()=>{const value=await client.execute<FilmWallet>('wallet');if(mounted.current){setWallet(value);window.dispatchEvent(new Event('film-wallet-changed'));}},[client]);
 const read=useCallback(async(id:string)=>{const result=await client.read(id);if(!mounted.current||current.current.project&&current.current.project.id!==id)return;setProject(result.project);setDirector(result.director);return result;},[client]);
 async function run(action:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);setNotice('');try{await action();}catch(e){if(mounted.current)setNotice(directorError(e));}finally{guard.current=false;if(mounted.current)setBusy(false);}}
 useEffect(()=>{mounted.current=true;const saved=selectedURL();void(async()=>{try{const values=await loadRows();if(!mounted.current)return;setRows(values);if(saved){const chosen=values.find(v=>v.id===saved);if(chosen?.legacy){setLegacy(await client.execute<FilmProject>('project.get',{id:saved}));}else{const result=await client.read(saved);if(mounted.current){setProject(result.project);setDirector(result.director);setCanvas(['queued','running','needs_review','completed','failed'].includes(result.project.state));}}}await refreshWallet();}catch(e){if(mounted.current)setNotice(directorError(e));}})();return()=>{mounted.current=false;};},[client,loadRows,refreshWallet]);
 useEffect(()=>{const timer=window.setInterval(()=>{if(document.visibilityState==='hidden'||guard.current)return;const {project:p,director:s}=current.current;if(!p||!s?.pendingCall&&!['queued','running'].includes(p.state)&&!uncertain&&!submission.current)return;void(async()=>{try{if(s?.pendingCall){const call=await client.execute<{status:string}>('director.call',{id:p.id,requestId:s.pendingCall.requestId});if(terminal.has(call.status)&&call.status!=='uncertain'){submission.current=null;setUncertain(false);await refreshWallet();}}await read(p.id);}catch(e){if(mounted.current)setNotice(directorError(e));}})();},3000);return()=>clearInterval(timer);},[client,read,refreshWallet,uncertain]);
 useEffect(()=>{if(visible&&!canvas)end.current?.scrollIntoView({block:'nearest'});},[director?.messages.length,canvas,visible]);
 async function select(row:Conversation){await run(async()=>{setOffer(null);setProductionOffer(null);setUncertain(false);submission.current=null;setChat('');setImage(null);imageContainer.current=null;setHistory(false);remember(row.id);if(row.legacy){setProject(null);setDirector(null);setLegacy(await client.execute<FilmProject>('project.get',{id:row.id}));setCanvas(false);}else{setLegacy(null);const result=await client.read(row.id);setProject(result.project);setDirector(result.director);setCanvas(['queued','running','needs_review','completed','failed'].includes(result.project.state));}});}
 function fresh(){setProject(null);setDirector(null);setLegacy(null);setChat('');setImage(null);imageContainer.current=null;setOffer(null);setProductionOffer(null);setHistory(false);setCanvas(false);setNotice('');setUncertain(false);submission.current=null;creation.current=localId();productionIntent.current=localId();remember(null);}
 async function continueLegacy(){if(!legacy)throw Error('NOT_FOUND');const p=await client.execute<ProductionProject>('production.legacy.import',{id:legacy.id,requestId:localId()});setProject(p);setLegacy(null);remember(p.id);const state=await client.execute<DirectorState>('director.get',{id:p.id});setDirector(state);setRows(await loadRows());return p;}
 async function send(){const text=chat.trim()?chat:image?'هذه صورة مرجعية للقصة. ناقشني في وصفها ودورها قبل التخطيط.':'';if(!text)return;await run(async()=>{
  if(director?.pendingCall||uncertain){setNotice('هناك طلب نصي لم تُحسم نتيجته في هذه المحادثة. تابع حالته أو افتح قصة جديدة دون إعادة إرساله.');return;}
  let p=legacy?await continueLegacy():project;if(!p){p=await client.create(text,creation.current);setProject(p);remember(p.id);setRows(await loadRows());}
  if(image){
   // Reuse authenticated image storage only; this container never enters legacy generation.
   const container=imageContainer.current??await client.execute<FilmProject>('project.save',{name:'مرجع صورة للقصة',story:'ملف مرجعي محفوظ للقصة الجديدة',seconds:10,orientation:null});imageContainer.current=container;
   const uploaded=await uploadChatImage(image,container,request);imageContainer.current=uploaded;
   await client.execute('production.reference.attach',{id:p.id,sourceProjectId:uploaded.id});setImage(null);imageContainer.current=null;
   setNotice('الصورة المرجعية مرتبطة بالقصة. الربط لا يثبت تحليلها بصرياً أو ثبات الهوية.');
  }
  // Sending creates only a bounded text offer. A story/production intent never grants resource consent.
  const next=await client.message(p.id,text);setQuotedMessage(text);setOffer(next);setProductionOffer(null);
 });}
 async function submitText(){if(!offer)return;await run(async()=>{if(wallet&&offer.offer.estimatedMicroUSD!==null&&wallet.balanceMicroUSD<offer.offer.estimatedMicroUSD)throw Error('AI_INSUFFICIENT_CREDIT');submission.current=offer.requestId;try{await client.submit(offer);setOffer(null);if(offer.operation==='director.message')setChat(value=>value===quotedMessage?'':value);await read(offer.offer.projectId);await refreshWallet();}catch(e){setUncertain(true);throw e;}});}
 async function quotePlan(){if(!project||!director)return;const action=nextPlanAction(director);if(!action)return;await run(async()=>setOffer(await client.plan(project.id,action)));}
 async function adopt(){if(!project||!director?.pendingRevision)return;await run(async()=>{await client.execute('director.approve',{id:project.id,revisionId:director.pendingRevision!.id,approved:true,requestId:localId()});setProductionOffer(null);await read(project.id);});}
 async function quoteProduction(){if(!project||!director?.storyApproved)return;await run(async()=>{const q=await client.execute<ProductionOffer>('production.quote',{id:project.id});setProductionOffer(q);productionIntent.current=localId();await refreshWallet();await read(project.id);});}
 async function approveProduction(){if(!productionOffer||!wallet)return;await run(async()=>{try{const p=await client.approve(productionOffer,wallet.balanceMicroUSD,productionIntent.current);setProject(p);setCanvas(true);setProductionOffer(null);}catch(e){setUncertain(true);throw e;}});}
 async function adoptSource(){if(!project||!chat.trim())return;await run(async()=>{const sourceId=await client.storeText(chat);await client.execute('director.source.set',{id:project.id,sourceId,requestId:localId(),approved:true});setOffer(null);setProductionOffer(null);await read(project.id);setNotice('حُفظ النص الأصلي كقصة جاهزة دون إعادة كتابته. موافقة السيناريو السابقة أُلغيت.');});}
 async function cancel(){if(!project)return;await run(async()=>{await client.execute('director.cancel',{id:project.id,approved:true,requestId:localId()});await read(project.id);setProductionOffer(null);});}
 async function follow(){await run(async()=>{if(project){const value=await read(project.id);if(submission.current){const call=await client.execute<{status:string}>('director.call',{id:project.id,requestId:submission.current});if(terminal.has(call.status)&&call.status!=='uncertain'){setUncertain(false);submission.current=null;setOffer(null);}}else if(value&&['queued','running','completed','needs_review','failed'].includes(value.project.state)){setUncertain(false);setProductionOffer(null);setCanvas(true);}}setRows(await loadRows());await refreshWallet();});}
 const historyRequest:FilmRequest=async(op,input={},requestId)=>{
  if(op==='projects.list')return (await loadRows(input.archived===true)).map(historyProject);
  if(op==='project.organize'){if(legacyIds.current.has(String(input.id)))return client.execute(op,input,requestId);const action=typeof input.name==='string'?'rename':typeof input.pinned==='boolean'?(input.pinned?'pin':'unpin'):(input.archived?'archive':'restore');return historyProject(await client.execute<ProductionSummary>('production.organize',{id:input.id,action,...(typeof input.name==='string'?{name:input.name}:{})}));}
  throw Error('هذه العملية غير متاحة في سجل المحادثات.');
 };
 const executing=!!project&&['queued','running'].includes(project.state);
 return <section className={'film-workspace film-chat-workspace'+(!canvas?' film-chat-docked':'')} dir="rtl" aria-busy={busy} hidden={!visible}>
 {preview&&<div className="film-preview-banner">معاينة محلية — لا اتصال سحابي ولا GPU</div>}
 <header className="film-chat-header"><button aria-label="المحادثات السابقة" onClick={()=>setHistory(!history)}>☰</button><strong>صناعة الأفلام</strong>{onClose&&<button aria-label="العودة إلى مشهد" onClick={onClose}>×</button>}</header>
 {history&&<ProjectHistory request={historyRequest} projects={rows.map(historyProject)} onSelect={p=>{const row=rows.find(r=>r.id===p.id);if(row)void select(row);}} onNew={fresh} onChanged={async p=>{if(project?.id===p.id){if(p.archived)fresh();else setProject({...project,title:p.name,pinned:p.pinned});}setRows(await loadRows());}}/>}
 {notice&&<div className="film-notice" role="alert"><span>{notice}</span><button disabled={busy} onClick={()=>void follow()}>تحديث الحالة</button></div>}
 {canvas&&project?<ProductionView project={project} busy={busy} onBack={()=>setCanvas(false)} onCancel={()=>void cancel()} onWatch={()=>{setCanvas(false);onNavigate?.('files',project.id);}}/>:<>
 <main className={'film-chat-stream'+(!project&&!legacy?' is-empty':'')} aria-label="محادثة الفيلم" aria-live="polite">
 {!project&&!legacy&&<div className="film-chat-empty"><div className="film-chat-logo"><img src="./mashhad-logo-128.webp" width="112" height="112" alt="شعار مشهد" decoding="async"/></div><h1>شنو قصة فيلمك؟</h1><p>احچي ونسولف أو نرتب قصتك. تكلفة النص تظهر قبل إرساله للمخرج؛ الإنتاج له موافقة مستقلة.</p></div>}
 {legacy&&<><p className="film-warning">محادثة محفوظة. إرسال رسالة يتابعها بالمخرج الجديد دون استرجاع المحرك الملغى أو موافقات الإنتاج السابقة. <button disabled={busy} onClick={()=>void run(async()=>{await continueLegacy();})}>متابعة بالمخرج الجديد</button></p>{legacy.messages.map((m,i)=><article key={i} className={'film-chat-bubble '+m.role}><small>{m.role==='user'?'أنت':'مخرجك'}</small><p>{m.content}</p></article>)}{legacy.merge?.status==='completed'&&<button onClick={()=>onNavigate?.('files',legacy.id)}>مشاهدة الفيلم المحفوظ</button>}</>}
 {director?.messages.map(m=><article className={'film-chat-bubble '+m.role} key={m.id}><small>{m.role==='user'?'أنت':'مخرجك'}</small><p>{m.text}</p></article>)}
 {director&&<DirectorSource key={director.source?.id??director.projectId} state={director} request={request}/>}
 {director?.pendingCall&&<p className="film-chat-thinking" role="status">✦ {director.pendingCall.stage==='research'?'جارٍ البحث وتوثيق المصادر…':'المخرج يجهّز ردّه…'}</p>}
 {director?.researchSuggestion?.needed&&!director.pendingCall&&<section className="film-card"><p>{director.researchSuggestion.reason??'المعلومة تحتاج بحثاً موثقاً قبل السيناريو.'}</p><button disabled={busy} onClick={()=>void run(async()=>setOffer(await client.research(project!.id,director.researchSuggestion!.query)))}>عرض تكلفة البحث والمصادر</button></section>}
 {director?.researchResults?.map(r=><section className="film-card" key={r.id}><h3>المصادر المحفوظة</h3><p>{r.summary}</p>{r.sources.map((s,i)=><p key={i}>{/^https?:\/\//.test(s.url)?<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>:s.title}</p>)}</section>)}
 {director&&!director.pendingCall&&nextPlanAction(director)&&<section className="film-card"><p>{director.editSuggestion?'تعديل مقترح: '+director.editSuggestion.instruction:director.planReady?'يمكنك مناقشة تعديل الخطة.':'إعداد السيناريو وفصوله ومشاهده — حتى 60 دقيقة.'}</p><button disabled={busy||uncertain} onClick={()=>void quotePlan()}>{director.editSuggestion?'عرض تكلفة تعديل الجزء المحدد':'عرض تكلفة خطوة التخطيط التالية'}</button></section>}
 {offer&&<section className="film-approval" aria-label="موافقة تكلفة المخرج"><h2>{offer.operation==='director.research'?'البحث الموثق':offer.operation==='director.plan'?'إعداد السيناريو':'رسالتك للمخرج'}</h2>{offer.operation==='director.message'&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{quotedMessage.slice(0,2000)}{quotedMessage.length>2000?'… — النص الكامل محفوظ ('+quotedMessage.length+' حرف)':''}</p>}<p>الحد التقديري للطلب النصي: {usd(offer.offer.estimatedMicroUSD)}</p>{offer.offer.cached&&<p>نتيجة محفوظة؛ لا بحث جديد.</p>}{offer.offer.blockers.map((b,i)=><p key={i} className="film-warning">{blockerLabel(b)}</p>)}<button className="film-primary" disabled={busy||uncertain||!offer.offer.dispatchAvailable||offer.offer.estimatedMicroUSD===null||!!wallet&&wallet.balanceMicroUSD<offer.offer.estimatedMicroUSD} onClick={()=>void submitText()}>أوافق — {offer.operation==='director.message'?'أرسل الرسالة':'نفّذ الطلب النصي'}</button><button disabled={busy} onClick={()=>setOffer(null)}>إلغاء</button></section>}
 {director&&<DirectorPlanCard state={director} quote={productionOffer} balance={wallet?.balanceMicroUSD??0} busy={busy||uncertain||!!director.pendingCall} onAdopt={()=>void adopt()} onQuote={()=>void quoteProduction()} onApprove={()=>void approveProduction()} onCancel={()=>void cancel()}/>}
 {project&&['queued','running','needs_review','failed'].includes(project.state)&&<button onClick={()=>setCanvas(true)}>متابعة واجهة التوليد</button>}
 {project?.state==='completed'&&project.result&&<button className="film-primary" onClick={()=>onNavigate?.('files',project.id)}>تشغيل الفيديو المكتمل</button>}
 {director?.error&&<p role="alert" className="film-notice">{directorError(Error(director.error))}</p>}
 <div ref={end} className="film-chat-end" aria-hidden="true"/>
 </main>
 <ChatComposer value={chat} onChange={setChat} onSend={()=>void send()} onImage={file=>{try{validateChatImage(file);setImage(file);}catch(e){setNotice(directorError(e));}}} disabled={executing} imageDisabled={busy||executing||!!director?.outline} sendDisabled={busy||executing||(!chat.trim()&&!image)}>
 {imageURL&&<div className="film-staged-image"><img src={imageURL} alt="صورة مرجعية جاهزة للإرسال"/><button type="button" aria-label="إزالة الصورة قبل الإرسال" onClick={()=>setImage(null)}>×</button></div>}
 {project&&chat.length>1000&&!executing&&<button type="button" disabled={busy||!!director?.pendingCall} onClick={()=>void adoptSource()}>اعتماد النص المكتوب كقصة جاهزة دون تغيير</button>}
 </ChatComposer>
 </>}
 </section>;
}
