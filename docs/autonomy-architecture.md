# ADR: L9 Autonomy Upgrade — Website-Bot

**Status:** Proposed  
**Date:** 2026-07-15  
**Author:** L9 Architecture (via Perplexity deep-research brief)

## Context

Website-Bot is a deterministic, staged site-generation pipeline targeting Astro + Vercel.  
The existing stage orchestrator (`src/pipeline/`) runs one-shot without durable checkpointing,  
which means a mid-run failure requires a full restart and any external mutations (Vercel deploys) have no registered rollback path.

## Decision

Wrap the existing 10-stage pipeline in an **Inngest durable function** (`src/inngest/website-pipeline.ts`).

### What changes

| File | Change |
|------|--------|
| `.github/workflows/agent-pipeline.yml` | **NEW** — autonomous trigger; fires Inngest event after pre-flight gate. Does NOT replace `build-and-validate.yml`, `deploy-to-vercel.yml`, `emit-handoff.yml`, or `regen-lockfile.yml`. |
| `src/inngest/website-pipeline.ts` | **NEW** — Inngest function wrapping all stages with durable steps, approval gate, budget guard, and compensation. |
| `src/lib/budget-guard.ts` | **NEW** — `AgentBudgetGuard` class (admission → reserve → reconcile → enforce). |
| `src/lib/compensation.ts` | **NEW** — `CompensationRegistry` saga/rollback abstraction. |
| `src/lib/schema.sql` | **NEW** — `agent_jobs`, `budget_violations`, `compensation_log` DDL. |

### What does NOT change

- Existing pipeline stage modules in `src/pipeline/`
- Existing workflows: `build-and-validate.yml`, `deploy-to-vercel.yml`, `emit-handoff.yml`, `regen-lockfile.yml`
- `AGENTS.md` locked decisions (Astro, Vercel, npm, @quantum-l9/llm-router)
- `.env.example` or `config/launch-env.required.yaml`

## Implementation status (2026-07-20)

The original proposal above assumed `VercelDeploy.deployPreview()` / `.promoteToProduction()` /
`.rollback()` methods and a `step.waitForEvent('website/production.approved')` human-approval
gate between a preview deploy and a production promotion. **`VercelDeployStage` does not have
that API** — it performs a single direct `target: 'production'` deploy with no preview/promote
split and no rollback endpoint. Implementing the preview → approve → promote → rollback flow is
tracked as a follow-up (it would also move `VercelDeployStage` onto the "preview-first only"
deployment posture already locked in `AGENTS.md`, which it does not currently follow either).

What is implemented in `src/inngest/website-pipeline.ts` today:

- The existing 10-stage `PipelineRunner` run wrapped as one durable Inngest step (not split
  per-stage — `PipelineRunner` owns a single SQLite `BuildDB` connection for the whole run, so
  splitting it across step boundaries would leave that connection spanning Inngest replays).
- `AgentBudgetGuard` admission/reserve/reconcile/enforce around the run, with compensation
  triggered on `BudgetExceededError` / `AdmissionRejectedError`.
- A `CompensationRegistry` entry registered before the run so a failure can report the
  deployment for manual rollback (VercelDeployStage has no automated rollback to call yet).
- A `website/pipeline.completed` Inngest event emitted on success (in addition to, not instead
  of, `HandoffEmitterStage`'s existing `contracts/website_factory_integration.yaml` write and
  optional SEO-Bot registration POST).

## Approval gate semantics (not yet implemented)

The human-approval gate described in the original proposal — hibernating at
`step.waitForEvent('website/production.approved')` for up to 24 hours, with compensation on
timeout — requires the preview/promote split above and is **not present** in the current
`website-pipeline.ts`. Do not assume this gate exists until it ships.

## Budget control

`COST_CAP_USD` is injected as an env var from the GitHub Actions `workflow_dispatch` input (default: `1.00`).  
The `AgentBudgetGuard` enforces four modes as spend accumulates:

| Pressure | Mode |
|----------|------|
| < 70% | `normal` |
| 70–85% | `cheaper_model` |
| 85–95% | `narrow_scope` |
| 95–100% | `require_approval` |
| > 100% | `stop` (throws `BudgetExceededError`) |

## Required secrets (new)

```
INNGEST_EVENT_KEY    — from Inngest dashboard (signing key for event dispatch)
INNGEST_SIGNING_KEY  — from Inngest dashboard (request signature verification)
POSTGRES_URL         — optional; if set, persists job cost to agent_jobs table
```

## Consequences

- A crash retries the whole `run-pipeline` step (i.e. the whole 10-stage run) via Inngest's
  built-in step retry — not just the failing stage — because the stages share one `BuildDB`
  connection and `BuildContext` for the duration of the run.
- On budget exhaustion, the registered compensation action logs the deployment for manual
  rollback; there is no automated Vercel rollback yet (see "Implementation status" above).
- Budget spend is visible per-run in Postgres (when `POSTGRES_URL` is set) and in the Inngest
  dashboard.
