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
| ADR-0006 | Unassigned in this repository | — | — |
| ADR-0007 | Unassigned in this repository | — | — |
| [ADR-0008](ADR-0008-platform-application-boundary.md) | Website factory systems are platform applications | accepted | 2026-07-22 |
| [ADR-0009](ADR-0009-infisical-secrets-plane.md) | Infisical is the Website-Bot secrets plane | accepted | 2026-08-11 |

ADR-0001–ADR-0005 are the `redesign-improve/v1` pack (accepted 2026-08-14).
ADR-0008 and ADR-0009 are platform/infrastructure decisions. They share one
numbering series; 0006 and 0007 were never issued here.

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

## Related design docs (not ADRs)

Design notes that are not numbered decisions stay under
[`docs/architecture/`](../architecture/) (for example
`learning-plane.v1.design.md`).

## Cross-repo

The SEO-Bot side of the redesign-improve architecture is recorded in the SEO-Bot
`adr/` series (ADR-0010–ADR-0014). Both packs share the
`l9.website-intelligence/v1` protocol and `contracts/WEBSITE_INTELLIGENCE_LOCK.json`.
