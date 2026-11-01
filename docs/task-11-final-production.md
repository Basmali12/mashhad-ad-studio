# Task 11 — final cinematic composition

Local-only work on `Basmali12/mashhad-ad-studio`, branch `codex/ltx-film-engine-integration`. Preserves existing dirty task 1–10 work. No commit/push, deployment, DNS, paid API, GPU, model download, new backup or task 12 work.

## Integrated path

The existing approved director plan, character/scene images, selected Wan/Hunyuan clips, original Habibi/Audar voice assets and task-10 synchronization checkpoints feed the same durable production engine. The opt-in final composer adds `quality` between `merge` and `save`; the platform installs this composer, while previous isolated adapter fixtures remain compatible. Public APIs still cannot call worker `run`.

The director has a strict structured-effect schema compatible with existing scripts, sees at most 64 own-project approved SFX metadata entries, and proposes event-linked effects without inventing files, licenses or measured visual timings. Original dialogue and source anchors are unchanged. New fields are validated again by the production plan; model prose never authorizes resources or overrides rights.

## Effects and audio

- `sound-effects.mjs` stores bounded uploaded/local-library PCM WAVs in the existing private production asset namespace, with actual sample duration, SHA, source and explicit license attestation. No sound pack, scraped Internet audio, free commercial-license assumption or generation API is bundled. Wind/rain/doors/vehicles/crowds/nature/historical atmospheres use descriptive library names under ambience/foley; character vocal synthesis retains the approved speech profile. Actual natural effects must be supplied as appropriate licensed/user-owned audio.
- `sfx.event.approve` binds a reviewed event offset to the actual completed original shot SHA, event ID and source window. Trim provenance maps it onto measured edits. Missing, stale, multiple or unreviewed evidence yields `needs_review`, never arbitrary placement at scene start. This is reviewed timing evidence, not an automated semantic detector that recognizes a door opening.
- Music is explicit opt-in. Silence is an explicit window without fabricated audio; windows overlapping speech are rejected. No implicit sound looping, silence filling, or audio/video stretching is performed.
- `production-mix.mjs` builds separate narration/dialogue/vocal-event and ambience/foley/music buses, 48-kHz stereo normalized formats, per-track gain and speech-keyed sidechain ducking. Background defaults duck during speech. Sources remain immutable.
- A real hot-mix test exposed AAC overshoot despite an initial limiter. The final graph disables limiter automatic makeup, oversamples to 192 kHz for limiting, uses conservative 0.63 peak headroom, then resamples to 48 kHz before AAC. Decoded stressed-fixture peaks stay below full scale. This fixture is not a universal true-peak or perceptual-quality guarantee; final observations remain necessary.

## Composer, long-film bounds and recovery

`final-film-composer.mjs` orders sources from plan IDs, not response arrival order. It uses measured task-10 edits, preserves one original continuous narrator through chapter-local source windows, and mixes selected voices/effects at measured absolute times. Default transitions are clean cuts. A requested subtle fade (maximum 500 ms and half a shot) stays inside existing footage without shortening audio or introducing overlap; no gratuitous transitions are inserted.

Chapter pages contain at most 32 video sources and 256 audio tracks. Nested final groups contain at most 64 sources. Original media is read from canonical private files, FFmpeg works from disk, final export copies stream, and `resolveFinal` exposes a scoped streaming file seam instead of loading an hour into RAM. `readFinal` remains a bounded legacy small-buffer helper and is not the customer playback path.

Both assembly and final-copy preflight available disk space. Actual duration is separate from requested duration. Output uses verified 720p portrait/landscape canvas and 25 fps for normal plans, with explicit project/test overrides. Different native clip formats are normalized; originals remain unchanged. Padding is limited to one conversion frame, and insufficient actual footage is a failure/replan condition, not a long freeze or another paid generation.

Group fingerprints, project revision group namespaces, successful records, checkpoints and progress prevent repeating completed chapter pages on retry. A failed chapter leaves others intact. Existing unknown GPU attempts remain uncertain with their accounting holds untouched. A trusted internal `recoverLocalProduction({processStoppedConfirmed:true})` seam can clear interrupted local writer intents and reconcile **zero-cost, non-model** local attempts only after the operator proves the previous local process stopped; it is not a browser operation or an assumption that an ambiguous paid dispatch failed. Then normal explicit retry/approval resumes only the failed stage. Default startup remains conservative; it does not silently replay work. Same-project replacement of an already published different final artifact remains refused by the existing immutable result contract; this task does not silently overwrite user files.

