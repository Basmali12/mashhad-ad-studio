# Task 04 — FLUX integration, 2026-10-31

## Scope

Local implementation only on `codex/ltx-film-engine-integration`. The previous Tasks 01–03 working tree is preserved. No backup, restore point, deployment, weight download, GPU, inference request or OpenAI request was performed. No domain, token, account, ledger or existing media was deleted. Qwen, Wan, Hunyuan and TTS implementations remain outside this task.

The installed FLUX adapter is usable by the existing model-neutral registry and production coordinator. It is deliberately gated by both existing paid-execution policy and `FILM_FLUX_PAID_ENABLED=YES`; the environment template defaults to `NO`. Merely constructing services, saving an account, opening administration, inspecting files or making a quote never deploys or starts a GPU. The story planner remains an injected contract, not a newly enabled paid service.

## Entry points and durable records

- `engine/flux-prompt.mjs`: validated structured character/place/time/era/lighting/wardrobe/expression/pose/camera/style/reference input; exact 720×1280 or 1280×720 original dimensions; explicit text-in-image opt-in; fixed original BF16/four-step settings and reproducible seed.
- `engine/flux-integration.mjs`: registry adapter plus character/scene-image production adapter. `production.quote` with `phase: images` approves only these stages and returns the project to planned after they complete. This does not start video or audio stages.
- `engine/flux-modal-transport.mjs` and `flux_modal_bridge.py`: private stdin credential handoff; selected account, canonical model path, app/class/Volume and runtime binding; durable single-dispatch operation IDs; control-plane observations and scoped stop. An unknown dispatch is followed, never resubmitted automatically.
- `engine/flux-image-assets.mjs`: original image and bounded CPU preview, actual dimension/SHA verification, tenant-owned files and persistent character-angle references. PostgreSQL-backed Store entities retain file metadata/provenance rather than image bytes. Existing storage providers and authenticated asset paths are reused.
- `engine/flux/`: pinned Python inference, reusable image, manifest, CPU preparation, approved bootstrap deployment and persistent result receipts. See the runtime document for official sources, dependency versions and exact manifest.

New durable entities include `engine-preparation`, `flux-image-request`, `production-asset`, `production-character-reference` and `production-reference-binding`. Existing engine command/runtime/history, production attempt/stage/model-run, approval and charge records remain the source of authorization and accounting.

## Identity, references and recovery

Character angles depend on the first character image. Scene requests reuse stored character images rather than recreating identity from text alone. Existing owned uploaded references can be bound by their hash; cross-user access, changed bytes, duplicate references and unsupported reference counts are rejected. Multi-reference requests accept at most four actual images. Images carry model revision, final prompt, settings, seed, reference IDs, subject and timeline links. Future Qwen/Wan adapters can consume the same original asset references without rescaling them here.

Successful stages are not regenerated on refresh/retry. If the image was generated but local preview/storage completion fails, the attempt requires result reconciliation: the same retained result is fetched and committed locally without another GPU generation or second charge. An original left by a failed preview remains private and cannot masquerade as a completed asset. No face-consistency, absent-text or visual-quality guarantee is inferred from these records.

## Preparation, lifecycle and costs

The 17-file pinned manifest totals 15,975,692,643 bytes (14.8785 GiB); it excludes the duplicate root checkpoint. Future approved CPU preparation uses `local_dir` under the scoped Volume path and verifies size plus SHA256, reusing valid files. No model bytes pass through HostHatch. Software installation, deployment attestation and weight readiness are separate states. A warmup is ready only with provider evidence, not because the browser sent a request.

An explicit prepare quote and approval precede Volume creation, cloud build/deploy and CPU transfer. An explicit fresh start quote precedes GPU warmup. CPU quote and GPU resource-window estimates are distinct from customer hourly price and from actual provider invoicing; network/build/storage may remain unknown and are disclosed. GPU customer metering includes startup and idle until scoped stop is confirmed. Duplicate commands do not create another paid request. A failed generation with confirmed runtime termination still settles its measured customer rental; it is not falsely free. Provider invoice amounts are not fabricated from customer rental charges.

## Local verification and deferred evidence

Fixtures exercise a ten-minute timeline, five character angles, two scene references, mock account preparation/start/stop, scope and approval validation, failed generation billing, and original-result recovery after preview failure. Actual local CPU image decoding, dimension checks, thumbnail creation and file hashing accompany mocked inference. Python tests register pinned Modal SDK definitions without hydration, use an injected pipeline, and inspect preparation/result/lifecycle contracts.

The task execution record is completed below after final TypeScript, lint, customer/admin/worker builds, frontend, gateway, backend and Python checks. These checks do not prove a built CUDA container, real model load, image quality, identity consistency, measured VRAM or transfer speed. Those require later separately approved cloud preparation and inference. CPU/RAM/VRAM defaults are conservative preflight rules, not measured FLUX performance guarantees.

## Final local execution record

- `npm run build`: passed, including all four TypeScript configurations and customer Vite build.
- `npm run build:admin`: passed, including TypeScript and isolated administration build.
- `node scripts/build-reels-worker.mjs`: passed; bundles only, no service started.
- `npm run lint`: passed. Final transport edits also passed targeted ESLint.
- `npm test -- --maxWorkers=2`: 691 tests / 167 files passed.
- `npm run film:gateway:check`: 40 passed.
- `npm run film:engine:check`: 288 passed on the final source, including actual local FFmpeg fixtures with an explicitly selected existing FFmpeg executable.
- `python -m unittest discover -s services/film-engine/tests -p 'test_*.py'`: 58 passed. The pinned SDK emits a future-version deprecation notice for test-only `registered_functions`; no failure.
- `python services/film-engine/tests/validate_transfer_images.py`: passed, no cloud operation.
- `git diff --check`: passed; an existing Windows CRLF normalization warning is informational.

Additional lifecycle regression coverage proves that a historical warmup receipt cannot report ready after all tasks disappear; terminal scoped calls and zero tasks close admission and stop metering. A stop racing with dispatch persists and cancels a late GPU or CPU call ID, without spawning another call. An uncertain stop permits an explicit scoped follow-up; it never reopens generation admission. Unsigned 32-bit seed validation matches between JavaScript and Python.

All changes remain local and uncommitted together with the preceding tasks' work. No production environment flag was enabled and Task 05 was not started.
