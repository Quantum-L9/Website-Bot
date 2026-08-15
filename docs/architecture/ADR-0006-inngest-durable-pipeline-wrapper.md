<!-- L9_META: layer=architecture, role=autonomy_adr, status=accepted, version=1.0.0 -->
# ADR-0006: Inngest Durable Wrapper Around PipelineRunner

## Status
Accepted.

## Date
2026-07-15

## Context
`PipelineRunner` is a one-shot orchestrator. A mid-run crash restarts the whole
factory. External mutations (Vercel deploys) had no registered compensation path.
A Perplexity brief proposed wrapping the pipeline in Inngest with per-stage
durable steps, a human approval gate, and automated preview/promote/rollback.

`VercelDeployStage` does not expose preview, promote, or rollback APIs. It
deploys `target: 'production'` in one shot. `PipelineRunner` holds one SQLite
`BuildDB` connection for the whole run, so splitting stages across Inngest step
boundaries would leave that connection spanning replays.

## Decision
Website-Bot wraps the existing `PipelineRunner` in one Inngest function
(`src/inngest/website-pipeline.ts`, id `website-pipeline`).

- The runner stays the stage authority. Inngest does not become a second pipeline.
- The durable unit is the whole `run-pipeline` step, not per-stage steps.
- `AgentBudgetGuard` admits, reserves, reconciles, and enforces spend.
  `COST_CAP_USD` comes from the workflow dispatch input (default `1.00`).
  Pressure modes: `<70%` normal, `70–85%` cheaper_model, `85–95%` narrow_scope,
  `95–100%` require_approval, `>100%` stop (`BudgetExceededError`).
- `CompensationRegistry` records the deployment for **manual** rollback on
  budget or admission failure. There is no automated Vercel rollback.
- Success emits `website/pipeline.completed` in addition to
  `HandoffEmitterStage` (not instead of it).
- Existing workflows (`build-and-validate`, `deploy-to-vercel`, `emit-handoff`,
  `regen-lockfile`) are not replaced. Locked stack decisions in `AGENTS.md` are
  unchanged.

The proposed `step.waitForEvent('website/production.approved')` gate is **not**
part of this decision. It requires a preview/promote split that does not exist.

## Consequences
- A crash retries the entire factory run, not the failing stage.
- Budget exhaustion logs compensation; an operator rolls back by hand.
- Do not assume a human approval gate or automated rollback exists.
- Required process env when the wrapper is used: `INNGEST_EVENT_KEY`,
  `INNGEST_SIGNING_KEY`. `POSTGRES_URL` is optional job-cost persistence.

## Related Artifacts
- `src/inngest/website-pipeline.ts`
- `src/lib/budget-guard.ts`
- `src/lib/compensation.ts`
- Archived source: `docs/archive/autonomy-architecture.md`
