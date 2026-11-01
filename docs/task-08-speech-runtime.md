# Task 08 — real future Habibi / Audar speech runtimes

This is local implementation and fixture verification only. No weights were downloaded; no GPU, paid API, CPU cloud job, build, deployment, Volume, account secret or license acceptance was created. Synthetic PCM fixtures do not establish voice quality, dialect accuracy, identity consistency, real speed or hardware readiness.

## Models, source pins and licenses

| Stable model ID | Version | HF revision | Required bytes |
| --- | --- | --- | --- |
| `habibi-irq` | `0.1.1-specialized` | `3ad11a152851245c002156526c5e1d0b12f2b9d5` | 1,403,156,767 |
| `habibi-egy` | `0.1.1-specialized` | same immutable Habibi revision | 1,403,236,793 |
| `habibi-msa` | `0.1.1-specialized` | same immutable Habibi revision | 1,403,064,476 |
| `audar-tts-v1-flash` | `V1-Flash` | `addf2d80538edab4de2103843678825bc11ddce1` | 4,631,138,421 |

[Official Habibi code](https://github.com/SWivid/Habibi-TTS/tree/3b4d793481f1a8e686a2229c6d7946c5d9f6b8c0) is pinned to `3b4d793481f1a8e686a2229c6d7946c5d9f6b8c0`; the [specialized weights](https://huggingface.co/SWivid/Habibi-TTS/tree/3ad11a152851245c002156526c5e1d0b12f2b9d5/Specialized) for IRQ, EGY and MSA are Apache-2.0 according to the publisher. Unified, SAU and UAE weights are noncommercial and are **not** included. Code is MIT. Required [Vocos 24kHz](https://huggingface.co/charactr/vocos-mel-24khz/tree/0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21) is pinned to `0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21` and its card declares MIT.

[Official Audar source](https://github.com/AudarAI/Audar-TTS-V1/tree/8316d3f50e87f5622af3ecb78c1ef95261bff655) is pinned to `8316d3f50e87f5622af3ecb78c1ef95261bff655`. Source/example helpers are Apache-2.0; [Flash model weights](https://huggingface.co/audarai/Audar-TTS-V1-Flash/tree/addf2d80538edab4de2103843678825bc11ddce1) use the separate **AudarAI Open License v1.0**, not Apache-2.0. Intended commercial/model-as-a-service use must be checked against those terms before enabling it; no commercial readiness is inferred here.

Flash requires [NeuCodec](https://huggingface.co/neuphonic/neucodec), revision `a940021324df13a07f44185f0a17c6dac3698179`, whose public API metadata declares Apache-2.0 but whose files are gated. Its actual reference encoder additionally needs [facebook/w2v-bert-2.0](https://huggingface.co/facebook/w2v-bert-2.0/tree/da985ba0987f70aaeb84a80f2851cfac8c697a7b), pinned to `da985ba0987f70aaeb84a80f2851cfac8c697a7b`. The Audar manifest includes original Transformers weights, codec `pytorch_model.bin`, and semantic encoder safetensors/configs; GGUF, demo voices, Turbo and Pro are excluded. Each model has a separate manifest under `engine/speech/manifests/` with exact source repository/revision/path, size and SHA256. No shared account or other engine's weights are assumed.

LFS hashes/sizes were obtained from public metadata. Small public text/config files were streamed only to verify SHA256 and their Git blob hash. No model weight, codec binary or large tokenizer asset was downloaded. Access to gated codec text files returned HTTP401; this was **not bypassed**. Those unneeded configs are excluded because the pinned package's actual checkpoint loader uses an explicit architecture and `pytorch_model.bin`. Codec Python wheel source was inspected in memory; its immutable wheel SHA256 is recorded in the manifest.

## Actual offline inference APIs

**Habibi specialized:** the runtime loads the official F5-TTS v1 Base `DiT` architecture and selected local checkpoint/vocabulary, loads Vocos with `is_local=True`, then calls official `habibi_tts.infer.utils_infer.infer_batch_process`. Settings follow the publisher: 32 steps, CFG 2, sway -1, speed 1, specialized `dialect_id=None`. Streaming sample chunks are collected without extra silence padding or time stretching. It never calls `preprocess_ref_audio_text`, whose upstream behavior can trim the reference or launch Whisper ASR. A supplied transcript is mandatory.

**Audar Flash:** local-only `AutoTokenizer` and `AutoModelForCausalLM` load original Transformers assets. Official `encode_reference`, `build_prompt` and `GEN_DEFAULTS` implement the published protocol. Generation uses temperature 1, top-k40, top-p0.9, repetition penalty1.1, min50/max1500 new tokens, and the official `<|TARGET_CODES_END|>` EOS. Missing EOS is an explicit token-limit error rather than a claimed complete utterance. Generated speech codes are decoded through the actual NeuCodec decoder.

The upstream `NeuCodec.from_pretrained` only accepts remote repository IDs, and its constructor silently downloads w2v-BERT. The local adapter therefore reproduces the pinned `neucodec==0.0.6` constructor's architecture in `LocalNeuCodec`, loads the semantic model/feature extractor from explicit local directories, and reads the pinned codec checkpoint with `torch.load(weights_only=True)`. It applies the same upstream ignored-key filters and rejects unexpected/non-semantic missing keys. This documented compatibility shim still requires a real installation/checkpoint test; it is not a claim that upstream supports arbitrary local paths.

Both models natively output **24kHz mono**: Habibi/Vocos24k, and Audar's documented OUT_SR/NeuCodec hop480 at50codes/s. Runtime stores PCM16 little-endian WAV from actual sample arrays and reports actual sample count, duration, sample format, SHA256 and byte count. No sample-rate conversion, ASR, external TTS API or invented word alignment is performed. `wordTimestamps` is explicitly null.

## Reference, expression and speaker contracts

An approved Backend-owned reference is required for every voice. Python admits only PCM16 mono16kHz WAV, **5–12seconds**, at most1MiB, plus nonempty exact reference transcript. This common policy fits Audar's documented5–15s range while avoiding Habibi CLI's automatic clipping. No default/demo voice, synthetic profile imitation or missing-transcript ASR fallback exists. Reference hash, transcript hash, profile fingerprint, owner-bound character/narrator, utterance ID and exact requested text hash are retained as proof metadata; these prove inputs, not that an ASR confirmed the spoken words.

Python accepts `text`, `referenceTranscript`, `voiceProfileId`, `voiceProfileFingerprint`, `characterId`, `narrator`, `utteranceId`, `locale`, `expression`, `seed`, private `reference_audio` bytes and expected `referenceSHA256`. Either one character ID or narrator=true is required. Backend owns consent/rights, project/customer checks and immutable profile persistence; Python also rejects changing a loaded profile's reference/transcript/fingerprint/locale binding. Seed is unsigned32; parent stage chunking derives `(profileBaseSeed + parentChunkIndex) mod 2^32`, and optional inner chunks derive `(requestSeed + innerIndex) mod 2^32`. A derived chunk seed is not a change of the immutable base speaker profile.

Habibi specialized locales are ar-IQ, ar-EG and ar-MSA respectively, with neutral delivery only. Audar documents Arabic dialectal/English coverage, not independently verified Iraqi pronunciation. ar-IQ may carry the supplied Iraqi reference/text but remains unverified; normal Iraqi routing should stay on Habibi-IRQ. No prompt or shared reference guarantees identical timbre when changing model families.

Audar Flash's official eight expression tags are **laughs, curious, excited, sighs, exhales, mischievously, whispers, sarcastic**; neutral adds no tag. The runtime inserts one trusted selected tag, preserving the caller's target words. Raw bracket tags, unsupported/stacked tags, special-token injection and tag-only/empty vocal events are rejected. An isolated laugh/scream/cry API is not claimed; expressive delivery of actual spoken words is supported by the official protocol and still awaits an audio quality test.

Exact incoming text is preserved in SHA metadata and concatenated chunk reconstruction, including whitespace. Request limits are600Unicode characters/1200UTF8bytes. Habibi inner chunks are at most120UTF8bytes, further limited by the reference's text/duration and22-second reference+generation context calculation. Audar chunks are at most200characters/800UTF8bytes. Maximum16inner chunks; total actual output at most120seconds/8MiB. Parent orchestration normally sends one preplanned chunk per paid stage; it controls pauses/assembly separately. Progress counts only genuinely completed audio chunks, never generated characters, inferred word timings or guessed elapsed percent.

## Hardware, image and lifecycle

Current deployment admits **L40S48GB only**, CPU2/4, RAM16/32GiB, with a policy minimum VRAM8GiB. These are conservative admission settings, not measured requirements. RTX is not silently substituted. Runtime has an explicit optional `device='cpu'` constructor path, but unavailable CUDA never silently falls back to CPU.

Speech dependencies are isolated from video. Habibi0.1.1 requires **torch<2.9**, so the speech image pins torch/torchaudio2.8.0+cu128, Transformers4.57.6, HFHub0.36.0, tokenizers0.22.1, F5-TTS1.1.22, the exact Habibi source commit, Vocos0.1.0 and NeuCodec0.0.6, plus direct dependencies. Audar's official helper code is checked out at its exact commit in the future image. No install/resolver or image build ran here; these direct pins are not a complete transitive hash lock or proof of compatibility. Actual CUDA/codec/package installation and memory behavior remain pending.

Shared image definitions contain no job IDs, prompts, voice references, account tokens or customer secrets. Model-specific function environment config binds one definition/model/account. Names are `mashhad-speech-<modelId>-<engineUUIDprefix>` and an independently hashed result Volume; model path is `models/<modelId>/<engineUUID>`.

`build_speech_app` registers inert `SpeechEngine(runtime_id=...)` plus CPU `prepare_models`. GPU class max1/min0/buffer0, retries0, timeout600s/startup180s/idle1200s. CPU preparation2CPU/8GiB/3600s/startup180s, retries0. Preparation verifies existing hashes, downloads only missing/invalid pinned files in the destination Volume and marks READY only after all checks. GPU start/generate are offline only and never bootstrap/deploy/download implicitly.

Explicit paid bootstrap validates scoped manifest/bundle ownership before provisioning. Audar additionally requires trusted model-license and codec-license acceptance. Before any Volume or build it hydrates a **pre-existing account-owned** Secret named `mashhad-hf-read`; it never creates, copies or prints its contents. Only the CPU preparation function receives that Secret; GPU receives no HF credential. Missing HF_TOKEN blocks gated downloads, and a rejected/expired gate fails without an automatic replacement attempt. Secret existence alone does not establish that codec access has been granted.

Durable private paths follow `runs/<run>/results/<request>.wav` plus receipt/claim and progress JSON. RPC returns `wavBytes` internally to Backend. Exclusive claims and stored fingerprint/receipt prevent duplicate synthesis after completed, failed or uncertain requests. Real control-plane confirmation, not a WAV receipt alone, establishes resource shutdown.

## Local evidence and deferred tests

The dedicated offline tests use stdlib PCM WAV fixtures, injected synthesizers and exact official API call-shape fixtures for Habibi and Audar. They cover all four manifests/model IDs, real sample-derived metadata, exact text/chunk reconstruction, reference validation, expression allowlist, profile mutation rejection, ownership scopes, approval/codec-secret safeguards, pinned missing-file preparation and actual installed Modal SDK registration without cloud hydration. Synthetic PCM is never labelled genuine model output.

Weights, CPU transfer/build, HF codec authorization, dependency installation, original checkpoint compatibility, GPU/CPU inference, dialect and emotional accuracy, voice consistency and end-to-end audio/film synchronization remain untested. These require later explicit authorization. No commercial model/codec readiness is declared by this local phase.
