# Task 09 — hierarchical OpenAI film director and bounded web research

Local implementation on `codex/ltx-film-engine-integration`, 2026-10-31. No deployment, OpenAI API request, GPU allocation, model download, cloud CPU job, DNS change, backup or restore point was performed. Task 10 was not started.

## Existing components retained

The new service uses `OpenAIDirector`, the existing encrypted `openai-director` key configuration, its configured model/pricing, Responses endpoint and AI wallet. No new model name or credential was installed. `film-money.mjs` adds only the owned `production-project` namespace for `production-text-call`; wallet lots, expiry, reservation, uncertainty, recovery, settlement and ledger rules remain shared. Model availability on the actual OpenAI account is untested.

`FILM_DIRECTOR_ENABLED=NO` is the default. Live text execution additionally requires the existing global paid gate, the existing server key, sufficient wallet credit and an approved, unexpired exact text quote. Browser inputs cannot supply tools, schemas, instructions, account ownership, provider credentials or billing rates. No page-open action starts production or research.

Existing customer/admin layouts, account management, GPU rental, files and scheduling were preserved. This task supplies real server APIs, schemas and typed gateway contracts; the live customer UI was not deployed or certified against the new workflow.

## Production service flow

`engine/production-director.mjs` owns the durable tenant-scoped workflow:

1. `production.create` saves the original user story exactly, including leading/trailing whitespace. The original and SHA-256 remain separate from proposed plans and generated treatments.
2. `director.message.quote` estimates a discussion request without sending it. `director.message` requires the exact quoted text-cost approval. `director.call` observes and adopts its existing response; it never resends a request.
3. Structured discussion distinguishes everyday chat, questions, ideas, ready scripts, production prompts, advertisements, story/scene/character/voice changes, approval and cancellation. An intent label is not authority to spend or start/stop a model. A separate validated edit proposal resolves ordinal requests such as the fifth scene to stable existing IDs. Local revision quotes can use that saved target; film-duration/structural changes are marked for outline planning. Creative ideas may propose new content; strict scripts retain their source wording.
4. `director.plan.quote` / `director.plan` use independently saved `outline`, `chapter_outline`, `scene`, compact `chapter`, or targeted `revision` calls. Long chapters use scene planning; compact whole-chapter requests are limited to two minutes as a request-size boundary, not a film-duration limit.
5. Every successful scene is checkpointed. Later scene calls receive the relevant source excerpt, fixed Character Bible/voices, chapter summaries and planned event state rather than the entire previous film. Continuity includes saved earlier scenes inside a still-incomplete chapter, not only completed chapters. Timelines support 10 seconds–60 minutes; current production validation remains bounded to 1,000 shots/utterances.
6. A complete proposal exposes title, target duration, counts, characters, voice IDs, actual required model routes, saved readiness and pending revisions. Unknown aggregate production cost/spend limit remains `null`; no fictitious zero or guaranteed final duration is shown. An authoritative resource quote is still required after adopting the plan.
7. `director.approve` adopts only the latest reviewed revision, without executing any model. Existing `production.quote` and `production.approve` remain necessary for resource spending. Text approval cannot approve image/video/TTS/GPU work.

Sources, conversations, revisions, chapter layouts and partially planned scenes use the existing Store/PostgreSQL entity abstraction. There is no replacement database. Full stored history is retained; public messages and timeline previews are bounded to keep the existing gateway transport usable for long conversations.

## Content, continuity and timing validation

`engine/director-story.mjs` defines closed strict Structured Outputs schemas and local validation. Strict utterances must match exact source substrings and speaker IDs. Production directions stay separate from spoken words. Source offsets, chapter/scene/shot timing, causal event ordering, unique event IDs, relationships, references and supported voice routes are checked before adoption. These structural checks cannot prove perfect semantic faithfulness or historical truth; a human still reviews the proposed story.

Approved speaker IDs remain fixed. Unassigned voices are explicitly named `unassigned-<speakerId>` and cannot synthesize until a real approved profile exists. Explicit voice revisions must choose an existing approved, matching project profile; the director cannot manufacture a reference, silently switch Habibi/Audar, or guarantee an accent/identity from text. Reference-image handling remains through the existing file ownership checks; this task does not analyze every image automatically.

