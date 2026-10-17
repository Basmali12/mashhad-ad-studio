import {optimizeBannerImage} from './optimize-banner';
import {api} from '../../../convex/_generated/api';
import {publishingConnection} from '../../shared/api/publishing-session';
import {uploadBunnyWithTicket} from '../media/bunny-media';
import {validBannerFile,assertBannerDimensions} from '../../../shared/site-banner';
import {mediaSignature} from '../../../shared/media-signature';
export async function validateBannerImage(file:File){
 if(!validBannerFile(file.type,file.size)||!mediaSignature(file.type,new Uint8Array(await file.slice(0,32).arrayBuffer())))throw Error('اختَر صورة JPG أو PNG أو WebP حتى 2 MB.');
 let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('تعذر قراءة صورة الإعلان.');}
 try{assertBannerDimensions(bitmap.width,bitmap.height);}finally{bitmap.close();}
}
export async function uploadBannerImage(file:File,onProgress:(text:string)=>void){
 file=await optimizeBannerImage(file);
 await validateBannerImage(file);
 const ticket=await publishingConnection().client.mutation(api.reelsBanner.prepareUpload,{type:file.type,size:file.size});
 return uploadBunnyWithTicket(file,onProgress,ticket);
}
