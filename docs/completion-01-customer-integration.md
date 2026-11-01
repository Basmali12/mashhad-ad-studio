# Completion 01 — customer/director/production integration

Date: 2026-10-31. Branch: `codex/ltx-film-engine-integration`. Local worktree only; nothing committed, pushed or deployed. No weights, GPU, real OpenAI, new backup, cloud mutation or completion task 02.

## Implemented path

`FilmEntry` → existing `FilmWorkspace` shell → `DirectorConversation` / `directorClient` → authenticated `filmTransport` → customer Gateway → signed film platform → existing `production-director` / `production-engine` → existing store/accounting/artifact/media services.

- Removed customer chat/launch calls to `chat.submit`, `project.launch` and legacy per-scene generation. Current rental UI was extracted into `RentalServers` with its existing service contracts and pricing unchanged.
- Existing RTL CSS, composer, logo, history menu, tab shell and final-only file library are reused. No admin redesign. Customer components import no administrative control or credential.
- Explicit sends quote one text request; a separately displayed text-cost consent submits that exact quote. Normal conversation never grants GPU consent. Research uses a separately bounded request, saved citations and cache; opening/polling never starts search or planning calls.
- Planning follows the server's nextAction (source summary, outline, chapter or scene). Natural language edit suggestions resolve existing stable IDs; only an explicit priced revision is submitted. Applying an edit clears its consumed suggestion. Source adoption and screenplay adoption are different from production spending approval.
- `production.source.*` uploads exact long documents in 12,000-character chunks, up to 1,000,000 UTF-16 characters; requests use a source ID. Long originals are retained on the server with SHA-256 and reviewed via read-only paging. A display excerpt is never reconstructed as provider source. Canonical-source replacement is explicit, audited and invalidates earlier plan approval.
- Film duration remains 10s–60min, controlled by the existing hierarchical director contracts. Character/voice IDs, original scripts, source anchors and successful unchanged stages remain durable. Audio identity is not an acoustic claim.
- New conversations are independent even with duplicate titles. Existing conversations can be renamed/pinned/archived/restored. Legacy continuation imports original text/messages into one deterministic new draft; no old model, job, charge or approval is imported. Completed artifact compatibility mirrors are deduplicated in the history display.
- Existing authenticated image upload storage is reused only as a reference container, followed by owner-checked `production.reference.attach`. No old generation runs. Reference metadata/bytes being saved is **not** proof that the discussion model has visually analysed them.
- Production approval requires screenplay adoption, current model readiness/publication, a quote and explicit ceiling, wallet funds and a unique intent. The server repeats these checks. Prepared-but-unpublished definitions are blocked pending B2; no hidden publication fallback.
- Polling uses persisted director request IDs and actual production stages/progress; it never resubmits on reload or ambiguous timeout. Fresh URL selection is explicit via `filmProject`; no selected project means a fresh conversation. Draft edits made while a text request runs are not cleared by its response. Chat remains available after final completion.
- Only a completed final result opens the existing Files tab. Existing secure ticket/view/download/delete/retention paths remain authoritative. Internal clips have no customer player or download control.

## Changed surfaces

Frontend: `src/features/film/{FilmWorkspace,DirectorConversation,DirectorSource,ProductionView,RentalServers}.tsx`, `directorClient.ts`, composer text capacity, local preview read-only support and status labels. Shared public operation/types were extended.
Backend/Gateway: source documents, history organisation, canonical source adoption, safe legacy import, reference binding, compact large-film HTTP DTOs, text-request continuation, current-publication checks and wallet/ceiling admission. See `completion-01-backend-integration.md` for exact backend evidence.

## Verification and limits

Fresh local evidence is recorded in `completion-01-verification.json`. It includes the full React suite, Backend regression and long-film Mock DAG, Gateway, TypeScript, lint and both app builds. A two-loopback-server test traverses the real Gateway/HMAC/platform/director path with only Responses results mocked. FFmpeg creates a real small MP4, which is committed/listed/ticketed through the owned final-file path; a second customer is denied access.

The local design preview was opened and its actual composer/history controls were checked in the in-app browser. That preview has no connected account/model and is not an authenticated production walkthrough or GPU result. No visual/acoustic quality certification is claimed.

B1 software wiring is implemented. B2 (generic engine test/approve/publish/customer catalog binding), commercial licence gates and native cloud/GPU validation remain separate prerequisites. This change intentionally prevents starting an unapproved engine; it does not make unprepared weights or unavailable voices usable.
