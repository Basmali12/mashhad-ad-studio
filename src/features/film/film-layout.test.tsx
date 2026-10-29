import FilmGeneration,{elapsedLabel} from './FilmGeneration';
import type {FilmProject} from '../../../shared/film-contracts';
import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import FilmWorkspace from './FilmWorkspace';
it('customer film UI retains story/orientation/native audio and cannot import administrator controls',()=>{
 let calls=0;const html=renderToStaticMarkup(<FilmWorkspace request={async()=>{calls++;throw Error('NO_CLOUD');}}/>);
 expect(calls).toBe(0);expect(html).toContain('صناعة الأفلام');expect(html).toContain('رسالتك للمخرج');expect(html).toContain('إعدادات وإرفاق صورة');expect(html).not.toContain('المدة بالثواني');expect(html).not.toContain('إعداد التقرير');expect(html).not.toContain('اسم الفيلم');expect(html).not.toContain('إدارة محركات الأفلام');expect(html).not.toContain('Token Secret');expect(html).not.toContain('IRAQ AI STUDIO');
 const source=readFileSync(new URL('./FilmWorkspace.tsx',import.meta.url),'utf8');expect(source).not.toContain("import('./FilmAdmin')");expect(source).not.toContain("tab==='admin'");
});
it('administrator entry is separate, and the gateway transport does not use a second studio session',()=>{
 const customer=readFileSync(new URL('../../app/customer-app.tsx',import.meta.url),'utf8'),admin=readFileSync(new URL('../admin/admin-page.tsx',import.meta.url),'utf8');
 expect(customer).toContain("import('../features/film/FilmEntry')");expect(customer).not.toContain('FilmAdminEntry');expect(admin).toContain("import('../film/FilmAdminEntry')");
 const transport=readFileSync(new URL('./filmTransport.ts',import.meta.url),'utf8');expect(transport).toContain("credentials:'omit'");expect(transport).not.toContain('/api/session');expect(transport).not.toContain('/auth/google');
});

it('generation clock distinguishes elapsed time from requested duration and stops visual activity after completion',()=>{
 expect(elapsedLabel(59)).toBe('59 ثانية');expect(elapsedLabel(70)).toBe('1 دقيقة و10 ثانية');expect(elapsedLabel(130)).toBe('2 دقيقة و10 ثانية');
 const p={id:'p',name:'film',story:'test',messages:[],seconds:20,orientation:'portrait',reference:null,state:'completed',textPending:false,textUncertain:false,textCostPolicy:'administrator_funded_separate_from_gpu_wallet',planningCompletedScenes:2,merge:null,scenes:[],error:null,launch:{state:'completed',approvedAt:1000,finishedAt:71000}} as const;
 const html=renderToStaticMarkup(<FilmGeneration request={async()=>{throw Error('NO_CLOUD');}} project={p as unknown as FilmProject} rental={null} onBack={()=>{}} onStop={()=>{}} busy={false}/>);
 expect(html).toContain('1 دقيقة و10 ثانية');expect(html).toContain('20');expect(html).not.toContain('is-active');expect(html).not.toContain('<progress');
});
