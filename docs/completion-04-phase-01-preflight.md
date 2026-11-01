# Completion 04 — phase 1 cloud preflight (no spend)

Checked: 2026-10-31T18:29:22.876575+00:00

Phase2 is NOT approved. No images, containers, Volumes or weights were created. No runtime was started/stopped. No secret value was shown. Existing legacy read-inspection timestamps were refreshed through the current admin UI.

## Readiness

- B1/B2/B3/B5 are locally implemented; latest recorded code hashes match. They are not deployed to the live admin. The live HTML entry is admin-PBeUZ_hT.js (30 October), versus current local admin-BNtKC3Mn.js. Live controls still describe LTX. An integrated customer/admin production test is blocked until separately authorized publication/deployment.
- Main account basm1998ali authenticated by SDK and dashboard. Displayed current credits: $23.68. Dashboard current0/10 GPUs and0/100 containers; type/region availability not guaranteed. No running main-environment app found.
- Existing admin associates basm1998ali, husrd2021 and Nor/mawaeediasn; each legacy inspection remains not-ready and reports0 unconfirmed operations. That old UI is not independent verification of new-model preparation, direct credentials or quotas for the two other accounts.
- Existing comparison Volume has79.439GiB of older Cog/Hunyuan diffusers material, not the current official native manifest. Historical result Volume has13 files (~0.010GiB). Neither was modified, treated as new weights, deleted or used to restore LTX.
- No current approved voice references or NeuCodec access were established. LatentSync is not commercially eligible; general personal entertainment is not noncommercial research.

## Proposed resource and cost table

Target for every proposed row: basm1998ali only; no fallback account. CPU preparation:2cores/8GiB/3600-second window = $0.158256 per model. Test totals below include GPU+CPU+RAM, not builds/network/storage. They fill configured conservative windows, not measured inference time or enforced invoice caps.

| Model | GPU / CPU / RAM GiB | Download GiB | Test window min | Test resources USD | Preparation USD | Proposed approval allocation USD |
|---|---|---:|---:|---:|---:|---:|
| FLUX.2 Klein 4B | L40S / 4 / 64 | 14.879 | 50 | 2.209 | 0.158 | 5 |
| Qwen Image Edit 2511 | RTX-PRO-6000 / 4 / 128 | 53.756 | 90 | 6.364 | 0.158 | 8 |
| Wan 2.2 I2V-A14B | RTX-PRO-6000 / 4 / 256 | 117.535 | 90 | 7.899 | 0.158 | 10 |
| HunyuanVideo 1.5 | RTX-PRO-6000 / 4 / 128 | 148.270 | 90 | 6.364 | 0.158 | 8 |
| Habibi IRQ | L40S / 2 / 16 | 1.307 | 25 | 0.906 | 0.158 | 1.5 |
| Habibi EGY | L40S / 2 / 16 | 1.307 | 25 | 0.906 | 0.158 | 1.5 |
| Habibi MSA | L40S / 2 / 16 | 1.307 | 25 | 0.906 | 0.158 | 1.5 |
| Audar Flash | L40S / 2 / 16 | 4.313 | 25 | 0.906 | 0.158 | 1.5 |
| LatentSync 1.6 | L40S / 4 / 32 | 6.538 | 25 | 0.998 | 0.158 | 0 (excluded) |

- All8 non-Latent models:342.674GiB; preparation+test compute windows ~$27.725. Gross persistent storage ~$30.84/month before any included allowance; verified actual charge unknown. Approval allocations total$37.00, not an authorized or provider-enforced cap, excluding storage/network and final-film extra generation.
- Build cost is not measured or independently capped. GPU failure/startup/idle and delayed billing can incur costs. Egress standard reference is$0.04/GiB after allowances; public HF→Modal inbound weights are not assumed equal to billable Modal outbound traffic. Do not apply the egress rate to every downloaded GiB.
- A proposed next step is FLUX alone:5USD operational compute/build budget plus explicit consent for14.879GiB retained weights (gross1.34USD/month before allowances). This needs explicit consent and exact stop/time/budget settings before dispatch, and is NOT a guaranteed invoice ceiling. The rest of the round is deferred.

## Order and stop rules

One serial attempt per engine: FLUX→Qwen→Wan→Hunyuan→HabibiIRQ/EGY/MSA→Audar. Required owned/licensed inputs and model conditions are gates, not defaults. No rerun/account switch after failure. Stop only the exact test call/runtime, confirm terminal calls and zero owned containers, retain uncertain receipts and block further work. Audar initially tests one expression; more samples and new final-film generation need added cost approval. LatentSync separate restricted research only if genuinely eligible.

## Compatibility boundary

Configured Python3.12; image/video Torch2.9.1+cu128, speech Torch2.8.0+cu128, LatentSync Torch2.5.1+cu121 on L40S in separate environments. HostHatch does not need CUDA for orchestration. Published version pins and Mock contracts are not proof that cloud image builds/native kernels/VRAM/inference work. No actual cloud build was attempted.

## Sources

- https://modal.com/pricing
- https://modal.com/docs/guide/gpu
- https://huggingface.co/Qwen/Qwen-Image-Edit-2511
- https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B
- Current exact manifests, licence evidence and CPU/GPU lockfiles under services/film-engine/engine/. Full calculation and observed resource metadata: completion-04-phase-01-preflight.json.

Mandatory pause: wait for explicit budget/resources consent; no Phase2 work or deployment was performed.
