# Deployment

## Target

Deployment target is Vercel. Deployment must be preview-first. Production deployment requires explicit operator authorization.

## Prerequisites

1. Node.js 18+ installed.
2. npm 9+ installed.
3. Dependencies installed: `npm ci` (installs `@quantum-l9/llm-router` from GitHub Packages).

## Required Environment Variables

See `.env.example` for the canonical variable list. See `config/launch-env.required.yaml` for the fail-closed launch contract.

### LLM Intelligence (required for generation and visual QA)

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key — routes to GPT-4o, Claude, Gemini |
| `PERPLEXITY_API_KEY` | Perplexity API key — search-grounded research tasks |
| `CLIENT_ID` | Unique client identifier for budget isolation |
| `MONTHLY_BUDGET_PER_CLIENT` | Monthly token budget in USD (default: 200) |
| `WEEKLY_BUDGET_TARGET` | Weekly soft budget target in USD (default: 50) |
| `SITE_URL` | Live site URL for visual QA and SEO verification |

### Vercel Deployment (required for deploy)

| Variable | Purpose |
|----------|---------|
| `VERCEL_ORG_ID` | Vercel org id from project settings |
| `VERCEL_PROJECT_ID` | Vercel project id from project settings |
| `VERCEL_TOKEN` | Secret deployment token |

### Site Runtime (required for launch)

| Variable | Purpose |
|----------|---------|
| `PUBLIC_FORM_ENDPOINT` | Server-side endpoint for lead form submissions |
| `PUBLIC_ANALYTICS_ID` | Analytics measurement/site id |
| `CRM_PROVIDER` | CRM provider selector (e.g. acculynx, hubspot, salesforce, none) |
| `CRM_API_TOKEN` | CRM API token for the configured provider (phase 2) |

## Deployment Preconditions

Before any preview deployment:

```bash
npm ci
npm run build
npm run verify:all
```

If external checks are blocked because credentials are missing, the report must state the exact missing values.

## Preview Deployment Flow

```bash
npm ci
npm run build
npm run verify:all
npm run deploy:preview
```

After Vercel returns a preview URL:

```bash
VERIFY_BASE_URL=https://preview-url.example npm run verify:all
```

Save deployment logs and verification evidence before production promotion.

## Visual QA (Optional Pre-Production)

After preview deployment, run visual QA to validate layout across viewports:

```bash
SITE_URL=https://preview-url.example npm run verify:visual-qa
```

This captures screenshots at desktop, tablet, and mobile viewports and validates layout via LLM vision. Results are written to `validation/visual_qa_report.json`.

## Production Deployment Flow

Only after preview verification passes and the operator explicitly authorizes production:

```bash
npm run verify:launch-env
npm run deploy:production
```

After production deploy:

```bash
VERIFY_BASE_URL=https://production-domain.example npm run verify:all
```

## Fail-Closed Launch Environment Gate

Production deployment must not proceed until:

```bash
npm run verify:launch-env
```

The command writes `validation/launch_env_report.json` and exits nonzero while required vars are missing or approval gates remain unresolved. Secrets must be set in Vercel or a secure local secret store. Do not commit `.env.local`.

## Rollback

Rollback depends on Vercel deployment history. At minimum, record:

- previous deployment URL or Vercel deployment ID
- rollback method used
- operator approval if production
- post-rollback smoke-test result

## Do Not

- Do not deploy production before preview passes.
- Do not commit `.env.local`.
- Do not hardcode API keys or Vercel tokens.
- Do not call deployment successful without URL and verification evidence.
- Do not treat local build success as deployment proof.
- The router is installed prebuilt from GitHub Packages (`@quantum-l9/llm-router`); there is no separate router build step.
