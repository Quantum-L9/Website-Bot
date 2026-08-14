# Architecture Decision Records (ADRs)

This directory contains the canonical Architecture Decision Records for the
Website-Bot **redesign-improve/v1** architecture — the decisions that define
Copy vs. Redesign behavior, the SEO-Bot boundary, LLM capability routing, the
competitive pattern/blueprint gate, and the quality-delta release gate.

These decisions remain authoritative until superseded by a numbered ADR.

## Index

| ADR | Topic | Status | Date |
|-----|-------|--------|------|
| [ADR-0001](ADR-0001-explicit-build-modes.md) | Explicit Copy and Redesign-Improve Build Modes | accepted | 2026-08-14 |
| [ADR-0002](ADR-0002-seo-bot-build-time-boundary.md) | SEO-Bot Build-Time Intelligence Boundary | accepted | 2026-08-14 |
| [ADR-0003](ADR-0003-llm-capability-routing.md) | Capability-Based LLM Routing and Provider Isolation | accepted | 2026-08-14 |
| [ADR-0004](ADR-0004-competitive-pattern-harvest-and-blueprint-gate.md) | Competitive Pattern Harvest and Blueprint Gate | accepted | 2026-08-14 |
| [ADR-0005](ADR-0005-quality-delta-and-bounded-repair.md) | Quality Delta Gate and Bounded Repair | accepted | 2026-08-14 |

## Scope note

These records form the `redesign-improve/v1` pack (accepted 2026-08-14). They are a
self-contained architecture series and are numbered independently of the
infrastructure ADRs under [`docs/architecture/`](../docs/architecture) (e.g.
ADR-0008 platform/application boundary, ADR-0009 Infisical secrets plane), which
remain in force.

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

## Cross-repo

The SEO-Bot side of this architecture is recorded in the SEO-Bot `adr/` series
(ADR-0010–ADR-0014). Both packs share the `l9.website-intelligence/v1` protocol and
`contracts/WEBSITE_INTELLIGENCE_LOCK.json`.
