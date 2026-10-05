import {it,expect} from 'vitest';
import {humanChallenge} from './flow-human';
it('separates a real human challenge from the account privacy notice',()=>{expect(humanChallenge('هذا الموقع الإلكتروني محميّ بخدمة reCAPTCHA، وتنطبق عليه سياسة الخصوصية وبنود الخدمة من Google.')).toBe(false);expect(humanChallenge('This site is protected by reCAPTCHA')).toBe(false);expect(humanChallenge('Verify you are human')).toBe(true);expect(humanChallenge('Complete the CAPTCHA')).toBe(true);expect(humanChallenge('تحقق بشري')).toBe(true);expect(humanChallenge('إنشاء أفاتار ترقية')).toBe(false);});
