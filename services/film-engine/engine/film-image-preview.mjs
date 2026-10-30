import {textBudgetExposure} from './film-money.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {id,hash} from './store.mjs';
import {inspectReference} from './film-reference.mjs';
export const PREVIEW_MODEL='gpt-image-2-2026-04-21',PREVIEW_ESTIMATE_USD=.10;
const LIFE=7*86400000,SAFE=/^[a-zA-Z0-9_-]{1,100}$/;
export function createFilmImagePreview({store,secret,origin,origins,now=Date.now,budgetMicroUSD,fetcher=fetch}){
 const pending=new Set(),abort=new AbortController();
 const sign=(key,expires)=>createHmac('sha256',secret).update('film-preview\n'+key+'\n'+expires).digest('hex');
 const filename=r=>{if(!SAFE.test(r.projectId)||!SAFE.test(r.id))throw Error('PREVIEW_INVALID_PATH');return path.join(store.folder,'film-previews',r.projectId,r.id+'.image');};
 const publicDTO=r=>r?{id:r.id,status:r.status,estimatedUSD:r.estimatedUSD,computedUSD:r.computedUSD??null,invoiceUSD:null,expiresAt:r.expiresAt,error:r.error?'تعذرت معاينة الصورة؛ لا إعادة محاولة تلقائية.':null,model:PREVIEW_MODEL}:null;
 async function initialize(){await fs.mkdir(path.join(store.folder,'film-previews'),{recursive:true,mode:0o700});for(const r of await store.all('film-image-preview'))if(['queued','running'].includes(r.status)){r.status='uncertain';r.error='PREVIEW_INTERRUPTED_NO_RETRY';await store.put('film-image-preview',r);const p=await store.get('film-project',r.projectId);if(p?.preview?.id===r.id){p.preview={...p.preview,status:r.status,error:r.error};await store.put('film-project',p);}}}
 async function offer(p,prompt){if(typeof prompt!=='string'||prompt.trim().length<10||prompt.length>4000)throw Error('PREVIEW_PROMPT_REQUIRED');p.preview={id:id(),status:'offered',prompt,orientation:p.orientation,referenceVersion:p.referenceVersion||0,estimatedUSD:PREVIEW_ESTIMATE_USD,createdAt:now(),expiresAt:now()+LIFE};return p.preview;}
 async function execute(p,quoteId,approved,referenceData){
  if(approved!==true)throw Error('APPROVAL_REQUIRED');let record,claimed=false;
  await store.transaction(async()=>{
   const current=await store.get('film-project',p.id);if(current?.customerId!==p.customerId||current.preview?.id!==quoteId)throw Error('NOT_FOUND');
   const old=await store.get('film-image-preview',quoteId);if(old){record=old;return;}
   if(current.preview.status!=='offered'||current.preview.expiresAt<=now()||current.preview.orientation!==current.orientation||current.preview.referenceVersion!==(current.referenceVersion||0)||current.referenceUploading||current.launch||current.textPending)throw Error('PREVIEW_NOT_AVAILABLE');
   const disk=await fs.statfs(store.folder);if(Number(disk.bavail)*Number(disk.bsize)<32*1024*1024)throw Error('PREVIEW_STORAGE_UNAVAILABLE');
   const config=await store.get('config','openai-director');if(!config?.credentials)throw Error('OPENAI_KEY_REQUIRED');
   if((await store.all('film-image-preview')).filter(r=>r.projectId===p.id).length>=3)throw Error('PREVIEW_LIMIT');
   const used=textBudgetExposure((await store.all('film-text-reservation')).filter(r=>r.createdAt>now()-30*86400000),await store.all('text-call'));
   if(!Number.isSafeInteger(budgetMicroUSD)||used+100000>budgetMicroUSD)throw Error('TEXT_BUDGET_LIMIT');
   record={id:quoteId,projectId:p.id,customerId:p.customerId,status:'queued',prompt:current.preview.prompt,orientation:current.orientation,createdAt:now(),expiresAt:now()+LIFE,estimatedUSD:PREVIEW_ESTIMATE_USD};
   await store.put('film-text-reservation',{id:'image-'+quoteId,customerId:p.customerId,projectId:p.id,calls:1,reservedMicroUSD:100000,createdAt:now(),source:'image_preview_reservation_not_invoice'});
   await store.put('film-image-preview',record);current.preview={...current.preview,status:'queued'};await store.put('film-project',current);claimed=true;
  });
  if(claimed){const task=run(record,referenceData).finally(()=>pending.delete(task));pending.add(task);}return publicDTO(record);
 }
 async function run(r,referenceData){try{
  r.status='running';await store.put('film-image-preview',r);const cfg=await store.get('config','openai-director'),key=store.open(cfg.credentials,'openai-director').key;
  const values={model:PREVIEW_MODEL,prompt:'Create one cinematic scene concept, no text, subtitles, captions, logos or lettering. '+r.prompt,n:1,size:r.orientation==='portrait'?'864x1536':'1536x864',quality:'low',output_format:'jpeg',output_compression:80,safety_identifier:hash(r.customerId)};
  let body,endpoint,headers={Authorization:'Bearer '+key};
  if(referenceData){const m=referenceData.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);if(!m)throw Error('PREVIEW_REFERENCE_INVALID');body=new FormData();for(const [k,v]of Object.entries(values))body.set(k,String(v));body.set('image',new Blob([Buffer.from(m[2],'base64')],{type:m[1]}),'reference.'+(m[1]==='image/png'?'png':'jpg'));endpoint='edits';}
  else{body=JSON.stringify(values);headers['Content-Type']='application/json';endpoint='generations';}
  let response;try{response=await fetcher('https://api.openai.com/v1/images/'+endpoint,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)])});}catch{throw Error('PREVIEW_CONNECTION_UNCERTAIN');}
  if(!response.ok){await response.body?.cancel();throw Error('PREVIEW_PROVIDER_'+response.status);}
  const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>12000000)throw Error('PREVIEW_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}const result=JSON.parse(Buffer.concat(chunks).toString());
  if(result.data?.length!==1||typeof result.data[0].b64_json!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(result.data[0].b64_json))throw Error('PREVIEW_INVALID_IMAGE');
  const bytes=Buffer.from(result.data[0].b64_json,'base64');inspectReference(bytes,'image/jpeg');const target=filename(r);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});r.sha256=hash(bytes);r.size=bytes.length;r.status='completed';
  const u=result.usage,t=u?.input_tokens_details?.text_tokens,i=u?.input_tokens_details?.image_tokens,o=u?.output_tokens;if([t,i,o].every(v=>Number.isFinite(v)&&v>=0))r.computedUSD=(t*5+i*8+o*30)/1e6;
 }catch(e){r.status=/UNCERTAIN/.test(e.message)?'uncertain':'failed';r.error=/^PREVIEW_[A-Z0-9_]+$/.test(e.message)?e.message:'PREVIEW_FAILED_NO_RETRY';}
 r.finishedAt=now();await store.put('film-image-preview',r);const p=await store.get('film-project',r.projectId);if(p?.preview?.id===r.id){p.preview={...p.preview,...publicDTO(r)};await store.put('film-project',p);}await store.audit('image_preview_'+r.status,r.id);
 }
 async function view(p){const r=p.preview?.id?await store.get('film-image-preview',p.preview.id):null;if(!r||r.projectId!==p.id||r.customerId!==p.customerId||r.status!=='completed'||r.expiresAt<=now())throw Error('NOT_FOUND');const ticket={id:id(),projectId:p.id,customerId:p.customerId,previewId:r.id,expires:Math.min(now()+120000,r.expiresAt)};await store.put('film-preview-ticket',ticket);return {url:origin+'/api/film-preview/'+ticket.id+'?expires='+ticket.expires+'&signature='+sign(ticket.id,ticket.expires),expires:ticket.expires};}
 async function handle(req,res,url,secure){if(!url.pathname.startsWith('/api/film-preview/'))return false;const fail=()=>{res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"ACCESS_DENIED"}');};try{
  const key=url.pathname.split('/').at(-1),expires=url.searchParams.get('expires'),signature=url.searchParams.get('signature');if(!secure||req.method!=='GET'||!SAFE.test(key)||!/^\d{13}$/.test(expires||'')||! /^[a-f0-9]{64}$/.test(signature||'')||!timingSafeEqual(Buffer.from(sign(key,expires)),Buffer.from(signature)))throw Error();
  const ticket=await store.get('film-preview-ticket',key),r=ticket?await store.get('film-image-preview',ticket.previewId):null,p=ticket?await store.get('film-project',ticket.projectId):null;if(!ticket||ticket.expires!==Number(expires)||ticket.expires<=now()||r?.status!=='completed'||r.expiresAt<=now()||r.customerId!==ticket.customerId||r.projectId!==p?.id||p.customerId!==ticket.customerId)throw Error();
  if(req.headers.origin&&!origins.includes(req.headers.origin))throw Error();const bytes=await fs.readFile(filename(r));if(hash(bytes)!==r.sha256)throw Error();if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin'});res.end(bytes);
 }catch{fail();}return true;}
 async function cleanup(){for(const r of await store.all('film-image-preview'))if(r.expiresAt<=now()&&r.status!=='expired'&&!['queued','running'].includes(r.status)){await fs.unlink(filename(r)).catch(e=>{if(e.code!=='ENOENT')throw e;});r.status='expired';delete r.prompt;delete r.sha256;await store.put('film-image-preview',r);const p=await store.get('film-project',r.projectId);if(p?.preview?.id===r.id){p.preview={...publicDTO(r),status:'expired'};await store.put('film-project',p);}}for(const t of await store.all('film-preview-ticket'))if(t.expires<=now())await store.delete('film-preview-ticket',t.id);}
 return {initialize,offer,execute,view,handle,cleanup,publicDTO,async close(){abort.abort();await Promise.allSettled([...pending]);}};
}
