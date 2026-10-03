# رابط مشهد

https://basmali12.github.io/mashhad-ad-studio/

الكود في فرع main، والواجهة المبنية في gh-pages، مع .nojekyll وbase نسبي. البناء المحلي: npm run build. لا تنشر محتويات المشروع كلها إلى فرع Pages؛ انقل dist فقط.

GitHub Actions رفض تشغيل البناء بسبب مشكلة فوترة الحساب؛ لذلك استُخدم نشر Pages التقليدي من gh-pages، دون شراء خدمة أو تعديل الفوترة. متغيرات Vite الثلاثة عامة ومضمنة في البناء؛ لا تحتوي أسرار Worker.

هذا رابط واجهة منشور متصل حاليًا بـConvex Development وClerk Development، وليس انتقالًا إلى بيئة Production. بيانات الطلبات والملفات لا تزال محمية بهوية المالك. جلسة الدخول والمسودات المحلية لكل نطاق منفصلة؛ سجّل الدخول بالمالك عند فتح الرابط الجديد. المسودات المحلية القديمة تبقى في المعاينة المحلية ويمكن نقلها إلى Convex هناك.

التوليد والمونتاج يحتاجان الكمبيوتر المحلي وnpm run worker:start. Pages لا يستضيف Chrome أو Worker. لا تنقل chrome-profile أو connection.secret أو ملفات الفيديو إلى GitHub. إعداد CLIENT_ORIGINS يحتفظ بالمعاينة المحلية ويشمل https://basmali12.github.io لملفات Convex المحمية.
