# Security

## Secret Handling

Never commit secrets. Do not place private API keys, tokens, CRM credentials, email credentials, or Vercel tokens in source files.

Use:

- `.env.local` for local private values
- Vercel environment variables for deployed environments
- `.env.example` for names only

## Client-Side Exposure Warning

Variables prefixed with `PUBLIC_` can be exposed to browser code. Do not store secrets in `PUBLIC_*` variables.

## Dependency Security

Run dependency checks through npm-supported tooling or organization-approved scanners. Current repository evidence does not prove a specific enterprise scanner, so scanner choice is Unknown.

## Vulnerability Reporting

Security contact is Unknown. Until supplied, report security issues to the repository owner/operator through the active project channel.

## Deployment Security

- Preview-first deployment.
- Production deployment requires explicit operator approval.
- No hardcoded deployment tokens.
- No deployment success claims without logs and URL evidence.

## Secret Handling Contract

Secrets must be supplied through environment variables or deployment secret storage only. Never commit `VERCEL_TOKEN`, `FORM_WEBHOOK_SECRET`, `CRM_CLIENT_SECRET`, `CRM_API_TOKEN`, or other CRM/API secrets. Security reporting remains Unknown until `SECURITY_CONTACT_EMAIL` or `SECURITY_DISCLOSURE_URL` is provided.
