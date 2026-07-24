# L9 Website Factory Bot

## Project Identity

This repository contains the L9 Website Factory Bot — a deterministic website generation pipeline powered by `@quantum-l9/llm-router`. It generates Astro-based lead-generation websites from domain specifications, with AI-powered content generation, design intelligence, competitor research, and visual QA. The factory is client-agnostic and prepared for Vercel preview-first deployment. A worked reference client lives under `examples/supplemental-insurance-pros/` (see `examples/README.md`).

## Verified Repo Facts

| Area | Value | Evidence |
|---|---|---|
| Runtime | Node.js 20+ | `REQUIREMENTS.md`, npm/Astro project |
| Package manager | npm | `package.json`, `package-lock.json` |
| Framework | Astro | `astro.config.mjs`, `package.json` |
| Build output | `dist/` | Astro static build convention and local validation bundle |
| Deployment target | Vercel | deployment scripts and docs |
| CRM direction | Configurable CRM provider (`CRM_PROVIDER`), phase 2 | env contract and verification scripts |
| LLM Router | @quantum-l9/llm-router (GitHub Packages dependency) | `src/services/llm.ts` |
| LLM Providers | OpenRouter + Perplexity | `contracts/llm_router_integration.yaml` |

Unsupported values remain `Unknown` until the operator supplies them. Do not invent contact, license, disclaimer, analytics, CRM, or deployment values.

## Domain Spec — input contract (flat, canonical)

The pipeline consumes a **flat** `DomainSpec`, validated at stage 1 by
`src/pipeline/validateDomainSpec.ts`. This is the canonical build input — see
`fixtures/ci-test-spec.yaml` for a complete example and `src/pipeline/BuildContext.ts`
for the type. Required shape:

- `client_id: string`
- `business_name: string`
- `vertical: string`
- `geography: { states: string[]; primary_state: string }`
- `routes: Array<{ slug: string; title: string; components: string[] }>`
- `design: { status: 'resolved' | 'pending'; palette?: Record<string,string>; fonts?: Record<string,string> }`
- `seo_contract` — validated when present, and **required** when any route renders a
  `contact_form` component:
  - `site_url: string` — must normalize to an absolute `https://` URL (bare domains are
    normalized; `http://` and non-URL values are rejected at spec load)
  - `phone?: string` — dialable number with 7–15 digits (E.164 or national formats accepted);
    flows into `siteConfig.phone` and the `LocalBusiness.telephone` schema
  - `lead_form_action: string` — absolute `https://` form endpoint; **required whenever any
    route uses `contact_form`** so a missing endpoint fails at spec load (stage 1), never at
    site build. Test/demo endpoint IDs are additionally rejected by the placeholder scan gate.
  - `target_keywords?: string[]` — non-empty strings when present
- optional: `wom_flags`

Run with an explicit spec: `npm run pipeline -- --spec=<path>`, pointing at the client's
normalized spec (for the reference client, `examples/supplemental-insurance-pros/domain_spec.normalized.yaml`).
The rich, deeply-nested authoring format is **not** consumed directly — the loader detects it and
fails with an actionable message.

### Authoring flow (source → normalize → consume)
1. **Author** the rich spec (the client's `domain_spec.source.yaml`, e.g.
   `examples/supplemental-insurance-pros/domain_spec.source.yaml`) with business/market/compliance detail.
2. **Normalize**: `npm run normalize-spec` → generates the flat, pipeline-ready
   `domain_spec.normalized.yaml` (`scripts/normalize-spec.ts`). Never hand-edit the flat file.
3. **Consume**: the pipeline builds from the flat spec.

CI guards drift: `npm run normalize-spec:check` (run in `build-and-validate.yml`) fails if the
committed flat spec doesn't equal `normalize(<source spec>)` or isn't a valid `DomainSpec`.

### Generated-output quality gate (placeholder scan)

Every build runs a mandatory `placeholder-scan` stage between generation
(`content-generation`, `schema-generator`) and assembly (`site-assembler`). It scans all
LLM-generated copy and JSON-LD schemas against a typed pattern catalog
(`src/validation/placeholderPatterns.ts`): bracketed fill-ins like `[phone number]`,
unrendered template variables, lorem ipsum, TODO/TBD markers, RFC 2606 example domains,
test form endpoints, and empty structured-data values. Error-severity findings fail the
build with `PLACEHOLDER_CONTENT_DETECTED` and a full finding list (source, pattern,
excerpt); warning-severity findings (reserved 555-01xx numbers, "coming soon" stubs) are
logged without blocking.

## Quick Start

```bash
npm ci                    # Install dependencies (incl. @quantum-l9/llm-router from GitHub Packages)
npm run build             # Build the Astro site into dist/
npm run preview           # Serve built site locally
```

Canonical operator commands are available through `make`:

```bash
make help                 # Show all available commands
make install              # Install dependencies
make build                # Build site
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

Never commit `.env.local`. Required live-launch values include Vercel credentials, form endpoint, analytics provider/id, CRM credentials (for the configured `CRM_PROVIDER`), business contact values, professional license (if the client's vertical requires one), and approved disclaimer text.

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
6. The configured CRM provider receives a synthetic lead or CRM is formally deferred.
7. Analytics receives page-view and conversion events or analytics is formally deferred.
8. Rollback procedure is verified.
9. No unresolved blocker remains.

## File Map

- `src/`: Astro source files.
- `public/`: static public assets and runtime SEO files.
- `scripts/`: verification and deployment automation.
- `validation/`: generated launch-env reports (per-run artifacts, gitignored). Historical
  per-client validation reports live with their client under
  `examples/<client>/validation/`.
- `docs/`: secondary operational documentation when present.
- `Makefile`: canonical CI/operator command surface.
- `justfile`: developer ergonomic wrappers.
- `.env.example`: environment variable contract without secrets.

## AI Agent Use

Read `AGENTS.md` before modifying the repository. Agents must preserve Astro/Vercel locks, avoid fake claims, avoid invented values, and validate before reporting readiness.

## Per-Client Launch Values

Each client supplies these before launch (they remain `Unknown` in the factory until provided). See `examples/supplemental-insurance-pros/` for a worked example.

- business phone
- business email
- business address
- professional license number/state/type (if the client's vertical requires displaying one)
- approved disclaimer text
- support/security contact
- license choice
- form endpoint
- Vercel org/project/token
- analytics provider/id
- CRM provider selection and credentials (endpoint/keys/account)

## Launch Configuration Closure

The remaining launch Unknowns are controlled through `.env.example`, `config/launch-env.required.yaml`, and `scripts/verify-launch-env.mjs`. No real-world values are invented in this repository.

Before public launch, provide required support, security, domain, form, Vercel, legal approval, licensing, analytics, and CRM values through `.env.local` or Vercel Project Settings.

Run:

```bash
npm run verify:launch-env
```

This fails closed until required launch values and approval gates are satisfied. `DRAFT_LEGAL_DISCLAIMER.md` is draft only until `LEGAL_DISCLAIMER_APPROVED=true` and `LEGAL_DISCLAIMER_VERSION` are set.
