# Completion 03 — Audar/NeuCodec access and readiness

Checked: 2026-10-31. Local code/tests only; no token/account connection, metadata request with credentials, weights, cloud jobs or inference was executed.

## Official sources

- Audar official card: https://huggingface.co/audarai/Audar-TTS-V1-Flash
- NeuCodec official card: https://huggingface.co/neuphonic/neucodec
- NeuCodec official implementation: https://github.com/neuphonic/neucodec
- The public NeuCodec card declares Apache-2.0 and commercial permission, separately requiring Hub access-condition acceptance. Accessibility of the public card does not establish access to its weights.
- Exact audited model/code/codec/semantic revisions and file SHA256 remain in speech/manifests/audar-tts-v1-flash.json; licence sources and pinned dependency review are in model-license-evidence.json. No weights or revision pins were replaced.

## Root defects repaired

1. Modal Secret existence was incorrectly called codecAuthorized=true. Control-plane inspection now reports codecAccess.secretConfigured, authorized=null and unverified/local_files_verified; the secret is never read back by the control plane. A configured secret permits a separately approved CPU preparation attempt, not an inference-readiness claim.
2. For a missing gated component, speech/access.py checks authenticated file metadata for the exact approved repo/revision/sourcePath/size inside the already approved CPU worker. It never downloads the weight as an access probe. Real access is granted or denied by Hugging Face, never by a local flag. No such real request occurred in this task.
3. Missing token, denied gate, wrong/missing revision/file and network/temporary failure have distinct bounded codes. Raw HTTP errors, headers, tokens and signed locations are not stored or returned. The same safe code survives the preparation receipt, shared transport, registry and existing gateway error vocabulary.
4. A definitive access failure returns a failed scoped receipt; cloud stop is independently confirmed by the outer control plane after the function returns. It does not become ready, trigger GPU, replay a paid request or auto-retry on status. Unknown provider state remains uncertain.
5. Existing locally hash-verified components can be reused offline without a new Hub token. The authorization state remains separate from usable cached files and publisher licensing; no consent is fabricated. READY is written only after every manifest file passes hash/size validation.
6. Quote missingBytes now includes present files whose content has not been verified; size alone no longer removes a potentially corrupt file from the quoted preparation set.
7. Habibi IRQ/EGY/MSA continue to use their own vocoder and specialized manifest. Audar access failures do not disable Habibi or silently change an existing voice profile's engine.

## Local evidence

- Python synthetic metadata tests cover official IDs, all required codec/semantic local paths, exact revision/size, 401/403/404/network classification, absent token, traversal, secret-safe evidence, cached offline files and failed-attempt replay protection.
- JS transport tests cover unverified secret-vs-access, gated quote blockers, absent/unverified files and unchanged Habibi routing. Registry tests preserve the safe failure and stopped status without resubmission.
- Inference libraries and public network are replaced only at their genuine IO boundaries; results do not prove actual account permissions, model loading, speech quality or cloud readiness.

See completion-03-verification.json for final integrated check counts.
