<!-- L9_META: layer=architecture, role=pattern_harvest_adr, status=accepted, version=1.0.0 -->
# ADR-0004: Competitive Pattern Harvest and Blueprint Gate

## Status
Accepted, **amended by [ADR-0018](ADR-0018-website-build-blueprint-v2-single-authority.md)**.

The harvest sequence, the bounded donor ingestion, the acceptance-test
requirement and the BLUEPRINT GATE below all still stand. What changed is the
artifact the gate seals: `WebsiteBuildBlueprintV1` is superseded and removed;
the gate now seals `WebsiteBuildBlueprintV2`, and `CompetitiveLandscape` +
`PatternPortfolio` are no longer its only semantic inputs — `ClientVision` and
`DesignReferenceIntelligence` are first-class first-party authorities alongside
them. Compilation moved from `CompetitiveIntelligenceStage` to
`src/intelligence/WebsiteBuildBlueprintCompiler.ts`. Every mention of V1 below
is historical.

## Date
2026-08-14

## Context
Generating before understanding the category permits the system to reproduce a weak
source site or invent generic design choices.

## Decision
`REDESIGN_IMPROVE` requires the following sequence before page generation:

```
BaselineSiteProfile
        +
CompetitiveLandscape
        ↓
bounded donor ingestion
        ↓
per-donor nugget extraction
        ↓
cross-donor synthesis
        ↓
PatternPortfolio
        ↓
source-vs-market gap analysis
        ↓
WebsiteBuildBlueprint
        ↓
BLUEPRINT GATE
```

Each harvested concept must contain:

- evidence;
- abstract invariant;
- disposition;
- beneficiary destination;
- risk;
- acceptance test.

Allowed dispositions:

`PORT`, `PORT_WITH_HARDENING`, `CONFIGURE`, `MERGE_WITH_EXISTING`, `KEEP_LOCAL`,
`MIGRATION_CONTEXT`, `REJECT`, `UNKNOWN`.

Website-Bot ports **patterns**, not competitor expression.

Competitor prose, images, source code, trademarks, and exact visual treatments may
**not** become generation inputs.

Cross-donor frequency is evidence, not automatic adoption authority.

Each adopted pattern has one destination and one owner.

No design, page-content, image, or assembly generation may begin until a validated
WebsiteBuildBlueprint exists.

## Consequences
- Research becomes an executable prerequisite rather than an advisory report.
- Downstream generation receives normalized patterns and requirements rather than
  raw competitor pages.

## Validation / Evidence
- Every blueprint pattern reference resolves to PatternPortfolio evidence.
- Every adopted pattern has an acceptance test.
- Raw donor text/image payloads are absent from page-content generation requests.

## Related Artifacts
- `@quantum-l9/bot-interop` `WebsiteBuildBlueprintV1`, `CompetitiveLandscapeV1`
- SEO-Bot ADR-0012 (CompetitiveLandscape Ranking Authority)
