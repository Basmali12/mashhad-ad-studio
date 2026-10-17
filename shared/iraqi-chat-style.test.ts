import {it,expect} from 'vitest';
import {iraqiChatReply} from './iraqi-chat-style';
it('normalizes observed dialect slips without changing code, links, names or negation',()=>{
 expect(iraqiChatReply('شكو بدك نبدأ؟ أنا معاك، لا تغير اسم علي 1998.','ناقشني')).toBe('شتريد نبدأ؟ أنا وياك، لا تغير اسم علي 1998.');
 expect(iraqiChatReply('يمكنك تستخدم `معاك` والرابط https://example.test/معاك','وضح')).toBe('تگدر تستخدم `معاك` والرابط https://example.test/معاك');
 expect(iraqiChatReply('رحمان وياك','وضح')).toBe('رحمان وياك');
});
it('preserves explicitly requested formal writing and translations',()=>{
 const formal='يمكنك الذهاب معي.';expect(iraqiChatReply(formal,'اكتبها بالفصحى')).toBe(formal);
 expect(iraqiChatReply('معاك','ترجم الكلمة')).toBe('معاك');
});
