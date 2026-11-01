import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import AdminVideoTest from './AdminVideoTest';
it('compact engine test is an inert quote form, with editable exact Arabic dialogue',()=>{
 let calls=0;const html=renderToStaticMarkup(<AdminVideoTest busy={true} onQuote={()=>calls++}/>);
 expect(calls).toBe(0);expect(html).toContain('rows="2"');expect(html).toContain('اختبار المحرك المحدد');expect(html).not.toContain('LTX');expect(html).toContain('<details>');expect(html).toContain('هلا بيكم');expect(html).toContain('disabled');expect(html).toContain('عرض الكلفة أولاً');
});
it('test dispatch stays disabled by default until a new engine is explicitly integrated',()=>{
 let calls=0;const html=renderToStaticMarkup(<AdminVideoTest busy={false} onQuote={()=>calls++}/>);
 expect(calls).toBe(0);expect(html).toContain('إنتاج الفيديو متوقف إلى حين إعداد محرك جديد.');
 expect(html).toContain('<button disabled="">');
});
