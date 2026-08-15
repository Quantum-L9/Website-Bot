# Recursive Engineering Run v1

Bounded recursive development controller for Website-Bot. Each real E2E is an
experiment against a specific code version: its evidence compiles into
engineering signals, the highest-leverage supported root cause becomes one PE
Pack, one bounded code hypothesis is implemented, independently validated,
promoted, and deployed — and the exact deployed revision drives the next E2E.

- **Mode:** `DEVELOPMENT_RECURSIVE` only.
- **Wave budget:** target 3, hard max 3. A fourth wave is unrepresentable and
  hard-rejected by the state machine.
- **Control plane:** immutable during a recursive run. The coding agent may
  improve the application plane but may never modify the authority that
  defines, bounds, validates, or terminates its autonomy.

## Operator surface

```bash
npm run recursive:improve -- --source <SOURCE_URL> --waves 3
npm run recursive:status   [--run <id>]
npm run recursive:resume   -- --run <id>
npm run recursive:simulate
npm run recursive:schemas
npm run recursive:test
```

- `recursive:improve` materializes a DomainSpec for the source URL and runs the
  canonical real E2E entrypoint (`npm run pipeline:end-to-end -- --spec=...`),
  then harvests engineering signals from the produced release receipt and
  evidence store. `--waves` accepts only `3`.
- `recursive:status` inspects a run's durable manifest and final receipt.
- `recursive:resume` rebuilds an interrupted run's state from the durable event
  ledger without repeating completed semantic operations.
- `recursive:simulate` executes the fully controlled three-wave proof against a
  local bare repository and a local deployment directory (no GitHub, no
  Vercel, no real Safe Haven campaign).

Durable state lives under `.l9/recursive/<runId>/` (gitignored): the campaign
manifest, wave receipts, the final machine-readable run receipt, and the
append-only event ledger.

## Bound contracts

Six canonical schemas bound at program admission (pack digests recorded in the
program runtime admission receipt), emitted under `schemas/recursive/`:

| Schema | File |
|---|---|
| `l9.engineering-signal/v1` | `engineering-signal.schema.json` |
| `l9.pe-pack/v1` | `pe-pack.schema.json` |
| `l9.code-change-outcome/v1` | `code-change-outcome.schema.json` |
| `l9.recursive-engineering-event/v1` | `recursive-engineering-event.schema.json` |
| `l9.recursive-engineering-wave/v1` | `recursive-engineering-wave.schema.json` |
| `l9.recursive-engineering-run/v1` | `recursive-engineering-run.schema.json` |

`npm run recursive:schemas` validates every emitted schema with the repo's
JSON Schema 2020-12 compiler (fail-closed objects, no external refs, generated
positive/negative fixtures). Conformance tests additionally pin each contract's
field set to the bound pack types.

## Architecture

- `src/recursive/contracts/` — bound contract types, digests, schema validator.
- `src/recursive/state/` — campaign manifest, atomic transitions, wave budget,
  crash-safe resume. `constants.ts` is control plane.
- `src/recursive/events/` — HMAC-authenticated event envelope, append-only
  ledger, deduplication, reconciliation, fenced leases.
- `src/recursive/harvest/` — EngineeringHarvestCompiler over the shipped
  release receipt, evidence chain, stage failures, and checkpoints.
- `src/recursive/signals/` — EngineeringSignalRegistry: dedupe, cluster, rank.
- `src/recursive/pepack/` — PEPackCompiler with frozen acceptance contract and
  mutation envelope.
- `src/recursive/executor/` — bounded coding executor (envelope enforcement,
  patch provenance). The executor never verifies its own work.
- `src/recursive/verifier/` — independent verifier: originating/control/
  disconfirm/holdout replay, repository checks, semantic artifact blast
  radius, verified patch SHA receipt.
- `src/recursive/promotion/` — PR reconciliation, required checks, verified-SHA
  merge gate, exact merge receipt.
- `src/recursive/deployment/` — exact merge-SHA deployment, health validation,
  automatic rollback.
- `src/recursive/controller.ts` — the run loop.
- `src/recursive/simulation/simulate.ts` — the simulated three-wave proof.

## Laws

1. Maximum 3 waves.
2. One real full E2E per tested code version.
3. One coherent PE Pack per wave; one primary repository and subsystem.
4. Control plane immutable during autonomous runs.
5. Acceptance contract frozen (digest-bound) before mutation.
6. Coding agent cannot self-certify.
7. Originating + controls + disconfirm + protected holdout required.
8. No test weakening to obtain green.
9. Artifact-diff blast-radius verification required.
10. Merge only after independent replay/CI PASS with verified patch SHA equal
    to merge head SHA.
11. Next E2E only after a deployment receipt proves the expected SHA.
12. Hooks trigger reconciliation; hooks never authorize transitions.
13. All external effects idempotent.
14. One engineering mutation stream.
15. Automatic rollback on failed deployment verification.
16. Hard cost/scope budgets in addition to the wave budget.
17. No actionable high-confidence signal → stop.
18. Wave 3 code is explicitly marked pending next full-E2E validation
    (`fullE2EValidated: false`); the next run begins by E2E-testing V3.

## Terminal states

`WAVE_LIMIT_REACHED` (normal three-wave completion),
`REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL`, `NO_ACTIONABLE_SIGNAL`,
`NO_MATERIAL_IMPROVEMENT`, `CONTROL_PLANE_CHANGE_REQUIRED`,
`PATCH_VALIDATION_FAILED`, `DEPLOYMENT_FAILED`, `BLOCKED`, `FATAL`.

## Runbook

- **Inspect:** `npm run recursive:status -- --run <id>`.
- **Recover:** `npm run recursive:resume -- --run <id>` replays the ledger;
  duplicates are NOOPs, stale events are audited, lost events are recovered by
  reconciliation against durable truth.
- **Proof:** `npm run recursive:simulate` must pass before any real run.
- **Start:** `npm run recursive:improve -- --source <SOURCE_URL> --waves 3`.
