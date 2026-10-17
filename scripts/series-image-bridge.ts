import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile);
export class ImageBridgeError extends Error {constructor(message:string,readonly code:string){super(message);}}
async function connectionStatus(verifyFlow=false){
 try{const result=await run(process.execPath,['node_modules/convex/bin/main.js','function-spec'],{cwd:process.cwd(),timeout:30000,maxBuffer:3000000});
 const ready=/privateStudioImages(?:\.js)?:authorize/.test(result.stdout)&&/privateStudioImages(?:\.js)?:status/.test(result.stdout);
 if(ready&&verifyFlow){const health=JSON.parse(await invoke(['run','privateStudioImages:health','{}','--identity',await ownerIdentity()]));if(!health.online)return {ready:false,message:'خدمة Flow غير جاهزة بعد؛ انتظر اكتمال فحص المتصفح ثم افحص الربط. موافقتك محفوظة.'};if(!health.freeLiteAvailable||!health.imageOptionsAt||Date.now()-health.imageOptionsAt>3600000)return {ready:false,message:'لم تتأكد إتاحة موديل صور بكلفة صفر حاليًا. لم نستخدم توليدًا مدفوعًا.'};}
 return {ready,message:ready?'حساب Flow متصل وأقوى موديل صور مجاني متاح جاهز.':'خدمة صور Flow الخاصة لم تتفعّل على السيرفر بعد. البرومبت وموافقتك محفوظان؛ إعادة المحاولة لن تفعّل الخدمة.'};
 }catch{throw new ImageBridgeError('تعذر فحص اتصال خدمة الصور. حاول فحص الربط لاحقًا.','SERVICE_UNAVAILABLE');}
}
async function invoke(args:string[]){try{const result=await run(process.execPath,['node_modules/convex/bin/main.js',...args],{cwd:process.cwd(),timeout:30000,maxBuffer:500000});return result.stdout.trim();}catch(e){const diagnostic=String((e as {stderr?:string}).stderr??'');if(diagnostic.includes('اتصال Flow أو أسعار الصور تحتاج تحديثًا.'))throw new ImageBridgeError('خدمة Flow تفحص الموديلات والأسعار حاليًا. موافقتك محفوظة؛ أكمل الطلب بعد انتهاء الفحص.','FLOW_NOT_READY');if(diagnostic.includes('Nano Banana Lite المجاني غير متاح حاليًا'))throw new ImageBridgeError('موديل Nano Banana Lite المجاني غير متاح في هذا الحساب حاليًا. لم نستخدم توليدًا مدفوعًا.','FLOW_NOT_READY');if(diagnostic.includes('خدمة المتصفح على السيرفر'))throw new ImageBridgeError('خدمة التحكم بحساب Flow غير جاهزة حاليًا. انتظر انتهاء فحص المتصفح ثم حدّث الرصيد.','FLOW_NOT_READY');if(diagnostic.includes('متصفح حساب Flow الخاص غير متصل'))throw new ImageBridgeError('متصفح حسابك الخاص يحتاج إكمال الاتصال أو تسجيل الدخول.','FLOW_NOT_READY');throw new ImageBridgeError('تعذر الاتصال بخدمة حساب Flow الخاص. لم يُستخدم توليد مدفوع.','SERVICE_UNAVAILABLE');}}
let identity:Promise<string>|undefined;
export {invoke as invokeStudio,ownerIdentity as studioOwnerIdentity};
async function ownerIdentity(){identity??=(async()=>{const [subject,issuer]=await Promise.all([invoke(['env','get','OWNER_SUBJECT']),invoke(['env','get','CLERK_JWT_ISSUER_DOMAIN'])]);if(!subject||!issuer)throw new Error('هوية المالك غير متاحة.');return JSON.stringify({subject,issuer});})();return identity;}
export async function seriesImageOperation(data:unknown){
 if(!data||typeof data!=='object')throw new Error('طلب الصورة غير صالح.');
 const v=data as {op:string;key:string;prompt:string;sourceJobId?:string;sourceStorageId?:string;jobId:string;data:string;type:string;name:string};
 if(v.op==='uploadReference'){
  if(!['image/jpeg','image/png','image/webp'].includes(v.type)||typeof v.data!=='string'||v.data.length>2000000||!/^[A-Za-z0-9+/=]+$/.test(v.data)||typeof v.name!=='string'||v.name.length>255)throw new Error('الصورة المرجعية غير صالحة.');
  const bytes=Buffer.from(v.data,'base64'),key='image:'+createHash('sha256').update(bytes).digest('hex'),identity=await ownerIdentity();
  const ticket=JSON.parse(await invoke(['run','files:begin',JSON.stringify({key,kind:'image',name:v.name,type:v.type,size:bytes.length}),'--identity',identity]));
  if(ticket.storageId)return {storageId:ticket.storageId};
  const response=await fetch(ticket.url,{method:'POST',headers:{'Content-Type':v.type},body:bytes});if(!response.ok)throw new Error('تعذر رفع الصورة المرجعية.');
  const {storageId}=await response.json();return {storageId:JSON.parse(await invoke(['run','files:finish',JSON.stringify({key,storageId}),'--identity',identity]))};
 }
 if(v.op==='check')return connectionStatus(true);
 if(v.op==='health')return JSON.parse(await invoke(['run','privateStudioImages:health','{}','--identity',await ownerIdentity()]));
 if(v.op==='balance'||v.op==='refreshBalance'){
  const connection=await connectionStatus();if(!connection.ready)throw new ImageBridgeError(connection.message,'SERVICE_NOT_ACTIVE');
  if(v.op==='refreshBalance')await invoke(['run','privateStudioImages:refreshBalance','{}','--identity',await ownerIdentity()]);
  return {balance:JSON.parse(await invoke(['run','privateStudioImages:balance','{}','--identity',await ownerIdentity()]))};
 }
 const idPattern=/^[a-zA-Z0-9-]{8,100}$/;
 if(v.op==='generate'){
  if(!idPattern.test(v.key)||typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>9500||(v.sourceJobId&&!idPattern.test(v.sourceJobId)))throw new Error('برومبت الصورة غير صالح.');
  const connection=await connectionStatus();if(!connection.ready)throw new ImageBridgeError(connection.message,'SERVICE_NOT_ACTIVE');
  return {jobId:JSON.parse(await invoke(['run','privateStudioImages:authorize',JSON.stringify({key:v.key,prompt:v.prompt,...(v.sourceJobId?{sourceJobId:v.sourceJobId}:{}),...(v.sourceStorageId?{sourceStorageId:v.sourceStorageId}:{})}),'--identity',await ownerIdentity()]))};
 }
 if(v.op==='status'&&idPattern.test(v.jobId)){
  const result=JSON.parse(await invoke(['run','privateStudioImages:status',JSON.stringify({jobId:v.jobId}),'--identity',await ownerIdentity()]));
  if(result.status==='completed'&&result.url){const url=new URL(result.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.convex.cloud'))throw new Error('مصدر الصورة غير موثوق.');const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('تعذر تنزيل الصورة.');const type=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type??''))throw new Error('نوع الصورة غير صالح.');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>15000000)throw new Error('حجم الصورة كبير.');return {status:result.status,type,data:bytes.toString('base64')};}
  return {status:result.status,error:result.error?'Flow أوقف طلب الصورة. راجع اتصال الحساب أو البرومبت.':null};
 }
 throw new Error('طلب الصورة غير صالح.');
}
