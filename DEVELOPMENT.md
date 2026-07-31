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
