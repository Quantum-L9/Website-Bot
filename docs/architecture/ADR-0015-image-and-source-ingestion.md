<!-- L9_META: layer=architecture, role=image_pipeline_adr, status=accepted, version=1.0.0 -->
# ADR-0015: Image and Source-Ingestion Pipeline

## Status
Accepted.

## Date
2026-08-14

## Context
Generated sites need logos, heroes, and Open Graph images. Text-only builds
must not fail because an image subsystem is absent. Provider SDKs (Gemini,
router-backed generation) must not leak into planning, assembly, or Astro
components.

## Decision
Website-Bot owns the path from source assets to rendered images:

```
source website → crawl/extract → asset inventory → map to placements
→ generate only missing images → copy into Astro → render & validate
```

1. **`DomainSpec.assets` is optional.** Text-only builds omit it and skip every
   image stage. Source inputs (`sourceSite`, `providedImages`) stay separate
   from slots (`imageSlots`). `preferredSources` order is
   `provided → source-site → generated`.
2. **Placement keys** are shared by the plan, resolved assets, and
   `siteConfig.images`: `global:logo`, `global:og-image`, `<routeSlug>:hero`
   (home is `/:hero`).
3. **Stages:** `source-site-ingestion` → `image-asset-planning` →
   `image-generation` (only `generated` plan entries) → `image-validation`.
   `SiteAssemblerStage` copies client-owned resolved images into
   `public/images/` and exposes them on `siteConfig.images`.
4. **Image evidence is outside the mandatory release chain.** Absence of an
   image manifest must not fail a text-only release.
5. **Provider isolation.** `src/services/images/ImageGenerator.ts` is the only
   generation boundary. CI uses `FakeImageGenerator`. Swapping adapters does
   not change the plan, assembly, or components.
6. **SSRF.** `src/ingestion/UrlPolicy.ts` rejects loopback, RFC1918,
   link-local, CGNAT, cloud metadata, and non-HTTP targets, and scopes the
   crawl to the seed host unless `allowSubdomains` is set. Spec load validates
   `sourceSite.url`.

## Consequences
- Image work cannot block a text-only factory run.
- Stages must not import provider SDKs; they call `ImageGenerator`.
- Crawl/download stays behind `UrlPolicy` on every request and redirect.

## Related Artifacts
- `src/stages/SourceSiteIngestionStage.ts`
- `src/stages/ImageAssetPlanningStage.ts`
- `src/stages/ImageGenerationStage.ts`
- `src/services/images/ImageGenerator.ts`
- `src/ingestion/UrlPolicy.ts`
- Archived source: `docs/archive/image-asset-pipeline.md`
