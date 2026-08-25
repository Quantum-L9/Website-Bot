# Safe Haven Golden Calibration Prompt

Read tests/golden/safehaven/RUNBOOK.md and execute ONLY the Safe Haven Golden
CALIBRATION phases.
Do not run the real paid Safe Haven E2E yet.
Follow the runbook fail-closed.
Required final calibration gate:
101/101 oracle properties
100% coverage
0 stale citations
0 unenforced properties
0 soundness failures
0 hardcoded oracle values
positive 1/1 PASS
negative 25/25 REJECTED
0 false accepts
0 harness errors
deterministic replay PASS
synthetic receipt without calibration mode REJECTED with
SYNTHETIC_RECEIPT_FORBIDDEN
Return the exact Agent Completion Report from the runbook.
Do not weaken or modify oracle.json, case.json, thresholds, verifier semantics,
or the canonical 25-control denominator to obtain a pass.
