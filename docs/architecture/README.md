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
| [ADR-0008](ADR-0008-platform-application-boundary.md) | Website factory systems are platform applications | accepted | — |
| [ADR-0009](ADR-0009-infisical-secrets-plane.md) | Infisical is the Website-Bot secrets plane | accepted | — |

ADR-0001–0005 are the `redesign-improve/v1` pack. ADR-0008–0009 are platform /
infrastructure decisions. Numbers 0006 and 0007 are unused (the two series were
previously split across `adr/` and this directory).

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

## Cross-repo

The SEO-Bot side of this architecture is recorded in the SEO-Bot ADR series
(ADR-0010–ADR-0014). Both packs share the `l9.website-intelligence/v1` protocol and
`contracts/WEBSITE_INTELLIGENCE_LOCK.json`.
