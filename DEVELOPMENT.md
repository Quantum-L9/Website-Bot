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

## Run Locally

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Preview Built Site

```bash
npm run preview
```

## Command Surface

Prefer `make` for CI/operator workflows and npm scripts for direct Node execution.

```bash
make help
make install
make build
make verify
```

## Editing Rules

- Preserve Astro framework.
- Preserve Vercel deployment target.
- Do not invent business contact values.
- Do not embed secrets in source code.
- Do not bypass verification scripts after changes.

## Safe Change Flow

1. Edit source or config.
2. Run `npm run build`.
3. Run targeted verification script.
4. Run `npm run verify:all`.
5. Record evidence in `validation/` when producing a release bundle.
