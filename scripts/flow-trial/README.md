# تجربة حساب Flow الخاص — المالك فقط

الرابط: https://scan.iraqaistudio.com/flow-trial/

المالك يسجّل بحساب مشهد الموجود عبر Clerk. الخادم يرسل JWT الجلسة الافتراضية إلى استعلام `access:allowed` الموجود؛ لا تُفتح الشاشة إلا إذا عاد `true`. إعداد مشهد الحالي يضيف `aud=convex` إلى الجلسة، ولا يحتاج قالب JWT منفصلًا بهذا الاسم. إعداد الهوية يحتوي المفتاح العام وعنوان Convex فقط، ولا يحتوي App Secret أو كلمة Google أو مفتاح Convex إداري. بعد فتح الشاشة، تسجيل Google والتحقق يدويان داخل المتصفح البعيد.

التجربة مستقلة عن واجهة مشهد العامة وعن صف التوليد والعامل الحالي. لا توجد أتمتة توليد أو قراءة رصيد أو ربط محفظة بهذه الجلسة بعد. نجاح تسجيل Google واستمرار حساب Flow يحتاج اختبارًا يدويًا؛ تشغيل Chrome ونجاح بروتوكول الشاشة وحدهما لا يثبتان قبول Google الدخول.

## حدود العزل

- مستخدم نظام `mashhad-trial`، ملف شخصي في `/var/lib/mashhad-flow-trial/chrome-profile` بصلاحيات خاصة، شاشة `:100`.
- VNC `5902` وWebSocket `6081` وبوابة `43136` تستمع على loopback فقط. Caddy يقدم HTTPS بالمسار الخاص ويحافظ على مسار الخدمة السابقة.
- بوابة HTTP وWebSocket تشترطان جلسة المالك. الكوكي HttpOnly/Secure/SameSite=Strict، صالح لثماني ساعات. قفل الشاشة يغلق الاتصالات الفعالة. Origin يُفحص في POST وWebSocket. محاولات الدخول الفاشلة محدودة.
- الخدمات مفعلة عند الإقلاع. لا تحتاج بقاء حاسوب المالك مفتوحًا. تسجيل خروج Google أو إبطال الجلسة من المزود قد يتطلب دخولًا جديدًا.
- Browser password saving disabled in initial profile preferences. لا توجد جلسة Google منسوخة من الجهاز أو من العامل الحالي، ولا يوجد CAPTCHA solver أو stealth أو تعطيل sandbox.
- تشغيل حساب واحد تجريبي فقط؛ ليس نظام جلسات متعدد الزبائن.

## التحقق

`node --test scripts/flow-trial/server.check.mjs`

على VPS: `node /tmp/mashhad-flow-trial/check-live.mjs` يستخدم بوابة loopback مؤقتة وبيانات اختبار عشوائية، ويتحقق من HTML/modules الحقيقيين وWebSocket/RFB ورفض غير المصادق وقفل الجلسة. بيانات الاختبار تُحذف في finally. لا يدخل إلى Google ولا يولد فيديو.

## الإيقاف

`systemctl stop mashhad-flow-trial-{gateway,novnc,viewer,chrome,display}`

يبقي ملف Google الخاص محفوظًا. لا يوقف `mashhad-worker` أو `mashhad-chrome`. لإزالة مسار التجربة من Caddy، راجع الفرق الحالي أولًا ثم أعد كتلة `scan.iraqaistudio.com` القديمة من النسخة `/etc/caddy/Caddyfile.before-flow-trial`، وتحقق بـ `caddy validate` قبل إعادة تحميل Caddy؛ لا تستبدل تغييرات لاحقة كاملة بالنسخة القديمة.


## ��� ������ ��������

`ownerFlow` ����� ����� ������� ������ ������ ��� ��� ����� `OWNER_PERSONAL_FLOW_ENABLED`. �� ������ ������. ������ ����� CDP 9432 ���� ������� ����� ������ ��� ���� ������ ��� ����� ������� �����. ������� ������� ���� ������ ���� ��� 9431.

�������� ������: `OWNER_PERSONAL_FLOW_FREE_POINTS_ENABLED` ���� false� ����� �� ���� ������. �� ����� Chrome ���� 1500M ��� ���� OOM ����� ��� ��������. �� ���� ����� ����� ��� �����. ��� ����� �����ߺ ����� ���� ������� ����� ������� �������.
