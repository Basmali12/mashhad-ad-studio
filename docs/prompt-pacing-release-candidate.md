# Prompt and pacing candidate — 2026-10-31

## Deployment record

The nine engine files from source `6f9f0e83eed93f88f4485882c4711bbacdc98a34`
were installed on muhtaj-app via installer release
`df1467aa2f08346906686a75af6d2b07fd9fd9e7`. Preflight confirmed zero active
work and matching previous file hashes. Syntax checks, the film-platform
service restart, post-install file hashes and the local health endpoint passed.
Rollback files remain in `/root/codex-prompt-pacing-before-df1467aa2f08`.
The authenticated customer Files refresh also completed after installation.
No GPU, transfer, database migration or new media generation was invoked.
There are 185 passing local engine tests, plus passing lint and typecheck.
GPU quality/pacing behavior is still unverified for this revision; Nor remains
private because its earlier run visibly contained text.

## Confirmed observation

The approved Nor commissioning run produced a 720x1280, 10.005-second MP4
with an AAC audio track. Text is visibly present on the speaker's chest in
sampled frames. Administrative publication correctly remains blocked. The
runtime completed in 511 recorded seconds and reports stopped resources;
supplier invoice cost is unavailable. No repeat GPU run has been made.

## Changes ready for deployment review

- Positive visual directions replace the repeated typography deny-list in
  the shared generation-rules suffix (v5).
- Arabic dialogue remains in native script, once per locked speaker turn,
  explicitly attributed to the soundtrack (contract v3). No external TTS.
- Existing historical suffixes are recognized; new policy versions invalidate
  outstanding quotes rather than modifying successful jobs or MP4s.
- The independently tested scene-pacing and visual-world changes are included
  in the same local candidate. The former trims only a measured very quiet
  AND nearly static tail; authored silent/action holds remain intact. The
  resulting frame conditions the next scene and the paced video feeds merging.
- Contemporary, heritage and future settings remain available. No new LoRA,
  checkpoint, GPU type, guidance algorithm or quality profile is introduced.

## Limits

Repeated negative wording was found in the actual code, but it has not been
proven to cause the unwanted subtitles. The new wording is a hypothesis that
requires a separately approved controlled GPU comparison. Do not claim that
this removes text or that a negative CFG prompt is active. The official
DFR pipeline call still receives a single prompt and native audiovisual output.
Keep OCR checks and administrative publication proof enabled.

Production deployment requires authenticated server maintenance access,
an idle-work check, a rollback copy, all changed engine helpers deployed
together, and post-restart health checks. A source commit is not a live release.

Official prompting reference:
https://docs.ltx.io/open-source-model/usage-guides/prompting-guide
