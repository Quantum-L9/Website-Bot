# Quantum AI Partners — Clean Capability Test

A clean, end-to-end capability benchmark of Website-Bot against the repository
state at test start. The client is fictional: **Quantum AI Partners**, an AI
systems company. The input intentionally contains raw business truth, client
vision, and reference feedback only — **no design conclusions**.

## Files

| File | Role |
|---|---|
| `client-input.yaml` | Raw operator input, preserved verbatim (business truth, client vision, references, policies). |
| `domain_spec.yaml` | Flat `DomainSpec` the pipeline consumes. Carries only raw first-party input: `client_vision` in the client's own words, `design_references` with verbatim `selection_reason` and **no** `principles` (translating reference characteristics is Website-Bot's job), `design.status: pending`, `build_intent: REDESIGN_IMPROVE`. |
| `driver.ts` | Benchmark driver. Runs the production pipeline in-process through the same public API as `scripts/run-pipeline.ts` and serializes the redesign intelligence artifacts the CLI leaves in memory (CompetitiveLandscape, SEOContentBlueprint, StructuredContentPackage, design authorities) into `build/benchmarks/quantum-ai-partners/artifacts/`. No production code is modified. |

## Test purity

- `design.status` is `pending`; no palette, fonts, or tokens are supplied.
- `design_references` entries carry the client's verbatim feedback as
  `selection_reason`; `principles` are omitted so no reference characteristics
  are pre-translated by the operator.
- Geography `US` is the least-specific required field value (the client
  supplied no region); it is a build-context assumption, not business truth.

## Run

```bash
# Dry plan (validates spec, stage wiring, SEO-Bot preflight — no LLM spend, no mutations)
npx tsx reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/input/driver.ts --spec=reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/input/domain_spec.yaml --mode=plan --redesign

# Real local-proof build (full REDESIGN_IMPROVE intelligence chain + Astro build)
npx tsx reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/input/driver.ts --spec=reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/input/domain_spec.yaml --mode=local-proof --redesign
```

Output evidence (gitignored `build/benchmarks/quantum-ai-partners/`):

- `artifacts/` — captured intelligence artifacts (landscape, blueprint V2,
  SEOContentBlueprint, PageContentContract, StructuredContentPackage,
  design authorities, determinism proofs).
- Pipeline evidence: `build/evidence/<client>/<build>/` (checkpoints,
  assembly, build proof, release receipt).
- Generated site: `build/sites/<client>/` (source + `dist/`).
- Renders and evaluation: produced by the benchmark's render/evaluate pass.
