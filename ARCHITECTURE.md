# Architecture

## System Role

This is a generated Astro static website with verification scripts and deployment wrappers. It is not the Website Factory itself. The factory produced this site from a canonical domain specification.

## Layers

1. Domain specification: source of truth for business, audience, service area, compliance, and conversion assumptions.
2. Website object model: generated intermediate contract.
3. Astro implementation: static site source in `src/` and assets in `public/`.
4. LLM intelligence layer: `@quantum-l9/llm-router` in `packages/llm-router`, consumed via `src/services/llm.ts`.
5. Verification layer: scripts in `scripts/` and evidence in `validation/`.
6. Deployment layer: Vercel wrapper scripts and environment-driven configuration.

## LLM Router Integration

The `@quantum-l9/llm-router` module provides intelligent model selection for all AI-powered operations:
- Content generation (page copy, blog posts, meta descriptions)
- Design intelligence (color selection, layout reasoning)
- Competitor research (market positioning, content gaps)
- Visual QA (screenshot-based layout validation)
- Site mining (existing site analysis for migration)
- Domain spec generation (synthesis from operator inputs)
- Fact verification (claims, credentials, compliance)

The router selects the optimal model (GPT-4o-mini, Claude Sonnet, Gemini Flash, Perplexity Sonar) based on task type and complexity. Budget enforcement prevents overspend. See `contracts/llm_router_integration.yaml` for the full mapping.

## Runtime Boundaries

The static site must not contain private CRM credentials, Vercel tokens, analytics secrets, or email delivery credentials. Any sensitive integration must be handled through environment variables and server-side or provider-managed endpoints.

## Integration Boundaries

- Forms: use `PUBLIC_FORM_ENDPOINT` only for an intentionally public-safe form endpoint.
- AccuLynx: phase 2 verification; API keys must not be exposed to browser code.
- Analytics: configured by public provider/id values only.
- Vercel: deployment through environment variables and CLI wrapper.

## Non-Goals

- No custom backend is included unless added later.
- No production deployment is claimed without Vercel URL evidence.
- No legal/compliance claim is finalized until approved text and license details are supplied.
