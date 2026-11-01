# Task 10 — local LatentSync runtime and Arabic forced-alignment integration

Implemented in `services/film-engine/engine/latentsync/`; no weights were downloaded, packages installed, cloud app built/deployed, GPU allocated, or paid API called during implementation. Fixtures are synthetic bytes/emissions, not generated speech or lip-sync quality evidence.

## Official pins and component rights

- LatentSync upstream: [`bytedance/LatentSync`](https://github.com/bytedance/LatentSync), commit `a229c3948406bc2cf6eaf4873e662e70c6a04746`, code Apache-2.0. The publisher documents 512×512 face processing and approximately 18 GB minimum inference VRAM for v1.6; the configured 24 GiB minimum/L40S setting is conservative admission, not measured OOM safety.
- Publisher weights: [`ByteDance/LatentSync-1.6`](https://huggingface.co/ByteDance/LatentSync-1.6), revision `c42c7e6c8e9c213626389fa7d9a3c444b8536353`, **OpenRAIL++**, not the code's Apache license. Includes the exact UNet and tiny Whisper audio-feature checkpoint. Tiny Whisper is a native lip-conditioning component; alignment does not use Whisper transcription or any external ASR.
- Local VAE: [`stabilityai/sd-vae-ft-mse`](https://huggingface.co/stabilityai/sd-vae-ft-mse), revision `31f26fdeee1355a5c34592e401dd41e45d25a493`, model-card MIT metadata. Bundled terms and upstream use restrictions still need release review.
- Arabic CTC: [`jonatasgrosman/wav2vec2-large-xlsr-53-arabic`](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-arabic), revision `af46c2d8531b8dcbb5e23b952f739b372c2e5d2d`, Apache-2.0; native input 16 kHz.
- Face detector/106-point landmarks: official [InsightFace v0.7 `buffalo_m.zip` release](https://github.com/deepinsight/insightface/releases/tag/v0.7), immutable asset ID `372348396`, published SHA-256 `d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9`. The official [license policy](https://github.com/deepinsight/insightface#license) distinguishes MIT code from **non-commercial research-only pretrained models**. A license acknowledgement does not create commercial rights.

**Commercial readiness remains false.** A separately verified commercial grant, with a server-held evidence reference, or a properly licensed replacement detector/landmark model is required. The runtime does not invent that grant or claim rights from an acknowledgement. Preparation/deployment/start gates stay closed until the trusted server holds `licenseAccepted`, `faceModelRightsApproved` and a nonempty grant evidence reference. No grant was obtained or accepted in this task.

The combined manifest has 10 pinned files totaling **7,020,535,174 bytes**. Small JSON configs/tokenizer files were read to hash them; large model files were not read/downloaded. Only detector and 106-point landmark ONNX files are extracted from the pinned face archive; unused recognition/gender models are not unpacked. Extracted files receive hashes tied to the verified source archive and READY receipt.

## Real runtime paths

`alignment.py` loads the pinned local wav2vec2 processor/model with `local_files_only=True`. It computes real log-softmax emissions and a blank-interleaved CTC Viterbi path for the supplied transcript. Word start/end comes from actual emission frame positions and measured WAV samples. Blank frames preserve pauses; character count is never converted into timestamps. Sentence boundaries group the aligned source words. Arabic punctuation/diacritics are removed only for token matching, with original words retained in output.

Low-confidence, unsupported characters/dialects, impossible paths, invalid emissions or excessive chunk complexity return `status:needs_review`, `words:null` and `sentences:null`. There is no guessed alignment or automatic transcription/TTS replacement. In particular, the Arabic checkpoint's vocabulary does not contain every Iraqi/Egyptian orthographic variant; dialect timing accuracy requires real audio tests. `transcriptVerified:false` remains explicit even on a successful forced path.

`backend.py` constructs the actual publisher `LipsyncPipeline` with local VAE, local UNet, tiny Whisper features and pinned scheduler/config/mask from the official source checkout. It overrides the default face detector before instantiation: no automatic model-pack download and no largest-face heuristic. CPU ONNX detection must find exactly one usable face in **every frame**; excessive tracking discontinuity requires review. The same detector is applied inside native affine processing, with explicit RGB/BGR conversion. It does not identify a real person or certify actor identity.

The approved face binding is checked against the exact input video's hash and character ID. Zero/multiple/ambiguous faces stop before main diffusion loading. Manual face review remains necessary; a successful face count does not prove identity preservation.

The source clip must already be 25 fps and fit the measured audio window within the admitted tolerance. Native reverse/forward looping is disabled. The upstream extra feature context is limited to actual audio-derived frame count; insufficient source frames require timing review rather than hidden extension. Original 24-kHz PCM is retained separately and muxed after inference. There is no `-shortest`, voice acceleration, speech trimming, or second voice synthesis. The final MP4 retains original video dimensions while the model operates on 512-pixel face crops.

The upstream cwd-global temporary directory/re-encoding path is bypassed; all work/output uses the unique scoped attempt directory. Main-model and CTC backends unload when switching operations, with explicit CUDA cache release. No assertion is made that this eliminates OOM or proves GPU residency limits.

## Contracts and resources

Stable model ID `latentsync16`, version `1.6`. A single future deployment supports `operation:align|lip_sync` behind existing encrypted account/approval/confirmed-stop metering.

Native input uses safe metadata `audio`/`video` dictionaries plus decoded `audio_bytes`/`video_bytes`. SHA-256, asset IDs, speaker/profile/character bindings and operation-specific fields are checked before execution. Alignment supports original PCM16 mono 24-kHz WAV chunks ≤120 seconds, resampled by FFmpeg to 16 kHz with duration verification; lip-sync clips are bounded at 15 seconds/64 MiB. Long films must use the existing chunk/shot orchestration, not pass an entire movie to this runtime.

Alignment results echo operation, utterance/speaker/voice-profile IDs, exact text/audio SHA, model revision, actual duration, words/sentences/confidence and review state. Lip results echo shot/face-binding/source hashes and produce a **distinct** MP4. `needsReview:true`, `qualityVerified:false`, `lipSyncVerified:false` remain after native execution. FFmpeg/MP4 success alone is not visual/audio quality proof.

Cloud definitions: L40S, CPU 4, RAM 32 GiB, one container, retries zero, no minimum/buffer containers. CPU preparation: CPU 2, RAM 8 GiB. Python 3.10 and torch/torchaudio/torchvision 2.5.1 CUDA 12.1 follow the official environment, isolated from other model images. Inference uses offline model-loading flags and `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1`.

The local package is uploaded remotely as `latentsync_runtime`, because official upstream owns the `latentsync` import name. Modal registers by source reference under that remote alias; no serialized local closures or hidden source package collision is assumed.

Preparation/deploy imports are inert. Explicit future preparation pins all hashes, keeps per-engine/account/run claims and CPU receipts, and refuses to overwrite unowned deployments/result volumes. Imports, metadata inspection and project edits do not create resources. Progress reports completed native phases, not guessed time or word percentages.

## Local evidence and remaining limits

`python -m unittest services/film-engine/tests/test_latentsync_runtime.py`: **18 tests passed**. Coverage includes synthetic CTC emissions/repeated labels/unequal word durations/pauses/null-review outputs, immutable PCM/provenance, wrong-speaker/multiple-face rejection, native face admission before diffusion loading, model switching, preparation hashes/ZIP traversal/rights gates, shared Python bridge alignment/lip contracts, resource validation and actual SDK definition registration offline. `compileall` passed.

These tests do not run ONNX, wav2vec2 inference, UNet inference, Whisper features, a cloud image build or real lip-sync. Native CUDA/library compatibility, facial quality, dialect alignment, measured drift/latency/VRAM, throughput, cloud billing and commercial rights remain unverified/blocked pending later authorized validation. No task 11 code was added here.