## Quality, files and costs

See `task-11-final-quality.md` for real FFmpeg black/freeze/silence/clipping/drift observations and `task-11-sound-effects.md` for the library contract. Corrupt output or structural mismatches fail. Semantic facial deformation, voice identity, dialect accuracy and lip synchronization are not certified; the final stage remains `needs_review` until an explicit hash-bound human acceptance. Acceptance records review, not technical certification, and cannot bypass LatentSync commercial rights.

The existing files service receives only the final verified/exported film. It preserves title, actual duration, dimensions and byte size, extracts a small WebP from the actual video, and uses the existing temporary signed media route for both poster and MP4. Poster requests renew without rendering, older films fall back to the existing client preview, and layout/CSS remain unchanged. Playback uses HTTP range streaming; download and delete keep current ownership and seven-day final-media retention. Internal clips are not listed as completed customer movies.

`production.costs` is a read-only roll-up of existing stage charges, holds, uncertain attempts, scoped confirmed runtime histories and OpenAI planning/search charges. Resource time comes from actual histories, never film duration. Customer hourly charges, estimates and known supplier figures remain distinct; unknown provider, storage and additional fees are null. Refreshing these endpoints never books/settles a charge or dispatches work. `production.get` adds backend-derived activity labels and measured duration.

## Verification

Real local CPU fixtures exercise mixed dimensions/frame rates, different clip durations, continuous narrator progression through two chapters, two dialogue tracks, measured event mapping, ducking, silence, stressed AAC peak headroom, full MP4 decoding, actual WebP extraction, private file publication, signed HTTP poster/video ranges and renewal, deletion, disk failure, insufficient footage, chapter reuse after failure, quality review/resume and tenant boundaries. Fixtures are synthetic patterns/tones/WAVs and do not demonstrate generated human voices, native model quality or lip-sync quality.

Mocks cover 60-second and 10-minute checkpointed film execution, retries/duplicate charges, sixty-minute hierarchical planning, model-selection/privacy/approval regression, licensed SFX and measured-event failures. No complete real 60-minute render, live PostgreSQL deployment, cloud model execution or live mobile/browser interaction is claimed by this task.

Fresh verification results (2026-10-31):

- `npm run film:engine:check`: **484 passed**, zero failed/skipped. Includes **8** final-production real CPU/integration tests, **7** real quality tests, **12** SFX tests, continuous narration/two-speaker audio, authenticated poster/MP4 streaming, AAC stress and recovery.
- The final quality-renderer silence-window handoff was then checked again with the 15 final-production/quality tests: all passed, no skips.
- `npm run film:gateway:check`: **63 passed**, zero failed/skipped, including eight task-11 public-boundary tests.
- `python -m unittest discover -s services/film-engine/tests -p 'test_*.py'`: **171 passed**; no native model inference.
- `npm test -- --maxWorkers=2`: **691 passed** across **167** files.
- Customer/admin builds and their four TypeScript configurations passed. Existing Reels worker bundle passed, no service started.
- Repository ESLint and explicit new Node module/test ESLint passed; Git whitespace check passed with the pre-existing CRLF normalization warning only.
- Existing Modal SDK source/destination image-order validator passed without cloud hydration/RPC (`SOURCE_AND_DESTINATION_IMAGE_ORDER_VALID_NO_CLOUD`).

The initial hot AAC mix regression was preserved and corrected by the codec-headroom path, not by weakening the output peak assertion. The local worker-recovery test also exposed a nested transaction error; settlement now uses the existing billing API outside the enclosing state-update transaction, and explicit recovery of zero-cost local work leaves uncertain GPU admissions unchanged. The HTTPS ticket test uses the existing trusted-proxy HTTPS header on loopback; production HTTPS protection was retained.

No weights, cloud builds, GPU, OpenAI or other paid requests were executed. All documented generated media fixtures are synthetic local CPU files. No production or source push occurred.


## Remaining commercial gate

LatentSync remains disabled by default. Its InsightFace pretrained-weight commercial rights and actual GPU quality/compatibility still require resolution and later authorized testing. No rights flag was activated or weights fetched here. Available local effects require valid actual media and usage rights; an upload attestation is not independent license verification.
