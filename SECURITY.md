# Security

## Vulnerability reporting

| Field | Value |
|-------|-------|
| Security contact | `ib@quantumaipartners.com` |
| Disclosure URL | https://github.com/Quantum-L9/Website-Bot/security |

Canonical non-secret defaults also live in `config/launch-env.values.yaml`
(`SECURITY_CONTACT_EMAIL`, `SECURITY_DISCLOSURE_URL`).

## Secret handling

Never commit secrets. Do not place private API keys, tokens, CRM credentials,
email credentials, or Vercel tokens in source files.

Use:

- Infisical (ADR-0009) for runtime hydration
- `.env.local` for local bootstrap / emergency overrides (gitignored)
- `.env.example` for **names only**
- `config/launch-env.values.yaml` for committed **non-secret** operator defaults

## Client-side exposure warning

Variables prefixed with `PUBLIC_` can be exposed to browser code. Do not store
secrets in `PUBLIC_*` variables.

## Dependency security

Run dependency checks through npm-supported tooling or organization-approved
scanners.

## Deployment security

- Preview-first deployment.
- Production deployment requires explicit operator approval.
- No hardcoded deployment tokens.
- No deployment success claims without logs and URL evidence.

## Deferred integrations

CRM API tokens/secrets, form webhook secrets, and analytics credentials are
**not** required for factory MVP. They are enforced only when the corresponding
provider is claimed (`CRM_PROVIDER` ≠ `none`, form provider ≠ `none`, or
`--client-launch`).
