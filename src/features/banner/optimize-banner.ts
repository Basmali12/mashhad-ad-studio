import {assertBannerDimensions,validBannerFile} from '../../../shared/site-banner';
import {mediaSignature} from '../../../shared/media-signature';
export const BANNER_TARGET_BYTES=250*1024;
export async function optimizeBannerImage(file:File):Promise<File>{
 if(!validBannerFile(file.type,file.size)||!mediaSignature(file.type,new Uint8Array(await file.slice(0,32).arrayBuffer())))throw Error('اختَر صورة JPG أو PNG أو WebP حتى 2 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  assertBannerDimensions(bitmap.width,bitmap.height);
  let scale=Math.min(1,1600/bitmap.width,900/bitmap.height);
  if(file.type==='image/webp'&&scale===1&&file.size<=BANNER_TARGET_BYTES)return file;
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Error('تعذر ضغط صورة الإعلان.');
  let blob:Blob|null=null;
  for(let pass=0;pass<4;pass++){
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',pass===0?.82:.68));
   if(!blob||blob.type!=='image/webp')throw Error('المتصفح لا يدعم تحويل الإعلان إلى WebP.');
   if(blob.size<=BANNER_TARGET_BYTES)break;scale*=.8;
  }
  if(!blob||blob.size>BANNER_TARGET_BYTES)throw Error('الصورة تحتاج حجماً أصغر؛ اختَر صورة إعلان أبسط.');
  return new File([blob],'mashhad-banner.webp',{type:'image/webp',lastModified:Date.now()});
 }finally{bitmap.close();}
}
