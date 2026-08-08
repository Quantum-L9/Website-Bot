# Development

## Prerequisites

- Node.js 20+
- npm 10+
- Access to this repository root

## Setup

```bash
npm ci
cp .env.example .env.local
```

Fill `.env.local` only with local-safe values. Do not commit `.env.local`.

## Run the Factory

The factory has no root Astro dev server — it generates and builds client sites through
the pipeline. Iterate with the dry-run planner (no keys, no mutations):

```bash
npm run pipeline:plan
```

## Build a Site

`pipeline:local-proof` materializes the Astro project and runs `astro build` into
`build/sites/<client>/dist` (requires provider keys for content generation):

```bash
npm run pipeline:local-proof -- --spec=<domain-spec>
```

## Image Evidence, QA, and Resume

Each declared image slot resolves to one delivered asset in a fixed precedence
(`ImageAssetPlanningStage` → `ImageGenerationStage`): approved provided image →
approved source-site image → edit of an authentic reference → generate from
references → text-only (an unresolved required slot fails the build; an optional one
is dropped). Only a `client-owned` disposition authorizes republishing a crawled
image.

### Persisted evidence (snake_case on disk, camelCase in memory)

Three canonical evidence kinds are threaded through the evidence store; the codec
converts each manifest to snake_case JSON on write and back on read, and the
`schemas/*.schema.json` contracts (JSON Schema 2020-12, `additionalProperties:false`)
are validated by `npm run evidence:schemas`:

- `source_site` (`schemas/source-site-manifest.schema.json`) — the crawl manifest:
  pages, downloaded image candidates (path, dimensions, digest), rejects. Written by
  `SourceSiteIngestionStage`.
- `image_plan` (`schemas/image-asset-plan.schema.json`) — the per-slot resolution
  decision. Written by `ImageAssetPlanningStage`.
- `image_assets` (`schemas/image-asset-manifest.schema.json`) — the delivered-asset
  manifest (source, output path, MIME, dimensions, bytes, SHA-256, disposition,
  prompt hash + provider-neutral summary; never keys, bytes, or full prompts).
  Written by planning and overwritten by generation with the complete set, so it
  exists whenever slots are authored — even a provided- or source-site-only build.

### Deterministic image QA (`image-validation`, post-assembly)

Fails closed on a missing required placement, a delivered file missing/renamed on a
non-`/images/` path, evidence/site source drift, digest/dimension corruption, or
**unauthorized republication** of a crawled asset (a delivered `source-site` asset
whose disposition is not `approved-client-owned`). Missing alt text is advisory.

### Resume (no network, no paid calls)

Image stages re-run idempotently, so the assembler always has resolved images:

- Source-site ingestion reloads the persisted `source_site` evidence and re-verifies
  every downloaded image byte-for-byte (and each screenshot's presence); an intact
  set means **no crawl**. A missing or tampered file fails closed to a fresh crawl.
- Planning recomputes deterministically; generation serves each asset from its
  content-addressed cache (`build/assets/<client>/generated/<fingerprint>.*`) — **no
  provider call** when the fingerprint is unchanged.

Terminal convergence additionally requires `image_assets` evidence for any site with
image slots and `source_site` evidence when source-site ingestion is enabled. These
are additive to the existing mode-specific release gates.

## Command Surface

Prefer `make` for CI/operator workflows and npm scripts for direct Node execution.

```bash
make help
make install
make pipeline-plan
make verify-all
```

## Editing Rules

- Preserve Astro framework.
- Preserve Vercel deployment target.
- Do not invent business contact values.
- Do not embed secrets in source code.
- Do not bypass verification scripts after changes.

## Safe Change Flow

1. Edit source or config.
2. Run `npm run pipeline:plan` (or `pipeline:local-proof` for a full build).
3. Run targeted verification script.
4. Run `npm run verify:all`.
5. Record evidence in `validation/` when producing a release bundle.
