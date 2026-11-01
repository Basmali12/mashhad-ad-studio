# 3arab narration candidate — 2026-11-01

User selected public V1 examples 005 (solemn/religious) and 003 (calm); 006 was rejected for speed. Habibi IRQ/EGY/MSA stays available by explicit request. No production routing/catalog entry is enabled by this candidate.

## Actual local additions

`services/film-engine/engine/three_arab/` contains a pinned manifest, strict offline file verification, durable no-replay claims and a native adapter to the official InferenceRuntime. `three-arab-integration.mjs` records selected preview provenance and candidate routing/comparison contracts. `docs/three-arab-comparison-plan.json` preserves the same comparison text and seed for both samples. No frontend redesign, account/rental change, deployment or cloud action occurred.

The adapter requires explicit paid approval and separate rights review, exact local size/SHA256 checks, a clean pinned source checkout and local tokenizer/codec/watermark components. Hidden downloads are blocked by offline resolution. SilentCipher is retained, not removed. Native environment construction and compatibility have not been tested.

## Limits that must remain visible

The official V1 old caption configuration disables the speaker-conditioning branch (`use_speaker_condition_resolved = not use_caption_condition` when unset). These are voice-design target descriptions, not clones of demo files. Exact demo captions/seeds are unknown; identical timbre is not promised. V1 lacks a duration predictor, so each audition explicitly requests 15 seconds instead of accepting the native 30-second fallback. Speech clarity, pauses, missing words, timbre, silence and continuity require listening review; mock success proves none of these.

Known pinned asset bytes: 1,470,694,584 (~1.37 GiB), excluding the container and additional dependency artifacts. No weights were downloaded. Metadata, public source/config files and safetensors header ranges were inspected without tensor payloads.

## Rights/readiness blockers

Model card declares Apache-2.0, source metadata declares MIT; standalone source license needs clarification. Arabic codec inherits a parent with conflicting Apache/SAM wording. SilentCipher source MIT does not establish pretrained-weight permission where the weight card has no license. Commercial readiness remains false pending component-level reconciliation. No access gate may be bypassed.

## Proposed experiment, not authorized dispatch

Primary account only; two short same-text samples, one candidate each, seed 42, 40 steps, L40S, CPU 2, RAM 16 GiB, startup 180s, execution timeout 120s, idle 10s, retries zero, keep model loaded between samples if supported. These resources are a hypothesis, not measured requirements. Indicative compute allowance $0.15–$0.50 excludes uncertain image-build/network costs and is not a bill cap. A complete preparation quote and reliable account-level stop/budget checks are required before approval or spend. No automatic fallback or repeated successful generation.

## Fresh local evidence

Python candidate unit tests: 8 passed. Node candidate contracts: 4 passed. Both use local fake assets/backends; no model execution, paid API or GPU. Broader checks recorded after completion in the adjacent checks JSON.

Official sources: https://github.com/sherif1313/3arab-TTS and https://huggingface.co/sherif1313/3arab-TTS-500M-v1-VoiceDesign. Exact commits, revisions, hashes and unresolved license metadata are in `engine/three_arab/manifest.json`.


## Follow-up: steps 1–3 requested immediately

Fresh component metadata/license audit is `three-arab-license-audit-20261101.json` (six official sources, all fetched successfully). Source MIT versus model Apache alone is not a licensing conflict: code and weights may have different terms. Actual open questions concern inherited decoder terms and the scope of pretrained SilentCipher rights. This is not a finding that all use is forbidden, and user approval cannot clarify the missing scope.

`three_arab/environment.json` pins the upstream project and uv lock hashes, Python 3.11/cu128 frozen install arguments and offline native checks. It is a build recipe specification, not an executed environment build. No cloud resources were started.

The actual production-director context now supplies the two named candidate options with pinned preview provenance, explicit unavailable status and preservation of existing approved Voice Profiles. Its real local quote path is covered by a regression. Neither catalog publication nor production inference was enabled. The selected sound is not silently installed into existing projects.

Paid synthesis of the two requested new samples and final production admission remain incomplete pending component rights clarification, native environment preparation, bounded cloud test and listening approval. Existing official demos are not relabelled as our generated results. No new spending or deployment occurred.


## Publisher clarification follow-up

DACVAE inherited licensing is now resolved: the publisher explicitly confirmed Apache-2.0 for code and weights in https://huggingface.co/facebook/dacvae-watermarked/discussions/1 on 2025-12-19. Earlier notes about that blocker are historical and superseded. Different source MIT/model Apache declarations are not themselves a blocker.

