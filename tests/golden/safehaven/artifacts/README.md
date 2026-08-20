<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Safe Haven Golden calibration artifacts

A committed **record** of one execution of the Safe Haven Golden no-spend
validation gate. These files are outputs, never inputs: nothing in the
pipeline, the verifier, or the test suite reads this directory.

Every artifact here was produced by a sealed script from the sealed
`case.json` / `oracle.json`. No paid Golden run, no live provider call, and no
deployed candidate is represented. `positive-receipt.json` is explicitly
synthetic (`calibration.synthetic: true`) and the verifier refuses it outside
`GOLDEN_CALIBRATION_MODE=1`.

## Contents

| File | Produced by | What it proves |
| --- | --- | --- |
| `positive-receipt.json` | `scripts/build-safehaven-positive-receipt.mjs` | The synthetic positive control: a receipt that must be accepted. |
| `oracle-coverage.json` | `scripts/audit-safehaven-oracle-coverage.mjs` | 101/101 blocking oracle properties enforced, 100% coverage, 0 stale citations, 0 unenforced properties, 0 soundness failures, 0 hardcoded oracle values. |
| `calibration-verdict.json` | `scripts/verify-safehaven-golden.mjs` under `GOLDEN_CALIBRATION_MODE=1` | `GOLDEN_E2E_PASS_IMPROVED` on the positive control: 0 hard-gate failures, 0 blocking inconclusive states, 101/101 evaluations executed. |
| `negative-controls-report.json` | `scripts/verify-safehaven-negative-controls.mjs` | 25/25 canonical negative controls REJECTED, 0 false acceptances, 0 harness errors, deterministic replay PASS. |
| `bridge-unit-test-run.tap` | `node --import tsx --test tests/unit/safehaven-real-golden-bridge.test.ts` | The Safe Haven bridge contract suite: 64/64 passing. |

The bridge suite and the runtime-evidence code it exercises are not on this
branch; that TAP output comes from the Safe Haven real-Golden bridge change and
is included here so the whole gate reads as one record.

## Regenerating

Run from the repository root. The first four write to generated paths, not to
this directory, so a regeneration never dirties the tree:

```sh
node scripts/build-safehaven-positive-receipt.mjs
node scripts/audit-safehaven-oracle-coverage.mjs
GOLDEN_CALIBRATION_MODE=1 node scripts/verify-safehaven-golden.mjs \
  tests/golden/safehaven/case.json \
  tests/golden/safehaven/fixtures/positive-receipt.json \
  tests/golden/safehaven/oracle.json
node scripts/verify-safehaven-negative-controls.mjs \
  tests/golden/safehaven/case.json \
  tests/golden/safehaven/fixtures/positive-receipt.json \
  tests/golden/safehaven/oracle.json
node --import tsx --test tests/unit/safehaven-real-golden-bridge.test.ts
```

Outputs are byte-identical on replay except for two fields that are wall-clock
by construction: `evaluated_at` in `calibration-verdict.json`, and the
`duration_ms` values in the TAP output. Nothing else should drift; a diff
anywhere else is a real finding, not noise.

## What is deliberately absent

- No real Golden receipt, runtime evidence, or rendered visual evidence. Those
  require the paid end-to-end run, which is blocked on two unresolved external
  dependencies (SEO-Bot's per-run LLM audit export, and Safe Haven's canonical
  publish/deployment target).
- No credentials, tokens, provider keys, or absolute local paths.
