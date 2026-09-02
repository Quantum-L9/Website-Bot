# Support

## Support contact

| Field | Value |
|-------|-------|
| Email | `ib@quantumaipartners.com` |
| Operator | Igor Beylin / Quantum AI Partners |
| Tracker | https://github.com/Quantum-L9/Website-Bot |

Canonical non-secret defaults also live in `config/launch-env.values.yaml`
(`SUPPORT_CONTACT_EMAIL`, `SUPPORT_CONTACT_URL`).

## Support scope

This file covers repository operation, local verification, deployment preparation,
and generated-site runtime checks for the Website-Bot factory.

## Before requesting support

Run:

```bash
npm ci
npm run pipeline:plan
npm run verify:all
```

Include:

- command run
- exit code
- relevant log snippet
- Node and npm versions
- whether Infisical / `.env.local` bootstrap was present
- whether failure occurred locally, preview, or production

## Common support categories

- dependency installation failure
- Astro build failure
- smoke-test route failure
- missing environment variable
- Vercel credential issue
- form delivery issue (deferred until a client form provider is configured)
- CRM integration issue (deferred — `CRM_PROVIDER=none` for MVP)
- analytics event issue (deferred until claimed)

## MVP note

CRM, live form delivery, analytics providers, and client domain verification are
**not** factory MVP blockers. They become launch gates only for a client
production claim (`npm run verify:launch-env -- --client-launch`).
