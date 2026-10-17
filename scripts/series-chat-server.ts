import {libraryPublishingOperation} from './library-publishing-bridge';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import type {Plugin} from 'vite';
import {seriesImageOperation,ImageBridgeError} from './series-image-bridge';
import {seriesConnectionsOperation} from './series-connections-bridge';
import {seriesVideoOperation} from './series-video-bridge';
import {validateChatRequest,callSeriesAssistant,type ChatRequest} from '../shared/series-chat';
export {validateChatRequest,callSeriesAssistant,FREE_CHAT_MODEL,FREE_CHAT_FALLBACK,FREE_VISION_FALLBACK,FREE_IRAQI_CHAT_MODEL} from '../shared/series-chat';
const run=promisify(execFile);
export function seriesChatPlugin():Plugin{
 let keyPromise:Promise<string>|undefined;
 const turns=new Map<string,{hash:string;result:Promise<unknown>;time:number}>();
 let active=0;
 async function key(){
  keyPromise??=(async()=>{if(process.env.OPENROUTER_API_KEY?.trim())return process.env.OPENROUTER_API_KEY.trim();try{const result=await run(process.execPath,['node_modules/convex/bin/main.js','env','get','OPENROUTER_API_KEY'],{cwd:process.cwd(),timeout:30000,maxBuffer:100000});if(!result.stdout.trim().startsWith('sk-'))throw new Error();return result.stdout.trim();}catch{keyPromise=undefined;throw new Error('تعذر الوصول إلى مفتاح OpenRouter المحفوظ.');}})();return keyPromise;
 }
 return {name:'private-series-chat',apply:'serve',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const route=req.url?.split('?')[0];if(route!=='/api/series-chat'&&route!=='/api/series-image'&&route!=='/api/series-connections'&&route!=='/api/series-video'&&route!=='/api/library-publishing'){next();return;}
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const finish=(status:number,value:unknown)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  const port=server.httpServer?.address();
  const expected=typeof port==='object'&&port?`127.0.0.1:${port.port}`:'';
  if(req.headers.host!==expected||req.headers.origin!==`http://${expected}`||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress??'')){finish(403,{error:'الدردشة متاحة من المعاينة المحلية فقط.'});return;}
  if(req.method!=='POST'||req.headers['content-type']!=='application/json'){finish(405,{error:'طلب غير صالح.'});return;}
  let size=0;const chunks:Buffer[]=[];
  try{
   for await(const chunk of req){size+=chunk.length;if(size>24000000){finish(413,{error:'حجم الصور كبير. أرسل صورًا أصغر.'});return;}chunks.push(chunk);}
   const raw=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(raw);}catch{finish(400,{error:'طلب غير صالح.'});return;}
   if(route==='/api/library-publishing'){try{finish(200,await libraryPublishingOperation(data));}catch(e){finish(400,{error:(e as Error).message});}return;}
   if(route==='/api/series-video'){try{finish(200,await seriesVideoOperation(data));}catch(e){finish(400,{error:e instanceof Error?e.message:'تعذر متابعة الفيديو.'});}return;}
   if(route==='/api/series-connections'){try{finish(200,await seriesConnectionsOperation(data));}catch{finish(400,{error:'تعذر إكمال الربط. تحقق من إعدادات الخدمة وحاول مجددًا.'});}return;}
   if(route==='/api/series-image'){try{finish(200,await seriesImageOperation(data));}catch(e){finish(e instanceof ImageBridgeError?503:400,{error:(e as Error).message,...(e instanceof ImageBridgeError?{code:e.code}:{})});}return;}
   let request:ChatRequest;try{request=validateChatRequest(data);}catch(e){finish(400,{error:(e as Error).message});return;}
   const id=request.projectId+':'+request.turnId,hash=createHash('sha256').update(raw).digest('hex');
   for(const [id,entry]of turns)if(Date.now()-entry.time>1800000)turns.delete(id);
   const old=turns.get(id);if(old&&old.hash!==hash){finish(409,{error:'تغيرت الرسالة؛ أرسل رسالة جديدة.'});return;}
   if(old){finish(200,await old.result);return;}
   if(active>=2){finish(429,{error:'انتظر انتهاء الرد الحالي.'});return;}
   if(turns.size>=100){finish(429,{error:'بلغت حد الجلسة المحلية. أعد تشغيل المعاينة لاحقًا.'});return;}
   active++;
   const result=(async()=>{try{return await callSeriesAssistant(request,await key(),fetch,'openrouter');}catch(e){return {error:e instanceof Error&&e.name!=='TimeoutError'?e.message:'انتهت مهلة الاتصال. حاول لاحقًا.'};}finally{active--;}})();
   turns.set(id,{hash,result,time:Date.now()});const answer=await result;if('error' in answer)turns.delete(id);finish(200,answer);
  }catch{finish(500,{error:'تعذر إكمال طلب الدردشة.'});}
 });}};
}


