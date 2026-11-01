# Task 06 — Wan2.2 I2V-A14B runtime (local implementation)

This package defines future explicitly approved CPU preparation/deployment and GPU inference. No weights, GPU jobs, cloud images, Volumes or deployments were created while implementing it. Offline test fixtures are not evidence of model quality, actual speed, hardware availability or successful cloud execution.

## Publisher source and pinned assets

- Model ID: `wan22-i2v-a14b`, version `2.2`.
- Original publisher repository: [Wan-Video/Wan2.2](https://github.com/Wan-Video/Wan2.2/tree/1ea34ff48f87168174e12956e200b1d908b1c5ff).
- Original publisher's [I2V model card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) explicitly links the official [Diffusers layout](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B-Diffusers/tree/596658fd9ca6b7b71d5057529bbf319ecbc61d74). This is the publisher's full-precision dual-expert conversion, not a third-party quantization or a distilled replacement.
- Source commit: `1ea34ff48f87168174e12956e200b1d908b1c5ff`.
- HF revision: `596658fd9ca6b7b71d5057529bbf319ecbc61d74`.
- Manifest: **42 files, 126,202,569,662 bytes (117.535302 GiB)**, including all 24 expert shards, UMT5 encoder, VAE, tokenizer, scheduler/configs and publisher README/license metadata. Demo images and assets are excluded.
- Public metadata supplies LFS SHA256 and sizes; non-LFS text/config assets were streamed solely to compute SHA256 and independently verify Git blob SHA1. No safetensors, tokenizer binary or model weights were downloaded. Large tokenizer assets use publisher LFS metadata.
- License: Apache-2.0 per publisher card. The conversion's on-disk expert files are FP32-sized; inference casts original experts/text encoder to BF16. Storage size is reported as published, never halved under a false BF16-storage assumption.

## Actual inference contract

`WanVideoRuntime` in `services/film-engine/engine/wan/runtime.py` lazily loads `WanImageToVideoPipeline` from the Volume directory with `local_files_only=True`. Both experts must exist and the configured boundary must equal `0.9`; missing assets never trigger a GPU-side download. BF16 experts/text encoder and FP32 VAE follow the [official Diffusers implementation](https://github.com/huggingface/diffusers/blob/v0.42.1/src/diffusers/pipelines/wan/pipeline_wan_i2v.py). CPU offload keeps the pipeline available within one container without reload between requests.

Input is prompt + exactly one PNG/JPEG/WebP opening image, mode `image_to_video`, unsigned-32-bit seed, dimensions and frame count. The public service accepts only:

- `480×832`, `832×480`, `720×1280` or `1280×720`.
- Native **16 FPS**, **5–81 frames**, constrained to `4n+1` by the VAE temporal factor.
- **40 denoising steps**, high/low CFG **3.5 / 3.5**, one output video.

The publisher's default/example is 81 frames at 16 FPS. **81 is this service's conservative cap, not a claim about the architecture's theoretical maximum.** 81 native frames make an MP4 lasting **5.0625 seconds**; a parent orchestration layer may explicitly trim/assemble verified clips to match a requested timeline. This package never claims it directly generates a long movie in one pass.

Reference preprocessing belongs to the official pipeline and may resize/crop the conditioning image to output dimensions. Native output frames are checked for exact dimensions/count; there is no silent output resizing, frame duplication or interpolation. The pipeline receives the opening image itself; retaining only its ID does not satisfy conditioning.

Output is a **silent H.264 MP4**, original dimensions/FPS, up to 64 MiB, and metadata including SHA256, bytes, frame count, FPS, duration, seed, model/source pins, CFG, load/denoise/encoding times and actual CUDA memory counters when running on CUDA. FFmpeg streams native RGB frames and strips audio; ffprobe verifies the actual file's sole video stream, count, FPS and duration. No voice, lip-sync, OpenAI or external TTS is called.

Progress is each real denoising callback (`completed/40`, unit `steps`). It is not seconds of finished video. Video duration becomes verified only after frame decoding and MP4 probing. No simulated progress or estimated frame completion is reported.

## Hardware/dependencies and unverified limits

The inert image factory pins Python 3.12, torch 2.9.1+cu128, torchvision 0.24.1+cu128, Diffusers 0.42.1, Transformers 5.22.1 and direct dependencies, plus the distribution's FFmpeg package. Direct package pins are not a transitive hash lock, a resolved cloud build, or proof that the complete environment executes successfully.

[PyTorch documents Blackwell support and CUDA 12.8 wheels](https://pytorch.org/blog/pytorch-2-7/); the [official previous-version instructions](https://pytorch.org/get-started/previous-versions/) list the selected torch/torchvision pairing. Runtime leaves **native PyTorch SDPA backend selection automatic**. It neither installs an unverified external `flash-attn` extension nor forces the quadratic-memory MATH backend. The actual selected kernel, end-to-end CUDA compatibility and peak VRAM require a later approved GPU test.

Publisher native instructions state at least 80GB VRAM for their single-GPU A14B example. This app currently admits RTX PRO 6000 96GB only, CPU 4/8 and RAM 128/256 GiB; the manifest's conservative default is RAM 256 GiB. These are admission policies, **not measured guarantees against OOM**, particularly with 720p attention, loading both experts and dtype conversion. Speed, image/face consistency, absence of text, stability across sequential jobs and quality remain untested.

## Isolation, lifecycle and future explicit actions

`build_wan_app(config)` returns inert named app definitions. App name is `mashhad-wan-<definitionUUID hex first12>`; class `WanEngine(runtime_id=...)`. Runtime scopes enforce engine/account/run/request ownership. Model path is `models/wan22-i2v-a14b/<engineUUID>`; results Volume name is derived independently from the engine UUID. No new account can inherit another account's READY marker.

`deploy_wan_app(packet, client=...)` requires exact pinned manifest fingerprint, matching scope and explicit paid approval before provisioning/deployment. It reuses only a matching scoped deployment attestation and bundle fingerprint; an unowned named App/Volume is refused. GPU start/generate never bootstrap, deploy or download implicitly.

CPU `prepare_models` is 2 CPU / 8 GiB, timeout 3600s, startup 180s, retries 0. It hashes existing files, downloads only missing/invalid pinned files after approval, preserves validated files, commits real byte checkpoints, invalidates stale READY before repairing and writes final READY only after every hash passes. Same-operation failure does not dispatch another attempt automatically.

GPU class has min/buffer containers 0, max 1, retries 0, bounded timeout default 1800s/startup 900s and idle window default 1200s. The temporary runtime instance retains the existing shared transport's 60s scaledown policy. Wan's bounded bridge result wait is 2000s and private subprocess limit 2400s; this does not authorize retry on timeout. Explicit stop/control-plane confirmation is handled by the shared transport; a returned RPC or receipt alone never proves resources stopped.

`start(scope)` loads once and returns scoped readiness. `generate(request, scope)` returns `mp4Bytes` privately to Backend plus metadata. Durable paths are `runs/<run>/results/<request>.mp4`, corresponding `.json`, `.claim`, and `runs/<run>/progress/<request>.json`. Exclusive claims prevent replaying paid inference after completed/failed/uncertain results; reads observe existing receipts. Neither cloud provider secrets nor model bytes are placed in public configuration or logs.

## Local verification

`python -m unittest discover -s services/film-engine/tests -p test_wan_runtime.py -q` covers injected inference/encoder behavior, exact CFG/progress/frame/FPS policies, output drift rejection, the real lazy loader with injected modules, local-only weights, independent account scope, no overwrite/retry, missing-file preparation, approval/attestation safeguards and actual Modal SDK registration without hydration. Encoder command/probe behavior is mocked because FFmpeg is not on this local shell's PATH; these tests do not claim a real codec or model ran.

All checks are local. Model download, image build, resolver installation, Volumes, real CPU preparation, CUDA inference, codec execution inside the cloud image, memory/timing measurements and human quality review await separate explicit authorization.
