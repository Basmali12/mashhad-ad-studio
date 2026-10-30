import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import AdminVideoTest from './AdminVideoTest';
it('compact native-audio test is an inert quote form, with editable exact Arabic dialogue',()=>{
 let calls=0;const html=renderToStaticMarkup(<AdminVideoTest busy={true} onQuote={()=>calls++}/>);
 expect(calls).toBe(0);expect(html).toContain('rows="2"');expect(html).toContain('10');expect(html).toContain('صوت LTX الأصلي');expect(html).toContain('<details>');expect(html).toContain('هلا بيكم');expect(html).toContain('disabled');expect(html).toContain('عرض الكلفة أولاً');
});
