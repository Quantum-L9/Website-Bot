# Testing

## Test Classes

- Source validation: checks generated source structure.
- Build validation: proves Astro compiles to `dist/`.
- Smoke validation: proves routes and static files load locally or against a base URL.
- Form validation: planned site-level profile (`verify:form`) — currently `INCOMPLETE` / non-evidence (see below).
- Analytics validation: planned site-level profile (`verify:analytics`) — currently `INCOMPLETE` / non-evidence (see below).
- CRM validation: planned site-level profile (`verify:crm`) — currently `INCOMPLETE` / non-evidence (see below).
- SEO validation: planned site-level profile (`verify:seo`) — currently `INCOMPLETE` / non-evidence (see below).
- Rollback validation: planned site-level profile (`verify:rollback`) — currently `INCOMPLETE` / non-evidence (see below).

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

### Unimplemented validation profiles

The package scripts `verify:form`, `verify:analytics`, `verify:crm`, `verify:seo`, and `verify:rollback` are accepted by the Website-Bot validation executor allowlist, but they do **not** perform site-level validation yet.

For each of those five profiles the CLI reports status `INCOMPLETE` with `non_evidence: true` (reason `site_level_validation_unimplemented`) and exits with code **2**. A successful `echo` or other placeholder command is not validation evidence and must not produce `PASS`.

Because `make verify` includes these profiles, `make verify` may remain intentionally non-green until real site-level checks exist. That redness is honesty, not a regression of the offline gate. Use `npm run verify:all` for the offline factory gate; treat the five profiles as incomplete non-evidence until implemented.

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
