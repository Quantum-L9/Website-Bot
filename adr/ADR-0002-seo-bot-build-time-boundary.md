<!-- L9_META: layer=architecture, role=seo_boundary_adr, status=accepted, version=1.0.0 -->
# ADR-0002: SEO-Bot Build-Time Intelligence Boundary

## Status
Accepted.

## Date
2026-08-14

## Context
Redesign quality requires SERP intelligence and SEO-aware content without
duplicating SEO functionality inside Website-Bot or allowing SEO-Bot to become the
site mutation authority.

## Decision
SEO-Bot is the authoritative producer of:

- CompetitiveLandscape
- SEOContentBlueprint
- StructuredContentPackage

Website-Bot is the authoritative producer of:

- BaselineSiteProfile
- PatternPortfolio
- WebsiteBuildBlueprint
- PageContentContract
- QualityDeltaReport

Website-Bot owns final site mutation, component assembly, source-tree changes,
builds, quality gates, and deployment.

SEO-Bot may research, reason, generate content artifacts, validate SEO content, and
monitor post-launch outcomes. It may **not** modify Website-Bot's generated source
tree as part of the redesign transaction.

No artifact has joint mutable ownership.

### Build-Time Flow

```
SEO-Bot
CompetitiveLandscape
        │
        ▼
Website-Bot
PatternPortfolio
WebsiteBuildBlueprint
        │
        ├──────────────► SEO-Bot
        │                SEOContentBlueprint
        │                       │
        ▼                       │
PageContentContract ◄───────────┘
        │
        ▼
SEO-Bot
StructuredContentPackage
        │
        ▼
Website-Bot
assemble → build → validate → deploy
```

## Consequences
- Website-Bot does not implement independent SERP ranking logic.
- Website-Bot does not generate final page/body SEO copy in `REDESIGN_IMPROVE`.
- SEO-Bot does not choose layouts or mutate Astro/site source.

## Validation / Evidence
- Cross-repo contract tests validate artifact schema versions and hashes.
- Website-Bot fails closed when SEO artifacts required by redesign mode are absent
  or invalid.

## Related Artifacts
- `@quantum-l9/bot-interop` `l9.website-intelligence/v1`
- `src/intelligence/SeoBuildIntelligencePort.ts`
- `src/intelligence/compile-page-content-contract.ts`
- `contracts/WEBSITE_INTELLIGENCE_LOCK.json`
- SEO-Bot ADR-0010 (Build-Time Website Intelligence Interface)
