# Film account and resource management service

## Engine retirement

The former LTX inference implementation, profiles, model manifests and model-specific runtime dependencies are removed. No replacement inference engine is configured. New GPU inference and model preparation must fail closed before paid dispatch. Existing account credentials, projects, media, wallet/financial records and resource-stop/reconciliation operations remain supported; historical receipts are not rewritten as successful or deleted by this source change.

The service remains the authenticated backend for encrypted Modal accounts, connection verification, administrator permissions, cost quotes, resource observation, scoped stop/reconciliation, storage-management infrastructure, wallet settlement and retained media. Transfer infrastructure is retained for a future explicit model manifest; no old model is downloaded or revived automatically.

## Runtime and checks

The entry point remains `service.mjs`. Node 24+ is needed for the local SQLite fixture checks. PostgreSQL remains a supported server backend; `pg` is pinned by package-lock. Do not point local checks at the production database. Run `npm ci` and `npm test` in this directory, and the root build/typecheck/gateway checks.

`CUSTOMER_PLATFORM_ENABLED` and `ENGINE_ALLOW_PAID_ACTIONS` are deployment controls, not permission to restore a retired engine. An unconfigured engine must reject a new production request regardless of stored old readiness or approval. Starting this module does not apply database migrations, download weights, deploy Modal workers or start GPU.

## Preserved boundaries

- Authenticated gateway operations retain server-derived actor/tenant scope.
- Administrator account fields retain Token ID/Secret validation and encryption.
- Credentials travel in private pipes, never process arguments, browser DTOs or logs.
- Job and rental IDs remain durable and idempotent. Unknown cloud state stays unknown until observed; a timeout does not authorize another paid job.
- Existing resource cancellation/reconciliation and billing history remain available even though new inference is unavailable.
- Retained media uses ownership and expiry checks. No user media, financial records, conversations or unrelated services are removed by code retirement.
- Account switching or catalog display never starts GPU.

See `OPERATIONS.md` for operational safeguards, `BRIDGE-CONTRACT.md` for the retained API surface, and the repository's `docs/task-01-retirement.md` for source changes and verification evidence. Local cleanup alone is not proof of completed HostHatch/Modal deletion.
