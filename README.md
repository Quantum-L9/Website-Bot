# Supplemental Insurance Pros Website

## Project Identity

This repository contains the L9 Website Factory Bot — a deterministic website generation pipeline powered by `@l9/llm-router`. It generates Astro-based lead-generation websites from domain specifications, with AI-powered content generation, design intelligence, competitor research, and visual QA. Currently configured for Supplemental Insurance Pros, prepared for Vercel preview-first deployment.

## Verified Repo Facts

| Area | Value | Evidence |
|---|---|---|
| Runtime | Node.js 20+ | `REQUIREMENTS.md`, npm/Astro project |
| Package manager | npm | `package.json`, `package-lock.json` |
| Framework | Astro | `astro.config.mjs`, `package.json` |
| Build output | `dist/` | Astro static build convention and local validation bundle |
| Deployment target | Vercel | deployment scripts and docs |
| CRM direction | AccuLynx phase 2 | env contract and verification scripts |
| LLM Router | @l9/llm-router (workspace) | `packages/llm-router/`, `src/services/llm.ts` |
| LLM Providers | OpenRouter + Perplexity | `contracts/llm_router_integration.yaml` |

Unsupported values remain `Unknown` until the operator supplies them. Do not invent contact, license, disclaimer, analytics, CRM, or deployment values.

## Quick Start

```bash
npm ci                    # Install all workspace dependencies (root + packages/llm-router)
npm run build:router      # Build the @l9/llm-router TypeScript package
npm run build             # Build the Astro site into dist/
npm run preview           # Serve built site locally
```

Canonical operator commands are available through `make`:

```bash
make help                 # Show all available commands
make install              # Install workspace dependencies
make build-router         # Build @l9/llm-router
make build                # Build site (auto-builds router first)
make verify               # Run full verification suite
make verify-visual-qa     # Run LLM vision-based layout QA
make generate-domain-spec # Generate domain spec via LLM
make generate-content     # Generate page content via LLM
```

Developer shortcuts are available through `just` when installed:

```bash
just build
just verify
```

## Environment Setup

Copy the template and fill operator-specific values locally:

```bash
cp .env.example .env.local
```

Never commit `.env.local`. Required live-launch values include Vercel credentials, form endpoint, analytics provider/id, AccuLynx credentials, business contact values, license number, and approved disclaimer text.

## Validation

Run the full local verification suite:

```bash
npm run verify:all
```

Individual checks:

```bash
npm run verify:preflight
npm run verify:source
npm run verify:build
npm run verify:smoke
npm run verify:form
npm run verify:analytics
npm run verify:crm
npm run verify:seo
npm run verify:rollback
```

Validation must produce evidence. A script existing is not proof. A successful launch claim requires logs, URLs, receipts, or blocked checks labeled with exact missing values.

## Deployment

Deployment is Vercel preview-first:

```bash
npm run deploy:preview
```

Production deployment requires explicit operator authorization:

```bash
npm run deploy:production
```

See `DEPLOYMENT.md` for gates and `RUNBOOK.md` for operational procedures.

## Launch Gate

Do not call the site launch-ready until all are true:

1. `npm ci` passes.
2. `npm run build` passes.
3. `npm run verify:all` passes or labels external checks as blocked with evidence.
4. Vercel preview URL is created and verified.
5. Form endpoint receives a synthetic lead.
6. AccuLynx receives a synthetic lead or CRM is formally deferred.
7. Analytics receives page-view and conversion events or analytics is formally deferred.
8. Rollback procedure is verified.
9. No unresolved blocker remains.

## File Map

- `src/`: Astro source files.
- `public/`: static public assets and runtime SEO files.
- `scripts/`: verification and deployment automation.
- `validation/`: validation reports and machine evidence.
- `docs/`: secondary operational documentation when present.
- `Makefile`: canonical CI/operator command surface.
- `justfile`: developer ergonomic wrappers.
- `.env.example`: environment variable contract without secrets.

## AI Agent Use

Read `AGENTS.md` before modifying the repository. Agents must preserve Astro/Vercel locks, avoid fake claims, avoid invented values, and validate before reporting readiness.

## Remaining Unknowns

- business phone
- business email
- business address
- public adjuster license number
- approved disclaimer text
- support/security contact
- license choice
- form endpoint
- Vercel org/project/token
- analytics provider/id
- AccuLynx endpoint/key/account

## Launch Configuration Closure

The remaining launch Unknowns are controlled through `.env.example`, `config/launch-env.required.yaml`, and `scripts/verify-launch-env.mjs`. No real-world values are invented in this repository.

Before public launch, provide required support, security, domain, form, Vercel, legal approval, licensing, analytics, and AccuLynx values through `.env.local` or Vercel Project Settings.

Run:

```bash
npm run verify:launch-env
```

This fails closed until required launch values and approval gates are satisfied. `DRAFT_LEGAL_DISCLAIMER.md` is draft only until `LEGAL_DISCLAIMER_APPROVED=true` and `LEGAL_DISCLAIMER_VERSION` are set.
