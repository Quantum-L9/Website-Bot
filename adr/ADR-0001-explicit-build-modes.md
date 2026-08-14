<!-- L9_META: layer=architecture, role=build_modes_adr, status=accepted, version=1.0.0 -->
# ADR-0001: Explicit Copy and Redesign-Improve Build Modes

## Status
Accepted.

## Date
2026-08-14

## Context
Website-Bot must support two fundamentally different intents: faithful
reconstruction and material redesign. Source-site availability must not implicitly
choose behavior.

## Decision
Website-Bot will expose exactly two first-class build intents:

- `COPY`
- `REDESIGN_IMPROVE`

`COPY` treats the source site as reconstruction authority.

`REDESIGN_IMPROVE` treats the source site only as:

- verified business evidence;
- brand/source asset evidence where explicitly permitted;
- current-state UX/design/content baseline;
- quality baseline against which the candidate is evaluated.

In `REDESIGN_IMPROVE`, source page structure, source section order, source copy,
typography, layout, conversion flow, and visual system are **not** authoritative
unless explicitly preserved by operator policy.

Mode selection must be explicit in the canonical input contract. Existence of a
source crawl must never infer `COPY`.

## Consequences
- Copy-mode reconstruction paths remain available.
- Redesign mode must not invoke source-section reconstruction merely because
  crawled pages exist.
- Redesign mode fails closed if required redesign intelligence artifacts are
  absent.

## Validation / Evidence
- Tests must prove identical source inputs produce different stage plans under
  `COPY` and `REDESIGN_IMPROVE`.
- Tests must prove `REDESIGN_IMPROVE` cannot enter source-copy reconstruction
  branches.

## Related Artifacts
- `src/pipeline/BuildIntent.ts` (`parseBuildIntent`, `isCopyIntent`,
  `isImproveIntent`)
- DomainSpec
- BuildContext
- FactoryExecutionPlan
- ContentGenerationStage
- SourceSiteIngestionStage
