# Validation

## Policy

Validation must be evidence-backed. A script existing is not proof. A clean-looking report is not proof. Every pass, failure, blocked check, and Unknown must map to a file, command, log, URL, receipt, or deterministic inspection.

## Required Local Gate

```bash
npm ci
npm run build
npm run verify:all
```

## Validation Classes

| Class | Command | Purpose |
|---|---|---|
| Preflight | `npm run verify:preflight` | env/config readiness |
| Source | `npm run verify:source` | source structure and required files |
| Build | `npm run verify:build` | build output existence and fatal errors |
| Smoke | `npm run verify:smoke` | routes/static files/internal links |
| Form | `npm run verify:form` | lead form contract and endpoint readiness |
| Analytics | `npm run verify:analytics` | provider/id and event contract readiness |
| CRM | `npm run verify:crm` | AccuLynx contract, auth/env, payload shape |
| SEO | `npm run verify:seo` | robots, sitemap, llms, metadata, canonical requirements |
| Rollback | `npm run verify:rollback` | rollback procedure readiness |
| Full | `npm run verify:all` | aggregate gate |

## Evidence Files

Machine-readable validation artifacts may live in `validation/` or `reports/`:

- `validation_report.yaml`
- `*_checks.jsonl`
- command output logs
- `env_and_runtime_test_summary.yaml`
- deployment logs and URL reports when deployed

## Status Rules

- `PASS`: check executed and met expected result.
- `PASS_WITH_FINDINGS`: core check passed, but warnings or external blockers remain.
- `BLOCKED`: check cannot execute without credentials, URL, or operator values.
- `FAIL`: check executed and violated expected result.
- `UNKNOWN`: insufficient evidence exists.

## Launch Readiness Gate

The site is not launch-ready until all are true:

- build passes
- smoke tests pass
- preview deployment exists
- post-deploy verification passes
- form destination receives a synthetic lead
- AccuLynx receives a synthetic lead or CRM is formally deferred
- analytics receives page-view and conversion events or analytics is formally deferred
- rollback procedure is validated
- no unresolved blocker remains

## Forbidden Validation Patterns

- pass-only reports
- claiming deployment without URL evidence
- claiming form delivery without receipt
- claiming CRM success without record ID or equivalent receipt
- claiming analytics success without provider evidence
- hiding Unknowns
- ignoring blocked external checks

## Launch Environment Validation

Mandatory command:

```bash
npm run verify:launch-env
```

Evidence: `validation/launch_env_report.json`.

This check validates required variable presence and launch gates. External proof still requires preview deployment, form delivery receipt, AccuLynx record evidence, analytics event receipt, and domain response verification.
