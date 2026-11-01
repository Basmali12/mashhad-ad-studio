# Completion 01 — backend customer integration evidence

Date: 2026-10-31. Local worktree only. No cloud objects, weights, GPU, live OpenAI, deployment or backups.

## Actual customer seams

- Existing `director.*` and `production.*` remain authoritative; no legacy inference is used.
- `production.source.begin/chunk/complete/get`: tenant-owned, SHA-bound, sequential idempotent text documents up to 1,000,000 UTF-16 characters; 12,000-character request chunks. `production.create` accepts a completed `sourceId`; `director.message.quote` accepts `textId`. Long text is retained exactly, not replaced by its preview.
- Over-30,000-character canonical stories use separately quoted/approved `source_summary` steps (24,000-character source windows; at most 1,000 summary characters each) before outline. Full original text and global source offsets remain authoritative. Chapter planning uses bounded exact source excerpts. No paid continuation merely from polling.
- `director.source.set`: explicit customer source adoption before production attempts, atomically updates source, records previous text/hash/revision, invalidates the plan approval and preserves conversation messages.
- `production.organize` and bounded `production.list`: rename, pin, unpin, archive/restore without resetting production or requiring previous-chat resumption.
- `production.legacy.import`: deterministic owner-bound import into a fresh draft production project; copies only original text/messages/reference ownership and display direction. Old model jobs, plans, spending approvals, files and financial records remain unchanged. A repeated import returns the same project.
- `production.reference.attach`: binds an already validated owned upload container/reference to a new production project/director before planning. It dispatches no provider. Image IDs are passed as approved reference metadata, not falsely described as proof of image analysis.
- Director snapshot exposes external pending request identity, last intent, next planning action, orientation and target duration. HTTP-only projections bound long timelines/outlines while full durable state remains unchanged.
- Production quote reports wallet availability and affordability. Approval rechecks current wallet before queueing, binds the spending limit to the unique request and stores it. Public gateway requires the limit explicitly; existing trusted internal tests default to the exact approved quote (never unlimited).
- Production adapters reject a definition lacking an approved, tested publication tied to its current revision. This is intentionally closed until completion task 02 provides the separate publication workflow. Prepared files alone are not customer publication.

## Fresh verification

- Backend regression excluding the unchanged nine long-film readiness tests: **495 passed / 0 failed** (`node --test --test-concurrency=2 ...`).
- Focused director/production-engine/model suite rerun after the final HTTP projection/source-budget changes: **45 passed / 0 failed**.
- Explicit ESLint on nine changed backend/test modules: **0 errors, 0 warnings** (standalone Node globals; repository ESLint intentionally ignores the engine directory).
- A two-loopback-server HTTP test calls the real customer gateway, synthetic membership check, real HMAC bridge and film platform; only OpenAI response bodies are mocked. It tests ordinary chat, hierarchical plan/adoption, unavailable-model refusal, saved history/reload, real local FFmpeg MP4 commit, final-only file listing/ticket and foreign-user refusal. It issues exactly three synthetic Responses results and no GPU calls.
- Additional regressions cover original source chunks and ownership, scoped source summaries, explicit canonical-source adoption, independent duplicate-title conversations, safe legacy import, reference attachment, spending ceiling/funds rejection, current-publication rejection and clearing an applied edit suggestion.
- Model adapter fixtures were updated with explicit **synthetic** publication approvals and enough **synthetic** credit to cover the full approved estimate. No production authorization policy was relaxed. The existing 1,250-microUSD mocked failure-meter assertion is preserved.

Limits: these tests do not prove actual model readiness, dialect/identity quality, native GPU/container behavior, live PostgreSQL or deployment. Shared wallet/rental/account/file implementations were reused, not replaced. Completion task 02 and license/cloud gates remain separate.
