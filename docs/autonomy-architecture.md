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

## Approval gate semantics

The Inngest function hibernates at `step.waitForEvent('website/production.approved')` for up to 24 hours.  
To approve, send the event with `{ data: { jobId: '<job-id>' } }` via Inngest dashboard or API.

On timeout, the compensation registry rolls back the preview deployment and the function returns `approval_timeout`.

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

- Any pipeline stage crash is retried from the last completed Inngest step — not from stage 1.
- Vercel preview deployments are compensated (rolled back) on approval timeout or downstream failure.
- Budget spend is visible per-run in Postgres and in Inngest dashboard.
