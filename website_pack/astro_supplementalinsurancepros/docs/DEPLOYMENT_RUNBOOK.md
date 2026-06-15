# Deployment Runbook

## Purpose
This runbook closes deployment and runtime-verification gaps for the Astro/Vercel Supplemental Insurance Pros site without inventing missing operator values.

## Required operator values before production
Set these in Vercel project environment variables and local `.env.local` as applicable:

- `PUBLIC_SITE_URL`
- `PUBLIC_CONTACT_PHONE`
- `PUBLIC_CONTACT_EMAIL`
- `PUBLIC_CONTACT_ADDRESS`
- `PUBLIC_PA_LICENSE_NUMBER`
- `PUBLIC_PUBLIC_ADJUSTER_DISCLAIMER`
- `PUBLIC_FORM_ENDPOINT`
- `VERCEL_PROJECT_ID`
- `VERCEL_ORG_ID`
- `VERCEL_TOKEN`

Optional until activated:

- `PUBLIC_ANALYTICS_PROVIDER`
- `PUBLIC_ANALYTICS_ID`
- `PUBLIC_CRM_ENDPOINT`
- `PUBLIC_CRM_API_KEY`

## Local verification sequence

```bash
npm install
npm run verify:preflight
npm run verify:source
npm run verify:build
npm run verify:smoke
npm run verify:form
npm run verify:analytics
npm run verify:crm
npm run verify:seo
npm run verify:rollback
npm run verify:all
```

## Preview deployment

```bash
npm run verify:all
npm run deploy:preview
```

The deployment script refuses to call Vercel unless required Vercel environment variables exist.

## Production deployment

```bash
npm run verify:all
npm run deploy:production
```

Production deployment is blocked unless verification completes and Vercel credentials are configured.

## Runtime smoke test against deployed URL

```bash
RUNTIME_BASE_URL=https://supplementalinsurancepros.com npm run verify:smoke
```

## Form verification

`npm run verify:form` verifies the form structure, required fields, attribution fields, consent field, and whether delivery is configured or explicitly Unknown. It does not fake an external delivery success. A real end-to-end form delivery test requires `PUBLIC_FORM_ENDPOINT` and provider behavior.

## CRM verification

AccuLynx is intentionally phase-2. `npm run verify:crm` confirms provider and phase state, then labels endpoint/credential Unknown until supplied. It does not claim record creation without credentials.

## Analytics verification

`npm run verify:analytics` verifies attribution persistence and conversion hooks. It labels provider runtime delivery Unknown until provider and ID are configured.

## Rollback procedure

Vercel retains previous deployments. If a release fails after publish:

1. Identify the last known good previous deployment in Vercel.
2. Execute `vercel rollback` from the Vercel dashboard or CLI according to the current Vercel account permissions.
3. Run rollback validation:

```bash
RUNTIME_BASE_URL=<rolled_back_url> npm run verify:smoke
RUNTIME_BASE_URL=<production_url> npm run verify:smoke
```

4. Confirm form delivery state remains configured or explicitly Unknown.
5. Record the rollback reason, deployment URL, timestamp, and checks in the incident log.

## Monitoring activation

Monitoring is not claimed active until a provider is configured. Minimum supported monitoring checks:

- homepage 200
- contact page 200
- form endpoint health, where provider supports it
- sitemap and robots fetch
- conversion event presence after form submission

