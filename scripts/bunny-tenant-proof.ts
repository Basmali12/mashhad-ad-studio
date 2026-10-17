import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {privateStorageDirectory,stagedAssets,localStorageContext} from './bunny-local-store.ts';
interface Evidence {users:{subject:string;name:string}[];collections:{subject:string;id:string;name:string}[]}
const config=JSON.parse(await readFile(join(privateStorageDirectory,'local-convex-04','.convex','local','default','config.json'),'utf8')) as {adminKey:string;ports:{cloud:number}};
if(config.ports.cloud!==43240)throw Error('الاختبار محصور بالمحرك المحلي.');const client=new ConvexHttpClient('http://127.0.0.1:43240'),admin=client as ConvexHttpClient&{setAdminAuth(key:string,identity?:{subject:string;issuer:string}):void};admin.setAdminAuth(config.adminKey);
const snapshot=await client.query(makeFunctionReference<'query'>('phase06Evidence:snapshot'),{}) as Evidence;
const first=snapshot.collections.find(c=>c.name==='اختبار الحساب الأول'),second=snapshot.collections.find(c=>c.name==='اختبار الحساب الثاني');if(!first||!second||first.subject===second.subject||!snapshot.users.some(u=>u.subject===first.subject)||!snapshot.users.some(u=>u.subject===second.subject))throw Error('لم يكتمل الاختبار بحسابين مختلفين.');
const env=await readFile(join(privateStorageDirectory,'convex-env.private.txt'),'utf8'),issuer=env.match(/^CLERK_JWT_ISSUER_DOMAIN=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');if(!issuer)throw Error('مصدر الهوية غير متاح.');
// Both members signed in through Clerk in the UI. Admin impersonation below tests authorization
// independently against those real registered subjects, never bypasses signature verification in the app.
for(const [own,other] of [[first,second],[second,first]]){admin.setAdminAuth(config.adminKey,{subject:own.subject,issuer});const rows=await client.query(makeFunctionReference<'query'>('publishingCollections:list'),{}) as {id:string}[];if(!rows.some(r=>r.id===own.id)||rows.some(r=>r.id===other.id))throw Error('اختلطت الحافظات.');if(await client.query(makeFunctionReference<'query'>('publishingCollections:get'),{id:other.id})!==null)throw Error('تسربت حافظة حساب آخر.');const profile=await client.query(makeFunctionReference<'query'>('publishingUsers:profile'),{}) as {role:string};if(profile.role!=='customer'&&profile.role!=='super-admin')throw Error('دور غير مطابق.');}
const files=await stagedAssets(),a=files.find(f=>f.subject===first.subject&&f.type==='video/mp4'),b=files.find(f=>f.subject===second.subject&&f.type==='video/mp4');if(!a||!b||a.sha256!==b.sha256||a.path===b.path)throw Error('لم يتأكد فصل الملفات ذات البصمة نفسها.');
const {storage}=await localStorageContext();let denied=false;try{await storage.read(first.subject,b);}catch{denied=true;}if(!denied)throw Error('تسربت نسخة حساب آخر.');
await storage.verify(first.subject,a.path,a.sha256,a.size);await storage.verify(second.subject,b.path,b.sha256,b.size);
await writeFile(join(privateStorageDirectory,'tenant-real-acceptance.private.json'),JSON.stringify({at:new Date().toISOString(),signedInRealClerkAccounts:2,realLocalConvex:true,authorizationChecks:'controlled impersonation of actual registered subjects',privateFilesVerified:2,equalHashSeparatePaths:true,crossAccountCollectionsDenied:true,crossAccountStorageDenied:denied,productionChanged:false,subjects:[first.subject,second.subject]},null,2),{mode:0o600});
console.log(JSON.stringify({signedInRealClerkAccounts:2,realLocalConvex:true,equalHashSeparatePaths:true,crossAccountCollectionsDenied:true,crossAccountStorageDenied:denied,productionChanged:false}));
