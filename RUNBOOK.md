# Website-Bot v2.0 — Runbook

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10
- `tsconfig.json` at repo root (included in this pack) — requires `module: NodeNext` and `moduleResolution: NodeNext`
- a normalized DomainSpec for the target client (the bundled reference client is `examples/supplemental-insurance-pros/domain_spec.normalized.yaml`; real clients pass their own via `--spec` / `CLIENT_ID`)

## Required Secrets (GitHub)

| Secret | Purpose |
|--------|---------|
| OPENROUTER_API_KEY | LLM calls (content, design, schema) |
| PERPLEXITY_API_KEY | Optional — alternative LLM routing |
| VERCEL_TOKEN | Programmatic deploy |
| POSTHOG_KEY | Analytics injection |
| DATAFORSEO_LOGIN | SEO rank baseline |
| DATAFORSEO_PASSWORD | SEO rank baseline |
| SEO_BOT_URL | Handoff auto-registration |
| SEO_BOT_API_KEY | Handoff auth |

## Required Vars (GitHub)

| Var | Purpose |
|-----|---------|
| CLIENT_ID | Unique client identifier |
| VERCEL_PROJECT_ID | Vercel project ID |
| VERCEL_TEAM_ID | Vercel team ID (optional) |

## Local Development

```bash
npm ci
npm run typecheck          # tsc --noEmit — requires tsconfig.json
npm run pipeline:dry       # Full dry-run — no external calls
npm run pipeline           # Full pipeline
```

## Stage Skip Syntax

```bash
npx tsx scripts/run-pipeline.ts --skip=vercel-deploy,visual-qa
```

## Pipeline Stages

| # | Stage | Skippable | Blocks on failure |
|---|-------|-----------|-------------------|
| 1 | domain-spec-loader | No | Yes |
| 2 | unknown-resolver | No | Yes (error-severity flags) |
| 3 | design-intelligence | Yes | Yes |
| 4 | content-generation | Yes | Yes |
| 5 | schema-generator | Yes | Yes |
| 6 | posthog-snippet | Yes | No (warn only) |
| 7 | vercel-deploy | Yes | Yes |
| 8 | seo-baseline | Yes | No (warn only) |
| 9 | visual-qa | Yes | Only on CRITICAL |
| 10 | handoff-emitter | No | Yes |

## LLM Cost Control

Set env vars to override models:
- `LLM_CONTENT_MODEL` (default: perplexity/llama-3.1-sonar-large-128k-online)
- `LLM_DESIGN_MODEL`  (default: openai/gpt-4o)
- `LLM_SCHEMA_MODEL`  (default: openai/gpt-4o-mini)

All usage is written to `llm_usage` table in `website-bot.db` for cost auditing.
