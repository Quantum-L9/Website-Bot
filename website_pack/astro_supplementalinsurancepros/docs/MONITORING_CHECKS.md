# Monitoring Checks

Monitoring is configured as an operator checklist plus executable smoke checks. No external monitoring provider is marked active until credentials and destination are provided.

## Required checks

- GET `/` returns 200
- GET `/contact/` returns 200
- GET `/robots.txt` returns 200
- GET `/llms.txt` returns 200
- GET generated sitemap returns 200 after build/deploy
- Contact form renders required fields
- Form endpoint returns expected status once configured
- Conversion hook fires on form submit in browser QA
- AccuLynx sync remains phase-2 until credentials and endpoint are configured

## Command

```bash
RUNTIME_BASE_URL=https://supplementalinsurancepros.com npm run verify:smoke
```
