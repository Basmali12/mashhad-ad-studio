# Task 07 — HunyuanVideo 1.5 integration

2026-10-31. Local implementation in `Basmali12/mashhad-ad-studio`, branch `codex/ltx-film-engine-integration`. No weights, GPU, cloud CPU job, paid inference, OpenAI call, build/deployment, backup or restore point was created. Domain, design, account/token, rental and wallet infrastructure are preserved. No user data was deleted and Task 08 was not started.

## Official model and actual API

The [Tencent source](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5) and [model card](https://huggingface.co/tencent/HunyuanVideo-1.5) explicitly link their Diffusers collection. `engine/hunyuan/` loads those original publisher-linked conversions using `HunyuanVideo15Pipeline` / `HunyuanVideo15ImageToVideoPipeline`; no external generation API is involved. Source `60783e704160023913bee78f0b47036d393d4dfa` and root model `9b49404b3f5df2a8f0b31df27a0c7ab872e7b038` are pinned. Four variant pins and dependency/API verification are documented in `task-07-hunyuan-runtime.md`.

The 71-file manifest deduplicates shared components across 480p/720p T2V/I2V while keeping their transformers independent: **159,203,993,734 bytes / 148.270273 GiB**. Public configuration text and file metadata were inspected; no weight was downloaded. This size is disclosed before any future preparation; software installation is distinct from deployment, stored weights and loaded GPU memory.

The runtime preserves the real official signatures: I2V derives dimensions through the original image bucket helper; it does not accept invented width/height or callback arguments. Progress follows actual pipeline progress-bar updates. Native service policy is 50 steps, CFG 6, 24 FPS, 5–121 frames in `4n+1` form. The 121-frame example gives approximately 5.042s, not 20s. Five-second timeline parts retain 120 frames without slow motion or duplicated frames. Longer plans require distinct director motion beats and are split before image preparation. The service cap is not a claimed architectural maximum.

T2V dimensions are 480×848 / 848×480 or 720×1280 / 1280×720. Official I2V portrait bucket rounding yields **480×832 or 720×1264**, with landscapes 848×480 or 1280×720. Conditioning pixels are fitted to the documented input canvas, while the original stored image remains unchanged; no pipeline helper is monkeypatched and native output frames are never stretched/resized. Native output dimensions are recorded honestly. To avoid implicit spatial scaling in mixed-model assembly, the local timeline copy uses narrow symmetric padding, never spatial scaling/cropping: canonical grids are 720×1280 / 1280×720 and 480×848 / 848×480. For example, portrait Hunyuan I2V adds 8px above and below its native 720×1264 image. Wan 480p receives the corresponding 16px canvas extension where needed. This is stored separately from the original native metadata, and cannot be misreported as native generation at that canvas size.

RTX PRO 6000 96GiB is the admitted GPU, with conservative CPU 4–8 / RAM 128–256GiB settings. A cheaper GPU is not enabled without measurements. Python 3.12 / official PyTorch CUDA 12.8 wheels / native SDPA are pinned. CPU offload is an optional trusted runtime constructor setting; VAE tiling is enabled. FP8/distillation/cache acceleration is not implicitly enabled or described as quality-equivalent. Actual CUDA build, kernel selection, VRAM/OOM, throughput and visual quality require a later authorized GPU test. Startup warms the default 720p I2V variant; changing variant releases the previous pipeline and loads the selected variant, with its cost included in measured session/inference records. It does not keep all four transformers on GPU or claim variant switching is free.

## License and spending authority

Tencent Hunyuan Community License applies rather than Apache 2.0. The publisher's restrictions and intended deployment must be reviewed before activation. `FILM_HUNYUAN_LICENSE_ACCEPTED=NO` and `FILM_HUNYUAN_PAID_ENABLED=NO` are separate defaults; this task changed no real environment flag or accepted any terms. A token or cost approval never implies license acceptance. Trusted Node gates, Python dispatch, deployment and preparation all reject paid actions without acknowledgement; preparation forwards the same explicit licence acknowledgement to the scoped CPU worker. Free inspection and quotations remain available without allocating resources.

## Shared integration and model selection

- `hunyuan-integration.mjs` defines a separate model/profile/account binding and uses the existing video execution, billing/stop confirmation and result-recovery coordinator in `wan-integration.mjs` through trusted profile/request hooks. Wan remains independent and primary.
- `hunyuan-prompt.mjs` accepts explicit T2V or one approved I2V opening image, with distinct start/development/end/camera instructions. Character IDs, wardrobe, place, event/timeline, source hash and model revision persist. T2V carries no conditioning image and explicitly records `identityConditioned:false`; stored character descriptions are not called a face guarantee.
- `video-routing.mjs` makes a frozen planning choice per shot. Explicit engine choices win; T2V requires Hunyuan; complex-motion/quiet preferences are labeled unverified heuristics. The cost rule only uses comparable, same-customer historical records with explicit positive identity/motion review and no deformation. Without evidence it retains the primary and does not invent a cheaper model. Current quotes still use current configured rates and explicit approval; historical cost is not a promised new price.
- `production-plan.mjs` retains per-shot `videoModelId`, generation mode, selection intent/evidence and unique motion beats; T2V has no scene-image dependency or hidden image request. Film duration remains 10s–60min. The real planner hook is awaited and does not call OpenAI implicitly.
- `wan-video-assets.mjs` accepts separate trusted Wan/Hunyuan profiles, with mode-specific source admission and FPS/frame validation. It preserves immutable native and CPU-trimmed silent timeline media through the existing opaque asset/file contract.
- `video-comparison.mjs` / `video-comparison-hooks.mjs` record inference time, confirmed-stop metered runtime, measured customer charge, supplier invoice when available, dimensions/FPS and a separate human quality review. Supplier cost stays null when unknown. Planned end state is kept separately from evidence that it was reached; no automatic face/motion/deformation verdict is invented. These records never settle wallets or launch inference.

Failed jobs never ask the router for another provider. There is no automatic Wan→Hunyuan or Hunyuan→Wan regeneration. A received result followed by a local storage/metric failure is retained for CPU-only reconciliation. Completed stages survive restart and are not regenerated. Changing models between scenes does not certify visual continuity; approved shared image references and separate review remain necessary. Audio and lip synchronization are unchanged deferred stages; output is silent MP4.

## Verification boundary

Mock integration exercises explicit T2V/I2V contracts, mixed-model accounts, frame grids, approval/license gates, failure without fallback, measured-field recording and restart of a ten-minute 120-shot plan. Media tests separately decode and trim actual synthetic local MP4s using FFmpeg. They do not represent generated Hunyuan or Wan videos. Final combined commands/results are recorded below. All work remains local with the preceding tasks' uncommitted changes.

Final local execution record:

- `npm run build` and `npm run build:admin`: passed, including all four TypeScript configurations and isolated customer/admin bundles.
- `node scripts/build-reels-worker.mjs`: passed; bundles only, no service start.
- `npm run lint` and explicit ESLint for the shared/new video integrations, routing, comparison hooks and media files: passed.
- Frontend: 691 passed in 167 files.
- Backend `npm run film:engine:check`: 342 passed, zero skipped, with actual local FFmpeg synthetic-media checks.
- Python discovery: 133 passed, including original FLUX/Qwen/Wan regressions and Hunyuan runtime/transport tests. SDK registration deprecation notices are informational; hydration/network is forbidden in the fixtures.
- Gateway: 41 passed; private worker/run, routing injection, roles, approvals and response filters remain protected.
- Transfer image-order check and `git diff --check`: passed; existing Windows line-ending warning is informational.
- Windows text encoding audit found legacy cp1256 fixture files and one mixed-encoding documentation paragraph. They were normalized to UTF-8, followed by a strict text decode audit and rerun of the 20 affected Hunyuan/Qwen/Wan integration tests. Production behavior/design is unchanged by this normalization.

Additional verified cases include same-customer-only reviewed cost selection, no cross-account dispatch, no automatic retry/fallback, preservation of successful mixed-model clips, post-stop comparison-write failure recovered through the same result without a second charge, and limited symmetric timeline padding with native original preserved. No generated Hunyuan output, measured hardware throughput/VRAM, real invoice, licence acceptance, server deployment or live PostgreSQL interaction is claimed.
