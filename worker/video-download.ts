import type {BrowserContext,Download} from 'playwright';
import {writeFile} from 'node:fs/promises';
export async function fetchFlowVideo(context:BrowserContext,source:string,destination:string){
 const url=new URL(source);
 if(url.protocol!=='https:'||url.username||url.password||!['googleusercontent.com','googlevideo.com','googleapis.com','google.com'].some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`)))throw Error('DOWNLOAD_UNSUPPORTED: مصدر الفيديو ليس HTTPS معروفًا؛ لا تنزيل بديل.');
 const response=await context.request.get(source,{timeout:120000});
 try{
  if(!response.ok()||!response.headers()['content-type']?.startsWith('video/'))throw Error('DOWNLOAD_FAILED: لم يُرجع Flow فيديو.');
  const bytes=await response.body();if(!bytes.length)throw Error('EMPTY_VIDEO');await writeFile(destination,bytes,{mode:0o600});
 }finally{await response.dispose();}
}
export async function saveOriginalDownload(context:BrowserContext,file:Download,destination:string){
 const failure=await file.failure();
 if(failure){
  try{await fetchFlowVideo(context,file.url(),destination);return;}
  catch(error){throw Error(`DOWNLOAD_FAILED: original ${failure}; recovery ${error instanceof Error?error.message:'failed'}`,{cause:error});}
 }
 try{await file.saveAs(destination);}
 catch(error){
  if(!(error instanceof Error)||! /\bENOENT\b/.test(error.message))throw error;
  // Separate CDP clients can replace Chrome's download directory. Retrieve only
  // the original download URL, through this same authenticated browser context.
  // This is file recovery; it never submits another generation or requests upscale.
  await fetchFlowVideo(context,file.url(),destination);
 }
}
