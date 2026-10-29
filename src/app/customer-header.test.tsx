import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CustomerHeader} from './customer-header';
it('uses the generation tab and existing controls in production and preview, without legacy customer tabs',()=>{
 for(const preview of [false,true]){
  const html=renderToStaticMarkup(<CustomerHeader page="schedule" onPage={()=>{}} preview={preview}/>);
  expect(html.match(/<button/g)).toHaveLength(4);expect(html).toContain('أيقونة مشهد');expect(html).toContain('mashhad-icon-192.png');
  expect(html).toContain('توليد الفيديو');expect(html).toContain('باقات الاشتراك');expect(html).toContain('الجدول · 30 يوم');expect(html).toContain('الإعدادات');
  for(const title of ['قائمة النشر','التقويم','النتائج','الحسابات'])expect(html).not.toContain(title);
  expect(html).not.toContain('تسجيل الخروج');expect(html).not.toContain('لوحة الإدارة');
 }
});
