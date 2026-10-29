import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CustomerHeader,CustomerBottomNav} from './customer-header';
it('uses the generation tab and existing controls in production and preview, without legacy customer tabs',()=>{
 for(const preview of [false,true]){
  const html=renderToStaticMarkup(<><CustomerHeader page="schedule" onPage={()=>{}} preview={preview}/><CustomerBottomNav page="schedule" onPage={()=>{}}/></>);
  expect(html.match(/<button/g)).toHaveLength(5);expect(html).toContain('أيقونة مشهد');expect(html).toContain('mashhad-logo-128.webp');
  expect(html).toContain('توليد الفيديو');expect(html).toContain('ملفات الفيديو');expect(html).toContain('السيرفرات');expect(html).not.toContain('أفلام');expect(html).toContain('الجدول');expect(html).toContain('الإعدادات');
  for(const title of ['قائمة النشر','التقويم','النتائج','الحسابات'])expect(html).not.toContain(title);
  expect(html).not.toContain('رفع وجدولة الريلز');if(preview)expect(html).toContain('معاينة محلية');else expect(html).not.toContain('معاينة محلية');
  expect(html).not.toContain('تسجيل الخروج');expect(html).not.toContain('لوحة الإدارة');
 }
});
