# Architecture

## System Role

This is a generated Astro static website with verification scripts and deployment wrappers. It is not the Website Factory itself. The factory produced this site from a canonical domain specification.

## Layers

1. Domain specification: source of truth for business, audience, service area, compliance, and conversion assumptions.
2. Website object model: generated intermediate contract.
3. Astro implementation: static site source in `src/` and assets in `public/`.
4. Verification layer: scripts in `scripts/` and evidence in `validation/`.
5. Deployment layer: Vercel wrapper scripts and environment-driven configuration.

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
