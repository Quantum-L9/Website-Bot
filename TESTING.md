# Testing

## Test Classes

- Source validation: checks generated source structure.
- Build validation: proves Astro compiles to `dist/`.
- Smoke validation: proves routes and static files load locally or against a base URL.
- Form validation: verifies form contract and endpoint readiness.
- Analytics validation: verifies analytics configuration and event contract.
- CRM validation: verifies AccuLynx configuration contract and payload shape.
- SEO validation: verifies robots, sitemap, llms, metadata, and canonical runtime files.
- Rollback validation: verifies rollback procedure exists and can be followed.

## Commands

```bash
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

## Evidence Standard

A test is not considered complete unless it records:

- command or inspection method
- timestamp
- exit code or pass/fail status
- target artifact or URL
- expected result
- actual result
- blocker or Unknown when external credentials are missing

## External Checks

Live deployment, form delivery receipt, AccuLynx record creation, and analytics event receipt require operator credentials and runtime values.
