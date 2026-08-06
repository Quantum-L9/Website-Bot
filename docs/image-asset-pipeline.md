# Image & Source-Ingestion Pipeline

Website-Bot owns the full path from source assets to rendered images:

```
source website → crawl/extract → asset inventory → map to placements
→ generate only missing images → copy into Astro → render & validate
```

This document describes the **contract and the stages that exist today**, and the
sequence for the remaining work. Provider-specific code (direct Gemini, model
routing, provider budgeting) is isolated behind a local interface so it can move
behind LLM-Router later without touching the rest of the pipeline.

## Contract (`DomainSpec.assets`)

`assets` is optional. Text-only builds omit it and are unaffected by every image
stage. See `src/pipeline/BuildContext.ts` for the authoritative types.

- `sourceSite` — the website to crawl for reusable assets (off unless `enabled`).
- `providedImages` — operator-supplied images, resolved before any crawl/generation.
- `imageSlots` — desired image positions and how to fill them (`preferredSources`
  drives precedence: `provided → source-site → generated`).
- `generation` — build-level generation switch, model, budget, prompt compiler.

Source inputs (what exists) are kept deliberately separate from image slots
(what the generated site needs). `assets` is validated at spec load
(`validateDomainSpec`), including an SSRF check on `sourceSite.url`, and carried
through `scripts/normalize-spec.ts` only when it has the structured shape.

## Placement key convention

Resolved images are keyed by placement string, shared by the plan, the resolved
assets, and the generated `siteConfig.images`:

- `global:logo` — site logo (rendered in the layout header).
- `global:og-image` — default Open Graph image (rendered as `og:image` meta).
- `<routeSlug>:hero` — hero image for a route (home is `/:hero`).

## Stages

| Stage | Role | Status |
|-------|------|--------|
| `source-site-ingestion` | crawl + extract + download + provenance → `SourceSiteManifest` | **active** |
| `image-asset-planning` | deterministic slot → source resolution; stage provided/source assets; emit `ImageAssetPlan` + `ImageAssetManifest` | **active** |
| `image-generation` | fill only `generated` plan entries via the `ImageGenerator` interface; cache by fingerprint; enforce budget | planned (PR4) |
| `image-validation` | broken-reference + provenance checks | planned (PR5, may fold into visual QA) |

`SiteAssemblerStage` copies every client-owned resolved image into the Astro
project's `public/images/`, exposes them through `siteConfig.images`, and — because
the assembly manifest hashes the whole project — records them as build evidence
automatically. Image evidence is intentionally **outside** the mandatory release
chain: text-only builds must never fail for the absence of an image manifest.

## Provider isolation

`src/services/images/ImageGenerator.ts` is the local generation boundary. A
deterministic `FakeImageGenerator` backs CI (no network, no credentials); a direct
Gemini adapter and, later, a router-backed adapter implement the same interface.
Swapping providers never changes the plan, assembly, or Astro components.

## SSRF policy

`src/ingestion/UrlPolicy.ts` rejects loopback, RFC1918, link-local, CGNAT, cloud
metadata, and non-HTTP targets, and scopes the crawl to the seed host unless
`allowSubdomains` is set. The (future) crawler re-validates the resolved IP before
each request and after every redirect.

## Delivery sequence

1. **PR1 (this change)** — asset contract, provided-image resolution, resolved
   images copied into Astro and rendered (logo + hero + OG), image evidence, and
   the SSRF/inspection/planner/generation-interface foundations. Exit: a supplied
   local image appears in a successful local-proof build.
2. **PR2 (done)** — SSRF-guarded source-site crawler behind `UrlPolicy` → `SourceSiteManifest`
   (HTML/metadata/image extraction, policy-filtered downloads, provenance, optional
   Playwright screenshots behind an interface).
3. **PR3** — source-site candidate scoring in the planner (foundation already present).
4. **PR4** — Gemini adapter behind `ImageGenerator`, prompt compiler, cache, budget;
   generate only unresolved slots.
5. **PR5** — expanded Astro placements, dimensions/responsive rendering, image QA,
   provenance warnings in release evidence.
