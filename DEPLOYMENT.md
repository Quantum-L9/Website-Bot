# Deployment

## Target

Deployment target is Vercel. Deployment must be preview-first. Production deployment requires explicit operator authorization.

## Deployment Preconditions

Before any preview deployment:

```bash
npm ci
npm run build
npm run verify:all
```

If external checks are blocked because credentials are missing, the report must state the exact missing values.

## Required Environment Variables

See `.env.example` for the canonical variable list.

Required Vercel values:

- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_TOKEN`

Required public runtime values before launch:

- `PUBLIC_SITE_URL`
- `PUBLIC_FORM_ENDPOINT`
- `PUBLIC_ANALYTICS_PROVIDER`
- `PUBLIC_ANALYTICS_ID`

AccuLynx phase 2 values:

- `ACCU_LYNX_API_ENDPOINT`
- `ACCU_LYNX_API_KEY`
- `ACCU_LYNX_ACCOUNT_ID`

Business launch values:

- `PUBLIC_BUSINESS_PHONE`
- `PUBLIC_BUSINESS_EMAIL`
- `PUBLIC_BUSINESS_ADDRESS`
- `PUBLIC_LICENSE_NUMBER`
- `PUBLIC_DISCLAIMER_TEXT`

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

## Production Deployment Flow

Only after preview verification passes and the operator explicitly authorizes production:

```bash
npm run deploy:production
```

After production deploy:

```bash
VERIFY_BASE_URL=https://production-domain.example npm run verify:all
```

## Rollback

Rollback depends on Vercel deployment history. At minimum, record:

- previous deployment URL or Vercel deployment ID
- rollback method used
- operator approval if production
- post-rollback smoke-test result

## Do Not

- Do not deploy production before preview passes.
- Do not commit `.env.local`.
- Do not hardcode Vercel tokens.
- Do not call deployment successful without URL and verification evidence.
- Do not treat local build success as deployment proof.

## Fail-Closed Launch Environment Gate

Production deployment must not proceed until:

```bash
npm run verify:launch-env
```

The command writes `validation/launch_env_report.json` and exits nonzero while required vars are missing or approval gates remain unresolved. Secrets must be set in Vercel or a secure local secret store. Do not commit `.env.local`.
