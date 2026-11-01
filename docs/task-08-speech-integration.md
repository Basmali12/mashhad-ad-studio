# Task 08 — hybrid speech integration (local implementation)

Implemented on `codex/ltx-film-engine-integration`, 2026-10-31. Task 09 was not started. No weights downloaded, cloud containers built, GPU allocated, OpenAI called, production services restarted, domain changed, backup created, or release published during this task.

## Boundaries and entry points

- `engine/speech-integration.mjs` composes the existing registry, billing and durable production engine with four independent adapters. It does not replace account/token encryption, administration or customer rental management.
- `engine/speech-policy.mjs` maps agreed dialects to specialized Habibi IRQ/EGY/MSA. An approved Audar profile uses explicit `ar` or `en`; it is never an automatic substitute for an Iraqi or Egyptian speaker.
- `engine/voice-profiles.mjs` provides server-side owned reference import, immutable profile approval, speaker binding and hash-verified reads. References require a consent/licensing attestation, a supplied transcript and original PCM16 mono 16 kHz WAV of 5–12 seconds. This is not proof of consent or transcript accuracy; the operator must hold the actual rights.
- Profiles may be reserved for owned draft-project character IDs before planning. The local planner receives safe approved profile choices. After planning, speaker IDs must exist in the Character Bible or narrator list. Each narrator has an independent ID/profile; a narrator is not an unnamed character.
- No new customer/admin screens were introduced. This is the internal production-service integration; the local non-billable planner seam is unchanged. It does not claim that the live website has an enabled speech workflow.

## Runtime and licensing

Pinned sources, file manifests, hashes, licenses, offline loading and future deployment commands are documented in [task-08-speech-runtime.md](task-08-speech-runtime.md).

Specialized Habibi Apache-2.0 checkpoints only; the unified noncommercial checkpoint is excluded. Audar has its own license and a gated NeuCodec dependency. Both Audar and codec acceptance are explicit, closed-by-default server flags. A future preparation operation also requires the account-owned `mashhad-hf-read` Modal Secret with authorized `HF_TOKEN`; metadata presence does not prove model access. No terms were accepted and no gate bypass was implemented during this task.

Python speech images are independent of the video environments: Python 3.12, torch/torchaudio 2.8.0+cu128, pinned Habibi source and pinned Audar source. All inference dependencies load lazily. The local NeuCodec constructor loads its verified codec and semantic encoder offline instead of allowing upstream implicit downloads.

Speech deployments admit L40S, CPU 2 or 4, RAM 16 or 32 GiB. No automatic RTX PRO 6000 allocation. The low-level backend can select CPU, but CPU-only customer engines are not exposed by the existing GPU registry. These resource settings have not been benchmarked with real inference and are not an OOM/performance guarantee.

Default gates in `.env.example`: `FILM_SPEECH_PAID_ENABLED=NO`, `FILM_AUDAR_LICENSE_ACCEPTED=NO`, `FILM_AUDAR_CODEC_LICENSE_ACCEPTED=NO`. Existing global paid and per-operation approval gates remain authoritative. Adding an account, importing a reference, planning or opening a page cannot allocate GPU.

## Exact text, voice identity and long-film state

The plan supports `dialogue`, `narration` and capability-bounded `vocal_event` utterances. Audar expressions are the official eight tags: laughs, curious, excited, sighs, exhales, mischievously, whispers and sarcastic. The transport adds brackets only when building the native Audar prompt. The stored expression metadata accepts the validated canonical name or its exact bracketed form. Habibi rejects unsupported expression requests. Pure tag-only screaming/crying/laughter generation is not claimed as an upstream supported API.

Text is divided on word/sentence boundaries using conservative backend limits. Concatenating chunk texts reconstructs the original received utterance exactly; source text offsets are not word timestamps. Explicit pauses at valid text offsets are preserved as measured PCM silence. Chunk seeds derive deterministically from the immutable profile seed and chunk index. No profile/model/dialect switch occurs between chapters or retries.

Plans remain 10 seconds–60 minutes. Narrators may span multiple shots, and scenes without dialogue remain valid. Multi-part utterances have separate `voice_chunk` stages and one local `voice_merge` stage; successful chunks survive restart. A failed chunk requires the existing explicit retry/approval process. Ambiguous output is followed through the CPU receipt path without automatically synthesizing again. Every chunk uses the existing scoped attempt and wallet reservation/settlement.

The `audio` approval phase isolates speech and local speech merging from images/animation. A single returned receipt contains only its owned asset IDs. Gateway DTOs expose speaker roles and narrator IDs, never reference bytes, paths or credentials.

## Assets, timing and accounting

Original output is PCM16 mono 24 kHz WAV with SHA-256, actual sample count/duration, text, profile fingerprint, model/revision, expression, speaker, scene IDs, source offsets, planned start/end, and attempt provenance. Files use the existing private production directories and entities in the Store/PostgreSQL abstraction; WAV bytes are not database blobs. Reads verify ownership, canonical paths, no symlink escape, hash and active attempt binding.

Local merging concatenates verified native PCM once in chunk order, inserting only explicitly requested pauses. It does not time-stretch, trim speech, remove silence, invent elapsed word positions or invoke a second TTS. Overlong speech is saved with `timingReview.required`, then requires timing replanning before soundtrack rendering. Word timings remain `null`, transcription and acoustic identity remain unverified. Lip synchronization is left to the later task.

Requests record configured GPU/CPU/RAM, inference seconds when available, actual output duration, confirmed runtime through stop, customer hourly settlement, and separately recorded provider USD only when supplied. The 1,500-second conservative resource-window estimate is not expected inference time or a guaranteed bill cap. References and profile metadata do not guarantee accent, gender, naturalness or identity preservation.

## Verification evidence

- Node backend suite: 372 passed, no failures/skips, including real production orchestration with mocked TTS for 60-second and 10-minute films, restart, immutable speaker IDs, exact text/chunk ordering, native WAV persistence and one-chunk approved retry.
- A 60-minute storyboard is validated without allocation. This is planning evidence, not a generated one-hour audio test.
- Voice profile/audio tests exercise consent/rights validation, tenant isolation, immutable references, corruption/symlink rejection, eight-expression admission, overlong timing review and actual PCM merge/pause sample counts.
- Transport/runtime tests use mocks and official SDK registration offline; no model weights or synthesis are involved.
- Python: 153 tests passed. Source/destination image-order validation passed without cloud execution.
- Gateway: 42 tests passed, including bounded audio phase, narrator DTO allowlisting and no worker access.
- Frontend: 691 tests across 167 files passed. TypeScript checks and customer/admin Vite builds passed; reels runner bundles built without starting a service.
- Repository lint and explicit speech-module unused-variable lint passed. UTF-8 audit passed.

Actual model installation/build, gated Audar access, native TTS quality/dialect/voice consistency, memory demand, synthesis speed, cloud accounting and deployment are untested. Real cloud inference remains deliberately disabled pending later authorized preparation/testing.
