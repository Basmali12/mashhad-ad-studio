# المهمة 02 — مصادر كتالوج المحركات غير المفعّل

تاريخ قراءة المصادر: 31 أكتوبر 2026. تمت قراءة وثائق وصفية فقط؛ لا تثبيت مكتبات أو تنزيل أوزان أو إنشاء موارد أو GPU أو نشر. هذه القائمة لا تعد تفعيل أي نموذج أو اعتماده للإنتاج.

## المصادر الرسمية

| المعرّف المحلي | النموذج/الاختيار | المصدر الرسمي وما يثبته |
| --- | --- | --- |
| `flux2-klein-4b` | FLUX.2 [klein] 4B | [بطاقة Black Forest Labs](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B): توليد صور وتعديل بمرجع، وترخيص Apache 2.0 لهذه النسخة. |
| `qwen-image-edit-2511` | Qwen-Image-Edit-2511 | [بطاقة Qwen](https://huggingface.co/Qwen/Qwen-Image-Edit-2511): نسخة تعديل الصور 2511 ومسار `QwenImageEditPlusPipeline` وترخيص Apache 2.0. |
| `wan22-i2v-a14b` | Wan2.2-I2V-A14B | [بطاقة Wan-AI](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B): صورة إلى فيديو، أمثلة 480p و720p، وترخيص Apache 2.0. ليست نسخة TI2V-5B. |
| `hunyuanvideo15` | HunyuanVideo-1.5 | [بطاقة Tencent](https://huggingface.co/tencent/HunyuanVideo-1.5) و[المستودع الرسمي](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5): عائلة 1.5 ذات checkpoints ودقات متعددة؛ لم يُختر checkpoint واحد بعد. |
| `habibi-msa` | Habibi-TTS / MSA | [بطاقة SWivid](https://huggingface.co/SWivid/Habibi-TTS) و[الكود الرسمي](https://github.com/SWivid/Habibi-TTS): وجود معرف الفصحى MSA ومسار النسخ المتخصصة. |
| `habibi-irq` | Habibi-TTS / IRQ | المصدران السابقان يذكران معرف العراقية IRQ والنسخ المتخصصة. |
| `habibi-egy` | Habibi-TTS / EGY | المصدران السابقان يذكران معرف المصرية EGY والنسخ المتخصصة. |
| `audar-tts-v1-flash` | Audar-TTS-V1-Flash | [بطاقة AudarAI](https://huggingface.co/audarai/Audar-TTS-V1-Flash) و[المستودع الرسمي](https://github.com/AudarAI/Audar-TTS-V1): TTS، خيارات Transformers وGGUF، وcodec صوتي مرافق. |

النسخة `version` هي اسم إصدار الناشر فقط. لم نختلق رقم إصدار لـHabibi، ولذلك قيمته `null`. جميع `revision` تساوي `null` إلى أن يتم اختيار commit وملفات محددة وتدقيق البصمات في مهمة تجهيز مصرح بها لاحقاً.

## الموارد: المجهول يبقى مجهولاً

جميع `recommendedCPU` و`recommendedRAMGiB` و`recommendedVRAMGiB` في الكتالوج تساوي `null` وحالة الموارد `unverified`. لا تستخدم هذه القيم لتشغيل أو تسعير أو قبول تجهيز تلقائي.

- [بطاقة FLUX](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) تذكر نحو 13GB VRAM، بينما [README الرسمي](https://github.com/black-forest-labs/flux2) يذكر نحو 8GB لعائلة Klein 4B في سياق آخر. لا نختار أحد الرقمين كسقف أو توصية داخل تطبيقنا دون تحديد precision وoffload والدقة ومرمز النص وقياس فعلي.
- [مثال Wan الرسمي](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) يذكر 80GB VRAM لأمر single-GPU بدقة 720p مع offload وتحويل dtype. هذا شرط المثال المنشور، وليس قياساً على RTX لدينا أو وعداً بنجاح كل مدة.
- [متطلبات Hunyuan الرسمية](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5) تذكر 14GB مع offloading. لا تنطبق تلقائياً على كل checkpoint ودقة ومدة أو مسار attention، ولا تعني أن RAM المطلوبة معروفة.
- لم نعتمد مقادير CPU أو RAM أو VRAM لـQwen أو Habibi أو Audar. حجم أوزان GGUF أو عدد parameters لا يساوي ذروة الذاكرة الكاملة مع codec/encoders والتزامن.

الأرقام أعلاه بصيغة الناشر GB؛ لم نحولها افتراضياً إلى GiB ولم نضعها في حقول الموارد المعتمدة. قراءة وثيقة رسمية تحقق هوية المصدر، لا تحقق تشغيل النموذج على نظامنا.

## تنبيهات اختيار النسخة قبل التثبيت

- [بطاقة Habibi الرسمية](https://huggingface.co/SWivid/Habibi-TTS) تفرق بين المتخصصة MSA/IRQ/EGY (Apache 2.0 بحسب البطاقة) وبين Unified وSAU وUAE (CC-BY-NC-SA-4.0). لا يجوز استخدام Unified بدلاً منها افتراضياً ثم اعتبار الترخيص مطابقاً. يلزم تدقيق ترخيص ملفات النسخة المختارة قبل استخدامها التجاري.
- [Hunyuan](https://huggingface.co/tencent/HunyuanVideo-1.5) يستخدم ترخيص Tencent-Hunyuan الخاص؛ و[أوزان Audar Flash](https://huggingface.co/audarai/Audar-TTS-V1-Flash) تستخدم AudarAI Open License v1.0، لا ترخيص كود المستودع بديلاً عن ترخيص الأوزان. هذه ملاحظة فنية للتحقق المستقبلي وليست فتوى قانونية.
- وصف نماذج الفيديو في الكتالوج لا يثبت صوتاً مدمجاً أو lip sync. وجود نماذج TTS مستقلة لا يعني أننا شغلناها أو دمجناها مع الفيديو.
- المصدر الرسمي قد يقترح أمراً ينزل أوزاناً تلقائياً؛ لم ننفذ أي أوامر أمثلة أو `from_pretrained` أثناء هذه المهمة.

## حد التكامل المحلي

`shared/engine-catalog.ts` بيانات عامة ثابتة فقط، بدون Node أو طلبات شبكة أو أسرار. جميع الخيارات `enabled:false`؛ Backend وحده مسؤول لاحقاً عن إثبات التثبيت والجاهزية والموافقة على التكاليف.

خدمة Backend تستورد الوحدة المشتركة من `shared/`. أي تغليف أو نشر مستقبلي للخدمة يجب أن يضم هذه الوحدة في مسارها الصحيح؛ لا يكفي نسخ مجلد `services/film-engine` وحده. لم ننشر خدمة أو نغير إعدادات الإنتاج في المهمة 02.
