import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
import { validateFile, validateSignature } from '../shared/validation';
const modules=import.meta.glob('./**/*.{ts,js}');
const form={name:'اختبار محلي',address:'عنوان اختبار',phone:'07701234567',products:'عرض',prompt:'مشهد تجريبي',instructions:'',model:'Omni Flash',aspect:'9:16',duration:15,dialect:'العراقية'};
const owner={subject:'test-owner',issuer:'https://test.clerk.accounts.dev'};
const input={key:'test-request',form,clipCount:2,referenceIds:[],submit:true};
beforeEach(()=>{vi.stubEnv('OWNER_SUBJECT',owner.subject);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',owner.issuer);vi.stubEnv('CLIENT_ORIGINS','http://127.0.0.1:43130')});
describe('owner-only requests',()=>{
 it('rejects anonymous and a different user at every public data entry',async()=>{
  const t=convexTest(schema,modules);
  for(const user of [t,t.withIdentity({...owner,subject:'intruder'}),t.withIdentity({...owner,issuer:'https://other.clerk.accounts.dev'})]){
   expect(await user.query(api.access.allowed)).toBe(false);
   await expect(user.query(api.requests.list)).rejects.toThrow('المصرح');
   await expect(user.mutation(api.requests.save,input)).rejects.toThrow('المصرح');
   await expect(user.mutation(api.files.begin,{key:`image:${'a'.repeat(64)}`,kind:'image',name:'image.png',type:'image/png',size:8})).rejects.toThrow('المصرح');
  }
  expect((await t.fetch('/files?id=invalid')).status).toBe(401);
 });
 it('fails closed when owner configuration is missing',async()=>{vi.stubEnv('OWNER_SUBJECT','');const t=convexTest(schema,modules).withIdentity(owner);await expect(t.mutation(api.requests.save,input)).rejects.toThrow('المصرح');});
 it('keeps one queued request across repeated sends and preserves phone as text',async()=>{
  const t=convexTest(schema,modules).withIdentity(owner);
  const a=await t.mutation(api.requests.save,input);const b=await t.mutation(api.requests.save,{...input,form:{...form,name:'changed'}});
  expect(a).toBe(b);const rows=await t.query(api.requests.list);expect(rows).toHaveLength(1);expect(rows[0].form.phone).toBe('07701234567');expect(rows[0].form.name).toBe(form.name);expect(rows[0].status).toBe('بانتظار التشغيل');expect(rows[0].clipCount).toBe(2);expect(rows[0].actualPoints).toBeUndefined();
 });
 it('imports a draft idempotently, then queues the same record',async()=>{const t=convexTest(schema,modules).withIdentity(owner);const a=await t.mutation(api.requests.save,{...input,submit:false});await t.mutation(api.requests.save,{...input,submit:false});const b=await t.mutation(api.requests.save,input);expect(a).toBe(b);expect(await t.query(api.requests.list)).toHaveLength(1);});
 it('rejects invalid fields and unknown image IDs',async()=>{const t=convexTest(schema,modules).withIdentity(owner);await expect(t.mutation(api.requests.save,{...input,form:{...form,prompt:'  '}})).rejects.toThrow();await expect(t.mutation(api.requests.save,{...input,clipCount:0})).rejects.toThrow();const id=await t.run(ctx=>ctx.storage.store(new Blob([new Uint8Array([1])],{type:'image/png'})));await expect(t.mutation(api.requests.save,{...input,logoId:id})).rejects.toThrow('الملف');});
 it('verifies uploaded image bytes and serves it only to the owner',async()=>{
  const t=convexTest(schema,modules),user=t.withIdentity(owner);const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');const key=`image:${hash}`;
  await user.mutation(api.files.begin,{key,kind:'image',name:'image.png',type:'image/png',size:bytes.length});const storageId=await t.run(ctx=>ctx.storage.store(new Blob([bytes],{type:'image/png'})));
  await expect(t.action(api.files.finish,{key,storageId})).rejects.toThrow('المصرح');await user.action(api.files.finish,{key,storageId});
  const result=await user.mutation(api.files.begin,{key,kind:'image',name:'image.png',type:'image/png',size:bytes.length});expect(result.storageId).toBe(storageId);
  expect((await user.fetch(`/files?id=${storageId}`)).status).toBe(200);expect((await t.fetch(`/files?id=${storageId}`)).status).toBe(401);
 });
 it('validates video results and rejects unauthorized runner/manual changes',async()=>{
  const t=convexTest(schema,modules),user=t.withIdentity(owner);const requestId=await user.mutation(api.requests.save,input);const storageId=await t.run(ctx=>ctx.storage.store(new Blob(['fake'],{type:'video/mp4'})));
  await expect(t.mutation(api.requests.attachManualVideo,{requestId,storageId})).rejects.toThrow('المصرح');await expect(t.mutation(api.requests.updateResult,{requestId,status:'قيد التوليد'})).rejects.toThrow('المصرح');await expect(user.mutation(api.requests.attachManualVideo,{requestId,storageId})).rejects.toThrow('الملف');await expect(user.mutation(api.requests.updateResult,{requestId,status:'مكتمل'})).rejects.toThrow('دون ملف');await user.mutation(api.requests.updateResult,{requestId,status:'يحتاج تسجيل دخول',externalTaskId:'job-1',error:'تحتاج جلسة تشغيل',estimatedPoints:10});const row=(await user.query(api.requests.list))[0];expect(row.externalTaskId).toBe('job-1');expect(row.estimatedPoints).toBe(10);expect(row.actualPoints).toBeUndefined();
 });
 it('rejects spoofed MIME and oversized uploads',()=>{expect(()=>validateSignature(new Uint8Array([1,2,3]),'image/png')).toThrow();expect(()=>validateFile('video/mp4',101*1024*1024,'video')).toThrow();expect(()=>validateFile('image/svg+xml',50,'image')).toThrow();});
});

