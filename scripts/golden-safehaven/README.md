# Golden Safe Haven evidence adapter

External evidence readers for the Safe Haven golden oracle. These scripts are a
**new projection layer**: they read Website-Bot runtime evidence (receipts,
sealed artifacts, stage logs, manifests, the build DB, the built site, and the
visual-oracle harness outputs) and produce the normalized `receipt.json` that
`scripts/verify-safehaven-golden.mjs` consumes. They never modify `src/pipeline`
runtime code.

| Script | Purpose |
|---|---|
| `build-receipt.mjs` | Deterministic adapter: projects all runtime evidence into the verifier-consumed receipt with per-field provenance. |
| `check-site-integrity.mjs` | §16 site-integrity producer over built `dist/` (or a served URL): HTTP 200s, one H1, title/meta/canonical/lang presence, unique titles/canonicals, broken internal links, placeholder scan, redirects. |
| `collect-seo-bot-evidence.mjs` | Companion collector: runs the SEO-Bot preflight + three build-intelligence endpoints and persists the sealed artifacts + identity snapshot + sequence log into the run evidence dir. |
| `lib/normalize.mjs` | Pure, deterministic normalization helpers (route sets, donor joins, fallback flags, preflight checks, asset dispositions, visual requirement roles, canonical JSON). |
| `fixtures/build-fixtures.mjs` | Builds a complete internally consistent green-run fixture under `build/golden-fixtures/` (plus an empty fixture) for the adapter's end-to-end proof. |

## The fail-closed contract

The adapter is a READER that may **never invent evidence**:

- Missing input evidence stays missing: fields are **absent**, never zeros or
  expected constants.
- Success is never inferred from an exit code or from payload presence —
  `preflight.status` is derived from the nine oracle checks; fallback flags
  from `build_intent` + stage evidence.
- Unknown never converts into PASS; unqualified data is excluded, not passed.
- Every synthesized claim (donor `class`, fallback flags, requirement
  booleans, asset disposition taxonomy) is recorded under
  `adapter.provenance` mapping the receipt field to its source file + sha256.
- Every gap the runtime cannot supply is recorded under
  `adapter.missing_producer` as `{ field, producer, reason }`.

## Determinism

Same inputs → byte-identical receipt: canonical JSON (recursive key sort,
2-space indent, trailing newline), stable emission order, and no
adapter-generated timestamps. Proven by running the adapter twice and `cmp`-ing
the outputs.

## Usage

```bash
# 1. site integrity (always first — the adapter reads its output)
node scripts/golden-safehaven/check-site-integrity.mjs \
  --case tests/golden/safehaven/case.json \
  --site-dir build/sites/safehaven/dist \
  --out build/evidence/safehaven/<buildId>/site-integrity.json

# 2. SEO-Bot collection (writes sealed artifacts + identity snapshot into
#    the evidence dir; without SEO_BOT_URL/SEO_BOT_API_KEY it records
#    missing_producer entries instead of fabricating anything)
node scripts/golden-safehaven/collect-seo-bot-evidence.mjs \
  --client-id safehaven --build-id <buildId> \
  --evidence-dir build/evidence/safehaven/<buildId> \
  --case tests/golden/safehaven/case.json

# 3. receipt
node scripts/golden-safehaven/build-receipt.mjs \
  --client-id safehaven --build-id <buildId> \
  --evidence-dir build/evidence/safehaven/<buildId> \
  --assets-dir build/assets/safehaven/<buildId> \
  --site-dir build/sites/safehaven/dist \
  --db .l9/data/website-bot.db \
  --case tests/golden/safehaven/case.json \
  --out build/evidence/safehaven/<buildId>/receipt.json
```

Optional flags: `--site-integrity <path>` (default
`<evidence-dir>/site-integrity.json`) and `--visual-dir <dir>` (default
`<assets-dir>/visual-qa`).

## Provenance model

`adapter.provenance` is an object keyed by receipt field path; each value is
`{ source, digest }` where `source` is the evidence file (or `"derived"` +
`"db:stage_runs"`/`"db:llm_usage"` for computed fields) and `digest` is the
sha256 of the source file (or of the deterministic derivation inputs).
`adapter.missing_producer` lists every field the runtime evidence cannot
supply, naming the producer that must record it.

### Key derivation rules

| Receipt field | Derived from |
|---|---|
| `identity.*.worktree_state` | collector `identity-snapshot.json` (CLEAN / `DIRTY:n paths`); absent → missing |
| `run.run_id` | visual harness `manifest.json` run_id |
| `run.copy_fallback_used` / `generic_fallback_used` | `build_intent` + stage_runs rows for legacy `content-generation` / `schema-generator` (skipped ≠ used) |
| `preflight.status` | all-nine-checks PASS → PASS, else FAIL |
| `competitive_landscape.selected_donors[].class` | `"operating-company"` only for qualified donors (the payload's exclusion-reason taxonomy enumerates the non-operating classes); payload-carried `class` wins |
| `website_build_blueprint.project_proof_required` / `gallery_required` | visual_requirements role membership |
| `page_content_contract.determinism` | sealed PCC payload `{digest_run_1, digest_run_2}` |
| `assets.candidate_dispositions` | image manifest mapped to oracle taxonomy (`SOURCE_CLIENT_OWNED`/`SOURCE_REFERENCE_ONLY`/`DONOR_REFERENCE_ONLY`/`UNKNOWN`/`GENERATED`) |
| `assets.*_project_proof_count` / `*_gallery_count` | manifest slot role classification (eligible = non-forbidden disposition, selected = source-site assets) |
| `business_truth.unsupported_claim_count` | structured-content `validation.unsupported_claims` only (forbidden-pattern matches live in `prohibition_violations`) |
| `visual.pairs[].trials[].blind` / `judge_input_manifest` | pass-through from the harness `normalized-results.json`; absent when the harness does not record them |

Artifact references (`competitive_landscape.artifact_ref`,
`website_build_blueprint.competitive_landscape_ref` / `artifact_ref`,
`seo_content_blueprint.competitive_landscape_ref`,
`page_content_contract.artifact_ref`,
`structured_content.page_content_contract_ref`) are emitted as plain
`artifact_id` **strings** — the conformed verifier compares refs with `===`.

## Tests

```bash
node --test scripts/golden-safehaven/lib/normalize.test.mjs
node scripts/golden-safehaven/fixtures/build-fixtures.mjs   # rebuild fixtures
# then the 3-step usage above, and:
node scripts/verify-safehaven-golden.mjs \
  tests/golden/safehaven/case.json \
  build/golden-fixtures/golden-fixture-001/receipt.json    # expect GOLDEN_E2E_PASS_IMPROVED
```

The empty fixture (`build/golden-fixtures/empty/`) exercises the fail-closed
path: the adapter must emit 30+ `missing_producer` entries and no fabricated
fields.