Every shot supplies visual scene/movement instructions and independent authored Arabic speech. Wan remains image-conditioned; Hunyuan remains the secondary route. Scene duration follows narrative and provisional audio needs, while native clip bounds and distinct motion beats remain enforced separately. Visible dialogue receives `requires_lip_sync`; narration does not. This is a marker for Task 10, not implemented lip synchronization. Actual audio duration and later alignment must replace preliminary timings.

Historical/religious material is distinguished from dramatic invention. Unsupported `documented=true` claims are rejected without trusted verification IDs. OpenAI output and web citations alone never certify an event or attributed quotation. Symbolic/non-face treatment can be requested through the visual instructions; no generated-face or no-lettering guarantee is claimed.

## Narrow revisions and idempotence

`production.adoptPlan` is an internal server method, not a public dispatch capability. It refuses active/uncertain production and invalidates stale production quotes. A changed shot or voice invalidates only affected stages and their dependency descendants. Completed unchanged images, audio, neighbouring shots, files and financial receipts survive. Retired stage rows and plan revisions remain application history; this does not create deployment backups or restore copies.

Calls and quotes are bound to owner, project, state revision, exact context/schema, output budget, model and pricing. Double clicks recover the same record and wallet settlement. Unknown network submissions retain uncertainty and holds; restart follows recorded receipts and never reconstructs consent or repeats a provider request. A failed planning stage can be requested again with a new quote, preserving successful earlier stages.

Original text bypasses the old blanket provider-label substitution on the typed director/production bridge DTOs. This prevents a user's quoted words from being rewritten. Other existing customer-provider-label handling is unchanged.

## Official web_search addition

The research request uses only the official Responses `web_search` tool. Discussion may propose research, but cannot launch it. `director.research.quote` and `director.research` require separate explicit approval; a ready screenplay with no verification request does not automatically search.

Defaults: one tool call and 1,600 maximum output tokens; hard application ceilings: two tool calls and 3,000 output tokens. Exceeding the defaults requires an explicit expansion flag and a new approved quote. The request fixes `max_tool_calls`, `max_output_tokens`, low search context, approved-domain filters, and source metadata inclusion. No arbitrary browser/function/computer tools are admitted.

The request estimates the configured text rates plus the published web-search tool fee and an 8,000-token-per-call content allowance. **That allowance is an estimate, not an exact cap on retrieved search-content tokens.** The official tool exposes a context-size setting rather than a precise retrieved-token limit. Estimated USD is not an invoice cap. Reported token usage and observed tool fees are recorded separately; malformed/unknown usage retains an uncertain hold. No automatic query expansion or retry occurs.

`engine/director-research.mjs` validates source URLs against actual provider search-source/citation metadata, approved domains and public HTTPS URL rules. Invented, credential-bearing and unobserved references are rejected. Claims need citations on two independent approved domains to retain the `supported` label; otherwise they remain uncertain. This compares provenance and source diversity, not factual correctness. Disagreement is retained, not silently resolved.

Owned query/results are cached for seven days per user/project/policy version. Reusing a valid cache entry makes no new OpenAI request or wallet debit. Returned summaries, source links, rights notes and a newly written cinematic treatment appear in the director's messages/state before production approval. No full books/pages are scraped or stored. Research instructions require original summaries/treatments, prohibit substantial copyrighted copying, and treat retrieved pages as untrusted data.

## Official references inspected

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses): Responses JSON Schema, strict shape and local validation.
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search): official tool, domain filters and provider source/citation metadata.
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing): web-search tool fees plus search-content tokens at model rates, inspected 2026-10-31. Stored pricing estimates are not invoice statements.

## Verification

Fresh final local checks: backend **424/424**, gateway **50/50**, Python **153/153**, frontend **691/691** across 167 files. TypeScript checks, customer/admin Vite builds, reels runner bundling, repository ESLint and explicit new engine-module ESLint passed. Source/destination image-order validation and UTF-8 audit passed. No checks were skipped in these suites. Tests use real local Store, wallet, production orchestration, schema validation and signed bridge handling, with mocks only at the OpenAI/model boundaries. They do not establish live model availability, cinematic quality, religious/historical accuracy or cloud performance.
