# Task 12 — long-film local readiness evidence

Scope: the actual `createProductionEngine` state machine and Store, with deterministic non-billable planning, mocked model execution and mocked final artifacts. No model weights, GPU, OpenAI, cloud, deployments, downloads or backups are involved. These tests do not prove model quality, FFmpeg memory use, production networking, commercial rights or live cloud stopping.

## Fresh verification

`services/film-engine/tests/task12-readiness.test.mjs` covers 30, 60, 300, 600, 1200 and 3600-second projects. Shots remain ten seconds; chapters/scenes partition exact time boundaries. All runs use final-composer quality/save dependencies. The 60 and 1200-second fixtures additionally opt into cinematic alignment/timeline stages. Every mocked dispatch checks that its dependency was already durably completed.

Each duration checks: no dispatch/debit while planning or quoting; explicit idempotent double approval; durable checkpoint after five stages; restart with a fresh worker; completion without duplicate successful dispatches, attempts or charges; fixed character/voice/text identity; ordered unique event IDs; no final result before completion; chapter merges; quality before final save. Separate cases cover a second-chapter failure without replaying the completed first chapter, uncertain spend/stop state retaining its accounting hold across recovery without automatic resubmission, cross-user denial, the closed execution switch and funds lost before admission.

Diagnostics record actual shot/stage/attempt/charge row counts and elapsed local test time. Counts are bounded logical-work evidence, not a heap/VRAM guarantee. The ten-second shot size is a fixture choice, not a claim that every future model supports the same runtime/duration.

Fresh focused run: **9/9 tests passed**, total approximately 164 seconds; focused ESLint passed. The 3600-second Mock completed all **1449 stages**, with **360 shots**, **1447 attempts** and **1447 settled charge rows**, including checkpoint/restart, in approximately 147 seconds. Other durations completed with 21/35/129/249/491 stages respectively (30/60/300/600/1200 seconds). These accounting rows belong only to disposable local test Stores and represent synthetic costs, not real billing.

## Read-only implementation audit

- Planning validates ten seconds through sixty minutes and separates persistent chapters, scenes, shots, utterances and identities. DAG stages are independently persisted and approval/quote hashes bind the plan revision.
- Stage receipts are tenant/project/attempt-bound. Settlement requires confirmed cloud stop; uncertain submission is retained for reconciliation and is not silently repeated.
- Assembly fingerprints include source IDs/SHA/durations, format and audio/edit settings. Sources are verified again before committing the resulting canonical group file. This supports reuse of confirmed identical work rather than an unscoped filename cache.
- Source-ID final export streams input chunks and verifies hashes. Artifact verification has a 64 GiB bound; direct byte inputs and `readFinal()` use the smaller 512 MiB buffered helper. Large output consumers therefore need the existing authenticated file/media streaming path; the buffered helper is not a general sixty-minute delivery guarantee.
- The public media library enforces seven-day visibility/deadlines and removes final exports/tickets when cleanup runs. At the audited snapshot, its removal path does not delete the new private `production-assets`/`production-groups` intermediate trees or tombstone `production-result`; private intermediate retention needs a deliberate policy before promising full storage reclamation.
- Worker stage lookups scan/filter stored stage rows repeatedly. Full Mock completion establishes correctness at these fixture sizes; it does not establish concurrent long-film throughput or bounded process heap. Streaming production export reduces one large-buffer path but does not replace load/soak tests.

Findings above were sent to the parent implementation agent. No production code was changed by this audit. Any later parent fixes should be recorded separately with their own verification evidence.
