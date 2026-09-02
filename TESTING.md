# Testing

## Test Classes

- Source validation: checks generated source structure.
- Build validation: proves Astro compiles to `dist/`.
- Smoke validation: proves routes and static files load locally or against a base URL.
- Form validation: site-template profile (`verify:form`) against `astro_template/`.
- Analytics validation: site-template profile (`verify:analytics`) against `astro_template/`.
- CRM validation: site-template profile (`verify:crm`) against `astro_template/`.
- SEO validation: site-template profile (`verify:seo`) against `astro_template/`.
- Rollback validation: site-template profile (`verify:rollback`) against `astro_template/`.

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

### Site-template validation profiles

The package scripts `verify:form`, `verify:analytics`, `verify:crm`, `verify:seo`, and `verify:rollback` run structural checks in `astro_template/` (via `npm --prefix astro_template run verify:<profile>`). They record JSONL evidence under `astro_template/validation/` and exit non-zero only on `FAIL` rows. Missing build output is reported as `BLOCKED` / `PASS_WITH_UNKNOWNS` rather than a false `PASS` from a placeholder command.

Factory offline gate remains `npm run verify:all` (also `just verify`). `make verify` additionally runs the site-template profiles and `verify:launch-env`.

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

Live deployment, form delivery receipt, CRM record creation (for the configured CRM provider), and analytics event receipt require operator credentials and runtime values.
