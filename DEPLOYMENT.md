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

Names match the fail-closed launch contract in `config/launch-env.required.yaml`
(validated by `scripts/verify-launch-env.mjs`). Values marked **secret** are
server-side only and must never be exposed to browser code.

| Variable | Purpose |
|----------|---------|
| `FORM_PROVIDER` | Lead-form provider (e.g. webhook, formspree, custom, crm_proxy) |
| `FORM_ENDPOINT_URL` | Server-side/trusted endpoint that receives lead submissions |
| `FORM_WEBHOOK_SECRET` | **secret** — form webhook validation |
| `LEAD_NOTIFICATION_EMAIL` | Lead notification recipient (if email routing is used) |
| `ANALYTICS_PROVIDER` | Approved analytics provider |
| `ANALYTICS_MEASUREMENT_ID` | Provider measurement/site id |
| `CRM_PROVIDER` | CRM provider selector (e.g. `acculynx`, `hubspot`, `salesforce`, `none`) |
| `CRM_API_TOKEN` | **secret** — CRM API token for the configured provider (phase 2) |
| `CRM_CLIENT_SECRET` | **secret** — CRM client secret for the configured provider (phase 2) |

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

## Triggered-Deploy Credential Preflight

`verify:launch-env` covers the launch/legal contract. The build+deploy pipeline additionally
reads execution credentials at runtime; a triggered deploy must have these present or it will
fail. The deploy workflows (`build-site.yml`, `deploy-to-vercel.yml`) run this preflight before
the pipeline so a missing credential fails fast with a readable message:

```bash
npm run verify:deploy-secrets       # production mode: FAIL_CLOSED on missing required creds
npm run verify:deploy-secrets --ci  # CI mode: warnings only, exit 0
```

It writes `validation/deploy_secrets_report.json`.

### Required in GitHub for a triggered deploy

Set these under the repo (or org, scoped to this repo) → **Settings → Secrets and variables → Actions**.

**Secrets** (tab: *Secrets*)

| Secret | Consumed by | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | `src/services/llm.ts` | content/design/schema generation (required) |
| `VERCEL_TOKEN` | `src/stages/VercelDeployStage.ts` | Vercel deploy + correlation (required) |
| `GITHUB_SITE_TOKEN` | `src/stages/ClientSourcePublishStage.ts` (`env://GITHUB_SITE_TOKEN`) | push generated source to the client repo (required) |
| `CLIENT_VERCEL_DEPLOY_HOOK` | `SiteAssemblerStage` | deploy-hook trigger (or use API mode via project id) |
| `PERPLEXITY_API_KEY` | llm-router | competitor research (optional) |
| `POSTHOG_KEY` / `PUBLIC_POSTHOG_KEY` | `PostHogSnippetStage` | analytics snippet (optional; `PUBLIC_POSTHOG_KEY` preferred) |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | SEO baseline | keyword data (optional) |
| `SEO_BOT_URL` / `SEO_BOT_API_KEY` | SEO handoff | `--auto-register-seo-bot` (optional) |

**Variables** (tab: *Variables* — identifiers, not secrets)

| Variable | Purpose |
|---|---|
| `VERCEL_TEAM_ID` | team-scoped Vercel deploys (required) |
| `CLIENT_VERCEL_PROJECT_ID` | per-client project identity (or embed `deploy.vercel_project_id` in the DomainSpec) |

`GITHUB_REPO_ID` is supplied automatically by the workflow (`github.event.repository.id`).

> Org secrets are only visible to a triggered run when the org secret's **Repository access**
> policy includes this repository. Confirm under Org → Settings → Secrets and variables → Actions.

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
