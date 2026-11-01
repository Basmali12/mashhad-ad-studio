# المهمة 04 — مسار FLUX.2 [klein] 4B الحقيقي، محضّر محلياً

## النطاق والحد الفاصل

التاريخ: 31 أكتوبر 2026. أضيف مسار Python فعلي لتحميل النموذج والاستدلال مستقبلاً، وتعريف Modal قابل لإعادة الاستخدام، وتجهيز CPU صريح ومقيد. لم نثبت مكتبات inference على الجهاز، ولم نبن صورة سحابية أو ننشر التطبيق أو ننزل أوزاناً أو نشغل GPU.

الفحوص المحلية تستخدم صوراً ومكونات صغيرة اصطناعية وPipeline محقوناً، إضافة إلى تسجيل تعريفات SDK المثبت دون hydration أو اتصال. لا تثبت جودة مخرجات FLUX أو توافق الصورة المبنية فعلياً مع CUDA.

## النسخة والمصدر

- [النموذج الرسمي الأصلي](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B): `black-forest-labs/FLUX.2-klein-4B`، النسخة 4B المقطرة، لا 9B ولا Base ولا quantization.
- مراجعة الأوزان: `e7b7dc27f91deacad38e78976d1f2b499d76a294`.
- [الكود المرجعي للناشر](https://github.com/black-forest-labs/flux2/tree/50fe5162777813d869182b139e83b10743caef15): `50fe5162777813d869182b139e83b10743caef15`، تم التحقق من وجود commit بواجهة GitHub الوصفية.
- [بطاقة المراجعة المثبتة](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/e7b7dc27f91deacad38e78976d1f2b499d76a294/README.md) تصرح بدعم توليد الصور وتعديلها والمراجع المتعددة، وترخيص Apache 2.0 لهذه النسخة.

التنفيذ يستخدم مسار الناشر المدعوم `Flux2KleinPipeline` من Diffusers، ولا يستنسخ مستودع الناشر داخل الصورة أو يحمّل نموذجاً آخر ضمنياً.

## Manifest بلا نسخة أوزان مكررة

`engine/flux/model-manifest.json` يحتوي 17 ملفاً مطلوباً، بمجموع **15,975,692,643 بايت = نحو 14.8785GiB**. القائمة تشمل Transformer وText Encoder بشطريه وVAE وScheduler وTokenizer fast وملفات إعدادها و`LICENSE.md`.

لم تدخل نسخة checkpoint الجذرية `flux-2-klein-4b.safetensors` المكررة أو صور وثائق النموذج. لا نعتمد مجموع المستودع بالكامل كحجم التنزيل المطلوب.

لم ننزل `tokenizer.json` الكبير أو أي safetensors. أخذت SHA256 والأحجام من [بيانات Hugging Face الرسمية للمراجعة](https://huggingface.co/api/models/black-forest-labs/FLUX.2-klein-4B/revision/e7b7dc27f91deacad38e78976d1f2b499d76a294?blobs=true). ملفات الإعداد والترخيص الصغيرة فقط، كل منها أقل من 100KB، قرئت وحسبت بصماتها مع التحقق من Git blob ID.

استبعد `tokenizer/merges.txt` و`tokenizer/vocab.json` الاختياريان لمسار tokenizer البطيء؛ المسار يحمل `Qwen2TokenizerFast` صراحة من `tokenizer.json` المحلي الكامل، ولا يرجع إلى tokenizer بطيء أو شبكة عند غيابه. يجب إثبات هذا التكوين بحاوية فعلية قبل اعتماده للإنتاج.

## الصورة والاعتماديات

`image.py` لا يستورد Modal عند استيراده. `build_model_image()` و`build_preparation_image()` ينشئان تعريفات محلية فقط. Image layers لا تحتوي job IDs أو كلمات مرور أو prompts أو seeds أو بيانات الحسابات. إعدادات تعريف المحرك تُرسل في environment الخاص بالدالة، لا في طبقة بناء الصورة.

الاعتماديات المباشرة مثبتة في `requirements-gpu.lock`: Python 3.12، PyTorch `2.9.1+cu128` من [فهرس PyTorch الرسمي](https://download.pytorch.org/whl/cu128)، Diffusers `0.42.1`، Transformers `5.22.1`، Accelerate `1.15.0`، Safetensors `0.8.0`، Pillow `13.0.0`، Hugging Face Hub `2.4.0`، Tokenizers `0.23.1`، NumPy `2.2.6`، Modal SDK `1.6.2`.

تمت قراءة metadata للمتطلبات المباشرة؛ لم ننفذ تثبيتاً أو resolver كاملاً لكل wheel/transitive dependency. اسم `.lock` هنا يعني تثبيت الإصدارات المباشرة، وليس ادعاء امتلاك lock كاملاً ببصمات كل الحزم المتعدية. بناء صورة حقيقية وفحص استيراد المكتبات ينتظر موافقة منفصلة.

[إصدار Diffusers الرسمي](https://github.com/huggingface/diffusers/releases/tag/v0.42.1) هو الإصدار المثبت، وقد قرئ [مصدر Pipeline من هذا الإصدار](https://github.com/huggingface/diffusers/blob/v0.42.1/src/diffusers/pipelines/flux2/pipeline_flux2_klein.py) للتحقق من وجود `Flux2KleinPipeline` ودعم image list وcallbacks. توضح [وثائق PyTorch](https://pytorch.org/blog/pytorch-2-7/) دعم Blackwell وCUDA 12.8 ابتداء من سلسلة 2.7؛ اختيار wheel أحدث من نفس عائلة CUDA لا يغني عن تجربة الجهاز والـdriver فعلياً.

GPU inference يعمل بوضع offline و`local_files_only=True`. لا تحميل ضمن `prepare()` أو `generate()`، ولا FP8 ولا torch.compile أو تبديل تلقائي للموديل/المعالج. الإعداد: BF16 الأصلي، أربع خطوات، guidance 1.0 وCPU offload وفق مثال الناشر.

لا نعلن RAM/VRAM دنيا مجرّبة لدينا. أرقام الناشر مشروطة بالتكوين؛ RTX PRO 6000 وL40S هما الخياران المسموحان في تعريف التطبيق، لكن نجاح الجيل بهذه الصورة والتكوين لم يثبت على أي منهما في هذه المهمة.

## العقود

- `runtime.py`: `FluxKleinRuntime(model_dir, pipeline_factory=..., image_loader=..., generator_factory=...)`؛ الدوال `prepare()` و`generate(request, output_dir, on_progress)`.
- request: `prompt`, `width`, `height`, `seed`, `mode`؛ و`reference_images` كقائمة bytes، لا URLs أو مسارات يختارها العميل. الأنماط `text_to_image`, `edit`, `multi_reference`، مع حد تطبيقي أربعة مراجع. هذا الحد احترازي للتطبيق لا أقصى قدرة مثبتة للنموذج.
- الأبعاد محدودة ومتوافقة مع مضاعفات 16؛ ترفض النتائج التي تغير الأبعاد المطلوبة. يحفظ PNG الأصلي دون قص أو تصغير بعد التوليد، مع seed وبصمة الصورة وإعداداتها وأزمنة التحميل والاستدلال وذروة ذاكرة PyTorch حين تقاس فعلياً.
- `modal_app.py`: `build_flux_app(config, sdk=None)` يعيد `(app, remoteClass)`، واسم الـclass `KleinEngine` ومعاملها `runtime_id`.
- GPU RPCs: `start(scope)` و`generate(request, scope)`. `scope={engineId,accountId,runId,requestId?}` ويجب مطابقة التعريف والحساب والجلسة؛ generate يتطلب requestId ثابتاً.
- `prepare_models(request)` دالة CPU. تتطلب `paidApproved:true` و`modelRevision` و`manifestFingerprint` ومطابقة `modelVolume/resultsVolume/weightPath/scope` للتعريف المنشور.

كلتا الدالتين والـclass معرفة في النطاق العام، لا كدوال متداخلة serialized قد تنقل bytecode بين Python 3.13 و3.12. ثبت تسجيلها باستخدام SDK الحقيقي محلياً دون شبكة.

## التخزين والتجهيز والاستكمال

Volume الأوزان يركب read-only على GPU في `/models`، وVolume نتائج مستقل موجود مسبقاً يركب في `/results`. تجهيز CPU وحده يملك تركيب الأوزان القابل للكتابة. كلاهما `create_if_missing=False` داخل مصنع التطبيق.

`deploy.py:deploy_flux_app(packet, client=...)` مسار bootstrap منفصل لا ينفذ عند الاستيراد: لا ينشئ Volume أو يبني أو ينشر إلا بعد الموافقة الصريحة وبصمة manifest ونطاق صحيحين. يرصد تطبيقاً موجوداً باسم التعريف ولا يستبدل تطبيقاً مجهول الملكية؛ يستخدم attestation في `deployment.json`. لا يستدعى هذا المسار من start أو generate كحل خفي. البناء والتخزين والشبكة تكاليف إضافية غير معلومة يجب ذكرها في عرض الموافقة.

التجهيز يتحقق SHA256 لكل ملف موجود وينزل الناقص أو التالف فقط من المستودع والمراجعة المثبتين داخل CPU سحابي. لا يستخدم قرص HostHatch لحفظ الأوزان. يستخدم التنزيل العام `token=False` ولا ينسخ Secrets الحساب القديم. `READY.json` لا يكتب إلا بعد تطابق جميع الملفات وإتمام commit. تنزع علامة جاهزية سابقة قبل إصلاح ملف تالف؛ الفشل لا يترك علامة جاهزية كاذبة.

سجل التجهيز `preparations/<operationId>.json` يعرض bytes الملفات المكتملة المتحققة، لا نسبة تنزيل داخل الملف غير مقاسة. مطالبة exclusive لنفس operationId تمنع إعادة التنزيل تلقائياً عند الغموض أو الفشل.

generate يحفظ PNG وreceipt في `runs/<runId>/results/<requestId>.png/json`، وتقدم الأربع خطوات الفعلي في `runs/<runId>/progress/<requestId>.json`. نفس requestId وبصمته يعيد النتيجة المحفوظة، ولا يعيد الاستدلال. تغير الطلب لنفس المعرف مرفوض. metadata/status يقرأ هذه الملفات من control plane؛ استدعاء GPU للمعاينة أو status ليس فحصاً مجانياً.

GPU startup يحتفظ بالـpipeline داخل نفس instance ويعيد استخدامه بين الصور؛ لا يعاد تحميله في كل `generate()`. لا نضمن بقاء نفس الحاوية بعد توقفها أو بعد idle timeout. `min_containers=0`, `max_containers=1`, `retries=0`, وخمول افتراضي 1200 ثانية. لا توجد حلقة keepalive.

إيقاف الموارد وتأكيده من مسؤولية النقل/المراقبة باستخدام معرّفات التطبيق والجلسة الصحيحة. انتهاء RPC وحده أو وجود PNG لا يثبت توقف GPU. لا يدّعي هذا الملف اختبار سلوك الإيقاف السحابي فعلياً.

## الفحص المنفذ والمنتظر

نفذ `python -m unittest discover -s services/film-engine/tests -p test_flux_runtime.py -v`: فحوص اصطناعية للنسخة والإعدادات، T2I/edit/multi-reference، عدم إعادة بناء Pipeline، توقيت callbacks، رفض الطلبات والمراجع والمسارات غير الآمنة، جاهزية الملفات، تجاوز الصحيح منها، عدم إعادة المحاولة، وتسجيل تعريفات Modal في النطاق العام دون hydration.

بانتظار الموافقة: بناء الصورة فعلياً، resolve متكامل للاعتماديات، تنزيل الأوزان إلى الحساب المقصود، الاستدلال على GPU، قياس RAM/VRAM والجودة والسرعة والكلفة، وتجربة الإلغاء والإيقاف واستعادة النتيجة بعد انقطاع الاتصال. لا تستخدم نتائج mocks كإثبات نجاح هذه الخطوات.
