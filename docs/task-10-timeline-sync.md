# Task 10 — cinematic measured-timeline composition

`services/film-engine/engine/cinematic-timeline-sync.mjs` exports synchronous `buildCinematicTimeline({plan,audioAssets,alignments,videoAssets,cueBindings=[],minConfidence=.6})`. It is a pure metadata composer, not a model runner, media decoder or rights/tenant authority. Callers must resolve and verify owned original assets using the existing production storage before supplying metadata. This module does no filesystem, network, GPU, OpenAI, FFmpeg or paid work.

## Input bindings

- One final original speech WAV per utterance, with `assetId` (or `id`), `utteranceId`, `speakerId`, `voiceProfileId` (or `profileId`), actual `durationMs`, `samples`, `sampleRate`, and SHA-256. Sample-derived duration must match the supplied duration within 1 ms. Each speaker/profile must match the approved plan's character or narrator. Duplicate or unknown asset/utterance IDs, mismatching owners when scope metadata is present, and changed sample metadata fail closed.
- Alignment binds the same utterance, speaker, profile and original audio SHA. Accepted successful statuses are `aligned` or `completed`. Word timings must be ordered, in the actual audio bounds, match the original supplied transcript after punctuation/spacing normalization, and have numeric confidence at or above the configured threshold. Sentence timings, when supplied, are validated independently; they are not guessed from word counts.
- Original video metadata binds one unique verified clip to each shot; its actual duration bounds every chosen source interval. `assetId` and `id` are supported aliases. A missing clip is a review condition, not permission to reuse another clip or fabricate output.
- A cue is explicit `shot.audioCue={utteranceId,wordIndex,sentenceIndex}` or an equivalent external `cueBindings` row with `shotId`. Indices are zero based. Exactly one word/sentence index may be set; both null means the actual audio-track start. Conflicting duplicate cues fail closed. Cue targets come from the measured alignment, never keyword substring/character-length guessing.

## Scheduling

Nonoverlapping utterance groups retain their planned narrative order and explicit positive gaps, but each group uses the real WAV duration. A shorter utterance moves subsequent groups earlier; an overrun moves them later. No speech is trimmed, repeated, sped up or regenerated. Narration remains one original audio track with `sourceOffsetMs=0` across all visual cuts. Connected planned overlaps retain their relative start offsets, and unapproved overlapping speakers are marked for review.

Measured word/sentence cues anchor picture boundaries. Between those explicit anchors, ordered existing footage is redistributed using the planned relative pacing and its actual available durations. This is a proposed picture edit, not word timing inference or proof of natural motion. It does not impose five- or ten-second picture cuts. Each original clip is used once, with a source interval starting at zero and ending no later than its measured native duration.

When the available footage cannot cover the real audio window, the composer retains the audio clock, sets `needsReview`, and emits `visualExtensionRequests` with `approvalRequired:true` and `automaticExecution:false`. It never freezes a frame, loops, stretches video, calls a model or silently cuts the narration. A native-versus-container timing discrepancy of at most 80 ms is recorded separately as `roundingMs` for the parent's frame-grid normalizer; it is not presented as extra source footage. Sub-80-ms picture cuts are marked for review.

## Output and confidence

The output contains measured duration, shot/source intervals, original audio tracks, flat absolute word/sentence rows tagged with speaker/profile/utterance, and `alignmentStates` for each utterance. Missing, failed, low-confidence, wrong-hash/profile or transcript-mismatching alignment has `words:null` and `sentences:null` in its state, and does not create precise narrator cues. Known actual audio duration remains available even when alignment fails. Raw tentative alignment evidence remains the responsibility of the parent's durable alignment assets.

`needsReview` and explicit reason codes identify missing data, wrong cues, overlap, insufficient footage and normalization concerns. `quality.acousticAlignmentVerified`, `quality.lipSynchronizationVerified`, and `quality.faceIdentityVerified` remain false: consistent metadata or successful encoding is not an acoustic/visual quality test. The parent separately handles targeted-face LatentSync, consent, persistent stages, cost approval, artifact handoff and final FFmpeg normalization.

## Local evidence

Nine pure tests pass (including explicit human acceptance of valid low-confidence evidence): narrator word cue and continuous audio, two distinct voices, shorter real speech without padded dead air, visual-coverage overrun requiring approval, missing/failed/low-confidence/mismatched alignment, changed/duplicate/foreign metadata, actual sentence cues with deliberate pauses, and a ten-minute metadata film with 120 clips and 1,000 aligned words. Input immutability is asserted. Explicit ESLint passes. These are local metadata/Mock checks, not actual forced-alignment accuracy, facial identity, GPU performance or LatentSync quality evidence.
