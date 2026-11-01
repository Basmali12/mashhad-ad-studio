# Task 06 — Wan 2.2 I2V-A14B integration

2026-10-31, local only, `Basmali12/mashhad-ad-studio` / `codex/ltx-film-engine-integration`. No model weights, cloud build/deployment, GPU, paid inference or OpenAI call was executed. No backup, restore point, DNS/design change, user-data deletion or modification of credentials/wallet/rental infrastructure was made. Task 07 was not started.

## Official implementation and pins

The requested [Wan2.2 repository](https://github.com/Wan-Video/Wan2.2) and [original I2V-A14B card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) explicitly link the publisher's [Diffusers conversion](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B-Diffusers). This integration uses that official dual-expert model with `WanImageToVideoPipeline`; it is not the 5B TI2V model, a third-party distilled version or FP8 checkpoint. The pinned layout retains original precision on disk and loads BF16 experts/text encoder plus FP32 VAE according to the official Diffusers path. Its 42-file manifest totals **126,202,569,662 bytes / 117.535302 GiB**. Public file metadata/configurations were inspected; no weight was downloaded. Exact HF/source pins, dependency versions and primary-source compatibility evidence are in `task-06-wan-runtime.md` and `engine/wan/model-manifest.json`.

Python 3.12, official PyTorch 2.9.1 CUDA 12.8 wheels and native PyTorch SDPA are selected for the RTX PRO 6000 Blackwell target. No external Flash Attention package, forced math attention backend, quantization or silent GPU substitution is installed. Native SDPA dispatch chooses supported kernels; the actual selected kernel, VRAM behavior, 720p speed and CUDA image build remain unverified without a later authorized GPU test. 96GiB VRAM and 128–256GiB host RAM are conservative preflight settings, not an OOM guarantee.

## Runtime, approval and lifecycle

`engine/wan/` contains lazy inference, stable Modal image definitions, explicit CPU preparation and scoped deployment. `wan-modal-transport.mjs` uses the existing closed model transport/bridge with separate `wan-*` operation/runtime/result/preparation namespaces. Stable model ID remains `wan22-i2v-a14b`, version `2.2`; account secrets, idempotency, stop confirmation and actual customer metering retain their existing implementation.

`wan-integration.mjs` binds production `animate` stages to the selected definition/account and approved source image. `FILM_WAN_PAID_ENABLED=NO` is the new default; no real environment was changed. Metadata inspection/quotes and opening administration never start inference. Start and preparation require the existing explicit scoped approvals and enabled server authority. Function timeout is 1800s, startup timeout 900s; private result wait is bounded separately and never interprets an ambiguous timeout as permission to resubmit. Production stages explicitly stop their owned runtime. Supplier invoice amounts are recorded only when available; the existing measured customer rental is not labeled a provider invoice.

## Opening images and movement

The official I2V request receives exactly **one** opening image. `image-quality.getAnimationInput` enforces ownership, current file hash, approved image review and character anchors. Other identity references remain in the project/Character Bible; they are not falsely passed as independent multi-image Wan conditioning. Every shot stores source image ID/hash, character IDs and stable descriptors, place, wardrobe, model revision, final prompt, seed, dimensions, frame count, FPS, timeline and runtime identity.

`wan-prompt.mjs` describes initial state, action development, final state and camera path explicitly. The director must provide English `motionPlan: {start, development, end, camera}`; no paid translator or fabricated Arabic-to-English translation is hidden in this task. Structured fields are validated before GPU admission. Qwen/FLUX scene-image preparation uses the planned starting pose. A changed place/action receives a new planned opening image from the image stage; the adapter does not recycle an ending frame or replay the previous motion automatically.

Supported output grids: 720×1280 / 1280×720, and the publisher-compatible 480×832 / 832×480. Default remains 720p. The 480p grid is approximately portrait/landscape rather than an exact 9:16 ratio; original image dimensions are retained. There is no customer interface redesign or new quality selector.

## Duration and long films

The service conservatively admits 5–81 frames in the `4n+1` form at 16FPS, based on the publisher's 81-frame example. **81 frames is a service validation cap, not a claimed architectural maximum.** Native 81-frame output is 5.0625s; it is not reported as a ten-second inference.

`wan-shot-plan.mjs` splits longer storyboard shots into timeline parts of at most five seconds only when the director supplied distinct `motionBeats` with the required count. Missing/duplicate beats fail planning before spend. Sound effects crossing a split require a timing replan instead of being silently repeated. The original event IDs remain on the first part, later parts have distinct event IDs, utterance IDs are recomputed from overlap, and one voice stage per utterance is retained. No dialogue is regenerated or cut into new voice identities here.

Film duration stays 10s–60min. A ten-minute mock storyboard normalizes to 120 short shots; a one-hour boundary check yields 720. Successful stages/assets/checkpoints survive worker interruption. A failed shot requires explicit fresh retry approval; an ambiguous request follows its original function call/result and never creates another generation automatically.

The optional `production.quote` phase `animation` prices only animation after image stages complete; it does not approve audio or a full film. Completion records `completedPhases: ['images', 'animation']` and returns to planned. Audio/TTS, lip synchronization and remaining film work remain for later tasks; LatentSync is not installed.

## Native media and future soundtrack handoff

`wan-video-assets.mjs` stores immutable `native.mp4`, original SHA256/bytes/frame count/FPS/dimensions/duration, and a separate `video.mp4` timeline asset. Native output receives a full CPU decode and any audio stream is rejected. A 5-second timeline uses 80 frames from an 81-frame native result: FFmpeg trims only excess ending frames, without freezing, stretching, resizing or adding sound. Its H.264 CRF0 timeline encoding avoids additional lossy compression; the native remains unchanged. Both files are decoded/verified and saved privately under the existing production storage. Failed local verification/tooling retains the native result for same-attempt recovery.

The existing `resolveProductionAsset` contract supplies an opaque, tenant-owned video asset to soundtrack/sync stages with actual duration, frames, dimensions and `hasAudio:false`. No intermediate clip is added as a customer final film. A failed CPU commit can adopt the already generated result after confirmed stop without another inference or double charge.

## Local verification

Mock inference tests cover source admission, single-image request, selected account, three sequential clips, explicit retry, source/timeline/character provenance, no duplicate paid requests and paid-disabled operation. The ten-minute worker-resume test executes the real coordinator, registry, billing and Wan adapter against mocked providers/media storage, preserving the first three completed clips across restart. Native media tests separately run real local FFmpeg against synthetic files; these are not model-generated videos.

Final command results are recorded below after the combined checks. Real CUDA build/load, generated motion/identity/captions, kernel selection, hardware availability, throughput and actual supplier billing remain untested and require later separate approval. All edits remain local with preceding tasks' uncommitted work.

Final local results:

- `npm run build`, `npm run build:admin`: passed, including TypeScript for app, Convex compatibility, workers and services.
- `node scripts/build-reels-worker.mjs`: passed; no service was started.
- `npm run lint` plus explicit ESLint on Wan integration/prompt/planner/assets: passed.
- Frontend: 691 passed / 167 test files.
- `npm run film:engine:check`: 322 passed with actual local CPU FFmpeg fixtures; final source-orientation guard subsequently passed the seven affected Wan integration tests.
- Gateway: 41 passed, including strict animation-phase quotation without granting worker/run access.
- Python discovery: 109 passed; SDK definition registration performs no hydration/network. Known pinned-SDK deprecation notices are informational.
- Transfer image-order validation and `git diff --check`: passed. Existing CRLF warning is informational.

Verified boundaries include one approved opening image, mismatched/too-small orientation rejection, original silent video decode, native/timeline frame counts, source/model/account/tenant scope, explicit approvals, no replay on failure, actual customer-meter settlement after stop, CPU result adoption without another charge, ten-minute checkpoint resume, and the one-hour planning boundary. Native generated quality and cloud hardware behavior are explicitly not certified by these mock/local checks.
