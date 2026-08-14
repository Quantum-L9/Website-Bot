<!-- L9_META: layer=architecture, role=llm_routing_adr, status=accepted, version=1.0.0 -->
# ADR-0003: Capability-Based LLM Routing and Provider Isolation

## Status
Accepted.

## Date
2026-08-14

## Context
Provider identity is not a valid substitute for task semantics. Search retrieval,
strategic reasoning, visual reasoning, extraction, and content generation require
materially different model capabilities.

## Decision
Website-Bot stages must declare intelligence requirements by **capability** rather
than model or provider.

Permitted Website-Bot intelligence classes are:

- `STRUCTURED_EXTRACTION`
- `VISUAL_PATTERN_ANALYSIS`
- `PATTERN_SYNTHESIS`
- `STRATEGIC_REASONING`
- `DESIGN_REASONING`
- `LAYOUT_VALIDATION`
- `VISUAL_DELTA_ANALYSIS`

Provider/model resolution belongs to `@quantum-l9/llm-router` policy.

Application stages, prompts, and pipeline definitions must not contain
provider-specific routing.

Direct provider HTTP calls from Website-Bot are forbidden.

`REDESIGN_IMPROVE` specifically forbids direct page-content generation through
Website-Bot's generic `generateContent` path.

Stable structured-data construction is deterministic. Website-Bot may consume
approved FAQ/content data but must not invoke an LLM merely to serialize schema.org
structures.

Search-backed reasoning is not owned by Website-Bot unless a later ADR creates an
explicit search capability boundary.

### Provider Policy
- Perplexity is not eligible merely because a task involves competitors.
- Competitor rank truth comes from SEO-Bot's CompetitiveLandscape.
- Pattern synthesis, design reasoning, blueprint generation, and quality judgment
  require reasoning/vision capability and must be router-selected independently of
  search providers.

## Enforcement
CI must reject:

- direct imports of provider SDKs in stages;
- hard-coded provider hostnames outside approved adapters;
- provider/model names in stage routing;
- `ctx.llm.generateContent` in redesign-mode page generation.

## Validation / Evidence
- Unit tests assert task descriptors (`src/intelligence/improve-llm-policy.ts`;
  `assertWebsiteImprovePolicy()` fails closed on search or `CONTENT_GENERATION`).
- Static checks assert that all Website-Bot intelligence leaves through the
  canonical intelligence port.

## Related Artifacts
- `@quantum-l9/llm-router` (`requiresSearchProvider` policy)
- `src/intelligence/improve-llm-policy.ts`
- SEO-Bot ADR-0011 (Search, Reasoning, and Provider Isolation)
