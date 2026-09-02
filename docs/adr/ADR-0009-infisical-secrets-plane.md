<!-- L9_META: layer=architecture, role=secrets_adr, status=accepted, version=1.0.0 -->
# ADR-0009: Infisical is the Website-Bot secrets plane

## Status
Accepted.

## Context
Website-Bot previously relied on per-secret GitHub Actions `env:` blocks and local
`.env` files. That duplicated secrets across surfaces, blocked agent clones without
human paste, and left PostHog / deploy credentials outside a shared vault.

## Decision
1. **Infisical** (org `infiscal-l9`, project Website-Bot) is the secrets plane for
   runtime hydration of bot/CI process environment.
2. Bootstrap uses a **machine identity** via Universal Auth:
   `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`
   (optional `INFISICAL_ENV=prod`).
3. Entrypoints hydrate via the shared helper `scripts/lib/hydrate-secrets.mjs`
   (`hydrateSecretsIfConfigured` → `@quantum-l9/infisical-config` `loadSecrets`)
   before reading config. Current consumers:
   - `scripts/run-pipeline.ts`
   - `scripts/verify-launch-env.mjs`
   - `scripts/verify-deploy-secrets.mjs`
   Secret **names in Infisical must match app env var names**.
4. Loaders are **fail-soft** unless `INFISICAL_REQUIRED=true`. Local `.env` remains
   an emergency override and never overwrites already-set **nonempty** vars.
   Blank `KEY=` placeholders and empty vault rows are unset, not values — so
   Infisical can backfill required secrets (`L9_MEMORY_TOKEN` / `GRAPHITI_MCP_TOKEN`)
   instead of treating `KEY=` as a present empty credential. Memory itself is
   required; blank does not mean optional.
5. **No committed secret values.** `.env` / `.env.local` stay gitignored.
6. **AWS Secrets Manager** (`openclaw-igorbot/infisical-website-bot`,
   `openclaw-igorbot/posthog`, etc.) is the **agent bootstrap / registry mirror**
   owned by Cursor-Governance — not a second app secrets plane.
7. CI supplies Infisical bootstrap secrets (`INFISICAL_*`); Node `loadSecrets()`
   hydrates the vault. Remaining non-migrated deploy secrets may still arrive via
   GitHub Actions until upserted into Infisical. Wrapping jobs with the Infisical
   CLI (`infisical run`) is deferred — do not install via curl|bash in CI.

## Consequences
- Agents resolve Infisical bootstrap via `l9-aws-secrets` then export `INFISICAL_*`
  before running the pipeline — they must not ask humans for PostHog values when
  Infisical/AWS resolution works.
- Launch/deploy verifiers use the same hydration contract as the pipeline; Infisical
  access alone is not a launch/deploy PASS (existing FAIL_CLOSED checks still apply).
  Reports may include only `source_mode` and `bootstrap_present` provenance fields.
- Full collapse of every GitHub Actions secret into Infisical is incremental;
  PostHog keys are the first migrated set.
- SEO-Bot should consume the same package contract; do not fork a second loader.
