import fs from 'node:fs';
import {createFilmImagePreview} from './film-image-preview.mjs';
import {observedProgress,verifiedVideoSeconds} from './film-progress.mjs';
import {createFilmMediaLibrary} from './film-media-library.mjs';
import {touchesAccount} from './account-routing.mjs';
import path from 'node:path';
import {id,hash} from './store.mjs';
import {settings} from './config.mjs';
import Arabic from './arabic-dialogue.cjs';
import {createFilmMerger} from './film-merge.mjs';
import {createFilmReferences,REFERENCE_CUSTOMER_LIMIT} from './film-reference.mjs';
import {money,cost,minimumCredit,available,debit,CREDIT_LIFETIME,STOP_GUARD_SECONDS} from './film-money.mjs';
import {verifyBridge,mediaSignature,validMediaSignature} from './film-bridge-security.mjs';
import {reviewBlocksContinuation} from './film-review.mjs';

const dateOrNull=v=>{if(v==null)return null;if(!Number.isSafeInteger(v)||v<=0)throw Error('INVALID_INPUT');return v;};
const prose=(v,max=20000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw Error('INVALID_INPUT');return v.trim();};
const SAFE=/^[a-zA-Z0-9_-]{1,100}$/;
const accountReady=a=>a&&a.activated!==false&&a.discovery?.ready===true;
const clean=text=>String(text??'').replace(/modal|مودال/gi,'مزود الحوسبة');
const label=(v,max=120)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f<>]/.test(v))throw Error('INVALID_INPUT');return v.trim();};
const secureRequest=req=>!!req.socket.encrypted||(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&req.headers['x-forwarded-proto']==='https');
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const unconfirmed=j=>j&&j.cloudStopped!==true&&['start','generate','prepare'].includes(j.action);
const blocksRental=j=>unconfirmed(j)&&!(j.status==='completed'&&j.attachedEngineId&&j.result?.videoVerified);
function mediaRange(value,size){
 if(value===undefined)return null;
 const match=typeof value==='string'&&/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||!size||!match[1]&&!match[2])throw Error('RANGE_NOT_SATISFIABLE');
 const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
 if(first!==null&&(!Number.isSafeInteger(first)||first<0||first>=size)||last!==null&&(!Number.isSafeInteger(last)||last<0))throw Error('RANGE_NOT_SATISFIABLE');
 if(first===null){if(last===0)throw Error('RANGE_NOT_SATISFIABLE');return {start:Math.max(0,size-last),end:size-1};}
 if(last!==null&&last<first)throw Error('RANGE_NOT_SATISFIABLE');return {start:first,end:last===null?size-1:Math.min(size-1,last)};
}
const messages={INSUFFICIENT_CREDIT:'رصيدك لا يغطي التجهيز وهامش الإيقاف. اشحن المحفظة أولاً.',SERVER_LOCKED:'المحرك مقفول من الإدارة.',SERVER_BUSY:'المحرك مشغول حالياً.',USER_HAS_RENTAL:'عندك جلسة قائمة؛ تابعها أو أوقفها أولاً.',NOT_FOUND:'العنصر غير موجود أو غير مسموح لك بالوصول إليه.',FORBIDDEN:'هذه العملية للمسؤول فقط.',APPROVAL_REQUIRED:'راجع السعر ووافق على التكلفة أولاً.',PAID_DISABLED:'التشغيل المدفوع مقفل؛ لم يبدأ أي تشغيل.',SCENE_ALREADY_ATTEMPTED:'لهذا المشهد محاولة محفوظة. لن نعيد توليده تلقائياً.',RENTAL_NOT_READY:'المحرك غير جاهز للتوليد بعد.',INVALID_INPUT:'راجع الحقول المطلوبة.',INVALID_MONEY:'اكتب مبلغاً صحيحاً بالدولار.',TEXT_DISABLED:'كتابة القصة غير مفعلة من الإدارة.',RENTAL_SCHEMA_REQUIRED:'خدمة الاستئجار تحتاج إكمال تهيئة قاعدة البيانات.',PLAN_REQUIRED:'جهّز واعتمد تقرير الفيلم قبل التوليد.',COST_CHANGED:'تغير السعر أو إعداد المحرك؛ راجع عرضاً جديداً.',NO_CAPACITY:'بلغ الحساب حد الجلسات المحدد؛ جرب لاحقاً.'};

