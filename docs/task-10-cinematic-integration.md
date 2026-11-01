# Task 10 — cinematic synchronization (local integration)

Scope: task 10 only, on `codex/ltx-film-engine-integration`. No deployment, live inference, weights, cloud build, OpenAI call, backup or DNS change. Existing accounts, wallet accounting, GPU registry and layout are retained. No task 11 work.

## Production wiring

- The existing model catalog has an inactive pinned `latentsync16` definition. Its adapter, private transport and Python Modal runtime use the existing scoped admission, quotes, encrypted credentials, metering and confirmed stop; opening a project cannot dispatch it.
- `production-plan.mjs` adds an opt-in, topologically ordered synchronization DAG: native speech chunks → actual CTC alignment chunks → sample-count alignment merge → measured timeline → selected visible-speaker lip synchronization → local shot edits → bounded chapter/film assembly. Narration and off-screen dialogue do not require lip synchronization.
- `synchronization` is an explicit production quote phase. Missing rights, unprepared definitions or missing bindings block paid admission. An ambiguous provider submission remains uncertain and cannot be automatically repeated.
- Successful chunks, voices, image/video sources and lip outputs remain private checkpoints. Failed/low-confidence decisions enter `needs_review`; explicit review/retry resumes only the affected stage, using a new approval when any resource operation is involved. Completed successful stages are not automatically regenerated.
- Source images, video, 24-kHz PCM voices and native word-timing evidence stay separate. `audioCue` points to an actual aligned word/sentence. No word clock is estimated from text length or speech character count.
- Measured duration is separate from requested duration. Final artifact verification uses measured duration. Unchanged plan adoption rebases a retained timeline checkpoint; changed cues or source dependencies invalidate affected descendants while retaining unchanged generated assets.

## Media and long-film bounds

- `cinematic-media.mjs` performs local CPU FFmpeg normalization: 25-fps H264/yuv420p silent conditioning video, 16-kHz mono PCM conditioning audio, preserving source hashes and originals. No dialogue speed alteration or wholesale silence removal. At most one frame (40 ms) of padding is permitted for format rounding, never a long frozen extension.
- A picture boundary through an actual spoken word requires review. Insufficient video emits an extension proposal with `approvalRequired:true`, `automaticExecution:false`; it never spends on additional footage automatically.
- Native LatentSync's muxed conditioning track is removed from its derived output. Final chapter assembly places the original approved voice track once across visual cuts, preserving its voice-profile identifier. Chapter/final audio source windows use measured time; sound-effect windows are checked after retiming.
- Existing FFmpeg assembly remains disk-backed and grouped to bounded input sets (64 video sources and 256 audio tracks per group). Alignment follows existing <=120-second speech chunks, instead of holding an hour's model input in memory. Timeline responses page at <=200 entries. All file access is resolved from owned ledger IDs and hashes, never caller paths/URLs.

## Public seams and honest quality state

`sync.face.approve`, `sync.asset.get`, `sync.review`, `sync.timeline.get` use server-derived tenant identity, existing authentication, gateway input validation and safe metadata DTOs. Private paths, request payloads, raw bytes, credentials and rights evidence never belong in these responses. No UI redesign was performed.

Initial native support requires exactly one explicitly bound face in every sampled frame. Multiple/absent faces are not handled by choosing the biggest face; they stop for review. Separate single-speaker shots can express a two-character conversation. Native face checks are not identity recognition.

Actual Arabic CTC emissions supply timing; missing/failed confidence yields null timings/review, never fabricated accuracy. Iraqi/Egyptian dialect accuracy, lip offset, face preservation, artifacts and real throughput are **not certified** by metadata, Mocks or successful FFmpeg decoding. Human visual/acoustic review is represented explicitly. `qualityCertified` and public quality verification flags remain false.

## Licensing blocker and future activation

See `task-10-latentsync-runtime.md` for source revisions, hashes, dependencies and exact rights. LatentSync code licensing is distinct from its model and face-detector dependencies. The pinned InsightFace pretrained face weights are not generally licensed for commercial use. **A real commercial grant or a verified replacement is required before customer use.** No such grant was obtained in task 10. An environment flag or typed reference is an operator attestation, not a license grant or automated verification of rights.

All new `FILM_LATENTSYNC_*` execution/license/face-rights switches default to NO, with no rights reference. No weights were downloaded. Separate runtime images prevent conflicting video/speech dependencies from being silently replaced.

## Verification record

Task-specific coverage includes measured narrator word cues across clips, two voice identities, short actual audio, deliberate pauses, low-confidence review, explicit acceptance preserving raw scores, missing visual coverage, multi-face rejection, correct native requests, failure/confirmed-stop behavior, duplicate prevention, ordered chunk/sample merging, safe tenant boundaries, ten-minute metadata and durable production Mock checkpoints, and real local CPU FFmpeg fixtures. All native generation/model responses are Mocks; the FFmpeg fixture is a synthetic local blue clip and PCM, not generated character content.

Fresh local results (2026-10-31):

- Backend Node tests: **455 passed**, none skipped/failed, with an explicit preinstalled local FFmpeg binary. Includes actual CPU media normalization and durable Mock production tests.
- Python unit tests: **171 passed**, including **18** dedicated LatentSync/CTC/bridge tests. Native model inference remains mocked.
- Gateway tests: **55 passed**, including safe sync DTOs, identity isolation and no private-field echoes.
- Frontend tests: **691 passed** across **167** files.
- TypeScript, customer build, admin build, existing worker bundle, repository ESLint and explicit new synchronization-module ESLint passed. Python `compileall` passed.
- Existing pinned Modal SDK image-order structural validator passed with `SOURCE_AND_DESTINATION_IMAGE_ORDER_VALID_NO_CLOUD`; it performs no cloud hydration/RPC.
- Git whitespace check passed (one pre-existing line-ending normalization warning only).

An initial full run lacked the preinstalled FFmpeg path, exposing CPU-fixture setup failures. Supplying the existing binary resolved them; no install or download was made. Added catalog entry also required updating fixed 8-entry expectations to 9. A renderer regression caused by comparing two absent revision fields was reproduced and corrected. Final totals above are from successful fresh checks, not the initial runs.
