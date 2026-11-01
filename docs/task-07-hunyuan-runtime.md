# Task 07 — HunyuanVideo-1.5 runtime (local implementation)

No weights were downloaded, no GPU/CPU cloud job was dispatched and no image/Volume/deployment was created during this implementation. The package contains future explicitly approved operations. Injected fixture outputs are not real generated videos or proof of quality, memory use, speed or availability.

## Sources and license

The publisher is [Tencent-Hunyuan/HunyuanVideo-1.5](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/tree/60783e704160023913bee78f0b47036d393d4dfa), source commit `60783e704160023913bee78f0b47036d393d4dfa`. The original [Tencent HF model](https://huggingface.co/tencent/HunyuanVideo-1.5/tree/9b49404b3f5df2a8f0b31df27a0c7ab872e7b038) is pinned to `9b49404b3f5df2a8f0b31df27a0c7ab872e7b038`.

The publisher README explicitly documents `HunyuanVideo15Pipeline` and links the [Diffusers collection](https://huggingface.co/collections/hunyuanvideo-community/hunyuanvideo-15). This implementation uses those publisher-linked original full-precision conversions, not an unofficial inference API or quantized replacement. Each source has its own immutable pin:

| Variant | HF conversion repository suffix | Revision |
| --- | --- | --- |
| 480p T2V | `hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-480p_t2v` | `286be7ce72277246578a3e3cc2487e95ddae5bcf` |
| 480p I2V | `hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-480p_i2v` | `5a700ee883ff4c1b3d887ec4188755a7a5e2f698` |
| 720p T2V | `hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-720p_t2v` | `f4dbc4a1efa4ac8ea56680cdf79d9f455105e814` |
| 720p I2V | `hunyuanvideo-community/HunyuanVideo-1.5-Diffusers-720p_i2v` | `dcf088ef4e420dd54bc25930ee810bb6613dfcb5` |

The **Tencent Hunyuan Community License applies, not Apache-2.0**. The publisher card declares EU exclusion; commercial/territorial restrictions must be checked against the actual license and intended deployment. License text/NOTICE are included in the pinned manifest. A valid account token does not establish license eligibility or acceptance. The Backend license gate is separate; Python preparation/deployment also require trusted `licenseAccepted:true`. No acceptance is inferred or performed by local tests.

## Manifest and storage layout

Model ID `hunyuanvideo15`, version `1.5`. The manifest contains **71 unique files, 159,203,993,734 bytes = 148.270273 GiB**, covering all four original transformers, Qwen2.5-VL text model, ByT5 text model/tokenizers, Siglip image encoder/processor for I2V, guider, schedulers and VAE. Identical whole components across variants are stored once under `shared/<component>/<fingerprint>/`; transformer/config files stay under `variants/<variant>/transformer`. Distilled, sparse, SR and FP8 variants are excluded.

Every file records local path, source repository, source revision, source path, exact size and SHA256. LFS hashes/sizes were read from public repository metadata only. Small public text/config/tokenizer text assets were streamed without retention to compute SHA256 and independently verify the Git blob hash. No safetensors or tokenizer binary/model weight asset was downloaded. The original storage representations vary; the manifest reports actual published bytes and never assumes all storage is BF16-sized.

CPU preparation uses each file's pinned repository/revision and first verifies existing local files. Only missing/invalid files are downloaded to the mounted Volume's scoped incoming path, verified, then moved into the canonical shared/variant path. No file traffic passes through HostHatch disk. READY is invalidated before repairs and committed only after all hashes pass. Persistent checkpoints report actual fully verified bytes/files, not simulated intrafile progress. A failed/uncertain operation is not silently redispatched.

## Inference modes and exact native canvases

The implementation uses [Diffusers 0.42.1 T2V](https://github.com/huggingface/diffusers/blob/v0.42.1/src/diffusers/pipelines/hunyuan_video1_5/pipeline_hunyuan_video1_5.py) and its [I2V pipeline](https://github.com/huggingface/diffusers/blob/v0.42.1/src/diffusers/pipelines/hunyuan_video1_5/pipeline_hunyuan_video1_5_image2video.py). Components are loaded locally with `local_files_only=True` and a closed whitelist of official component classes, assembled into the appropriate official pipeline. Actual mode/task/target-size/CFG configuration is checked before readiness.

- T2V: prompt, zero image references, exact `480×848`, `848×480`, `720×1280` or `1280×720`.
- I2V: prompt, exactly one image, native `480×832`, `848×480`, `720×1264` or `1280×720`.
- Native output **24 FPS**, **5–121 frames**, constrained to `4n+1`.
- Fixed **50 denoising steps**, **CFG 6** via the original `ClassifierFreeGuidance` component, not an unsupported `guidance_scale` call argument.
- BF16 inference, original weights, no quantization/FP8/step distillation/SR/cache/compile. Native PyTorch SDPA automatic backend selection, with no forced quadratic-memory MATH context or unverified external flash-attn package.

121 frames/24 FPS follows the official publisher example and yields **5.0416667s**. The 121-frame cap is a conservative service policy, not a claimed architecture maximum. Parent orchestration controls longer timelines and final assembly; this runtime does not pretend to generate a long movie in one pass.

I2V's public API derives dimensions from the input image using the official bucket helper; it does not accept width/height kwargs. The helper rounds aspect ratios directionally, so portrait buckets differ slightly from exact 9:16. Only conditioning pixels are explicitly fitted to a `480×848` or `720×1280` portrait reference canvas, after which the **unmodified** official helper selects `480×832` or `720×1264`. Landscape canvases retain their native sizes. The calculated bucket must match the requested native output before inference. The helper is never monkeypatched and output frames are never resized, stretched, interpolated or silently trimmed. Metadata records the conditioning canvas separately.

The original pipeline has no `callback_on_step_end` argument. Progress is captured from its real denoising `progress_bar.update` calls through a temporary wrapper restored in `finally`. Only actual completed steps are emitted; 50/50 does not claim decoding/encoding is complete or that that many seconds of video exist. Frame count, dimensions and duration become verified only from decoded frames and probed MP4.

Output is silent H.264 MP4 up to 64 MiB, verified by FFmpeg/ffprobe for exact frames/FPS/dimensions, duration and absence of audio. Metadata records mode, variant, original seed, dimensions, frames, FPS/duration, SHA256/bytes, model/source pins, CFG, load/inference/encoding times and CUDA memory counters when actually available. No OpenAI, voice, TTS or lip-sync is called.

## Loading and lifecycle

`HunyuanVideoRuntime.prepare()` defaults to **720p I2V only**. It does not load all four transformers in GPU memory. Repeated requests of the same variant reuse one pipeline; changing mode/resolution releases the previous pipeline, collects memory and loads the selected variant. This has real mode-switch cost and does not guarantee immediate reuse of every component. Default CPU offload and VAE tiling follow the publisher's basic Diffusers example; offload is an explicit trusted runtime constructor option, never a customer request flag.

Service policy admits RTX PRO 6000 96GB only, CPU 4/8 and RAM 128/256 GiB. Manifest defaults are CPU 4/RAM 128 GiB. This is not a measured memory guarantee: simultaneous component loading, dtype conversion, 720p attention and sequential mode switches remain untested. Lower GPUs must wait for an explicit benchmark, even though publisher documentation describes offloading on smaller cards. Official FP8 kernels exist in upstream but are not installed or enabled here and require a future separate implementation/benchmark.

Named App `mashhad-hunyuan-<engineUUID hex first12>` exposes `HunyuanEngine(runtime_id=...)`, with start/generate RPC and shared scoped result protocol. App/Volume names, model path `models/hunyuanvideo15/<engineUUID>` and account/engine/run/request scopes are isolated. Exclusive request claims plus persisted receipts prevent replaying completed, failed or uncertain inference. MP4/receipt/progress paths match the existing private transport convention; only the verified asset is returned to Backend, never provider credentials.

CPU preparation: **2 CPU / 8 GiB, timeout 3600s, startup 180s, retries 0**. GPU: default **timeout 1800s, startup 900s, idle 1200s**, max one/min zero/buffer zero containers, retries zero. Timeout bounds remain explicit. No start/generate path secretly deploys or downloads. Approved bootstrap requires paid and license approval, full pinned manifest fingerprint and scoped attestation/bundle checks. Shared transport observes the real control plane before claiming resources stopped; a receipt alone is insufficient.

## Verification and deferred evidence

`python -m unittest discover -s services/film-engine/tests -p test_hunyuan_runtime.py -q` exercises both modes/all four variants with injected pipeline/image fitter/encoder fixtures, real progress events, reuse versus mode switches, direct component-loader arguments with injected modules, native bucket rejection before inference, license/approval/ownership safeguards, multiple source pins and canonical shared-file placement, no retry/overwrite and actual installed Modal SDK registration without hydration.

Python compilation/import and fixture tests are local only. Real model downloads, dependency resolution/image build, license eligibility confirmation, CPU preparation, codec binaries inside the cloud image, CUDA/selected attention kernel, memory/timing, visual quality and identity/continuity checks require later explicit authorization. Direct dependency pins are not a complete transitive hash lock or proof of a successful build.
