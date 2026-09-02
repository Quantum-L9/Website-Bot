# Website-Bot Clean Capability Test — Final Report

**Client:** Quantum AI Partners (fictional) · **Date:** 2026-09-01

## Repository HEAD tested

| Ref | SHA |
|---|---|
| Production HEAD (test subject, untouched) | `9a4a156ba9b67d392e4ee9f50810a44240536fde` — `feat(blueprint)!: replace WebsiteBuildBlueprintV1 with V2 single authority (#173)` |
| HEAD at packaging (benchmark scaffolding only) | `4cea9e4ee024703c93d9635297703f8116659eaa` — three additive commits: `43923d8` (input + driver), `137e565` + `4cea9e4` (driver fixes) |

No production file (`src/`, `scripts/`, `packages/`, `astro_template/`,
`contracts/`, `schemas/`) was modified during the 2026-09-01 run. This pack
lives under `reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/`.
The packaging PR also updates `.gitignore` and NodeNext specifiers in two unit tests.

## Final status

**BLOCKED_BY_EXTERNAL_DEPENDENCY**

## Where the run stopped

The pipeline (flat `DomainSpec`, `build_intent: REDESIGN_IMPROVE`, plan mode)
validated the spec and ran two stages successfully, then failed closed at the
third stage:

1. `domain-spec-loader` — OK (6 routes, spec valid)
2. `unknown-resolver` — OK (0 WOM flags)
3. `seo-build-intelligence-preflight` — **FAILED**: `REDESIGN preflight failed: SEO-Bot /health unreachable: fetch failed` (code `SEO_BOT_UNREACHABLE`)

Evidence: `evidence/plan-mode-run.log`, `evidence/seo-bot-probe.log`,
`evidence/seo-bot-dev-start.log`, `status.json`.

## Causal chain (observed evidence, not inference)

1. The configured `SEO_BOT_URL` is an `http://` **loopback** URL and is
   configured (`SEO_BOT_API_KEY` present too), but `GET /health` fails with
   `fetch failed` — nothing is listening.
2. SEO-Bot's canonical local port 3100 has no listener (`lsof` empty).
3. Starting the local SEO-Bot checkout (`npm run dev` in `<local SEO-Bot checkout>`)
   exits at config validation: **missing `L9_MEMORY_TOKEN`**.
4. `L9_MEMORY_TOKEN` has no reference in the governance secrets registry
   (`~/.cursor-governance/ops/secrets`), so it is not resolvable from the
   sanctioned secrets plane by this session.
5. The Docker daemon is not running, so SEO-Bot's canonical containerized
   backing services (Postgres/Redis/ClickHouse) cannot come up without operator
   action.
6. The memory plane the token belongs to (Graphiti) is itself unreachable this
   session (sessionStart hydration DEGRADED — connection refused).

The REDESIGN_IMPROVE topology intentionally fails closed before the first paid
build-intelligence call when SEO-Bot is unreachable (the preflight is a
topology invariant, not a courtesy check). This is the product behaving
correctly; the environment it depends on is down.

## Reference sites actually acquired

**None.** No stage that acquires or analyzes the five client-supplied reference
URLs ever ran (the run stopped before `competitive-intelligence`, and — see
GAP-1 below — the pipeline has no stage that crawls client-supplied
`design_references` URLs at all).

## Additional references selected — and why

None. Reference-pool refinement never ran.

## Design intelligence summary

Not produced. `ClientVision` / `DesignReferenceSet` / `DesignReferenceIntelligence`
resolution and the sealed `WebsiteBuildBlueprintV2` compilation all live inside
`competitive-intelligence`, which was never reached.

## Resulting design direction

Not produced (blocked upstream).

## Major blueprint decisions

Not produced (blocked upstream).

## SEO intelligence used

None. The run stopped at the SEO-Bot readiness proof; zero paid SEO-Bot calls
were made.

## Site routes built

None. The generated Astro site does not exist.

## Functional validation results

Not run (no site was built).

## Visual evaluation results

Not run (no site was rendered).

## Client intent alignment

Not assessable (no rendered site).

## Palantir differentiation assessment

Not assessable (no rendered site).

## Remaining defects / identified capability gaps

Recorded, not silently repaired (benchmark integrity rule):

| ID | Gap | Evidence |
|---|---|---|
| GAP-1 | No pipeline stage acquires or analyzes client-supplied design-reference sites. `DesignReferenceSpec.principles` is operator-authored; `deriveDesignReferenceIntelligence` merges spec-declared principles only. The benchmark's `acquire_reference_evidence` / `analyze_each_client_reference` steps have no implementation. Real crawl + screenshot acquisition (`HttpDonorIngestor`) exists only for SEO-Bot SERP-selected donors. | `src/intelligence/design-authority.ts`, `src/stages/CompetitiveIntelligenceStage.ts`, `src/pipeline/BuildContext.ts` (`DesignReferenceSpec`) |
| GAP-2 | `scripts/normalize-spec.ts` does not carry `client_vision` / `design_references` / `build_intent` from the rich authoring format into the flat spec — redesign clients must hand-author the flat `DomainSpec`. | `scripts/normalize-spec.ts` (`buildFlatSpec` fixed key set) |
| GAP-3 | The stock CLI does not persist `CompetitiveLandscape`, `SEOContentBlueprint`, or `StructuredContentPackage` to disk (in-process memory only; only the blueprint and PageContentContract are written). The benchmark driver captures them in-process. | `src/stages/CompetitiveIntelligenceStage.ts`, `src/stages/RedesignContentAuthorityStage.ts`, `scripts/run-pipeline.ts` |

## Smallest unblock path (proposed separately — no production changes made)

1. Operator starts the SEO-Bot service on the configured loopback URL
   (canonical local port 3100), supplying `L9_MEMORY_TOKEN` and any
   Postgres/Redis backing it needs locally; **or** points `SEO_BOT_URL` at a
   running SEO-Bot instance with matching `bot-interop` / `llm-router` versions.
2. Re-run:
   `npx tsx reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/input/driver.ts --spec=reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/input/domain_spec.yaml --mode=local-proof --redesign`
3. The driver then captures the full intelligence chain and the pipeline builds
   the Astro site; the render/evaluate pass and ZIP packaging follow.

## What the run proved (even while blocked)

- The flat spec authoring path for `REDESIGN_IMPROVE` inputs works: spec
  validation passed with `client_vision` + `design_references` + `pending`
  design, so the raw-input → first-artifact boundary is intact.
- Preflight fail-closed behavior works exactly as designed: unreachable SEO-Bot
  yields a typed `SEO_BOT_UNREACHABLE` failure before any paid call, in plan
  mode, in seconds.
- The benchmark driver correctly reuses the production execution plan
  (`buildFactoryExecutionPlan` + `executeFactoryPlan`) with `buildIntent`
  propagated.

## Output ZIP

`quantum-ai-partners-benchmark.zip` — see `validation-summary.md` for the
manifest of what is packaged and which benchmark-required artifacts could not
be produced and why (none of them are claimed to exist).

## Honesty statement

Everything above is observed evidence or clearly labeled derived judgment.
Artifacts that do not exist (design intelligence JSONs, contracts from SEO-Bot,
website source, renders, evaluations) are explicitly marked **not produced**,
with the blocking stage named. No capability is claimed as exercised without a
corresponding artifact. Production code was not modified during this run.
