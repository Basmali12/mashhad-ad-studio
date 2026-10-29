import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import FilmWorkspace from './FilmWorkspace';
it('customer film UI retains story/orientation/native audio and cannot import administrator controls',()=>{
 let calls=0;const html=renderToStaticMarkup(<FilmWorkspace request={async()=>{calls++;throw Error('NO_CLOUD');}}/>);
 expect(calls).toBe(0);expect(html).toContain('صناعة الأفلام');expect(html).toContain('القصة والحوار المطلوب');expect(html).toContain('الاتجاه');expect(html).toContain('720p ثابتة');expect(html).not.toContain('إدارة محركات الأفلام');expect(html).not.toContain('Token Secret');expect(html).not.toContain('IRAQ AI STUDIO');
 const source=readFileSync(new URL('./FilmWorkspace.tsx',import.meta.url),'utf8');expect(source).not.toContain("import('./FilmAdmin')");expect(source).not.toContain("tab==='admin'");
});
it('administrator entry is separate, and the gateway transport does not use a second studio session',()=>{
 const customer=readFileSync(new URL('../../app/customer-app.tsx',import.meta.url),'utf8'),admin=readFileSync(new URL('../admin/admin-page.tsx',import.meta.url),'utf8');
 expect(customer).toContain("import('../features/film/FilmEntry')");expect(customer).not.toContain('FilmAdminEntry');expect(admin).toContain("import('../film/FilmAdminEntry')");
 const transport=readFileSync(new URL('./filmTransport.ts',import.meta.url),'utf8');expect(transport).toContain("credentials:'omit'");expect(transport).not.toContain('/api/session');expect(transport).not.toContain('/auth/google');
});
