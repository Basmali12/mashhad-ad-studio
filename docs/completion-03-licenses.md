# Completion 03 — official licensing evidence and enforcement

Checked 2026-10-31, local-only, no weights downloaded, no gated files read, no GPU, paid API, deployment or backup. Public official model metadata, README and license documents were fetched without credentials. Exact repository revisions, source URLs and document SHA256 values are preserved in `services/film-engine/engine/model-license-evidence.json`: 16 weight/component repository revisions, 9 official code repositories, 55 direct pinned Python package versions. Package metadata is not a transitive installed-container SBOM or legal certification; the actual future built image still needs its notices/SBOM checked. Three absent PyPI license labels (sentencepiece/torchao/vocos) were checked against versioned official source notices.

## Scoped eligibility

| Component | Code / weights | Personal scope | Commercial scope |
| --- | --- | --- | --- |
| FLUX.2 Klein 4B | Apache-2.0 / Apache-2.0 | Conditional permitted | Conditional permitted; not the separately licensed 9B family |
| Qwen Image Edit 2511 | Apache-2.0 / Apache-2.0 | Conditional permitted | Conditional permitted |
| Wan 2.2 I2V-A14B | Apache-2.0 / Apache-2.0 | Conditional permitted | Conditional permitted; pinned official Diffusers export retained |
| HunyuanVideo 1.5 | Tencent Hunyuan Community | Territorial/AUP conditions apply | Conditional; explicit acknowledgement remains required, deployment must obey territory and service obligations |
| Habibi IRQ, EGY, MSA | MIT code / expressly Apache-2.0 specialized weights | Conditional permitted | Conditional permitted for these three specialized variants only |
| Audar V1 Flash | AudarAI Open License v1.0 | Conditional permitted | Paid hosted services permitted under current pinned terms; no user/revenue cap |
| NeuCodec | Apache-2.0 code / weights | Conditional permitted | Conditional permitted; Hub access is independently gated |
| LatentSync 1.6 | Apache-2.0 code / OpenRAIL++ weights | Whole pipeline only restricted noncommercial research because face weights are separate | Blocked with bundled InsightFace weights |
| InsightFace | MIT code / noncommercial-research pretrained weights | Noncommercial research only, not general personal entertainment permission | No grant verified for the bundled detector/106-landmark weights |

Apache/MIT permissions retain attribution/notice and redistribution requirements. These licenses do not license input likenesses, voices, trademarks, datasets or all output uses. Owner/voice reference consent remains independent.

Sources: [FLUX](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B), [Qwen](https://huggingface.co/Qwen/Qwen-Image-Edit-2511), [Wan](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B), [Habibi specialized exception](https://huggingface.co/SWivid/Habibi-TTS/blob/3ad11a152851245c002156526c5e1d0b12f2b9d5/README.md).

Hunyuan conditions include excluding EU, UK and South Korea, including use of outputs; a special grant above 100M MAU at release; pass-through restrictions/license, actual provider identification and non-affiliation, and conspicuous AI labeling for public output. Existing server acknowledgement is an operator compliance declaration, not proof of territory enforcement or a special grant. No live site is certified compliant here. [Pinned Tencent license](https://huggingface.co/tencent/HunyuanVideo-1.5/blob/9b49404b3f5df2a8f0b31df27a0c7ab872e7b038/LICENSE).

Audar's pinned July 1 2026 license expressly permits commercial hosted services without a commercial cap. The retained acknowledgements confirm reviewing notices and third-party terms; they are not a purchased sublicense. NeuCodec remains separately Apache-licensed and access-gated; license permission does not establish account access. [Audar license](https://huggingface.co/audarai/Audar-TTS-V1-Flash/blob/addf2d80538edab4de2103843678825bc11ddce1/LICENSE), [NeuCodec model card](https://huggingface.co/neuphonic/neucodec).

## LatentSync boundary

The current code uses InsightFace detector and 106-point landmark weights from pinned buffalo_m. Its MIT code license does not clear those weights. No legally and geometrically compatible replacement with verified inference has been established in this phase; a different detector alone would not prove equivalent landmark/alignment behavior. No fake mouth animation or altered algorithm was introduced. [InsightFace official policy](https://github.com/deepinsight/insightface#license), [LatentSync code](https://github.com/bytedance/LatentSync/blob/a229c3948406bc2cf6eaf4873e662e70c6a04746/LICENSE), [LatentSync weights](https://huggingface.co/ByteDance/LatentSync-1.6).

`model-licenses.mjs` classifies personal eligibility explicitly as `noncommercial_research_only`, with `runtimeEnabled:false`: classification never starts a provider or enables customer publication. Commercial publication remains blocked even with arbitrary rights booleans or a text reference. The low-level retained research path now requires server-configured `usageMode=noncommercial_research`, `researchOnly=true`, license acknowledgement and bounded research attestation. The service and transport require a private administrative project marked for the same research purpose. CPU preparation, deployment and READY markers carry/check that purpose. There is no new HTTP field or UI toggle to create research authority. Normal production configuration remains commercial and closed. Such local mock validation is not verification of research legality for a particular future study or evidence of inference quality.

## Source-bound enforcement and evidence

`engineSoftwarePolicy` now derives commercial admission and separate personal eligibility from `modelLicenseEligibility`; unknown licenses, revisions or altered source/weight identities are blocked. The audited digest covers source revision and every weight file's repository, revision, path, size and SHA, preventing a same-label replacement from inheriting clearance. Changed dependency locks also require a new license review. Existing software/dependency fingerprints, account/resource binding and commissioning review/publication proof remain intact. The commissioning test fixture now uses actual pinned FLUX manifest metadata with entirely mocked IO; fabricated weights are no longer implicitly licensed by a label.

Fresh scoped verification: 15 model-license tests, 13 LatentSync JS integration/transport tests, 8 commissioning-platform tests and 20 LatentSync Python tests passed. Positive research cases explicitly use synthetic private-project fixtures; no account, model or cloud function was invoked. Root integration verification records later combined runs. Commercial LatentSync remains a known external licensing blocker, not a silently repaired grant.

## Existing background-removal distribution obligation

The retained `@imgly/background-removal` package is AGPL-3.0, not permissively licensed merely because its dependency advisory is fixed. The official project offers other licensing options separately. Its AGPL notices/source obligations must be satisfied for the actual distribution/hosted integration, or a valid alternative commercial grant must be obtained before a proprietary deployment that cannot satisfy them. No grant was acquired or presumed here, and the scoped security loader preserves upstream license notices. [Official IMG.LY licensing section](https://github.com/imgly/background-removal-js#license). This is an existing dependency obligation; the npm repair does not itself create or resolve a commercial-license grant.