The remaining unresolved component is the SilentCipher pretrained checkpoint. Official issues 7/8/9 have no publisher comments at the recorded check. Those include internal testing scope as well as commercial use. No new public issue or message was sent. `manifest.json` records this narrower status. Native loading now checks recorded internal-testing eligibility before importing torch or touching CUDA; caller approval booleans alone cannot override unresolved permission. Mock adapters still exercise the local integration without model use.

No alternative voice engine, decoder or watermark was substituted. No weights downloaded, sample synthesized, cloud resource started or production deployment performed. The five previous video scenes are unaffected.


## AudioSeal variant — supersedes the SilentCipher trial blocker

The selected voice-design model, codec and tokenizer stay pinned. Only the post-synthesis watermark backend changes explicitly to Meta AudioSeal (source `e63a8a0e5cdf7bb797159c92ba15961557fe9bd2`, checkpoints `3c19eba53390776cf2cc9ed5f6c9ac67ce72ecba`). Publisher README explicitly includes code and model weights in the MIT grant. Preserve third-party notices. No SilentCipher pretrained weights are loaded/downloaded in this variant; its unresolved official path remains recorded as optional blocked evidence.

`watermark.py` reads hash-verified local checkpoints, embeds a fixed non-personal version payload, and requires detector confirmation. It resamples only the watermark branch at 16kHz, adds that delta to original-rate speech, preserves sample count, rejects clipping/excessive perturbation and never returns unmarked speech on failure. CPU synthetic verification is a compatibility check, not proof of audible voice quality or watermark robustness after every distribution codec.

`modal_trial.py` is a private factory only, without deployment/public endpoint/rental mutation. Explicit private trial uses the existing primary model Volume in a new fixed namespace. Its source registration does not start resources. The owner requested continuation and testing; live account limit was rechecked at $6.35 and Spend $0 with baseline gross $4.81218790 and zero active apps. Independent watcher targets total additional recorded spend $0.50, exact app ownership and original 30-minute deadline across attempts; provider billing can lag. No account limit is raised. Batch inference maximum is two requested samples, without automatic retries. Existing successful voices, images and videos are untouched.

Actual cloud build discovered a stale upstream lock workspace label (`irodori-tts` versus project `arabic-tts`). `build_lock.py` accepts only the original hash and changes that single root label. Parsed dependency graph equality is recorded in `three-arab-lock-repair-evidence.json`; no package versions/hashes were re-resolved. Build then succeeded. Preparation exposed Modal's trusted mount symlink; trial_directory now canonicalizes only that mount and rejects child namespace escapes. Downloaded files are reused and independently verified. Further runtime evidence is retained under `work/three-arab-audioseal-audition{1,2,3}` outside the source repository. Final readiness must follow actual saved receipts and listening review.


## Completed private audition and final technical checks

See `three-arab-private-audition-20261101.json` for current evidence superseding earlier untested/blocker notes. Both full 15-second outputs were generated and saved as native watermarked PCM, original pre-watermark float PCM and MP3. No clipping was measured in delivered PCM; both MP3s decode successfully and load in actual browser controls. Native watermark detector score was 1.0 with correct version payload for both; MP3 watermark robustness was not separately certified. Original speech duration/sample count was preserved. A bounded headroom gain (about -0.2 to -0.3dB) prevents clipping without pitch/time changes.

The first successful sample loaded the model in 11.114s; RF sampling 1.087s, decoder .100s, first-use watermark stage 23.077s, total post-load inference 24.443s. The second used the loaded model: RF .914s, decoder .071s, watermark .049s, total 1.051s. This is one measured private trial, not a concurrency or long-film performance guarantee.

The first GPU trial failed at watermark peak handling before a final audio file was saved. The successful repaired trial used a fresh execution namespace without replaying failed claims or overwriting any successful output. Source float PCM is now persisted before watermarking so a later postprocessing failure need not lose generated speech. All repair attempts shared the original spend/deadline guard and account cap; no account limit was changed.

Final observation confirms stopped App, zero tasks, zero active Apps. Recorded additional usage for all attempts was $0.11084327 at observation; provider billing may lag, this is not a final invoice. The existing Volume now holds ~1.446GiB of additional assets; indicative ongoing storage before allowances is ~$0.14/month. No new Volume, deployment, rental change or public publication occurred.

Local fresh verification: 16 Python tests and 48 unique Node integration tests passed, TypeScript/customer build/root lint passed. Engine paths are excluded from root ESLint, so Python compilation, Node execution and real CPU/GPU receipts are the relevant additional evidence. Initial FFmpeg checks required setting ENGINE_FFMPEG_BIN; subsequent full affected sets passed. Browser comparison is loopback-only at /actual-auditions.html. Pronunciation, natural pacing, exact demo similarity and sentence endings remain unverified by human listening; automatic voice admission and commercial production activation remain disabled pending review.
