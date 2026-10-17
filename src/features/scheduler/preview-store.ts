// Development preview only. Separate from customer collections and cloud credentials.
import type {PublishingCollection} from '../library/collection-store';
export interface PreviewUpload {id:string;file:File;acceptedAt:number}
export interface PreviewSettings {theme:'light'|'dark';plan:string;startsAt:number}
const name='mashhad-month-preview-v1';
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('files',{keyPath:'id'});r.result.createObjectStore('state');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function previewRead(){const db=await open();try{return await new Promise<{files:PreviewUpload[];collection?:PublishingCollection;settings?:PreviewSettings}>((resolve,reject)=>{const tx=db.transaction(['files','state'],'readonly'),files=tx.objectStore('files').getAll(),collection=tx.objectStore('state').get('collection'),settings=tx.objectStore('state').get('settings');tx.oncomplete=()=>resolve({files:files.result,collection:collection.result,settings:settings.result});tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export async function previewUpload(file:File,limit:number){
 if(file.type!=='video/mp4'||file.size<12||file.size>1024**3)throw Error('اختَر فيديو MP4 حتى 1 GB.');
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');const db=await open();
 try{return await new Promise<PreviewUpload>((resolve,reject)=>{const tx=db.transaction('files','readwrite'),store=tx.objectStore('files'),get=store.get(id);let saved:PreviewUpload,error:Error|undefined;get.onsuccess=()=>{if(get.result){saved=get.result;return;}const count=store.count();count.onsuccess=()=>{if(count.result>=limit){error=Error('انتهت حصة المعاينة المحلية.');tx.abort();return;}saved={id,file,acceptedAt:Date.now()};store.put(saved);};};tx.oncomplete=()=>resolve(saved);tx.onabort=tx.onerror=()=>reject(error??Error('تعذر حفظ الملف محلياً. تحقق من مساحة المتصفح.'));});}finally{db.close();}
}
async function write(key:string,value:unknown){const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,key);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('تعذر حفظ بيانات المعاينة محلياً.'));});}finally{db.close();}}
export const previewSaveSettings=(s:PreviewSettings)=>write('settings',s);
export async function previewSaveCollection(collection:PublishingCollection){const {files}=await previewRead();const videos=collection.libraryVideos?.map(v=>{const file=files.find(f=>f.id===v.bunnyAssetId)?.file;if(!file)throw Error('نسخة الفيديو غير موجودة في المعاينة.');return {...v,file};});const saved={...collection,libraryVideos:videos};await write('collection',saved);return saved;}
