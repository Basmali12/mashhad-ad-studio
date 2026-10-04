export { statuses } from '../shared/validation';
export type Status = import('../shared/validation').RequestStatus;
export interface AdForm { name: string; address: string; phone: string; products: string; prompt: string; instructions: string; model: string; aspect: string; duration: number; dialect: string; continuationPrompts?: string[] }
export interface Draft { id: string; createdAt: string; status: Status; form: AdForm; logo: File | null; logoOriginal?: File | null; references: File[]; clipCount?: number; updatedAt?: string }
export interface DraftRepository { list(): Promise<Draft[]>; save(draft: Draft): Promise<void> }
function database(): Promise<IDBDatabase> { return new Promise((resolve,reject)=>{ const request=indexedDB.open('personal-ad-studio',1); request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'}); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); }); }
export const draftRepository: DraftRepository = {
 async list(){const db=await database();try{return await new Promise<Draft[]>((resolve,reject)=>{const tx=db.transaction('drafts','readonly');const request=tx.objectStore('drafts').getAll();tx.oncomplete=()=>resolve((request.result as Draft[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}},
 async save(draft){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(draft);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
};
