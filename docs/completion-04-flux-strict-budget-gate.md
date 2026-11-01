# FLUX strict5USD pre-dispatch gate — stopped

2026-10-31. Primary account only. User authorizes no overspend, no site publication, no rental change and no other model.

## Decision

No paid resources were started. A total incremental5USD limit and reliable full resource shutdown are not established. This overrides any earlier suggestion that the administrative route was end-to-end ready.

## Actual direct Backend finding

The route is independent of the old UI. However the genuine administrative runner creates an administrative production-attempt without quoteId/chargeId or a production-model-run. The genuine shared model transport unconditionally reads/requires the production quote, charge and run records. A local isolated test joining the actual runner, actual FLUX adapter and actual shared transport reproduced the missing-quote SQLite bind failure. Cloud start/stop were mocked and the external runner was never called. Earlier native-adapter tests injected an entire Mock transport, so they did not establish this authorization boundary. A safe fix must create an independently scoped administrative authorization contract, not counterfeit customer financial rows.

See completion-04-flux-direct-path-probe.json for the precise result. The first diagnostic expected the later authorization error; the actual earlier undefined-bind failure was preserved and correctly classified in the subsequent reproduction.

## Billing observations (read-only)

The authenticated primary billing page displayed Starter; Oct1–Oct31 cycle;6.32USD gross usage;23.68USD credits;42.50USD total usage limit;0USD out-of-pocket spend limit. It explicitly says volume charges still accrue when workspace workloads stop. No limit was edited. A zero net spend limit permits consuming credits and therefore does not enforce a5USD gross trial cap.

Official Workspace budgets are monthly/global. Environment budgets require Team/Enterprise and cover compute only. This test has no verified total budget guard for build+CPUprepare+GPUstartup/inference/idle+network+persistent Volumes. Its actual supplier cost observer returns null; local rental estimates cannot substitute for it. Altering the global account cap may affect other workloads and was not done.

## Resources that can keep billing

- CPU image builders: no verified scoped cost cap/cancellation; inference timeout does not cover them.
- CPU preparation:2cores/8GiB,3600s execution+180s startup; min0/max1/retries0/idle2s. Explicit cancel exists; real stop not tested.
- GPU class:L40S/4cores/64GiB; defaults600s execution+180s startup+1200s idle. Scoped cancellation and graceful container stop check settled calls and zero active tasks; actual shutdown is unverified, not guaranteed by a Mock.
- Weights Volume14.879GiB and a separate results Volume: persistent after GPU shutdown. Gross weight-storage reference1.34USD/month before allowances. Official deletion billing can continue up to4days after daily snapshots; immediate deletion is not proof of zero subsequent charges.
- Output egress: not an established cumulative live invoice meter.

None was created, invoked, downloaded, stopped or deleted. Existing account resources and site/rental settings remain untouched.

## Reopen conditions

Fix/test the administrative authorization seam; establish a5USD total guard including builders, final shutdown and storage lifetime/lag reserve, without affecting other workloads. Until then, do not dispatch paid preparation or inference, and do not treat5USD as additional-spend permission.

Sources: https://modal.com/docs/guide/budgets ; https://modal.com/docs/guide/volumes ; https://modal.com/docs/guide/timeouts ; https://modal.com/docs/guide/billing . Full observed facts/resource inventory: completion-04-flux-strict-budget-gate.json.
