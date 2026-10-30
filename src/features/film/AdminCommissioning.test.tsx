import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import AdminCommissioning from './AdminCommissioning';
it('opening commissioning only offers account selection and never starts paid setup or a test',()=>{
 let calls=0;const html=renderToStaticMarkup(<AdminCommissioning request={async()=>{calls++;throw Error('PAID_CALL_FORBIDDEN');}} accounts={[{id:'account',label:'نور',weightsReady:false}]} onRefresh={async()=>{calls++;}}/>);
 expect(calls).toBe(0);expect(html).toContain('نور');expect(html).toContain('تجهيز الأوزان');expect(html).not.toContain('<video');expect(html).not.toContain('اعتماد الاختبار ونشر');
});
