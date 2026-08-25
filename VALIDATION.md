<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Website-Bot Validation

## Executed in the consolidated build environment

- Strict TypeScript: passed.
- Evidence schema structure: 9 required schemas passed; provisioning schema retained.
- Handoff v3 contract lock: passed.
- Evidence-focused tests: 16 passed, 0 failed.
- Full local deterministic site-factory tests: 50 passed, 0 failed.
- Provisioning tests: 14 passed, 0 failed.
- Process-boundary release-bundle rehydration: passed.
- Tampered evidence, stale receipt references, commit mismatch, and checkpoint invalidation tests: passed.

## Safe Haven Golden calibration gate

Executed with no spend: no paid Golden run, no live provider call, no deployed
candidate. Run with `GOLDEN_CALIBRATION_MODE=1` against the synthetic positive
control only. The full output is committed under
`tests/golden/safehaven/artifacts/`; the same run also writes to `evidence/`
per the runbook.

- Hostile oracle-coverage audit: 101/101 blocking properties enforced, 100%
  coverage, 0 stale citations, 0 unenforced properties, 0 soundness failures,
  0 behavioural detection-probe failures, 0 hardcoded oracle values.
  Verdict `ORACLE_IMPLEMENTATION_COMPLETE`.
- Synthetic positive control: `GOLDEN_E2E_PASS_IMPROVED`, 0 hard-gate failures,
  0 blocking inconclusive states, 101/101 oracle evaluations executed,
  30 visual votes, 10 pairs improved / 0 regressed, Wilson lower bound 0.8865,
  weighted mean delta 1.0. The receipt rebuilds byte-identically.
- Synthetic receipt without calibration authorization: rejected with
  `SYNTHETIC_RECEIPT_FORBIDDEN`, nonzero exit. Detection is a union of five
  independent signals, three of which cannot be removed by editing a field.
- Canonical negative controls: 25/25 rejected, 0 false acceptances,
  0 harness errors, deterministic replay passed.
  Verdict `GOLDEN_ORACLE_CALIBRATION_PASS`.
- Safe Haven bridge contract suite: 64 passed, 0 failed.
- Sealed Golden authorities (`oracle.json`, `case.json`, `visual-judge.md`):
  unmodified. Inventories unchanged at 101 blocking properties and 25 negative
  controls; no threshold changed.

Calibration validates the verifier. It is not evidence about any redesign.

## Not executed

- The paid real Safe Haven Golden run. Its entry point, operator permission,
  runtime credentials, and current SEO-Bot / LLM-Router reachability are not
  established here, so no real Golden result is represented as passed.
- Live GitHub provisioning/publication.
- Live Vercel provisioning/deployment.
- Live SEO-Bot DB registration and maintenance edit.
- Production rollout.

Those gates require operator credentials and disposable provider targets and are not represented as passed.
