# Habibi narration quality — local candidate, 2026-11-01

No deployment, GPU, weights, paid API, voice service or provider/account mutations in this task. Existing IRQ/EGY/MSA and Audar contracts remain. Original film, source recordings and receipts were not rewritten.

## Runtime connection

- `engine/narration-styles.mjs`: five performance templates, not five fabricated speakers. `deep-majestic`, `rough-moving`, `calm-reverent`, `documentary`, `epic-story`; native speeds .97/.98/.94/1/.98. Habibi expression remains `neutral`. No emotion/pitch parameter is fabricated.
- `engine/narration-profiles.mjs`: `register` requires administrator authority, owned reference bytes/transcript, signal checks, a traceable rights document/source with voice-use permission, explicit production scope, and human listening checks. Private benchmark references are ineligible. `select` matches Arabic descriptions and only returns admitted references owned by the customer; `bind` uses existing immutable Voice Profiles and per-project speaker bindings. `createSpeechServices().narration` exposes these backend methods without creating a new UI or changing rental routes.
- Existing director context receives a style recommendation and approved profiles' style metadata. Its prompt selects existing approved voices or reports a missing licensed reference. Suggestions are not synthesis dispatch or payment authorization.
- `engine/speech-text.mjs`: a separate synthesis copy uses NFC, removes invisible format controls/tatweel, maps Arabic punctuation/ellipsis and collapses whitespace. Optional `plain` policy removes vowel/recitation marks; `preserve` keeps user diacritics. Never rewrites story events, names, reference transcript, or stored exact utterances. Plain is a candidate policy, not a linguistic guarantee: diacritics, names, numerals and religious orthography need listening/text review. Do not use this to claim correct Qur'anic recitation.
- The selected reference, model revision, native speed, seed, text policy and mastering settings are fingerprinted in the immutable profile. Existing unstyled profiles retain their original exact synthesis text. Both transport admission and recovery check the authorized synthesis-copy hash against the unchanged original plan; arbitrary changed words are rejected.
- `speech-integration.mjs`: approved style settings reach the actual Habibi adapter; planned pauses become existing PCM-merge silence at punctuation boundaries. No forced durations, word cuts, audio retiming or random voice fallback. The frozen reference is rechecked before execution. Native runtime binds speed with identity, and its safe chunk byte calculation accounts for slower synthesis.
- `engine/narration-mastering.mjs`: local FFmpeg high-pass 65Hz, +0.8dB gentle warmth at 180Hz, 1.5:1 compression, limiter with latency compensation, then bounded gain (at most +6dB toward -19dB RMS with peak headroom). RMS is not LUFS. No denoiser, pitch lowering, generated rasp, time stretch or silence trimming. Exact sample count, mono/24kHz and clipping are checked. These are signal tests, not intelligibility/timbre certification.
- `speech-audio-assets.mjs`: new opted-in mastered outputs retain immutable `native.wav` beside `audio.wav`, source/output hashes and processing evidence under the same owned asset/retention folder. Legacy unprocessed asset binding remains compatible. Production timing still requires real output duration.

## References and honest readiness

Current `docs/private-habibi-reference-evidence.json` explicitly limits old benchmark references to private functional testing and has no listening clearance for five narration identities. None were silently imported as production voices. No celebrity, commercial voice-library sample or person recording was downloaded/cloned in this task. Five suitable voices are **not yet cleared**. Admission requires a recording/license permitting the proposed voice use or speaker consent, accurate transcript, clean signal and human audition. Admin attestations record evidence; they do not automatically establish legal rights or acoustic quality.

Upstream reviewed:

- https://github.com/SWivid/Habibi-TTS/blob/3b4d793481f1a8e686a2229c6d7946c5d9f6b8c0/src/habibi_tts/infer/utils_infer.py — 24kHz, reference-conditioned synthesis, native speed, byte-derived duration, 22s chunk context and the Arabic reference/target boundary. Existing `habibi_target_text` separator regression remains covered. Upstream overrides extremely short target text below ten UTF-8 bytes to a slower local speed: avoid isolated tiny words in audition plans; no blanket promise of exact pace.
- https://github.com/SWivid/Habibi-TTS/blob/3b4d793481f1a8e686a2229c6d7946c5d9f6b8c0/README.md — explicit reference audio/transcript and objective/human evaluation are separate.

## Same-text audition without hidden paid work

`node scripts/prepare-narration-comparison.mjs` creates `work/narration-comparison/plan.json` and a local RTL audio review page. All five entries use the same full Arabic text and seed42; reference and speed are explicit experimental variables. Without approved recordings it shows pending status, not fake players. It imports no provider and has no dispatch capability. Once authorized samples exist, `--input DIRECTORY` accepts fixed `<styleId>.wav` + `<styleId>.json` receipts `{text,sha256}`, rejecting different text or changed bytes. Audio controls play only supplied verified files. The previous five different-text samples are not reused as this comparison.

Local demonstration: the already generated `work/msa-story-ali1/01-msa-story-ali-native.wav` was processed on CPU only to `work/narration-quality-local/ali-mastered.wav` outside the repo (under the parent workspace). Its evidence preserves 91904 samples / about3.829s; no resynthesis or claimed new voice. New output is unapproved for listening quality.

## Listening gate before accepting voices

Use fixed playback volume; compare native and mastered versions. Listen for all words (especially names, vowel endings and punctuation), inserted/missing/repeated syllables, natural breathing/pauses, strength without shouting, organic roughness without buzz, and the same speaker across multiple chunks. Check sample counts/clipping and manually evaluate joins. No ASR, MOS, speaker-similarity measurement, subjective hearing approval or professional narrator quality is claimed by local software tests. Generate five new samples only after owner approval and cleared references. Never regenerate successful recordings automatically.

Fresh verification results are recorded in `narration-quality-checks-20261101.json`. Existing full-workspace tests may have independent failures; do not hide those as voice-quality success.
