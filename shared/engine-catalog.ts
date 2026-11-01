/**
 * Public, model-neutral descriptors only. Importing this file performs no I/O,
 * installation, provider request or resource allocation. An official model page
 * is not proof that an engine is installed, licensed for every use, or runnable.
 */
export type EngineModelKind = 'image' | 'image_edit' | 'video' | 'audio';
export type EngineModelSourceVerification = 'official_verified' | 'unverified';

export interface EngineModelPreset {
  readonly id: string;
  readonly name: string;
  /** Publisher release label, not a pinned repository commit. */
  readonly version: string | null;
  readonly kind: EngineModelKind;
  readonly variant: string | null;
  readonly enabled: false;
  readonly sourceURL: string | null;
  readonly sourceVerification: EngineModelSourceVerification;
  /** Pin an approved immutable revision before any future installation. */
  readonly revision: string | null;
  readonly runtimeProfile?: {gpu:string;cpu:number;ramGiB:number;minVramGiB:number;version:string|null;verified?:boolean};
  readonly resources: {
    readonly recommendedCPU: number | null;
    readonly recommendedRAMGiB: number | null;
    readonly recommendedVRAMGiB: number | null;
    readonly verification: 'unverified';
    readonly note: string;
  };
}

const unverifiedResources = (note: string): EngineModelPreset['resources'] => Object.freeze({
  recommendedCPU: null,
  recommendedRAMGiB: null,
  recommendedVRAMGiB: null,
  verification: 'unverified',
  note,
});

const presets = [
  {
    id: 'flux2-klein-4b',
    name: 'FLUX.2 [klein] 4B',
    version: '4B',
    kind: 'image',
    variant: '4B distilled',
    enabled: false,
    sourceURL: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4B',
    sourceVerification: 'official_verified',
    revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    resources: unverifiedResources('توليد صور وتعديلها؛ الموارد تعتمد الدقة وصيغة الأوزان ولم تُقَس في نظامنا.'),
  },
  {
    id: 'qwen-image-edit-2511',
    name: 'Qwen-Image-Edit-2511',
    version: '2511',
    kind: 'image_edit',
    variant: null,
    enabled: false,
    sourceURL: 'https://huggingface.co/Qwen/Qwen-Image-Edit-2511',
    sourceVerification: 'official_verified',
    revision: '6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9',
    resources: unverifiedResources('تعديل صور؛ لم نعتمد بعد تهيئة ذاكرة أو دقة أو صيغة تحميل محددة.'),
  },
  {
    id: 'wan22-i2v-a14b',
    name: 'Wan2.2-I2V-A14B',
    version: '2.2',
    kind: 'video',
    variant: 'I2V-A14B',
    enabled: false,
    sourceURL: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B',
    sourceVerification: 'official_verified',
    revision: '596658fd9ca6b7b71d5057529bbf319ecbc61d74',
    resources: unverifiedResources('صورة إلى فيديو؛ مثال الناشر للذاكرة مشروط بإعدادات محددة ولا يثبت ملاءمة أي GPU لدينا.'),
  },
  {
    id: 'hunyuanvideo15',
    name: 'HunyuanVideo-1.5',
    version: '1.5',
    kind: 'video',
    variant: null,
    enabled: false,
    sourceURL: 'https://huggingface.co/tencent/HunyuanVideo-1.5',
    sourceVerification: 'official_verified',
    revision: '9b49404b3f5df2a8f0b31df27a0c7ab872e7b038',
    resources: unverifiedResources('عائلة فيديو بنسخ متعددة؛ يلزم اختيار checkpoint والدقة ومسار offload قبل اعتماد الموارد.'),
  },
  {
    id: 'habibi-msa',
    name: 'Habibi-TTS — الفصحى',
    version: '0.1.1-specialized',
    kind: 'audio',
    variant: 'MSA',
    enabled: false,
    sourceURL: 'https://huggingface.co/SWivid/Habibi-TTS',
    sourceVerification: 'official_verified',
    revision: '3ad11a152851245c002156526c5e1d0b12f2b9d5',
    resources: unverifiedResources('إعداد للفصحى MSA؛ اختيار النسخة المتخصصة وملفاتها وترخيصها والموارد لم يُنفذ بعد.'),
  },
  {
    id: 'habibi-irq',
    name: 'Habibi-TTS — العراقي',
    version: '0.1.1-specialized',
    kind: 'audio',
    variant: 'IRQ',
    enabled: false,
    sourceURL: 'https://huggingface.co/SWivid/Habibi-TTS',
    sourceVerification: 'official_verified',
    revision: '3ad11a152851245c002156526c5e1d0b12f2b9d5',
    resources: unverifiedResources('إعداد للهجة العراقية IRQ؛ جودة النطق وثبات الصوت والموارد غير مختبرة في نظامنا.'),
  },
  {
    id: 'habibi-egy',
    name: 'Habibi-TTS — المصري',
    version: '0.1.1-specialized',
    kind: 'audio',
    variant: 'EGY',
    enabled: false,
    sourceURL: 'https://huggingface.co/SWivid/Habibi-TTS',
    sourceVerification: 'official_verified',
    revision: '3ad11a152851245c002156526c5e1d0b12f2b9d5',
    resources: unverifiedResources('إعداد للهجة المصرية EGY؛ يجب تثبيت ملفات النسخة المتخصصة وتحديد الموارد قبل التشغيل.'),
  },
  {
    id: 'audar-tts-v1-flash',
    name: 'Audar-TTS-V1-Flash',
    version: 'V1-Flash',
    kind: 'audio',
    variant: 'Flash',
    enabled: false,
    sourceURL: 'https://huggingface.co/audarai/Audar-TTS-V1-Flash',
    sourceVerification: 'official_verified',
    revision: 'addf2d80538edab4de2103843678825bc11ddce1',
    resources: unverifiedResources('توليد صوت بملفات Transformers أو GGUF مع codec؛ لم نحدد صيغة أو نقس RAM/VRAM بعد.'),
  },
  {
    id: 'latentsync16', name: 'LatentSync 1.6', version: '1.6', kind: 'video', variant: 'lip_sync', enabled: false,
    sourceURL: 'https://github.com/bytedance/LatentSync', sourceVerification: 'official_verified',
    revision: 'c42c7e6c8e9c213626389fa7d9a3c444b8536353',
    resources: unverifiedResources('OpenRAIL++ model and separately restricted face weights. Commercial execution requires actual rights; no GPU benchmark performed.'),
  },
] as const satisfies readonly EngineModelPreset[];

export type EngineModelPresetId = (typeof presets)[number]['id'];

/** All entries are inactive metadata; runtime readiness must come from Backend. */
export const ENGINE_MODEL_CATALOG: readonly EngineModelPreset[] = Object.freeze(
  presets.map((preset) => Object.freeze(preset)),
);

export function engineModelPreset(id: string): EngineModelPreset | undefined {
  return ENGINE_MODEL_CATALOG.find((preset) => preset.id === id);
}
