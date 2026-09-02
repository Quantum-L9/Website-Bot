# Architecture Decision Records (ADRs)

This directory is the **single canonical location** for Website-Bot Architecture
Decision Records. Do not add numbered ADRs under `adr/`, `docs/architecture/`, or
any other path.

These decisions remain authoritative until superseded by a numbered ADR.

## Index

| ADR | Topic | Status | Date |
|-----|-------|--------|------|
| [ADR-0001](ADR-0001-explicit-build-modes.md) | Explicit Copy and Redesign-Improve Build Modes | accepted | 2026-08-14 |
| [ADR-0002](ADR-0002-seo-bot-build-time-boundary.md) | SEO-Bot Build-Time Intelligence Boundary | accepted | 2026-08-14 |
| [ADR-0003](ADR-0003-llm-capability-routing.md) | Capability-Based LLM Routing and Provider Isolation | accepted | 2026-08-14 |
| [ADR-0004](ADR-0004-competitive-pattern-harvest-and-blueprint-gate.md) | Competitive Pattern Harvest and Blueprint Gate | accepted | 2026-08-14 |
| [ADR-0005](ADR-0005-quality-delta-and-bounded-repair.md) | Quality Delta Gate and Bounded Repair | accepted | 2026-08-14 |
| [ADR-0006](ADR-0006-inngest-durable-pipeline-wrapper.md) | Inngest Durable Wrapper Around PipelineRunner | accepted | 2026-07-15 |
| [ADR-0007](ADR-0007-per-client-factory-topology.md) | Per-Client Factory Topology | accepted | 2026-08-14 |
| [ADR-0008](ADR-0008-platform-application-boundary.md) | Website factory systems are platform applications | accepted | 2026-07-22 |
| [ADR-0009](ADR-0009-infisical-secrets-plane.md) | Infisical is the Website-Bot secrets plane | accepted | 2026-08-11 |
| ADR-0010 | (SEO-Bot series) | — | — |
| ADR-0011 | (SEO-Bot series) | — | — |
| ADR-0012 | (SEO-Bot series) | — | — |
| ADR-0013 | (SEO-Bot series) | — | — |
| ADR-0014 | (SEO-Bot series) | — | — |
| [ADR-0015](ADR-0015-image-and-source-ingestion.md) | Image and Source-Ingestion Pipeline | accepted | 2026-08-14 |
| [ADR-0016](ADR-0016-release-evidence-spine.md) | Release Evidence Spine | accepted | 2026-07-20 |
| [ADR-0017](ADR-0017-generation-claims-require-llm-credentials.md) | LLM Credentials Required for Generation Claims, Not Launch | accepted | 2026-08-14 |

ADR-0001–ADR-0005 are the `redesign-improve/v1` pack (accepted 2026-08-14).
ADR-0006–0007 and ADR-0015–0017 were extracted from archived sources under [`docs/archive/`](../archive/README.md).
ADR-0008 and ADR-0009 are platform/infrastructure decisions. Numbers 0010–0014 are the SEO-Bot series in that repository.

## Canonical artifact ownership

| Artifact | Owner |
|----------|-------|
| BaselineSiteProfile | Website-Bot |
| CompetitiveLandscape | SEO-Bot |
| PatternPortfolio | Website-Bot |
| WebsiteBuildBlueprint | Website-Bot |
| SEOContentBlueprint | SEO-Bot |
| PageContentContract | Website-Bot (deterministic compiler) |
| StructuredContentPackage | SEO-Bot |
| QualityDeltaReport | Website-Bot |

No artifact has joint mutable ownership.

## Architecture lock summary

- **Mode selection:** explicit (`COPY` \| `REDESIGN_IMPROVE`); a source crawl never infers `COPY`.
- **Redesign source role:** business truth = true, baseline = true, design authority = false, copy authority = false.
- **SEO authority:** SEO-Bot. **Site mutation authority:** Website-Bot.
- **Competitive rank authority:** SEO-Bot / CompetitiveLandscape (deterministic SERP).
- **Pattern authority:** Website-Bot / PatternPortfolio.
- **Design authority:** Website-Bot / WebsiteBuildBlueprint.
- **Content/SEO authority:** SEO-Bot / SEOContentBlueprint.
- **Page merge authority:** Website-Bot / PageContentContract (deterministic).
- **LLM provider selection:** forbidden in stages; router policy is authoritative.
- **Direct provider calls:** forbidden. **Redesign direct Website-Bot copy generation:** forbidden.
- **Raw competitor expression reuse:** forbidden.
- **Blueprint before generation:** required. **Quality delta before release:** required. **Bounded repair default:** 1.
- **Platform boundary:** Website-Bot and SEO-Bot are platform applications, not L9 runtime nodes (ADR-0008).
- **Secrets plane:** Infisical for runtime hydration; AWS Secrets Manager is agent bootstrap only (ADR-0009).
- **Durable wrapper:** one Inngest step around `PipelineRunner`; budget guard; compensation is manual rollback (ADR-0006).
- **Factory topology:** one client repo is site SoT; deploy materialized source, not `dist/`; dir-per-route pages (ADR-0007).
- **Images:** optional `DomainSpec.assets`; image evidence outside the mandatory release chain (ADR-0015).
- **Evidence spine:** `EvidenceStore` is authoritative; emitter does not repair missing proof (ADR-0016).
- **LLM credentials:** required for generation claims, not for launch (ADR-0017).
- **Blueprint authority:** exactly one active contract — `WebsiteBuildBlueprintV2`.
  V1 is superseded and removed. `ClientVision` and `DesignReferenceIntelligence`
  are first-party design authorities; observed palettes are non-authoritative
  under `REDESIGN_IMPROVE` (ADR-0018).

## Related design docs (not ADRs)

Design notes that are not numbered decisions stay under
[`docs/architecture/`](../architecture/) (for example
`learning-plane.v1.design.md`).

## Cross-repo

The SEO-Bot side of the redesign-improve architecture is recorded in the SEO-Bot
`adr/` series (ADR-0010–ADR-0014). Both packs share the
`l9.website-intelligence/v1` protocol envelope and
`contracts/WEBSITE_INTELLIGENCE_LOCK.json`, and both vendor the identical
`bot-interop` source, mechanically proven by
`scripts/validate-interop-parity.mjs` against
`contracts/BOT_INTEROP_PARITY.json` (WBV2-014).
