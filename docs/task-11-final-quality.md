# Task 11 — final-film CPU quality observations

`services/film-engine/engine/final-film-quality.mjs` adds a bounded, local FFmpeg quality pass through the existing owned production-asset resolver. It accepts ledger IDs and validated expected dimensions/duration/audio policy, never a caller file path, URL, shell command or raw stderr response.

## Implemented evidence

- Full video/audio decoding uses `execFile`, no shell, `-xerror`, `-err_detect explode`, a file/pipe protocol allowlist, two decode threads and one filter thread. Timeout is bounded at two hours and stdout/stderr at 16 MiB. The original movie is streamed by FFmpeg and the existing SHA verifier; the whole movie is never read into a JavaScript Buffer.
- Structural metadata derives from decoded input streams, actual frame/progress reports and final sample counts. Required audio, duration/dimension mismatches, corrupt MP4s and missing tools fail explicitly; they never become a successful quality record.
- FFmpeg `blackdetect`, `freezedetect`, `silencedetect` and `astats` produce observations. Intervals require finite, ordered, in-range values. A final open freeze/silence interval closes at the measured end of decode, rather than at a guessed scene boundary.
- Default observation thresholds: ≥0.5-second mostly-black interval (98% picture threshold, 0.1 pixel threshold); ≥2-second freeze at −50 dB difference; ≥0.75-second silence at −50 dB; clipping suspicion at >0.1 dB peak, or ≥−0.1 dB with ≥0.001 peak/sample ratio. Audio/video duration drift above 120 ms is a review finding. These are configurable-in-code heuristics, not proof that a cut, silence or freeze is artistically wrong.
- Approved intentional black/freeze/silence windows stay present in the measurements with `intentional:true`. A global `allowSilence` policy suppresses silence findings only; it does not insert sound or alter PCM. Exact optional `intentionalSilenceIntervals` avoid globally exempting a film with one deliberate pause.
- Audio absence is accepted only when it is not required. Missing audio statistics remain unknown rather than fabricated zero clipping. The clipping status is `suspected`, `no_evidence` or `not_measured`, not a guarantee of clean speech.

## Durable review/cache contract

`createFinalFilmQuality({store,now,runner?,ffmpeg?,verifyVideo?})` provides:

- `inspect({customerId,projectId,assetId,expectedDurationMs,expectedAudio,expectedWidth?,expectedHeight?,intentionalBlackIntervals?,intentionalFreezeIntervals?,intentionalSilenceIntervals?,allowSilence?})`.
- `read(customerId,projectId,assetId)`.
- `review({actor,customerId,projectId,assetId,reviewed:true,accepted:true})`, where `actor` is a trusted server-derived administrator or owner identity.

Rows in `production-quality` are keyed to tenant/project/asset, source SHA-256 and settings fingerprint. Concurrent identical scans share one process; retries with unchanged bytes/settings reuse the result. Every read/review/cache lookup verifies the current owned file/hash first. A changed source, path or settings cannot inherit approval from an older scan.

Safe DTOs contain source/settings hashes, observations, findings, measured dimensions/duration/audio and review state. They omit original paths, raw tool output and credentials. Review is hash/settings-bound and idempotent, audited through the existing Store; it does not touch wallet balances or regenerate content.

Initial status is always `needs_review`, including structurally sound clips with no technical findings: no reliable local classifier was installed for general cinematic quality, face identity, dialect accuracy or lip synchronization. Explicit human acceptance changes status to `reviewed`/`needsReview:false`, while `visualQualityCertified`, `voiceIdentityVerified`, `dialectVerified` and `lipSynchronizationVerified` remain **false**. Human review is not converted into an automated certification.

The final composer/production coordinator owns when this check runs, what policy is approved, how a failed/review-required stage resumes and when a final file becomes visible. This module does not independently publish a movie, start GPU, call an AI service or alter source files.

## Fresh local validation

`node --test services/film-engine/tests/final-film-quality.test.mjs` with the existing CPU FFmpeg binary: **7 tests passed, no skips**. Real tiny H.264/AAC fixtures verify motion+tone, black/frozen frames, silence, loud clipping suspicion, intentionally soundless output, missing required sound, corrupt containers, dimension/duration rejection, cache/review reuse and ownership/path/hash isolation. Injected malformed output proves unavailable tools, missing decode evidence and nonfinite observation rows do not produce a stored success. Explicit source unused-variable lint passed.

No GPU, model download, paid API, deployment, backup or Task 12 work was performed. The tests do not certify real generated film quality or demonstrate scanning a real 60-minute production.
