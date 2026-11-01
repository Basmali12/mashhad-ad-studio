# Private narration/video integration — 2026-11-01

User requested continuation through a real video test and GPU operation. Completed a 15s portrait 720p film with one newly generated 5s shot and two previously successful saved clips. The existing 15s solemn 3arab narration was reused without paid synthesis, timing changes or intentional word cuts. No OpenAI call, new video weights, production publication, account-limit change, rental or wallet mutation occurred.

`engine/three-arab-film-track.mjs` admits an already-generated, explicitly approved private admin narration into existing tenant-owned production-assets. It verifies the actual native request claim/model revision, PCM hash, exact story text, 48kHz mono duration, watermark evidence and immutable per-project narrator style binding. Reuse is idempotent; wrong user, changed source or voice change fails. This is not a general customer 3arab inference Adapter or public admission route.

`scripts/private-three-arab-video.py` uses the already prepared accelerated Wan model and exact-account independent watchdog. A bounded optional trial_limits argument in the existing LightWan app factory leaves original defaults unchanged. New scope used one GPU call, no retries, 180s execution/180s startup, RTX PRO 6000, CPU4/RAM128GiB. Native 81 frames at 16fps produces 5.0625s; final assembly uses 5.000s of each clip, never looping/freeze-filling a missing shot.

`scripts/assemble-three-arab-video.mjs` exercises the actual production asset resolver, shared soundtrack assembly, final artifact save, thumbnail and media library. Final film is 15.000s, 720x1280, H.264/AAC with faststart and a verified real thumbnail. Only final film is indexed; internal clips remain internal. Original source media and previous films remain unchanged. Local Store is a private test namespace, not the production database.

Measured new shot: model load 29.791s; pipeline 47.279s; local final assembly 9.51s. Final resource observation confirms stopped App, zero tasks and zero active Apps. Recorded usage rose from $4.92303117 to $5.06303117 ($0.14); billing may lag and this is not a final invoice. Usage cap remains $6.35, Spend $0. Configured compute-window estimate was ~$0.424, without claiming it as a guaranteed bill ceiling.

Review: file decoding and browser media readiness passed. Sampled frames show consistent-looking face/clothes/room, but motion is subtle and the requested doorway turn was not clearly achieved. No captions were visible in sampled frames; this is not frame-complete OCR or identity certification. Pronunciation, end-of-sentence completeness and aesthetics remain human review items. Nothing was deployed or enabled for general customer production.

Machine-readable receipts and media paths: `three-arab-video-trial-20261101.json`; actual immutable outputs are under the workspace work/three-arab-video-trial1 folder. Local preview: /video-trial.html on the existing loopback preview server.