/** Authenticated server-to-server gateway. Customer DTOs never include credentials, workspaces or provider jobs. */
messages.MEDIA_EXPIRED='انتهت مدة حفظ هذا الفيديو أو حُذف؛ لا يعاد توليده تلقائياً.';
messages.MEDIA_IN_USE='الفيديو مستخدم في إنتاج أو دمج جارٍ؛ أكمل العملية أو أوقفها قبل الحذف.';
messages.ACCOUNT_IN_USE='أوقف جلسات الحسابين وتأكد من توقفها قبل تغيير الربط.';
messages.WEIGHTS_NOT_READY='ملفات نسخة النموذج الحالية غير مكتملة؛ يلزم تجهيز الحساب من الإدارة أولاً، بدون بدء GPU.';
messages.REFERENCE_QUOTA='بلغت مساحة الصور المرجعية المتاحة لحسابك. راجع الإدارة؛ لم تُحذف صورك.';
export function createFilmPlatform({engine,origin,secret,enabled=false,now=Date.now,mediaOrigins=[],startWorker=true,textEnabled=false,textBudgetMicroUSD=0,closeTimeoutMs=2000,merger=createFilmMerger(),referenceCustomerByteLimit=REFERENCE_CUSTOMER_LIMIT,imageFetcher=fetch}){
 const store=engine.store,pending=new Set(),working=new Set();let closed=false,lastMediaSweep=0;
 const media=createFilmMediaLibrary({store,now});
 const imagePreview=createFilmImagePreview({store,secret,origin,origins:mediaOrigins,now,budgetMicroUSD:textBudgetMicroUSD,fetcher:imageFetcher});
 const references=createFilmReferences({store,secret,origin,origins:mediaOrigins,now,customerByteLimit:referenceCustomerByteLimit});
 if(!secret||secret.length<32)throw Error('BRIDGE_SECRET_REQUIRED');
 if(!origin||new URL(origin).protocol!=='https:')throw Error('HTTPS_ORIGIN_REQUIRED');
 const pause=()=>new Promise(resolve=>{const timer=setTimeout(resolve,1000);timer.unref?.();});
 const requireStore=()=>{if(!store)throw Error('RENTAL_SCHEMA_REQUIRED');};
 const requireRentals=async()=>{requireStore();if(!enabled||!engine.allowPaid)throw Error('PAID_DISABLED');if(!await store.rentalsReady())throw Error('RENTAL_SCHEMA_REQUIRED');};
 const scope=r=>({tenantId:r.customerId,rentalId:r.id,engineSlotId:r.engineSlotId,accountId:r.accountId});
 const owned=async(kind,key,customerId)=>{if(!SAFE.test(key||''))throw Error('NOT_FOUND');const r=await store.get(kind,key);if(!r||r.customerId!==customerId)throw Error('NOT_FOUND');return r;};
 const alert=async(reason,subject,details={})=>{const key=hash(reason+':'+subject);if(!await store.get('film-alert',key))await store.put('film-alert',{id:key,reason,subject,details,createdAt:now(),acknowledged:false});};
 const recovery=(async()=>{if(!store)return;await media.initialize();await imagePreview.initialize();for(const p of await store.all('film-project')){if(p.launch?.state==='starting'){p.launch.state='uncertain';p.error='LAUNCH_INTERRUPTED_FOLLOW_ONLY';await store.put('film-project',p);}if(p.reviewPending){if(p.directorFollow)p.directorFollow.failed=true;p.reviewPending=null;p.reviewState='needs_review';await store.put('film-project',p);}if(p.referenceUploading){delete p.referenceUploading;await store.put('film-project',p);}if(p.merge?.status==='running'){p.merge={status:'failed',error:'MERGE_INTERRUPTED_NO_AUTOMATIC_RETRY'};await store.put('film-project',p);}if(p.textPending){p.textPending=null;p.textUncertain=true;p.error='TEXT_INTERRUPTED_NO_AUTOMATIC_RETRY';await store.put('film-project',p);}}for(const r of await store.all('rental'))if(r.state==='reserved'&&!r.dispatchStarted){r.state='closed';r.stopReason='SERVER_RESTART_BEFORE_DISPATCH';r.closedAt=now();await store.put('rental',r);}})();
 const tasks=task=>{pending.add(task);void task.finally(()=>pending.delete(task));};
 const runTask=callback=>tasks(Promise.resolve().then(callback).catch(()=>{}));
 async function customer(actor){
  if(!actor||!SAFE.test(actor.id||'')||typeof actor.email!=='string'||actor.email.length>254)throw Error('BRIDGE_UNAUTHORIZED');requireStore();
  const key=hash('film-customer:'+actor.id),old=await store.get('film-customer',key);
  const value={...old,id:key,name:String(actor.name||'مستخدم').slice(0,100),email:actor.email,createdAt:old?.createdAt??now(),updatedAt:now()};
  await store.put('film-customer',value);return value;
 }
 async function wallet(customerId){
  const lots=(await store.all('film-credit')).filter(l=>l.customerId===customerId),rental=(await store.all('rental')).find(r=>r.customerId===customerId&&r.state!=='closed');
  return {balanceMicroUSD:available(lots,now()),expiresAt:lots.some(l=>l.expiresAt>now()&&l.remaining>0)?Math.min(...lots.filter(l=>l.expiresAt>now()&&l.remaining>0).map(l=>l.expiresAt)):null,
   reservedMicroUSD:0,activeRentalId:rental?.id??null,lots:lots.map(l=>({amountMicroUSD:l.amount,remainingMicroUSD:l.expiresAt>now()?l.remaining:0,expiresAt:l.expiresAt,expired:l.expiresAt<=now()}))};
 }
 async function listServers(){
  const accounts=new Map((await store.all('account')).map(a=>[a.id,a]));
  const rentals=await store.all('rental'),capacities=new Map((await store.all('film-capacity')).map(v=>[v.id,v.maxConcurrent])),standaloneJobs=(await store.all('job')).filter(j=>!j.tenantId&&blocksRental(j));return (await store.all('film-slot')).filter(s=>s.published&&!s.retired).map(s=>({id:s.id,name:clean(s.name),gpu:s.gpu,ram:s.ram,cpu:s.cpu,pricePerHourUSD:s.hourMicros/1e6,
   state:s.locked||!accountReady(accounts.get(s.accountId))?'locked':standaloneJobs.some(j=>touchesAccount(j,s.accountId))||rentals.some(r=>r.engineSlotId===s.id&&r.state!=='closed')||rentals.filter(r=>r.accountId===s.accountId&&r.state!=='closed').length>=(capacities.get(s.accountId)||1)?'busy':'available',availability:!accountReady(accounts.get(s.accountId))?'المحرك يحتاج إكمال تجهيز ملفات النموذج من الإدارة؛ لم يبدأ أي تشغيل.':s.testingOnly?'متاح للتجربة — لم يُعتمد اختبار الجودة بعد. GPU يبدأ عند تشغيلك فقط؛ التوفر الفوري غير مضمون.':'متاح للحجز لا يعني ضمان تخصيص فوري'}));
 }
 async function stopRental(r,reason='CUSTOMER_STOP'){
  if(r.state==='closed')return;if(r.stopAttemptAt&&now()-r.stopAttemptAt<10000)return;
  await store.transaction(async()=>{const latest=await store.get('rental',r.id);if(latest.state==='closed'){r=latest;return;}r={...latest,state:'stopping',stopReason:latest.stopReason||reason,stopAttemptAt:now()};await store.put('rental',r);});
  if(r.state==='closed')return;
  if(r.engineJobId)try{await engine.invoke('jobs/'+r.engineJobId+'/stop',{confirmCancel:true},scope(r));}catch{await alert('STOP_NOT_CONFIRMED',r.id);}
  else if(!r.dispatchStarted){await store.transaction(async()=>{const latest=await store.get('rental',r.id);if(!latest.dispatchStarted){latest.state='closed';latest.closedAt=now();await store.put('rental',latest);}});}
 }
 async function stopStatus(operation){
  const jobs=[];for(const key of operation.jobIds){let j=await store.get('job',key);if(unconfirmed(j))try{await engine.invoke('jobs/'+key+'/reconcile',{});j=await store.get('job',key);}catch{await alert('STOP_NOT_CONFIRMED',key,{accountId:operation.accountId});}jobs.push({id:key,status:j?.status||'uncertain',cloudStopped:j?.cloudStopped===true});}
  const rentals=[];for(const key of operation.rentalIds){let r=await store.get('rental',key);if(r&&r.state!=='closed'){try{await inspectRental(r);}catch{await alert('STOP_NOT_CONFIRMED',r.id);}r=await store.get('rental',key);}rentals.push({id:key,state:r?.state||'uncertain'});}
  const pending=jobs.filter(j=>!j.cloudStopped).length+rentals.filter(r=>r.state!=='closed').length,confirmed=pending===0;
  if(confirmed&&!operation.finishedAt){operation.finishedAt=now();await store.put('film-admin-stop',operation);}
  return {id:operation.id,requested:true,confirmed,pending,jobs,rentals,createdAt:operation.createdAt,finishedAt:operation.finishedAt??null,message:!jobs.length&&!rentals.length?'لا توجد عمليات مسجلة تحتاج إيقافاً. هذا ليس جرداً لكل موارد حساب المورد.':confirmed?'تأكد إغلاق جميع العمليات المحددة.':'طُلب الإيقاف، لكن بعض الموارد لم يُؤكد توقفها. تابع نفس العملية؛ لا تبدأ بديلاً.'};
 }
 async function emergencyStop({accountId,slotId}){
  const account=await store.get('account',accountId);if(!account)throw Error('NOT_FOUND');
  const rentals=(await store.all('rental')).filter(r=>r.accountId===accountId&&(!slotId||r.engineSlotId===slotId)&&r.state!=='closed'),proofs=new Set((await store.all('film-admin-test')).filter(p=>p.slotId===slotId).map(p=>p.id));
  const jobs=(await store.all('job')).filter(j=>!j.tenantId&&j.accountId===accountId&&unconfirmed(j)&&(!slotId||j.action==='generate'&&proofs.has(j.quoteId)));
  const operation={id:id(),accountId,engineSlotId:slotId??null,jobIds:jobs.map(j=>j.id),rentalIds:rentals.map(r=>r.id),createdAt:now()};await store.put('film-admin-stop',operation);
  for(const r of rentals)await stopRental(r,slotId?'ADMIN_STOP':'ADMIN_ACCOUNT_STOP');
  const roots=new Set(jobs.map(j=>j.id));for(const j of jobs){if(j.attachedEngineId&&roots.has(j.attachedEngineId))continue;try{await engine.invoke('jobs/'+j.id+'/stop',{confirmCancel:true});}catch{await alert('STOP_NOT_CONFIRMED',j.id,{accountId});}}
  await store.audit('film_admin_emergency_stop',operation.id);return stopStatus(operation);
 }
 async function meter(r,job){
  const event=job?.events?.find(e=>['runtime_imports','device_preflight'].includes(e.phase))||job?.events?.find(e=>e.kind==='ready');
  await store.transaction(async()=>{
   r=await store.get('rental',r.id);if(r.state==='closed')return;
   if(!r.meterStartedAt&&event)r.meterStartedAt=event.receivedAt||Math.round(event.time*1000)||now();
   if(r.meterStartedAt){
    const lots=(await store.all('film-credit')).filter(l=>l.customerId===r.customerId);
    const until=Math.max(r.meterStartedAt,job?.cloudStopped?(job.stoppedAt||job.finishedAt||now()):now());
    const total=cost(r.hourMicros,Math.floor(until-r.meterStartedAt));const delta=Math.max(0,total-(r.meteredMicroUSD||0));
    if(delta){const from=r.lastMeterAt||r.meterStartedAt,d={captured:0,uncovered:0,entries:[]};
     // Split delayed watchdog settlements at lot expiries; only time before expiry can consume that lot.
     const boundaries=[...new Set(lots.map(l=>l.expiresAt).filter(t=>t>from&&t<until))].sort((a,b)=>a-b);boundaries.push(until);
     let cursor=from,previous=r.meteredMicroUSD||0;
     for(const end of boundaries){const subtotal=cost(r.hourMicros,Math.floor(end-r.meterStartedAt));const part=debit(lots,Math.max(0,subtotal-previous),cursor);d.captured+=part.captured;d.uncovered+=part.uncovered;d.entries.push(...part.entries);previous=subtotal;cursor=end;}
     for(const lot of lots)await store.put('film-credit',lot);
     await store.put('film-ledger',{id:hash(r.id+':'+total),customerId:r.customerId,rentalId:r.id,type:'usage',microUSD:-d.captured,uncoveredMicroUSD:d.uncovered,entries:d.entries,createdAt:now()});
     r.chargedMicroUSD=(r.chargedMicroUSD||0)+d.captured;r.uncoveredMicroUSD=(r.uncoveredMicroUSD||0)+d.uncovered;r.meteredMicroUSD=total;r.lastMeterAt=until;
    }
    const remaining=available(lots,now()+STOP_GUARD_SECONDS*1000);
    r.lowFunds=remaining<=cost(r.hourMicros,STOP_GUARD_SECONDS*1000);
   }
   if(job?.cloudStopped===true){r.state='closed';r.closedAt=job.stoppedAt||job.finishedAt||now();r.providerRecordedUSD=job.cleanup?.recordedCost?.usd??job.result?.recordedCost?.usd??null;}
   else if(!['stopping','uncertain'].includes(r.state))r.state=job?.status==='ready'?'ready':job?.status==='running'?'preparing':r.state;
   await store.put('rental',r);
  });
  const latest=await store.get('rental',r.id);if(latest.lowFunds&&latest.state!=='closed')await stopRental(latest,'LOW_FUNDS');
 }
 async function inspectRental(r){
  if(!r.engineJobId){const found=(await store.all('job')).find(j=>j.rentalId===r.id&&j.action==='start');if(found){r.engineJobId=found.id;await store.put('rental',r);}else{if(r.dispatchStarted){r.state='uncertain';await store.put('rental',r);await alert('RESOURCE_STATE_UNKNOWN',r.id);}return;}}let job=await store.get('job',r.engineJobId);
  if(r.state==='uncertain'&&job?.status==='ready')await stopRental(r,'AMBIGUOUS_START');
  if(r.creditExpiresAt<=now()+STOP_GUARD_SECONDS*1000)await stopRental(r,'CREDIT_EXPIRING');
  if(['recovery_required','uncertain','failed'].includes(job?.status)&&!job?.cloudStopped){await stopRental(r,'SERVER_RESTART');try{job=await engine.invoke('jobs/'+r.engineJobId+'/reconcile',{},scope(r));}catch{await alert('RESOURCE_STATE_UNKNOWN',r.id);}}
  await meter(r,job);
  const latest=await store.get('rental',r.id),expectedStop=job?.status==='stopped'&&job.cloudStopped===true&&latest?.state==='closed'&&['CUSTOMER_STOP','ADMIN_STOP','ADMIN_ACCOUNT_STOP'].includes(latest.stopReason)&&!job.error;
  if(job&&!expectedStop&&['failed','uncertain','stopped'].includes(job.status))await alert('ENGINE_STOPPED',r.id,{knownReason:/^[A-Z_]{3,80}$/.test(job.error||'')?job.error:'PROVIDER_STOP',accountId:r.accountId});
 }
 async function tick(){
  await recovery;if(closed||!store)return;
  if(now()-lastMediaSweep>=60000){lastMediaSweep=now();try{await media.cleanup();await imagePreview.cleanup();}catch{await alert('MEDIA_CLEANUP_PENDING','media-sweep');}}
  for(const b of await store.all('film-account-billing'))if(b.expiresAt&&b.expiresAt<=now()+86400000)await alert('MANUAL_BILLING_EXPIRY',b.id,{source:'administrator',expiresAt:b.expiresAt});
  await Promise.all((await store.all('rental')).filter(r=>r.state!=='closed').map(async r=>{
   if(working.has(r.id))return;working.add(r.id);try{await inspectRental(r);}catch{await alert('METER_REQUIRES_REVIEW',r.id);}finally{working.delete(r.id);}
  }));
 }
 async function reserveDirectorFollow(latest,c){
  if(latest.directorFollow)return;
     if(!textEnabled||!Number.isSafeInteger(textBudgetMicroUSD)||textBudgetMicroUSD<=0)throw Error('TEXT_DISABLED');
     if(!(await store.get('config','openai-director'))?.credentials)throw Error('OPENAI_KEY_REQUIRED');
     const calls=latest.scenes.filter(s=>!s.attempted).length,reserve=calls*250000;
     const usage=(await store.all('film-text-reservation')).filter(x=>x.createdAt>now()-CREDIT_LIFETIME);
     if(usage.reduce((v,x)=>v+x.reservedMicroUSD,0)+reserve>textBudgetMicroUSD)throw Error('TEXT_BUDGET_LIMIT');
     if(usage.filter(x=>x.customerId===c.id&&x.createdAt>now()-86400000).reduce((v,x)=>v+x.calls,0)+calls>60)throw Error('TEXT_LIMIT');
     const request=id();await store.put('film-text-reservation',{id:request,customerId:c.id,projectId:latest.id,calls,reservedMicroUSD:reserve,createdAt:now(),source:'administrator_director_follow_reservation_not_invoice'});
     latest.directorFollow={id:request,approvedAt:now(),calls:[],failed:false};latest.visualReviews=[];latest.reviewState='awaiting_next_scene';
 }
 async function followProject(p){
  let changed=false;
  for(const scene of p.scenes||[]){
   if(!scene.jobId&&scene.quoteId){const j=(await store.all('job')).find(j=>j.quoteId===scene.quoteId&&j.tenantId===p.customerId&&j.projectId===p.id);if(j){scene.jobId=j.id;changed=true;}}
   if(scene.jobId){const j=await store.get('job',scene.jobId);if(j?.tenantId!==p.customerId||j.projectId!==p.id)continue;
    const status=j.status==='completed'&&j.result?.videoVerified?'done':['failed','uncertain','stopped','needs_review','recovery_required'].includes(j.status)?'needs_review':scene.status;
    if(status!==scene.status){scene.status=status;changed=true;}
   }
  }
  if(p.state==='generating'&&!pending.size){p.state=p.scenes.every(s=>s.status==='done')?'completed':'needs_review';p.error=p.state==='needs_review'?'RECOVERY_FOLLOW_ONLY':null;changed=true;}
  if(changed)await store.put('film-project',p);return p;
 }
 const timer=startWorker?setInterval(()=>{runTask(tick);},1000):null;timer?.unref();
 async function rentalDTO(r){
  const job=r.engineJobId?await store.get('job',r.engineJobId):null,events=job?.events||[];
  const telemetry=observedProgress(events);
  return {id:r.id,serverId:r.engineSlotId,state:r.state,elapsedSeconds:r.meterStartedAt?Math.max(0,Math.floor(((r.closedAt||now())-r.meterStartedAt)/1000)):0,
   billedMicroUSD:r.chargedMicroUSD||0,hourPriceUSD:r.hourMicros/1e6,lowFunds:!!r.lowFunds,
   ...telemetry,stopReason:r.stopReason||null,
   message:r.state==='uncertain'?'حالة الموارد غير محسومة؛ لن نبدأ جلسة بديلة.':null};
 }
 async function startRental(c,input){
  await requireRentals();if(input.approved!==true)throw Error('APPROVAL_REQUIRED');
  let r,created=false;await store.transaction(async()=>{
   const key=hash(c.id+':'+label(input.requestId,100));const old=await store.get('rental',key);if(old){r=old;return;}
   const slot=await store.get('film-slot',input.serverId);if(!slot?.published||slot.locked||slot.retired)throw Error('SERVER_LOCKED');
   if((await store.all('job')).some(j=>!j.tenantId&&blocksRental(j)&&touchesAccount(j,slot.accountId)))throw Error('SERVER_BUSY');
   if(!accountReady(await store.get('account',slot.accountId)))throw Error('WEIGHTS_NOT_READY');
   if(slot.hourMicros!==input.priceMicroUSD||slot.revision!==input.revision)throw Error('COST_CHANGED');
   const all=(await store.all('rental')).filter(x=>x.state!=='closed');if(all.some(x=>x.customerId===c.id))throw Error('USER_HAS_RENTAL');if(all.some(x=>x.engineSlotId===slot.id))throw Error('SERVER_BUSY');
   const capacity=await store.get('film-capacity',slot.accountId);if(all.filter(x=>x.accountId===slot.accountId).length>=(capacity?.maxConcurrent||1))throw Error('NO_CAPACITY');
   const lots=(await store.all('film-credit')).filter(l=>l.customerId===c.id);if(available(lots,now()+240000)<minimumCredit(slot.hourMicros))throw Error('INSUFFICIENT_CREDIT');
   r={id:key,customerId:c.id,engineSlotId:slot.id,accountId:slot.accountId,hourMicros:slot.hourMicros,settings:slot.settings,createdAt:now(),state:'reserved',dispatchStarted:false,
    creditExpiresAt:Math.min(...lots.filter(l=>l.expiresAt>now()+240000&&l.remaining>0).map(l=>l.expiresAt)),chargedMicroUSD:0};
   await store.put('rental',r);await store.audit('film_rental_reserved',r.id);created=true;
  });
  if(created)runTask(async()=>{
   try{
    const q=await engine.invoke('quote',{action:'start',accountId:r.accountId,settings:r.settings},scope(r));
    // Reserving the quote ID before dispatch prevents an ambiguous start from allocating another session.
    await store.transaction(async()=>{const latest=await store.get('rental',r.id);if(latest.state!=='reserved')throw Error('START_CANCELLED');r={...latest,quoteId:q.id,dispatchStarted:true,state:'preparing'};await store.put('rental',r);});
    const result=await engine.invoke('execute',{quoteId:q.id,approvedCost:true},scope(r));
    await store.transaction(async()=>{const latest=await store.get('rental',r.id);latest.engineJobId=result.id;await store.put('rental',latest);});
   }catch{
    const persisted=await store.get('rental',r.id),job=(await store.all('job')).find(j=>j.rentalId===r.id&&j.action==='start');
    if(job)persisted.engineJobId=job.id;
    persisted.state=persisted.dispatchStarted?'uncertain':'closed';if(persisted.state==='closed')persisted.closedAt=now();await store.put('rental',persisted);await alert('START_REQUIRES_REVIEW',r.id);
   }
  });
  return rentalDTO(r);
 }
 async function followDirector(c,projectId,index,jobId){
  let p=await owned('film-project',projectId,c.id);
  if(!p.directorFollow)return;
  const callId=p.directorFollow.id+'-'+index;
  if(p.directorFollow.calls?.some(x=>x.index===index))throw Error('DIRECTOR_REVIEW_REQUIRES_FOLLOW_ONLY');
  p.directorFollow.calls??=[];p.directorFollow.calls.push({index,id:callId,status:'submitted'});
  p.reviewPending=callId;p.reviewState='running';await store.put('film-project',p);
  try{
   const next=p.scenes[index+1];
   await engine.invoke('llm/reviews',{requestId:callId,projectId:p.id,jobId,approvedTextCost:true,...(next?{nextScene:next.prompt}:{})});
   let response;for(let poll=0;poll<130;poll++){if(closed)throw Error('SERVER_SHUTTING_DOWN');response=await engine.invoke('llm/calls/'+callId,undefined,undefined,'GET');if(['completed','failed','uncertain'].includes(response.status))break;await pause();}
   if(response?.status!=='completed'||!response.visualReview)throw Error('DIRECTOR_REVIEW_REQUIRES_FOLLOW_ONLY');
   p=await owned('film-project',p.id,c.id);const v=response.visualReview;
   p.visualReviews??=[];p.visualReviews.push({index,model:response.model,summary:v.summary,visibleText:v.visibleText,continuity:v.continuity,causalOrder:v.causalOrder,audioAssessment:'not_checked',findings:v.findings,suggestedCorrections:v.suggestedCorrections,sampleCount:response.evidence?.timestamps?.length||0,computedUSD:response.usage?.computedUSD??null,invoiceUSD:null});
   p.directorFollow.calls.find(x=>x.index===index).status='completed';
   await store.put('film-project',p); // Keep observations even when the next step is rejected.
   if(reviewBlocksContinuation(v))throw Error('DIRECTOR_VISUAL_CONCERNS');
   if(next){
    const current=p.scenes[index+1];if(current.attempted)throw Error('SCENE_ALREADY_ATTEMPTED');
    const prompt=prose(v.nextVisualPrompt,9000);if(/\p{Script=Arabic}/u.test(prompt))throw Error('DIRECTOR_VISUAL_PROMPT_REQUIRED');Arabic.checkPrompt(prompt,current.audioContract);
    // Keep original plan and locked native dialogue. Only the next unattempted visual prompt can change.
    current.originalPrompt??=current.prompt;current.prompt=prompt;current.directorCallId=callId;
   }
   p.reviewPending=null;p.reviewState=index===p.scenes.length-1?'completed':'awaiting_next_scene';await store.put('film-project',p);
   return {callId};
  }catch(e){p=await owned('film-project',projectId,c.id);p.reviewPending=null;p.reviewState='needs_review';p.directorFollow.failed=true;await store.put('film-project',p);throw e;}
 }
 async function generateProject(c,p,r){
  for(let index=0;index<p.scenes.length;index++){
   let project=await owned('film-project',p.id,c.id),scene=project.scenes[index];if(scene.status==='done')continue;
   if(scene.attempted||scene.jobId)throw Error('SCENE_ALREADY_ATTEMPTED');
   const latestRental=await owned('rental',r.id,c.id),start=await store.get('job',r.engineJobId);if(latestRental.state!=='ready'||!start||start.status!=='ready'||start.cloudStopped)throw Error('RENTAL_NOT_READY');
   let continuity={};
   if(!index&&project.reference)continuity.initialFrame=await references.data(project);
   if(index){const prior=project.scenes[index-1],priorJob=prior.jobId?await store.get('job',prior.jobId):null;
    if(prior.status!=='done'||priorJob?.tenantId!==c.id||priorJob.projectId!==project.id||!priorJob.result?.videoVerified)throw Error('CONTINUITY_REQUIRES_REVIEW');
    if(priorJob.rentalId===r.id)continuity.previousSceneId='scene-'+(index-1);
    else{const file=path.resolve(store.folder,'artifacts',priorJob.id,'last-frame.png'),stat=await fs.promises.stat(file);if(stat.size>4000000||stat.size<8)throw Error('CONTINUITY_REQUIRES_REVIEW');const bytes=await fs.promises.readFile(file);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('CONTINUITY_REQUIRES_REVIEW');continuity.initialFrame='data:image/png;base64,'+bytes.toString('base64');}
   }
   const q=await engine.invoke('quote',{action:'generate',accountId:r.accountId,settings:{...r.settings,orientation:project.orientation},engineJobId:r.engineJobId,prompt:scene.prompt,audioContract:scene.audioContract,projectId:project.id,sceneId:'scene-'+index,...continuity},scope(r));
   await store.transaction(async()=>{project=await owned('film-project',p.id,c.id);if(project.scenes[index].attempted)throw Error('SCENE_ALREADY_ATTEMPTED');project.scenes[index].attempted=true;project.scenes[index].quoteId=q.id;project.scenes[index].status='submitted';await store.put('film-project',project);});
   let result;try{result=await engine.invoke('execute',{quoteId:q.id,approvedCost:true},scope(r));}
   catch{const job=(await store.all('job')).find(j=>j.quoteId===q.id);if(!job)throw Error('SCENE_ACKNOWLEDGEMENT_UNKNOWN');result={id:job.id};}
   project=await owned('film-project',p.id,c.id);project.scenes[index].jobId=result.id;await store.put('film-project',project);
   let done=false,reviewed=false;for(let poll=0;poll<1200;poll++){
    const job=await store.get('job',result.id);
    if(job?.status==='needs_review'&&job.error==='GENERATION_SUCCEEDED_TEXT_REVIEW_REQUIRED'&&job.result?.videoVerified&&project.directorFollow){
     const approval=await followDirector(c,p.id,index,result.id);
     await engine.invoke('jobs/'+result.id+'/accept-review',{reviewCallId:approval.callId,approved:true},scope(r));
     project=await owned('film-project',p.id,c.id);project.scenes[index].status='done';await store.put('film-project',project);done=true;reviewed=true;break;
    }
    if(job?.status==='completed'&&job.result?.videoVerified){project=await owned('film-project',p.id,c.id);project.scenes[index].status='done';await store.put('film-project',project);done=true;break;}
    if(['failed','uncertain','stopped','needs_review','recovery_required'].includes(job?.status))throw Error('GENERATION_REQUIRES_REVIEW');
    if(closed)throw Error('SERVER_SHUTTING_DOWN');await pause();
   }
   if(!done)throw Error('GENERATION_MONITOR_TIMEOUT');
   if(!reviewed)await followDirector(c,p.id,index,result.id);
  }
  const project=await owned('film-project',p.id,c.id);project.state='completed';await store.put('film-project',project);await mergeProject(project);
 }
 async function mergeProject(p){
  await store.transaction(async()=>{const latest=await store.get('film-project',p.id);if(latest.merge?.status==='running')throw Error('MERGE_ALREADY_RUNNING');latest.merge={status:'running',startedAt:now()};await store.put('film-project',latest);});
  try{const result=await merger.merge({store,project:p});const latest=await store.get('film-project',p.id);if(latest.launch){latest.launch.state='completed';latest.launch.finishedAt=now();}latest.merge={status:'completed',completedAt:now(),...result};await store.put('film-project',latest);}
  catch(e){const latest=await store.get('film-project',p.id);if(latest.launch)latest.launch.finishedAt=now();latest.merge={status:e.message==='MERGE_UNAVAILABLE'?'unavailable':'failed',error:/^MERGE_[A-Z_]+$/.test(e.message)?e.message:'MERGE_FAILED',finishedAt:now()};await store.put('film-project',latest);}
 }
 async function projectDTO(p){
  return {preview:imagePreview.publicDTO(p.preview),id:p.id,name:clean(p.name),story:clean(p.story),messages:(p.messages||[]).map(m=>({role:m.role,content:clean(m.content),hasReference:!!(m.referenceId&&m.referenceId===p.reference?.id)})),textPending:!!p.textPending,textUncertain:!!p.textUncertain,planningCompletedScenes:p.planningCompletedScenes||0,textCostPolicy:'administrator_funded_separate_from_gpu_wallet',seconds:p.seconds,orientation:p.orientation,state:p.state,discussion:p.discussion||null,launch:p.launch?{state:p.launch.state,approvedAt:p.launch.approvedAt,finishedAt:p.launch.finishedAt||null}:null,reference:p.reference?{mime:p.reference.mime,size:p.reference.size,width:p.reference.width,height:p.reference.height,uploadedAt:p.reference.uploadedAt}:null,merge:p.merge?{status:p.merge.status,error:p.merge.error||null,duration:p.merge.duration||null,width:p.merge.width||null,height:p.merge.height||null,nativeAudio:p.merge.audio===true}:null,
   directorFollow:!!p.directorFollow,reviewPending:!!p.reviewPending,reviewState:p.reviewState||'not_requested',visualReviews:p.visualReviews||[],
   scenes:await Promise.all((p.scenes||[]).map(async(s,index)=>{const candidate=s.jobId?await store.get('job',s.jobId):null,j=candidate?.tenantId===p.customerId&&candidate?.projectId===p.id?candidate:null;const telemetry=observedProgress(j?.events||[]);
    return {index,title:'المشهد '+(index+1),visualPrompt:clean(s.prompt||''),status:s.status,dialogue:(s.audioContract?.lines||[]).map(l=>({speaker:clean(l.speaker),text:clean(l.text)})),...telemetry,durationSeconds:verifiedVideoSeconds(j),ready:await media.sceneAvailable(p,j),mediaExpired:!!j&&(!!j.mediaRemovedAt||await media.deadline(j)<=now())};})),error:p.error?'توقفت العملية وتحتاج مراجعة؛ لا إعادة تلقائية.':null};
 }
 async function dispatch(actor,operation,input={}){
  await recovery;
  if(typeof operation!=='string'||!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_INPUT');
  const c=await customer(actor);if(operation.startsWith('admin.')&&actor.isAdmin!==true)throw Error('FORBIDDEN');
  if(operation==='session')return {user:{id:c.id,name:c.name},wallet:await wallet(c.id),servers:await listServers(),enabled,planningEnabled:textEnabled&&textBudgetMicroUSD>0,capabilities:{referenceUpload:mediaOrigins.length>0,ingredients:false,voiceCloning:false,lastFrameContinuity:true,nativeAudio:true,wholeFilmMerge:true}};
  if(operation==='wallet')return wallet(c.id);
  if(operation==='files.list')return media.list(c.id,{finalOnly:true});
  if(operation==='files.ticket'){
   const e=await media.get(input.id,c.id),p=await owned('film-project',e.projectId,c.id),j=e.jobId?await store.get('job',e.jobId):null;
   if(!await media.accessible(p,j,e.index))throw Error('MEDIA_EXPIRED');
   const ticket=id(),expires=Math.min(now()+180000,e.expiresAt);
   await store.put('film-media-ticket',{id:ticket,customerId:c.id,projectId:p.id,...(e.kind==='film'?{mergeSHA:p.merge.sha256}:{jobId:e.jobId}),expires,download:input.download===true});
   return {url:origin+'/api/film-media/'+ticket+'?expires='+expires+'&signature='+mediaSignature(secret,ticket,expires),expires};
  }

  if(operation==='files.delete'){if(input.approved!==true)throw Error('APPROVAL_REQUIRED');return media.remove(input.id,c.id);}
  if(operation==='servers.list')return listServers();
  if(operation==='rental.quote'){
   const s=await store.get('film-slot',input.serverId);if(!s?.published||s.locked||s.retired)throw Error('SERVER_LOCKED');
   return {serverId:s.id,revision:s.revision,priceMicroUSD:s.hourMicros,pricePerHourUSD:s.hourMicros/1e6,minimumCreditUSD:minimumCredit(s.hourMicros)/1e6,warning:'التجهيز والاستخدام والخمول محسوبة بالثانية من بدء موارد الجلسة. الإيقاف ليس سقف فاتورة مضموناً.',canStart:enabled&&engine.allowPaid&&available((await store.all('film-credit')).filter(l=>l.customerId===c.id),now()+240000)>=minimumCredit(s.hourMicros)};
  }
  if(operation==='rental.start')return startRental(c,input);
  if(operation==='rental.status'){const r=await owned('rental',input.id,c.id);await inspectRental(r);return rentalDTO(await store.get('rental',r.id));}
  if(operation==='rental.stop'){const r=await owned('rental',input.id,c.id);await stopRental(r);return rentalDTO(await store.get('rental',r.id));}
  if(operation==='projects.list')return Promise.all((await store.all('film-project')).filter(p=>p.customerId===c.id).map(projectDTO));
  if(operation==='project.get'||operation==='project.follow')return projectDTO(await followProject(await owned('film-project',input.id,c.id)));
  if(operation==='project.preview.execute'){if(!textEnabled)throw Error('TEXT_DISABLED');const p=await owned('film-project',input.projectId,c.id);await imagePreview.execute(p,input.quoteId,input.approved,p.reference?await references.data(p):null);return projectDTO(await owned('film-project',p.id,c.id));}
  if(operation==='project.preview.view')return imagePreview.view(await owned('film-project',input.projectId,c.id));
  if(operation==='project.reference.view')return references.view(input.projectId,c.id);
  if(operation==='project.reference.ticket')return references.issue(input.projectId,c.id);
  if(operation==='project.reference.remove')return projectDTO(await references.remove(input.projectId,c.id));
  if(operation==='project.save')return store.transaction(async()=>{
   const old=input.id?await owned('film-project',input.id,c.id):null;
   if(old?.launch?.state==='starting')throw Error('SCENE_ALREADY_ATTEMPTED');if(old?.state==='generating')throw Error('SCENE_ALREADY_ATTEMPTED');if(old?.referenceUploading)throw Error('REFERENCE_LOCKED');if(old?.textPending)throw Error('TEXT_ALREADY_PENDING');if(old?.scenes?.some(s=>s.attempted))throw Error('SCENE_ALREADY_ATTEMPTED');
   const seconds=Number(input.seconds);if(!Number.isInteger(seconds)||seconds<10||seconds>300||seconds%10||!['portrait','landscape'].includes(input.orientation))throw Error('INVALID_INPUT');
   const name=label(input.name),story=prose(input.story,20000),changed=old&&(old.story!==story||old.seconds!==seconds||old.orientation!==input.orientation);
   const p={...old,id:old?.id||id(),customerId:c.id,name,story,seconds,orientation:input.orientation,messages:old?.messages||[],scenes:changed?[]:(old?.scenes||[]),state:changed?'draft':(old?.state||'draft'),createdAt:old?.createdAt??now(),updatedAt:now()};
   if(changed){p.planningCompletedScenes=0;p.error=null;p.textUncertain=false;delete p.merge;}
   await store.put('film-project',p);return projectDTO(p);
  });
  if(operation==='project.launch'){
   await requireRentals();if(input.approved!==true)throw Error('APPROVAL_REQUIRED');
   let p=await owned('film-project',input.projectId,c.id),intent;
   await store.transaction(async()=>{
    p=await owned('film-project',p.id,c.id);if(p.launch){intent=p.launch;return;}
    if(p.state!=='planned'||!p.scenes?.length||p.scenes.some(s=>s.attempted)||p.textPending)throw Error('PLAN_REQUIRED');
    const existing=(await store.all('rental')).find(r=>r.customerId===c.id&&r.state!=='closed');
    const slot=await store.get('film-slot',input.serverId);
    if(!slot||slot.retired||slot.locked||!slot.published)throw Error('SERVER_LOCKED');
    if(slot.revision!==input.revision||slot.hourMicros!==input.priceMicroUSD)throw Error('COST_CHANGED');
    if(existing&&(existing.engineSlotId!==slot.id||!['ready','preparing','reserved'].includes(existing.state)))throw Error('USER_HAS_RENTAL');
    await reserveDirectorFollow(p,c);
    intent={state:'starting',approvedAt:now(),serverId:slot.id,revision:slot.revision,priceMicroUSD:slot.hourMicros,requestId:label(input.requestId,100),rentalId:existing?.id||null};
    p.launch=intent;await store.put('film-project',p);
   });
   if(intent.started)return projectDTO(p);
   // A durable, single owner wins dispatch; polling/reloading never authorizes another allocation.
   let own=false;await store.transaction(async()=>{const latest=await owned('film-project',p.id,c.id);if(!latest.launch.started){latest.launch.started=true;await store.put('film-project',latest);own=true;}});
   if(own)runTask(async()=>{
    try{
     const rentalId=intent.rentalId||(await startRental(c,{serverId:intent.serverId,revision:intent.revision,priceMicroUSD:intent.priceMicroUSD,requestId:'launch-'+p.id,approved:true})).id;
     const latest=await owned('film-project',p.id,c.id);latest.launch.rentalId=rentalId;await store.put('film-project',latest);
     for(let n=0;n<900;n++){
      if(closed)throw Error('SERVER_SHUTTING_DOWN');
      const r=await owned('rental',rentalId,c.id);await inspectRental(r);const currentRental=await owned('rental',rentalId,c.id);
      if(currentRental.state==='ready'){
       await dispatch(actor,'project.generate',{projectId:p.id,rentalId,approved:true,directorFollow:true});
       const updated=await owned('film-project',p.id,c.id);updated.launch.state='generating';await store.put('film-project',updated);return;
      }
      if(['closed','stopping','uncertain'].includes(currentRental.state))throw Error('LAUNCH_REQUIRES_REVIEW');
      await pause();
     }
     throw Error('LAUNCH_WAIT_EXPIRED');
    }catch{
     const latest=await owned('film-project',p.id,c.id);latest.launch.state='needs_review';latest.launch.finishedAt=now();latest.error='LAUNCH_REQUIRES_REVIEW';await store.put('film-project',latest);
     if(latest.launch.rentalId){const r=await owned('rental',latest.launch.rentalId,c.id);if(r.state!=='closed')await stopRental(r,'FILM_FAULT');}
    }
   });return projectDTO(await owned('film-project',p.id,c.id));
  }
  if(operation==='project.generate'||operation==='project.resume'){
   await requireRentals();if(input.approved!==true)throw Error('APPROVAL_REQUIRED');const p=await owned('film-project',input.projectId,c.id),r=await owned('rental',input.rentalId,c.id);
   if(p.referenceUploading)throw Error('REFERENCE_LOCKED');if(!p.scenes?.length)throw Error('PLAN_REQUIRED');if(r.state!=='ready')throw Error('RENTAL_NOT_READY');
   if(operation==='project.resume'){
    const prior=await owned('rental',p.rentalId,c.id),priorJob=prior.engineJobId?await store.get('job',prior.engineJobId):null;
    if(prior.id===r.id||prior.state!=='closed'||priorJob?.cloudStopped!==true)throw Error('PRIOR_RENTAL_STOP_REQUIRED');
    if(p.scenes.some(s=>s.attempted&&s.status!=='done')||!p.scenes.some(s=>!s.attempted))throw Error('SCENE_ALREADY_ATTEMPTED');
    let remaining=false;for(const scene of p.scenes){if(!scene.attempted)remaining=true;else if(remaining)throw Error('CONTINUITY_REQUIRES_REVIEW');}
   }else if(p.state!=='planned')throw Error('PLAN_REQUIRED');
   await store.transaction(async()=>{const latest=await owned('film-project',p.id,c.id);if(latest.referenceUploading)throw Error('REFERENCE_LOCKED');if(latest.state==='generating'||(operation==='project.generate'&&latest.state!=='planned')||latest.scenes.some(s=>s.attempted&&s.status!=='done'))throw Error('SCENE_ALREADY_ATTEMPTED');
    if(latest.reviewPending||latest.directorFollow?.failed)throw Error('DIRECTOR_REVIEW_REQUIRES_FOLLOW_ONLY');
    if(input.directorFollow===true)await reserveDirectorFollow(latest,c);
    latest.state='generating';latest.error=null;latest.rentalHistory=[...new Set([...(latest.rentalHistory||[]),...(latest.rentalId?[latest.rentalId]:[]),r.id])];latest.rentalId=r.id;await store.put('film-project',latest);});
   runTask(async()=>{try{await generateProject(c,p,r);}catch{const latest=await owned('film-project',p.id,c.id);latest.error='GENERATION_REQUIRES_REVIEW';latest.state='needs_review';if(latest.launch){latest.launch.state='needs_review';latest.launch.finishedAt=now();}await store.put('film-project',latest);await alert('FILM_REQUIRES_REVIEW',p.id);await stopRental(await owned('rental',r.id,c.id),'FILM_FAULT');}});return {accepted:true};
  }
  if(operation==='project.merge'){const p=await owned('film-project',input.projectId,c.id);if(p.merge?.status==='deleted')throw Error('MEDIA_EXPIRED');if(!p.scenes?.length||p.scenes.some(s=>s.status!=='done'))throw Error('MERGE_SCENES_NOT_READY');if(p.merge?.status==='completed')return projectDTO(p);for(const scene of p.scenes)if(!await media.sceneAvailable(p,await store.get('job',scene.jobId)))throw Error('MEDIA_EXPIRED');await mergeProject(p);return projectDTO(await owned('film-project',p.id,c.id));}
  if(operation==='media.ticket'){
   if(input.index==='merged'){const p=await owned('film-project',input.projectId,c.id);if(p.merge?.status!=='completed'||!p.merge.sha256)throw Error('NOT_FOUND');if(!await media.accessible(p,null,'merged'))throw Error('MEDIA_EXPIRED');const ticket=id(),expires=Math.min(now()+180000,await media.deadline(p.merge));await store.put('film-media-ticket',{id:ticket,customerId:c.id,projectId:p.id,mergeSHA:p.merge.sha256,expires,download:input.download===true});return {url:origin+'/api/film-media/'+ticket+'?expires='+expires+'&signature='+mediaSignature(secret,ticket,expires),expires};}
   const p=await owned('film-project',input.projectId,c.id),scene=p.scenes?.[input.index];if(!scene?.jobId)throw Error('NOT_FOUND');
   const j=await store.get('job',scene.jobId);if(!j||j.tenantId!==c.id||j.projectId!==p.id||!j.result?.videoVerified)throw Error('NOT_FOUND');if(!await media.accessible(p,j,input.index))throw Error('MEDIA_EXPIRED');
   const ticket=id(),expires=Math.min(now()+180000,await media.deadline(j));await store.put('film-media-ticket',{id:ticket,customerId:c.id,projectId:p.id,jobId:j.id,expires,download:input.download===true});return {url:origin+'/api/film-media/'+ticket+'?expires='+expires+'&signature='+mediaSignature(secret,ticket,expires),expires};
  }
  if(operation==='admin.customers.list')return Promise.all((await store.all('film-customer')).map(async user=>({...user,wallet:await wallet(user.id)})));
  if(operation==='admin.credit.add'){
   const amount=money(input.amountUSD),requestId=label(input.requestId,100);if(!await store.get('film-customer',input.customerId))throw Error('NOT_FOUND');
   return store.transaction(async()=>{const key=hash('credit:'+requestId);const prior=await store.get('film-credit',key);if(prior){if(prior.customerId!==input.customerId||prior.amount!==amount)throw Error('IDEMPOTENCY_CONFLICT');return {saved:true};}const lot={id:key,customerId:input.customerId,amount,remaining:amount,createdAt:now(),expiresAt:now()+CREDIT_LIFETIME};
    await store.put('film-credit',lot);await store.put('film-ledger',{id:key,customerId:lot.customerId,type:'credit',microUSD:amount,expiresAt:lot.expiresAt,createdAt:now(),actor:c.id});await store.audit('film_credit_added',key);return {saved:true};});
  }
  if(operation==='admin.rentals.list')return Promise.all((await store.all('rental')).map(async r=>({...await rentalDTO(r),customerId:r.customerId,accountId:r.accountId,createdAt:r.createdAt,providerRecordedUSD:r.providerRecordedUSD??null,uncoveredMicroUSD:r.uncoveredMicroUSD||0,estimatedSupplierUSD:null,supplierCostSource:r.providerRecordedUSD==null?'unknown':'provider_recorded_not_invoice'})));
  if(operation==='admin.accounts.list'){
   const slots=await store.all('film-slot'),rentals=await store.all('rental'),jobs=await store.all('job');return Promise.all([...(await store.all('account')),...(await store.all('account-archive'))].map(async a=>{const standaloneActiveCount=new Set(jobs.filter(j=>!j.tenantId&&(j.accountId===a.id||j.sourceId===a.id)&&unconfirmed(j)).map(j=>j.attachedEngineId||j.id)).size;return {id:a.id,label:a.label,workspace:a.workspace,role:a.role,unlinked:!!a.unlinked,unlinkedAt:a.unlinkedAt??null,weightsReady:!!a.discovery?.ready,checkedAt:a.discovery?.checkedAt??null,files:(a.discovery?.productionQuality?.files||a.discovery?.files)?.map(f=>({name:f.name,size:f.size,present:f.present??true})),slots:slots.filter(s=>s.accountId===a.id),activeCount:rentals.filter(r=>r.accountId===a.id&&r.state!=='closed').length+standaloneActiveCount,standaloneActiveCount,billing:await store.get('film-account-billing',a.id),capacity:await store.get('film-capacity',a.id)};}));
  }
  if(operation==='admin.account.link')return engine.invoke('accounts',{label:label(input.name),tokenId:input.tokenId,tokenSecret:input.tokenSecret});
  if(operation==='admin.text.config')return engine.invoke('llm/config');
  if(operation==='admin.text.key.save')return engine.invoke('llm/config',{key:input.key});
  if(operation==='admin.text.key.remove')return engine.invoke('llm/config',undefined,undefined,'DELETE');
  if(operation==='admin.account.lock')return store.transaction(async()=>{const slots=(await store.all('film-slot')).filter(s=>s.accountId===input.accountId&&!s.retired);if(!slots.length)throw Error('NOT_FOUND');if(input.locked!==true&&!accountReady(await store.get('account',input.accountId)))throw Error('WEIGHTS_NOT_READY');for(const s of slots){s.locked=input.locked===true;await store.put('film-slot',s);}return {updated:slots.length,locked:input.locked===true};});
  if(operation==='admin.account.stop'){if(input.approved!==true)throw Error('APPROVAL_REQUIRED');return emergencyStop({accountId:input.accountId});}
  if(operation==='admin.account.activate')return engine.invoke('accounts/'+input.accountId+'/activate',{});
  if(operation==='admin.account.unlink'){if(input.approved!==true)throw Error('APPROVAL_REQUIRED');return engine.invoke('accounts/'+input.accountId,undefined,undefined,'DELETE');}
  if(operation==='admin.account.inspect')return engine.invoke('accounts/'+input.accountId+'/discover',{});
  if(operation==='admin.test.quote'){
   const slot=await store.get('film-slot',input.id);if(!slot)throw Error('NOT_FOUND');if(slot.retired)throw Error('SLOT_RETIRED');
   const q=await engine.invoke('quote',{action:'generate',accountId:slot.accountId,settings:slot.settings,projectId:id(),sceneId:'sample',prompt:prose(input.prompt,9000),audioContract:input.audioContract});
   await store.put('film-admin-test',{id:q.id,slotId:slot.id,revision:slot.revision});return q;
  }
  if(operation==='admin.test.execute'){
   if(input.approved!==true)throw Error('APPROVAL_REQUIRED');const proof=await store.get('film-admin-test',input.quoteId),q=await store.get('quote',input.quoteId),slot=proof?await store.get('film-slot',proof.slotId):null;
   if(slot?.retired)throw Error('SLOT_RETIRED');if(!proof||!slot||slot.revision!==proof.revision||q?.action!=='generate'||q.tenantId||q.accountId!==slot.accountId||q.settings?.gpu!==slot.gpu)throw Error('COST_CHANGED');return engine.invoke('execute',{quoteId:q.id,approvedCost:true});
  }
  if(operation==='admin.prepare.quote')return engine.invoke('quote',{action:'prepare',accountId:input.accountId,settings:settings({gpu:'RTX-PRO-6000',cpu:4,ram:96}),source:'volume'});
  if(operation==='admin.prepare.execute'){if(input.approved!==true)throw Error('APPROVAL_REQUIRED');const q=await store.get('quote',input.quoteId);if(q?.action!=='prepare')throw Error('INVALID_INPUT');return engine.invoke('execute',{quoteId:q.id,approvedCost:true});}
  if(operation==='admin.operation.status'){const stop=await store.get('film-admin-stop',input.id);if(stop)return stopStatus(stop);const job=await store.get('job',input.id);if(unconfirmed(job)&&job.stopRequestedAt)await engine.invoke('jobs/'+input.id+'/reconcile',{});return engine.invoke('jobs/'+input.id,undefined,undefined,'GET');}
  if(operation==='admin.slot.save')return store.transaction(async()=>{
   const account=await store.get('account',input.accountId);if(!account)throw Error('NOT_FOUND');const old=input.id?await store.get('film-slot',input.id):null;
   if(input.id&&!old)throw Error('NOT_FOUND');if(old?.retired)throw Error('SLOT_RETIRED');
   const accountSlots=(await store.all('film-slot')).filter(s=>s.accountId===account.id&&!s.retired),base=old||accountSlots[0];if(!old&&accountSlots.length>=2)throw Error('MAX_TWO_SLOTS');
   if(old&&old.accountId!==account.id)throw Error('INVALID_INPUT');
   const s={...old,id:old?.id||id(),accountId:account.id,name:label(input.name),hourMicros:money(input.hourPriceUSD),gpu:input.gpu||base?.gpu||'RTX-PRO-6000',cpu:4,ram:96,published:old?.published||false,locked:old?.locked??true,revision:(old?.revision||0)+1};
   s.settings=settings({gpu:s.gpu,cpu:4,ram:96,timeout:600,startup:180,budget:0,idleSeconds:1200});
   if(old&&old.gpu!==s.gpu){s.testJobId=null;s.published=false;s.locked=true;}await store.put('film-slot',s);return s;
  });
  if(operation==='admin.slot.reassign')return store.transaction(async()=>{
   if(input.approved!==true)throw Error('APPROVAL_REQUIRED');
   const s=await store.get('film-slot',input.id),a=await store.get('account',input.accountId);
   if(!s||!a)throw Error('NOT_FOUND');if(s.retired)throw Error('SLOT_RETIRED');
   if(s.accountId===a.id)return s;
   const accountIds=[s.accountId,a.id];
   if((await store.all('rental')).some(r=>accountIds.includes(r.accountId)&&r.state!=='closed')||(await store.all('job')).some(j=>unconfirmed(j)&&accountIds.some(aid=>touchesAccount(j,aid))))throw Error('ACCOUNT_IN_USE');
   if((await store.all('film-slot')).filter(x=>!x.retired&&x.accountId===a.id).length>=2)throw Error('MAX_TWO_SLOTS');
   const previousAccountId=s.accountId;
   s.accountId=a.id;s.revision++;s.locked=true;
   // Preserve trial visibility only; a result on the previous account cannot certify this account.
   s.published=!!(s.published&&s.testingOnly);s.testJobId=null;s.visualAudioReviewedAt=null;s.reviewedQualityContract=null;
   s.reassignedAt=now();s.reassignedBy=c.id;
   await store.put('film-slot',s);await store.put('film-slot-routing',{id:id(),slotId:s.id,previousAccountId,accountId:a.id,createdAt:now(),actor:c.id});
   await store.audit('film_slot_reassigned',s.id);return s;
  });
  if(operation==='admin.slot.retire')return store.transaction(async()=>{
   if(input.approved!==true)throw Error('APPROVAL_REQUIRED');const s=await store.get('film-slot',input.id);if(!s)throw Error('NOT_FOUND');if(s.retired)return s;
   if((await store.all('rental')).some(r=>r.accountId===s.accountId&&r.state!=='closed')||(await store.all('job')).some(j=>(j.accountId===s.accountId||j.sourceId===s.accountId)&&unconfirmed(j)))throw Error('ACCOUNT_IN_USE');
   s.retired=true;s.retiredAt=now();s.retiredBy=c.id;s.locked=true;s.published=false;s.revision++;await store.put('film-slot',s);await store.audit('film_slot_retired',s.id);return s;
  });
  if(operation==='admin.slot.verify')return store.transaction(async()=>{
   const s=await store.get('film-slot',input.id),j=await store.get('job',input.jobId);if(s?.retired)throw Error('SLOT_RETIRED');if(!s||!j||j.accountId!==s.accountId||j.settings?.gpu!==s.gpu||j.status!=='completed'||!j.cloudStopped||!j.result?.videoVerified||(engine.quality.textQualityRequired&&j.result.textQuality?.status!=='passed')||j.quality?.contract!==engine.quality.contract||input.reviewed!==true)throw Error('REAL_GPU_TEST_REQUIRED');s.testJobId=j.id;s.visualAudioReviewedAt=now();s.reviewedQualityContract=engine.quality.contract;await store.put('film-slot',s);return {verified:true};
  });
  if(operation==='admin.slot.publish')return store.transaction(async()=>{
   const s=await store.get('film-slot',input.id),a=s?await store.get('account',s.accountId):null,j=s?.testJobId?await store.get('job',s.testJobId):null;
   if(s?.retired)throw Error('SLOT_RETIRED');
   if(input.testingOnly===true){
    if(input.approved!==true)throw Error('APPROVAL_REQUIRED');
    if(!s||!a?.activated||!a?.discovery?.ready)throw Error('WEIGHTS_NOT_READY');
    if((await store.all('rental')).some(r=>r.accountId===s.accountId&&r.state!=='closed')||(await store.all('job')).some(j=>(j.accountId===s.accountId||j.sourceId===s.accountId)&&unconfirmed(j)))throw Error('ACCOUNT_IN_USE');
    s.published=true;s.testingOnly=true;s.trialPublishedAt=now();s.trialPublishedBy=c.id;await store.put('film-slot',s);await store.audit('film_slot_trial_published',s.id);return {published:true,testingOnly:true};
   }
   if(!s||!a?.activated||!a?.discovery?.ready||!j?.result?.videoVerified||j.status!=='completed'||!j.cloudStopped||(engine.quality.textQualityRequired&&j.result.textQuality?.status!=='passed')||j.accountId!==s.accountId||j.settings?.gpu!==s.gpu||j.quality?.contract!==engine.quality.contract||s.reviewedQualityContract!==engine.quality.contract||!s.visualAudioReviewedAt)throw Error('REAL_GPU_TEST_REQUIRED');s.published=true;s.testingOnly=false;await store.put('film-slot',s);return {published:true};
  });
  if(operation==='admin.slot.lock')return store.transaction(async()=>{
   const s=await store.get('film-slot',input.id);if(!s)throw Error('NOT_FOUND');if(s.retired)throw Error('SLOT_RETIRED');if(input.locked!==true&&!accountReady(await store.get('account',s.accountId)))throw Error('WEIGHTS_NOT_READY');s.locked=input.locked===true;await store.put('film-slot',s);return {locked:s.locked};
  });
  if(operation==='admin.slot.stop'){
   if(input.approved!==true)throw Error('APPROVAL_REQUIRED');const slot=await store.get('film-slot',input.id);if(!slot)throw Error('NOT_FOUND');return emergencyStop({accountId:slot.accountId,slotId:slot.id});
  }
  if(operation==='admin.capacity.save'){
   if(!await store.get('account',input.accountId)||![1,2].includes(input.maxConcurrent))throw Error('INVALID_INPUT');await store.put('film-capacity',{id:input.accountId,maxConcurrent:input.maxConcurrent,source:'administrator_declared_not_provider_availability',updatedAt:now()});return {saved:true};
  }
  if(operation==='admin.billing.save'){
   if(!await store.get('account',input.accountId))throw Error('NOT_FOUND');const credit=input.remainingUSD===null?null:money(input.remainingUSD,{allowZero:true});
   const value={id:input.accountId,remainingMicroUSD:credit,expiresAt:dateOrNull(input.expiresAt),renewsAt:dateOrNull(input.renewsAt),source:'administrator',updatedAt:now()};await store.put('film-account-billing',value);return value;
  }
  if(operation==='admin.billing.list')return store.all('film-account-billing');
  if(operation==='admin.alerts.list')return store.all('film-alert');
  if(operation==='admin.alert.ack'){const a=await store.get('film-alert',input.id);if(!a)throw Error('NOT_FOUND');a.acknowledged=true;await store.put('film-alert',a);return {saved:true};}
  if(operation==='review.submit')return reviewOperation(c,input);
  if(['chat.submit','text.status','plan.submit','plan.status'].includes(operation))return textOperation(c,operation,input);
  throw Error('NOT_FOUND');
 }

 async function reviewOperation(c,input){
  if(!textEnabled||!Number.isSafeInteger(textBudgetMicroUSD)||textBudgetMicroUSD<=0)throw Error('TEXT_DISABLED');
  if(input.approved!==true)throw Error('APPROVAL_REQUIRED');
  let p=await owned('film-project',input.projectId,c.id),request;
  await store.transaction(async()=>{
   p=await owned('film-project',p.id,c.id);
   if(p.reviewState&&p.reviewState!=='not_requested')return; // Existing intent, including uncertain failures: follow only.
   if(p.state==='generating'||p.textPending)throw Error('TEXT_ALREADY_PENDING');
   const jobs=[];
   for(const [index,s] of (p.scenes||[]).entries()){
    const job=s.jobId?await store.get('job',s.jobId):null;
    if(job?.tenantId===c.id&&job.projectId===p.id&&job.result?.videoVerified)jobs.push({index,jobId:job.id,sha256:job.result.sha256});
   }
   if(!jobs.length)throw Error('REVIEW_VERIFIED_VIDEO_REQUIRED');
   const usage=(await store.all('film-text-reservation')).filter(x=>x.createdAt>now()-CREDIT_LIFETIME);
   const reserve=jobs.length*250000;
   if(usage.reduce((v,x)=>v+x.reservedMicroUSD,0)+reserve>textBudgetMicroUSD)throw Error('TEXT_BUDGET_LIMIT');
   if(usage.filter(x=>x.customerId===c.id&&x.createdAt>now()-86400000).reduce((v,x)=>v+x.calls,0)+jobs.length>30)throw Error('TEXT_LIMIT');
   request={id:id(),jobs};
   await store.put('film-text-reservation',{id:request.id,customerId:c.id,projectId:p.id,calls:jobs.length,reservedMicroUSD:reserve,createdAt:now(),source:'administrator_budget_reservation_not_invoice'});
   p.reviewPending=request.id;p.reviewState='running';p.visualReviews=[];
   p.reviewIntent=request;await store.put('film-project',p);
  });
  if(!request)return {accepted:true,textCostPolicy:'administrator_funded_separate_from_gpu_wallet'};
  runTask(async()=>{
   try{
    for(const item of request.jobs){
     if(closed)throw Error('SERVER_SHUTTING_DOWN');
     const callId=request.id+'-'+item.index;
     await engine.invoke('llm/reviews',{requestId:callId,projectId:p.id,jobId:item.jobId,approvedTextCost:true});
     let response;for(let poll=0;poll<130;poll++){if(closed)throw Error('SERVER_SHUTTING_DOWN');response=await engine.invoke('llm/calls/'+callId,undefined,undefined,'GET');if(['completed','failed','uncertain'].includes(response.status))break;await pause();}
     if(response?.status!=='completed'||!response.visualReview)throw Error('REVIEW_REQUIRES_FOLLOW_ONLY');
     const updated=await owned('film-project',p.id,c.id);
     updated.visualReviews.push({index:item.index,model:response.model,summary:response.visualReview.summary,visibleText:response.visualReview.visibleText,continuity:response.visualReview.continuity,causalOrder:response.visualReview.causalOrder,audioAssessment:'not_checked',findings:response.visualReview.findings,suggestedCorrections:response.visualReview.suggestedCorrections,sampleCount:response.evidence?.timestamps?.length||0,computedUSD:response.usage?.computedUSD??null,invoiceUSD:null});
     await store.put('film-project',updated);
    }
    const updated=await owned('film-project',p.id,c.id);updated.reviewPending=null;updated.reviewState='completed';await store.put('film-project',updated);
   }catch{const updated=await owned('film-project',p.id,c.id);updated.reviewPending=null;updated.reviewState='needs_review';await store.put('film-project',updated);}
  });
  return {accepted:true,textCostPolicy:'administrator_funded_separate_from_gpu_wallet'};
 }
 async function textOperation(c,operation,input){
  let p=await owned('film-project',input.projectId,c.id);
  if(operation==='text.status'||operation==='plan.status')return projectDTO(p);
  if(!textEnabled||!Number.isSafeInteger(textBudgetMicroUSD)||textBudgetMicroUSD<=0)throw Error('TEXT_DISABLED');
  if(input.approved!==true)throw Error('APPROVAL_REQUIRED');
  const message=operation==='chat.submit'?prose(input.message,10000):null;
  const batches=operation==='plan.submit'?Math.ceil(p.seconds/60):1;
  const reserve=batches*250000; // Terra reservation, not an invoice cap; independent of GPU credits.
  const request=id();
  await store.transaction(async()=>{
   p=await owned('film-project',p.id,c.id);
   if(p.scenes?.some(s=>s.attempted))throw Error('SCENE_ALREADY_ATTEMPTED');
   if(['queued','running','uncertain'].includes(p.preview?.status))throw Error('PREVIEW_PENDING');if(p.launch)throw Error('SCENE_ALREADY_ATTEMPTED');if(p.referenceUploading)throw Error('REFERENCE_LOCKED');if(p.textPending)throw Error('TEXT_ALREADY_PENDING');
   if((p.textCalls||0)+batches>30)throw Error('TEXT_LIMIT');
   const usage=(await store.all('film-text-reservation')).filter(x=>x.createdAt>now()-CREDIT_LIFETIME);
   if(usage.reduce((v,x)=>v+x.reservedMicroUSD,0)+reserve>textBudgetMicroUSD)throw Error('TEXT_BUDGET_LIMIT');
   if(usage.filter(x=>x.customerId===c.id&&x.createdAt>now()-86400000).reduce((v,x)=>v+x.calls,0)+batches>30)throw Error('TEXT_LIMIT');
   await store.put('film-text-reservation',{id:request,customerId:c.id,projectId:p.id,calls:batches,reservedMicroUSD:reserve,createdAt:now(),source:'administrator_budget_reservation_not_invoice'});
   p.textPending=request;p.textUncertain=false;p.textCalls=(p.textCalls||0)+batches;p.textRequests=[];p.error=null;
   if(message){p.scenes=[];p.state='draft';p.discussion=null;delete p.merge;}
   if(message)p.messages=[...(p.messages||[]),{role:'user',content:message,...(p.reference&&!(p.messages||[]).some(m=>m.referenceId===p.reference.id)?{referenceId:p.reference.id}:{})}];await store.put('film-project',p);
  });
  runTask(async()=>{
   try{
    const scenes=[];
    for(let batch=0;batch<batches;batch++){
     if(closed)throw Error('SERVER_SHUTTING_DOWN');
     const latest=await owned('film-project',p.id,c.id),callId=request+'-'+batch,count=Math.min(6,p.seconds/10-batch*6);
     const instruction=operation==='plan.submit'?
      'Return JSON {scenes:[{prompt,audioContract:{language:"ar",dialect:"iraqi",mode:"dialogue",lines:[{speaker,text}]}}]}. Write exactly '+count+' chronological 10-second scenes numbered '+(batch*6+1)+' through '+(batch*6+count)+' of '+(p.seconds/10)+'. English visual action only in prompt, no dialogue or quotes. Iraqi Arabic dialogue must be complete Arabic-script sentences, 1-3 short lines, <=26 words total per scene. Named speakers with stable descriptions. Preserve explicitly requested formal Arabic. Native synchronized audio, no subtitles/lettering. Follow story and preceding scenes.':
      'Discuss this film in Iraqi Arabic. Propose duration within 10–300 seconds in multiples of 10; explain the supported duration if the request differs. Set ready_to_write only after the user asks you to draft the agreed story. No video tools are invoked.';
     latest.textRequests.push(callId);await store.put('film-project',latest); // durable before paid submission; never retry ambiguous call.
     await engine.invoke('llm/calls',{requestId:callId,projectId:p.id,mode:operation==='plan.submit'?'details':'discuss',approvedTextCost:true,instruction,maxTokens:6000,messages:[{role:'user',content:latest.story},...(latest.messages||[]).slice(-20).map(m=>({role:m.role,content:m.content})),...(scenes.length?[{role:'assistant',content:JSON.stringify({precedingScenes:scenes.slice(-6)})}]:[])]});
     let response;for(let poll=0;poll<130;poll++){if(closed)throw Error('SERVER_SHUTTING_DOWN');response=await engine.invoke('llm/calls/'+callId,undefined,undefined,'GET');if(['completed','failed','uncertain'].includes(response.status))break;await pause();}
     if(response?.status!=='completed')throw Error('TEXT_REQUIRES_REVIEW');
     const updated=await owned('film-project',p.id,c.id);
     if(operation==='plan.submit'){
      const plan=JSON.parse(response.text);if(!Array.isArray(plan.scenes)||plan.scenes.length!==count)throw Error('INVALID_PLAN');
      scenes.push(...plan.scenes.map(scene=>({prompt:prose(scene.prompt,9000),audioContract:Arabic.checkPrompt(scene.prompt,scene.audioContract),status:'pending',attempted:false})));
      updated.planningCompletedScenes=scenes.length;
      if(batch===batches-1){updated.scenes=scenes;updated.state='planned';}
     }else {
      updated.messages.push({role:'assistant',content:clean(response.discussion?.reply||response.text)});
      const d=response.discussion,seconds=d?.proposed_duration_seconds;
      if(d?.intent==='image_preview'){await imagePreview.offer(updated,d.portrait_prompt);d.ready_to_write=false;}else if(updated.preview?.status==='offered')updated.preview=null;
      if(Number.isInteger(seconds)&&seconds>=10&&seconds<=300&&seconds%10===0){
       if(updated.seconds!==seconds){updated.seconds=seconds;updated.scenes=[];updated.state='draft';delete updated.merge;}
       updated.discussion={readyToWrite:d.ready_to_write===true,seconds,style:clean(d.style||'')};
      }else updated.discussion={readyToWrite:false,seconds:null,style:clean(d?.style||'')};
     }
     await store.put('film-project',updated);
    }
    const updated=await owned('film-project',p.id,c.id);updated.textPending=null;await store.put('film-project',updated);
    if(operation==='chat.submit'&&updated.discussion?.readyToWrite)await textOperation(c,'plan.submit',{projectId:p.id,approved:true});
   }catch{const updated=await owned('film-project',p.id,c.id);updated.textPending=null;updated.error='TEXT_REQUIRES_REVIEW';await store.put('film-project',updated);}
  });return {accepted:true,textCostPolicy:'administrator_funded_separate_from_gpu_wallet'};
 }

 async function handler(req,res){
  const url=new URL(req.url,origin);if(await imagePreview.handle(req,res,url,secureRequest(req)))return true;if(await references.handle(req,res,url,secureRequest(req)))return true;if(url.pathname.startsWith('/api/film-media/')){
   const jid=url.pathname.slice('/api/film-media/'.length);if(!secureRequest(req)||!['GET','HEAD'].includes(req.method)||!SAFE.test(jid)||!validMediaSignature(secret,jid,url.searchParams.get('expires'),url.searchParams.get('signature'),now())){send(res,403,{error:'ACCESS_DENIED'});return true;}
   const ticket=await store?.get('film-media-ticket',jid),project=ticket?await store?.get('film-project',ticket.projectId):null,mediaJob=ticket?.jobId?await store?.get('job',ticket.jobId):null;
   const validOwner=ticket&&ticket.expires===Number(url.searchParams.get('expires'))&&project?.customerId===ticket.customerId;
   const withinRetention=validOwner&&await media.accessible(project,mediaJob,ticket.mergeSHA?'merged':project.scenes?.findIndex(s=>s.jobId===ticket.jobId));
   const validMedia=ticket?.mergeSHA?project?.merge?.status==='completed'&&project.merge.sha256===ticket.mergeSHA:mediaJob?.tenantId===ticket?.customerId&&mediaJob?.projectId===project?.id&&mediaJob?.result?.videoVerified;
   if(!validOwner||!validMedia||!withinRetention){send(res,404,{error:'NOT_FOUND'});return true;}
   const requestOrigin=req.headers.origin;if(requestOrigin&&!mediaOrigins.includes(requestOrigin)){send(res,403,{error:'ACCESS_DENIED'});return true;}
   if(requestOrigin)res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','video/mp4');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Accept-Ranges','bytes');res.setHeader('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');
   const file=ticket.mergeSHA?project.merge.path:path.resolve(store.folder,'artifacts',mediaJob.id,'video.mp4');try{const stat=await fs.promises.stat(file);if(!stat.isFile())throw Error();let range;try{range=mediaRange(req.headers.range,stat.size);}catch{res.setHeader('Content-Range','bytes */'+stat.size);res.setHeader('Content-Length',0);res.writeHead(416);res.end();return true;}
    if(ticket.download===true)res.setHeader('Content-Disposition','attachment; filename="mashhad-video.mp4"');
    if(range)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${stat.size}`);res.setHeader('Content-Length',range?range.end-range.start+1:stat.size);res.writeHead(range?206:200);if(req.method==='HEAD'){res.end();return true;}const stream=fs.createReadStream(file,range||{});res.once?.('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
   }catch{send(res,404,{error:'NOT_FOUND'});}return true;
  }
  if(url.pathname!=='/api/film-bridge')return false;
  try{
   const secure=secureRequest(req);
   if(req.method!=='POST'||!secure||!secret||secret.length<32)throw Error('BRIDGE_UNAUTHORIZED');
   let length=0,parts=[];for await(const part of req){length+=part.length;if(length>262144)throw Error('INVALID_INPUT');parts.push(part);}
   const raw=Buffer.concat(parts).toString(),nonce=verifyBridge(secret,req.headers,raw,now()),b=JSON.parse(raw);requireStore();
   if(!SAFE.test(b.requestId||''))throw Error('INVALID_INPUT');
   const readOnly=/^(session|wallet|files.list|servers.list|rental.quote|rental.status|projects.list|project.get|project.follow|text.status|plan.status|admin\.(customers.list|accounts.list|rentals.list|billing.list|alerts.list|operation.status|text.config))$/.test(b.operation);
   await store.transaction(async()=>{if(await store.get('film-bridge-nonce',nonce))throw Error('BRIDGE_UNAUTHORIZED');await store.put('film-bridge-nonce',{id:nonce,at:now()});for(const old of await store.all('film-bridge-nonce'))if(old.at<now()-120000)await store.delete('film-bridge-nonce',old.id);});
   const fingerprint=hash(raw),prior=readOnly?null:await store.get('film-bridge-request',b.requestId);
   if(prior){if(prior.hash!==fingerprint)throw Error('BRIDGE_UNAUTHORIZED');if(prior.finished){send(res,200,prior.result);return true;}throw Error('REQUEST_STATE_UNKNOWN');}
   if(!readOnly)await store.transaction(async()=>{if(await store.get('film-bridge-request',b.requestId))throw Error('REQUEST_STATE_UNKNOWN');await store.put('film-bridge-request',{id:b.requestId,hash:fingerprint,finished:false});});
   const result=await dispatch(b.actor,b.operation,b.input||{});if(!readOnly)await store.put('film-bridge-request',{id:b.requestId,hash:fingerprint,finished:true,result});send(res,200,b.operation.startsWith('admin.')?result:JSON.parse(clean(JSON.stringify(result))));
  }catch(e){const code=/^[A-Z_]{3,80}$/.test(e.message)&&!/MODAL/.test(e.message)?e.message:'REQUEST_FAILED';send(res,400,{error:code,message:messages[code]||'تعذر إتمام العملية. لا تعِد طلب التشغيل؛ افحص حالة الطلب أو راجع المسؤول.'});}
  return true;
 }
 return {handler,dispatch,tick,wallet,sweepMedia:()=>media.cleanup(),async close(){closed=true;if(timer)clearInterval(timer);await imagePreview.close();let timeout;try{await Promise.race([(async()=>{await Promise.allSettled((store?(await store.all('rental')).filter(r=>r.state!=='closed'):[]).map(r=>stopRental(r,'SERVER_SHUTDOWN')));await Promise.allSettled([...pending]);})(),new Promise(resolve=>{timeout=setTimeout(resolve,closeTimeoutMs);})]);}finally{clearTimeout(timeout);}}};
}
