import type {Download,Page} from 'playwright';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {saveOriginalDownload} from './video-download';
// Flow revokes its blob URL immediately after opening the browser download.
// Retain only the selected original video Blob for the duration of that action.
export async function saveSelectedOriginal(page:Page,action:()=>Promise<Download>,destination:string){
 const url=new URL(page.url());
 if(url.origin!=='https://flow.google.com'||!/^\/(?:u\/[0-9]+\/)?project\/[a-zA-Z0-9-]+\/edit\/[a-zA-Z0-9-]+$/.test(url.pathname))throw Error('IDENTITY_AMBIGUOUS: original download requires the verified Flow editor');
 const key='__mashhadOriginal_'+randomUUID().replaceAll('-','');
 await page.evaluate(key=>{
  const state={original:URL.createObjectURL,blobs:[] as Blob[],wrapper:undefined as typeof URL.createObjectURL|undefined};
  state.wrapper=function(obj:Blob|MediaSource){if(obj instanceof Blob&&obj.size>0&&obj.size<=100*1024*1024&&(obj.type.startsWith('video/')||obj.type==='application/octet-stream'||!obj.type))state.blobs.push(obj);return state.original.call(URL,obj);};
  (window as unknown as Record<string,unknown>)[key]=state;URL.createObjectURL=state.wrapper;
 },key);
 try{
  const file=await action();
  const result=await page.evaluate(async key=>{
   const state=(window as unknown as Record<string,{blobs:Blob[]}>)[key];
   if(!state?.blobs.length)return null;if(state.blobs.length!==1)throw Error('DOWNLOAD_IDENTITY_AMBIGUOUS: multiple original blobs');
   const blob=state.blobs[0];return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Original video blob could not be read'));reader.readAsDataURL(blob);});
  },key);
  if(result){
   const bytes=Buffer.from(result.slice(result.indexOf(',')+1),'base64');
   if(bytes.length<12||bytes.length>100*1024*1024||bytes.toString('ascii',4,8)!=='ftyp')throw Error('DOWNLOAD_FAILED: original blob is not MP4');
   await writeFile(destination,bytes,{mode:0o600});
  }else await saveOriginalDownload(page.context(),file,destination);
 }finally{
  await page.evaluate(key=>{const bag=window as unknown as Record<string,{original:typeof URL.createObjectURL;wrapper:typeof URL.createObjectURL}>;const state=bag[key];if(state&&URL.createObjectURL===state.wrapper)URL.createObjectURL=state.original;delete bag[key];},key).catch(()=>undefined);
 }
}
