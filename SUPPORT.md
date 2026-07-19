# Support

## Support Scope

This support file covers repository operation, local verification, deployment preparation, and generated site runtime checks.

## Known Unknowns

Support contact, escalation channel, and SLA are Unknown until supplied by the operator.

## Before Requesting Support

Run:

```bash
npm ci
npm run build
npm run verify:all
```

Include:

- command run
- exit code
- relevant log snippet
- Node and npm versions
- whether environment values were configured
- whether failure occurred locally, preview, or production

## Common Support Categories

- dependency installation failure
- Astro build failure
- smoke-test route failure
- missing environment variable
- Vercel credential issue
- form delivery issue
- CRM integration issue (configured CRM provider)
- analytics event issue

## Support Contact Gate

Support routing remains unresolved until `SUPPORT_CONTACT_EMAIL` or `SUPPORT_CONTACT_URL` is set. Do not publish a fake support address.
