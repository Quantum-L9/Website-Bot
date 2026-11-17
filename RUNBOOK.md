<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Website-Bot Site Factory Runbook

## Validate

```bash
npm ci --no-audit --no-fund
npm run verify:all
```

## Front door: `make website` (preflight, then run)

Start real builds here. It checks every environmental precondition in a few
seconds, before any paid call, and starts the pipeline only if all of them pass:

```bash
make website SPEC=inputs/quantum_ai_partners/domain_spec.normalized.yaml            # local-proof
make website SPEC=<spec> MODE=end-to-end ARGS="--build-id=<build>"
make website SPEC=<spec> PREFLIGHT_ONLY=1                                            # check only
```

The table prints PASS / FAIL / SKIP per check. Each FAIL names its fix, and any
FAIL exits non-zero without starting the pipeline. Secret values are never
printed: only whether they are present.

| Check | What it proves | Typical fix |
|---|---|---|
| `secrets.source` | Infisical hydration worked when `INFISICAL_*` is set | fix the machine identity |
| `spec.load` / `spec.provided_images` | `validateDomainSpec` passes and every `assets.providedImages[].path` exists | fix the spec or place the files |
| `secret.DEEPSEEK_API_KEY` / `llm.deepseek_model` | DeepSeek key present; `DEEPSEEK_MODEL` is a supported (priced) model | add the key to Infisical; unset a retired model |
| `secret.GEMINI_API_KEY` | only when `assets.generation.enabled` | add `GEMINI_API_KEY` |
| `budget.llm_build_budget` | `LLM_BUILD_BUDGET_USD` ≤ per-build cap (`--build-cap-usd` / `WEBSITE_BUILD_CAP_USD`, default $10) | lower the allowance |
| `budget.spend_ledger` | when `SPEND_LEDGER_PATH` is set: ledger directory/file writable; remaining (`cap_usd − spent_usd`, or `SPEND_CAP_USD`) ≥ the cap | fix ownership; raise the cap |
| `seo_bot.preflight` | REDESIGN only: `SEO_BOT_URL` reachable and its machine-authed `/api/build-intelligence/preflight` reports `ready` with matching interop/router versions | start SEO-Bot; rotate `SEO_BOT_API_KEY`; fix SEO-Bot's DataForSEO/LLM config |
| `publish.target` / `secret.github_publish_token` | publish modes: spec has `deploy` or `provision`; the `publish_credential_ref` env var (default `GITHUB_SITE_TOKEN`) is set | add the deploy block or the token |
| `secret.VERCEL_TOKEN` / `vercel.project` | end-to-end: token plus a project id, deploy hook or provisioning | add the Vercel token / project |

SEO-Bot probes time out after `--timeout-ms` (default 5000).

## Pipeline modes

```bash
npm run pipeline:plan -- --spec=<spec>
npm run pipeline:local-proof -- --spec=<spec> --build-id=<build>
npm run pipeline:publish-proof -- --spec=<spec> --build-id=<build>
npm run pipeline:end-to-end -- --spec=<spec> --build-id=<build> --auto-register-seo-bot
```

## Evidence operations

```bash
npm run evidence:show -- --client-id=<client> --build-id=<build> --mode=<mode>
npm run evidence:validate -- --client-id=<client> --build-id=<build> --mode=<mode>
npm run evidence:repair-index -- --client-id=<client> --build-id=<build> --mode=<mode>
npm run evidence:resume -- --client-id=<client> --build-id=<build> --mode=<mode> --from=auto --spec=<spec>
```

## Spec from a live site

```bash
npx tsx scripts/generate-spec.ts <url> --with-assets --out=<spec.yaml> --site-url=<showable-url>
```

When the crawl returns pages, routes, phone, palette, and `seo_contract.site_url` come from the crawl (or `--site-url`). LLM may fill only vertical, geography, and keywords.

## Canonical root

`build/evidence/<clientId>/<buildId>/`

Do not delete or edit evidence to force a retry. Fix the cause and resume the same build transaction.
