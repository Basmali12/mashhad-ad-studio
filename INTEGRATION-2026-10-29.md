# Mashhad integration boundaries

This repository retains the existing customer/admin Mashhad interfaces, Clerk/Convex scheduling and publishing integrations, file access, subscriptions and the film-service gateway. The former film inference model has been retired; no new engine is activated in this task.

The authenticated film gateway remains connected to the self-hosted film management service and PostgreSQL. Credential encryption, administrator permissions, wallet settlement, account/slot administration, storage-transfer infrastructure and stop/reconciliation remain in scope to preserve. Existing user projects, messages, media and receipts are not removed.

Deployment origins remain `https://iraqaistudio.com/` and the existing `scan.iraqaistudio.com` API/admin paths. No DNS or domain changes are part of this work. The presence of local source changes does not establish successful server installation or Modal deletion.

Current operating instructions: [README](README.md), [service operations](services/film-engine/OPERATIONS.md), and [task 1 record](docs/task-01-retirement.md). Historical local GPU tests are not readiness proof for a future replacement engine.
