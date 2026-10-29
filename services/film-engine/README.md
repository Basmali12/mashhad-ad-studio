# Film engine foundation



Local integration package for the existing Iraq AI Studio repository. Node 24 or newer is required (`node:sqlite` is used by local tests). Install with `npm ci` in this directory and run `npm test`. Runtime dependency `pg` remains pinned to `8.16.3`.



The standalone service entry is service.mjs. Read OPERATIONS.md and BRIDGE-CONTRACT.md before configuration. The authenticated customer bridge owns invocation, rental lifecycle, wallet settlement and artifact delivery. Never expose `api.invoke` directly to browser requests: its trusted scope is an in-process capability. Tenant invocations allow only quotes, execution and scoped job status/stop/reconciliation. Administrator account management stays on the existing protected engine interface.



`CUSTOMER_PLATFORM_ENABLED` and `ENGINE_ALLOW_PAID_ACTIONS` are disabled unless explicitly set to `YES`. Tenant execution requires migration 002 readiness. SQL files are provided for separately approved deployment; importing this package does not apply a PostgreSQL migration. Local fixture tests explicitly call `Store.installRentalSchema()` on a new temporary database only. Configure a distinct service data directory and database during a future approved deployment; the historical database default in the vendored adapter must not be used to point at the stable service by accident.



## Inference profiles



`LTX_INFERENCE_PROFILE=dfr-main` is the default selected by the user: LTX-2.5 Distilled, official `DFRPipeline`, Diffusion VAE, native audio, CPU offload and FP8 cast/BF16 compute. An unset variable selects it too. `dfr-candidate` remains an accepted backward-compatible alias and is canonicalized to `dfr-main` in Node, Python and the static image environment. The quality contract remains `ltx25-dfr-diffvae-720-v1`; the exact six-component readiness contract is `engine/runtime/production-profile.json`. Missing/wrong-profile/incomplete weights or a missing CPU text checker block a quote before a paid session. No fallback or automatic weight/checker download occurs.



The official DFR CLI comparison **did complete one real 10-second GPU run** on RTX PRO 6000, producing 720x1280/native AAC. Its existing local evidence is `outputs/ltx-quality-preparation/dfr-comedy-10s-once/receipt.json` and `DFR-COMPARISON-REPORT.txt` in the preparation workspace. This is evidence for the comparison, not acceptance of the persistent `DfrStoryEngine` adapter, concurrent tenant sessions, dialogue accuracy or text suppression. The persistent adapter and new tenant service have **not** been GPU-validated or deployed. Those require a separately approved staging run; see `OPERATIONS.md`.



`LTX_INFERENCE_PROFILE=conv-stable` is an explicit historical rollback using `engine.StoryEngine` and the successful deployed Conv VAE contract `ltx25-native-crop-720-v1`. Its five-component manifest is `engine/runtime/conv-profile.json`; the original `source-manifest.json` remains unchanged for historical transfers/provenance. Retaining it does not activate it automatically or delete DFR. Historical service evidence identifies `conv_vae=true` in `outputs/arabic-dialogue-trial-10s/scene-receipt.json`; the old repository, HostHatch service, successful media and receipts remain unchanged.



Both profiles use 768x1280 native inference cropped to 720x1280 (or landscape equivalents), 10-second/241-frame scenes and native audio. Default resources remain RTX PRO 6000 96GB, 4 CPU and 96GB RAM. The current DFR adapter is restricted to RTX PRO 6000/10 seconds; tenant L40S DFR quotes fail before dispatch. L40S remains available only with explicit Conv selection and its own required quality review. Invalid profile values fail closed. Images pin the canonical selection and retain both implementations; no image was built during this integration.



## Isolation and recovery



Different rented slots can have concurrent sessions even on the same Modal account. Operations on one trusted slot serialize independently so a slow discovery on another slot cannot block its emergency stop. Shared transaction locks and scoped job indexes prevent conflicting starts. Legacy administrator jobs globally exclude active/uncertain rental jobs, and a legacy active/uncertain job blocks all rental starts. A restart retains uncertain state and converts interrupted active state to `recovery_required`; there is no automatic GPU retry. Scene and reference keys include tenant and rental identities.



## Source attribution



Engine application source was copied from the user-owned local `iraqi-film-forge` preparation checkout, based on commit `73b5282c62918a92007db226f2c385894db421f4` plus its uncommitted rental preparation as of 2026-10-28. The source checkout and the existing HostHatch service were not changed. Changes to this vendored copy retain the user-selected DFR main profile, preserve explicit Conv rollback and strengthen tenant boundaries. `film-platform.mjs` implements the authenticated bridge, authoritative film wallet/rental lifecycle, tenant projects/planning/media and local CPU film merge.



The upstream LTX code is referenced rather than vendored here. Its exact repository, commit, model revision and artifact hashes remain in `engine/runtime/source-manifest.json`; runtime requirements locks remain alongside it. Preserve upstream license and model access terms when an approved operator later builds an image. No additional rights are implied by this wrapper.



No environment secrets, SQLite databases, receipts, media, model weights, virtual environments or historical customer data were copied. Tests use temporary state and a strict fake provider isolated from production code. PostgreSQL SQL execution, real SDK behavior of this integration, image build, persistent-service GPU quality and live deployment remain unverified. The separate prior DFR comparison is described above.



## Backend verification



Run `npm test`: foundation, gateway/platform, strict default-DFR and active-profile preparation cases exercise real temporary SQLite, exact money/expiry, concurrent rentals, auth/replay/privacy, durable attempts/resume, signed original media and local CPU AV concatenation. The concat case uses an already installed CPU FFmpeg binary when available; no downloads/models/GPU. FFprobe was unavailable in the local validation and the real FFmpeg full-decode checker was exercised. Machine-readable operations are frozen in bridge-contract.json and engine/film-contracts.ts.



Reference uploads and private previews are implemented through signed owner-bound tickets; see BRIDGE-CONTRACT.md. No cloud upload/storage/model operation is part of these local tests. PNG support is bounded noninterlaced 8-bit grayscale/RGB/gray-alpha/RGBA; JPEG support is bounded 8-bit baseline/progressive. Superseded private images are retained for a separately approved storage retention policy.



Retained images are bounded per customer by FILM_REFERENCE_CUSTOMER_LIMIT_BYTES (64MiB default), with atomic durable max-upload reservation before any body read. Replacements/unlinks count every retained original; failure cleanup releases reservations, interrupted/uncertain cleanup remains fail-closed pending offline reconciliation.



Account preparation uses the selected profile: six DFR components by default or five for explicit Conv rollback. The missing-only CPU cloud plan is bound to exact manifest/worker/plan fingerprints and exposes source/destination cost estimates before approval. Missing source additions fail closed; no DFR Hugging Face fallback or HostHatch model staging is enabled. Destination-local hashing precedes and follows upload; READY records the selected profile only after full verification. Existing cloud worker deployments need separately approved fingerprint-matching preparation; local tests do not deploy them. See `OPERATIONS.md` for the complete boundary and staging procedure.
