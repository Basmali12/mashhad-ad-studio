import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {localStorageContext,privateStorageDirectory} from './bunny-local-store.ts';
// Disposable, newly created test asset only. Never use a customer asset or real publication IDs.
const {storage}=await localStorageContext(),subject='disposable-bunny-test-'+randomUUID();
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(bytes).digest('hex'),blob=new Blob([bytes],{type:'image/png'}),asset=await storage.upload(subject,blob,hash);
let blocked=false;try{await storage.removeAfterPublication(subject,asset,['fixture-channel'],[{targetId:'fixture-channel',status:'accepted'}],true);}catch{blocked=true;}
if(!blocked)throw Error('سمح الحذف قبل اكتمال الإيصال.');await storage.verify(subject,asset.path,hash,bytes.length);
// These receipts exercise the storage guard, not a real or claimed public post.
const receipts=[{targetId:'fixture-channel',status:'published'}];
await storage.removeAfterPublication(subject,asset,['fixture-channel'],receipts,true);let missing=false;try{await storage.read(subject,asset);}catch{missing=true;}if(!missing)throw Error('لم يتأكد حذف ملف الاختبار.');
const restored=await storage.upload(subject,blob,hash);await storage.verify(subject,restored.path,hash,bytes.length);
await storage.removeAfterPublication(subject,restored,['fixture-channel'],receipts,true);
await writeFile(join(privateStorageDirectory,'bunny-cleanup-probe.private.json'),JSON.stringify({at:new Date().toISOString(),disposableOnly:true,publishingReceipts:'simulated fixture, not real publication',blockedBeforeCompletion:blocked,realDeleteVerified:missing,realRestoreVerified:true,originalsUnaffected:true,receipts},null,2),{mode:0o600});
console.log(JSON.stringify({disposableOnly:true,blockedBeforeCompletion:blocked,realDeleteVerified:missing,realRestoreVerified:true,realPublicPost:false,originalsUnaffected:true}));
