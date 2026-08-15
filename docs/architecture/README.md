<!-- L9_META: layer=architecture, role=adr_index, status=accepted, version=1.0.0 -->
# Architecture Decision Records

Canonical ADRs for Website-Bot. These decisions remain authoritative until
superseded by a numbered ADR.

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
| [ADR-0008](ADR-0008-platform-application-boundary.md) | Website factory systems are platform applications | accepted | — |
| [ADR-0009](ADR-0009-infisical-secrets-plane.md) | Infisical is the Website-Bot secrets plane | accepted | — |
| [ADR-0015](ADR-0015-image-and-source-ingestion.md) | Image and Source-Ingestion Pipeline | accepted | 2026-08-14 |
| [ADR-0016](ADR-0016-release-evidence-spine.md) | Release Evidence Spine | accepted | 2026-07-20 |
| [ADR-0017](ADR-0017-generation-claims-require-llm-credentials.md) | LLM Credentials Required for Generation Claims, Not Launch | accepted | 2026-08-14 |

ADR-0001–0005 are the `redesign-improve/v1` pack. ADR-0006–0007 and ADR-0015–0017
were extracted from archived sources under [`docs/archive/`](../archive/README.md).
ADR-0008–0009 are platform / infrastructure decisions. Numbers 0010–0014 are the
SEO-Bot series in that repository.

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
- **Runtime class:** Website-Bot and SEO-Bot are platform applications, not L9 runtime nodes (ADR-0008).
- **Secrets plane:** Infisical (ADR-0009).
- **Durable wrapper:** one Inngest step around `PipelineRunner`; budget guard; compensation is manual rollback (ADR-0006).
- **Factory topology:** one client repo is site SoT; deploy materialized source, not `dist/`; dir-per-route pages (ADR-0007).
- **Images:** optional `DomainSpec.assets`; image evidence outside the mandatory release chain (ADR-0015).
- **Evidence spine:** `EvidenceStore` is authoritative; emitter does not repair missing proof (ADR-0016).
- **LLM credentials:** required for generation claims, not for launch (ADR-0017).

## Cross-repo

The SEO-Bot side of this architecture is recorded in the SEO-Bot ADR series
(ADR-0010–ADR-0014). Both packs share the `l9.website-intelligence/v1` protocol and
`contracts/WEBSITE_INTELLIGENCE_LOCK.json`.
