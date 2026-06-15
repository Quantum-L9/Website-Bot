# Runbook

## Purpose

This runbook gives an operator or AI agent the exact procedures for local validation, preview deployment, runtime verification, failure triage, and rollback.

## Normal Local Verification

```bash
npm ci
npm run build
npm run verify:all
```

If route checks require a running local site:

```bash
npm run preview
```

Then run smoke verification in another terminal if the script supports `VERIFY_BASE_URL`:

```bash
VERIFY_BASE_URL=http://127.0.0.1:4321 npm run verify:smoke
```

## Preview Deployment Procedure

1. Confirm `.env.local` exists locally or deployment env vars exist in Vercel.
2. Run local build and verification.
3. Deploy preview.
4. Capture preview URL.
5. Run post-preview verification against the preview URL.
6. Save logs and validation output.

```bash
npm ci
npm run build
npm run verify:all
npm run deploy:preview
VERIFY_BASE_URL=https://preview-url.example npm run verify:all
```

## Production Promotion Procedure

Production deploy requires explicit operator approval and a passing preview verification report.

```bash
npm run deploy:production
VERIFY_BASE_URL=https://production-domain.example npm run verify:all
```

## Failure Triage

### Dependency install fails

- Confirm Node.js 20+ and npm 10+.
- Remove `node_modules` and rerun `npm ci`.
- Inspect `package-lock.json` consistency.
- Do not switch package managers without approval.

### Build fails

- Read the first fatal Astro error.
- Inspect `astro.config.mjs` and source files under `src/`.
- Do not deploy.

### Smoke test fails

- Confirm preview server is running.
- Confirm required routes exist.
- Confirm `robots.txt`, `llms.txt`, and `sitemap.xml` are accessible.
- Record failed route, status, and expected status.

### Form verification blocked

- Provide `PUBLIC_FORM_ENDPOINT`.
- Submit a synthetic test lead only.
- Confirm delivery destination receipt.
- Do not use real customer data.

### AccuLynx verification blocked

- Provide AccuLynx endpoint/account/key through environment variables.
- Do not expose API keys client-side.
- Confirm test record creation before marking CRM verification closed.

### Analytics verification blocked

- Provide analytics provider/id.
- Confirm page-view and conversion event receipt in provider debug or realtime view.

## Rollback Procedure

Rollback is not active until a preview or production deployment exists. Minimum rollback evidence:

- previous deployment identified
- rollback command or Vercel dashboard procedure documented
- post-rollback smoke test passed

## Incident Notes

For every failure, record:

- command run
- timestamp
- exit code
- log excerpt
- environment values present or missing
- whether issue happened locally, preview, or production

## Launch Configuration Procedure

1. Copy `.env.example` to `.env.local`.
2. Fill operator-owned values without committing secrets.
3. Run `npm run verify:launch-env`.
4. Resolve every missing value and gate failure.
5. Run `npm run verify:all`.
6. Deploy preview only after local checks pass.
7. Promote to production only after preview verification, legal approval, domain verification, form delivery, and required runtime checks pass.
