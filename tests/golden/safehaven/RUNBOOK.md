# Safe Haven Golden E2E Runbook
## Status
This runbook governs the Safe Haven Golden certification harness for:
- case: `safehaven-redesign-golden-v1`
- oracle: `safehaven-redesign-oracle-v1`
- build intent: `REDESIGN_IMPROVE`
- frozen route count: 29
- visual sentinel routes: 5
- viewports: 2
- visual pairs: 10
- visual trials per pair: 3
- total visual votes: 30
- canonical negative controls: 25
- blocking oracle properties: 101
The harness is fail-closed.
A command exiting successfully is NOT sufficient evidence of a Golden pass.
Missing evidence is failure.
Inconclusive visual evidence is NOT a Golden pass.
Synthetic calibration evidence must never certify a real Golden run.
---
# 1. Canonical files
The repository must contain exactly these Golden harness files at these paths:
tests/golden/safehaven/
  case.json
  oracle.json
  visual-judge.md
scripts/
  verify-safehaven-golden.mjs
  audit-safehaven-oracle-coverage.mjs
  verify-safehaven-negative-controls.mjs
  build-safehaven-positive-receipt.mjs
Generated calibration fixture:
tests/golden/safehaven/fixtures/
  positive-receipt.json
Generated audit evidence should be written under:
evidence/
Do not substitute historical YAML oracle files, consolidation reports, old verifier
copies, or locally renamed variants for these canonical paths.
---
# 2. Authority order
When operating this harness, authority is:
1. `tests/golden/safehaven/oracle.json`
2. `tests/golden/safehaven/case.json`
3. actual runtime evidence / Golden receipt
4. `scripts/verify-safehaven-golden.mjs`
5. `tests/golden/safehaven/visual-judge.md`
6. calibration fixtures
Synthetic calibration fixtures are test inputs only.
They are never business/runtime evidence.
Do not modify oracle thresholds to make a candidate pass.
Do not modify the frozen route inventory to make a candidate pass.
If the real source/site route inventory materially drifts from the frozen case,
REPORT THE DRIFT AND STOP.
---
# 3. Hard execution rule: calibration and real Golden are separate modes
There are two distinct modes:
## A. Calibration mode
Calibration validates the verifier itself.
Calibration uses the generated synthetic positive receipt.
Calibration MUST run with:
GOLDEN_CALIBRATION_MODE=1
The synthetic receipt is intentionally marked:
calibration.synthetic = true
The verifier must reject a synthetic receipt if calibration mode is NOT explicitly
enabled.
## B. Real Golden mode
Real Golden validates an actual Website-Bot redesign run.
Real Golden MUST NOT set:
GOLDEN_CALIBRATION_MODE
A real Golden receipt must contain actual runtime evidence.
Never copy synthetic fixture values into a real receipt.
Never run a real Golden receipt with calibration mode enabled.
---
# 4. Phase 0 — repository precheck
Run from the Website-Bot repository root.
Confirm the harness exists:
test -f tests/golden/safehaven/oracle.json
test -f tests/golden/safehaven/case.json
test -f tests/golden/safehaven/visual-judge.md
test -f scripts/verify-safehaven-golden.mjs
test -f scripts/audit-safehaven-oracle-coverage.mjs
test -f scripts/verify-safehaven-negative-controls.mjs
test -f scripts/build-safehaven-positive-receipt.mjs
If any required file is missing:
STOP.
Do not run calibration.
Do not run the real Golden.
Create the evidence directory:
mkdir -p evidence
---
# 5. Phase 1 — hostile oracle coverage audit
Run:
node scripts/audit-safehaven-oracle-coverage.mjs
Expected output:
blocking_properties_total = 101
blocking_properties_enforced = 101
coverage_pct = 100
stale_citations = []
unenforced_properties = []
soundness_failure_count = 0
hardcoded_oracle_values_remaining = 0
verdict = ORACLE_IMPLEMENTATION_COMPLETE
The audit also verifies explicit hardening for known false-green classes including:
- PCC digest equality
- exact visual pair set
- visual score bounds
- raw visual orientation normalization
- donor raw domain
- legacy PCC LLM authority
- site built-route count
- Router version presence
- legacy schema-generation authority
- exact donor-evidence domain set
- StructuredContent route-result exact route set
- PCC/SCP lineage-reference presence
- runtime 101-property evaluation gate
- external calibration authorization
- rendered visual-QA proof
If ANY value differs from the required result:
STOP.
Do not proceed to calibration.
The audit writes:
evidence/oracle-coverage.json
Do not overwrite a failed audit with manually edited evidence.
---
# 6. Phase 2 — build synthetic positive control
Run:
node scripts/build-safehaven-positive-receipt.mjs
Expected generated file:
tests/golden/safehaven/fixtures/positive-receipt.json
Expected builder summary:
synthetic = true
case_id = safehaven-redesign-golden-v1
route_count = 29
donor_count = 10
visual_pairs = 10
visual_trials = 30
expected_verdict = GOLDEN_E2E_PASS_IMPROVED
Important:
This receipt is deliberately synthetic.
It contains calibration-only identities, donor domains and visual results.
It MUST NOT be used as evidence that the Safe Haven website passed the Golden test.
---
# 7. Phase 3 — positive-control verification
Run the positive fixture only in explicit calibration mode:
GOLDEN_CALIBRATION_MODE=1 \
node scripts/verify-safehaven-golden.mjs \
  tests/golden/safehaven/case.json \
  tests/golden/safehaven/fixtures/positive-receipt.json \
  tests/golden/safehaven/oracle.json \
  | tee evidence/golden-positive-control.json
Required result:
exit code = 0
verdict = GOLDEN_E2E_PASS_IMPROVED
oracle_evaluation_coverage.expected = 101
oracle_evaluation_coverage.executed = 101
hard_gate_failures = []
blocking_inconclusive_states = []
calibration.synthetic = true
calibration.synthetic_receipt = true
calibration.calibration_mode = true
Visual positive-control metrics should show a fully positive synthetic fixture.
If the command returns nonzero:
STOP.
Do not weaken the verifier.
Do not change oracle thresholds.
Investigate the fixture/verifier mismatch.
---
# 8. Phase 4 — prove synthetic receipt cannot certify a real run
Run the SAME synthetic receipt WITHOUT calibration authorization:
node scripts/verify-safehaven-golden.mjs \
  tests/golden/safehaven/case.json \
  tests/golden/safehaven/fixtures/positive-receipt.json \
  tests/golden/safehaven/oracle.json \
  > evidence/synthetic-real-mode-rejection.json
This command MUST exit nonzero.
The verifier result MUST contain:
SYNTHETIC_RECEIPT_FORBIDDEN
If the synthetic receipt receives a zero exit or Golden PASS:
STOP.
The harness is unsafe.
Do not run the real Golden.
---
# 9. Phase 5 — canonical 25 negative controls
Run:
node scripts/verify-safehaven-negative-controls.mjs \
  tests/golden/safehaven/case.json \
  tests/golden/safehaven/fixtures/positive-receipt.json \
  tests/golden/safehaven/oracle.json \
  | tee evidence/golden-negative-controls.json
The negative-control runner internally executes the verifier with:
GOLDEN_CALIBRATION_MODE=1
This is correct because all 25 mutations originate from the synthetic positive fixture.
Required result:
positive_control.pass = true
negative_controls_total = 25
negative_controls_rejected = 25
false_acceptance_count = 0
harness_error_count = 0
deterministic_replay_pass = true
verdict = GOLDEN_ORACLE_CALIBRATION_PASS
Canonical controls cover:
NC-01  donor count < 10
NC-02  duplicate donor company
NC-03  forbidden directory donor
NC-04  missing donor screenshot
NC-05  SEO competitive call before preflight
NC-06  partial SEO route set
NC-07  unknown route
NC-08  CompetitiveLandscape lineage mismatch
NC-09  PCC LLM authority violation
NC-10  SCP/PCC lineage mismatch
NC-11  forbidden section alias / prose without blocks
NC-12  repair budget exceeded
NC-13  legacy content authority invoked
NC-14  redesign schema LLM authority invoked
NC-15  required authorized source photography not selected
NC-16  donor asset reused
NC-17  Router version drift
NC-18  CONTENT_VALIDATION incorrectly requires search
NC-19  visual QA absent
NC-20  only six visual pair wins
NC-21  homepage mobile critical pair loss
NC-22  visual hierarchy regression
NC-23  unsupported/prohibited business claim
NC-24  only 28 of 29 routes reachable
NC-25  pipeline exit 0 while a hard property is false
If even ONE control is falsely accepted:
STOP.
Do not run the real Golden.
---
# 10. Calibration authorization gate
The real Golden may proceed ONLY if ALL of the following are true:
101 / 101 blocking properties enforced
100% oracle coverage
0 stale citations
0 unenforced properties
0 soundness failures
0 hardcoded oracle values
positive control:
  1 / 1 PASS
negative controls:
  25 / 25 REJECTED
false accepts:
  0
harness errors:
  0
deterministic replay:
  PASS
synthetic receipt without calibration mode:
  REJECTED with SYNTHETIC_RECEIPT_FORBIDDEN
If calibration is not exactly green:
REAL GOLDEN IS NOT AUTHORIZED.
---
# 11. Real Golden preparation
IMPORTANT:
The files in this Golden harness define verification and calibration.
They DO NOT define the repository-specific command that launches the real
Website-Bot production/E2E redesign pipeline.
The agent must use the repository's actual REDESIGN_IMPROVE execution entrypoint.
Do not invent a pipeline command.
Before running it:
1. inspect the repository's current package scripts / E2E runner
2. identify the real REDESIGN_IMPROVE execution entrypoint
3. confirm it emits or can assemble an `l9.golden-run-receipt/v1` receipt
4. confirm SEO-Bot and LLM-Router dependencies are reachable
5. confirm real required credentials are configured
6. confirm the operator has authorized the paid/networked Golden run
The real run must use the frozen Safe Haven case:
tests/golden/safehaven/case.json
Source:
https://www.safehavenrr.com
Build intent:
REDESIGN_IMPROVE
The frozen route inventory contains 29 routes.
Do not silently repair route drift.
---
# 12. Real-run identity evidence
The real receipt must contain real identities.
Required:
website_bot.sha = full 40-character git SHA
seo_bot.sha = full 40-character git SHA
llm_router.sha = full 40-character git SHA
Website-Bot Router version must exist.
SEO-Bot Router version must exist.
Router run-identity package version must exist.
All three Router versions must match.
Worktrees must either be:
CLEAN
or explicitly recorded dirty states with an identifying diff identity.
Do not use synthetic SHAs such as repeated "1", "2", or "3" values in a real receipt.
---
# 13. Real preflight ordering
The receipt must prove:
seo-build-intelligence-preflight:PASS
occurred BEFORE:
seo:createCompetitiveLandscape
The required preflight checks are read from `oracle.json`.
All must pass before the first expensive SEO build-intelligence operation.
The required redesign execution subsequence must also be observed exactly as an
ordered subsequence.
Forbidden redesign stages must not execute.
---
# 14. CompetitiveLandscape and donor evidence
The real receipt must prove:
10 selected donors
10 unique normalized donor domains
ranking_llm_calls = 0
evidence_complete = true
Every selected donor must contain real evidence for:
qualified_operating_company
real_dataforseo_observation
query_id
rank
url
domain
normalized_domain
observed_at
visibility_contribution
class
Forbidden selected classes include:
directory
social
publisher
aggregator
marketplace
unknown
Donor crawl/screenshot evidence must cover the exact same 10 selected domains.
Each donor requires at least:
1 successful page
1 screenshot
an evidence digest
a valid crawl timestamp
Candidate output may not contain donor asset bytes.
---
# 15. Route / content lineage
All relevant artifacts must contain the exact frozen 29-route set.
This includes:
SEOContentBlueprint
PageContentContract
StructuredContentPackage
StructuredContent route-results
BuiltSite
SiteIntegrity rows
No duplicate routes.
No missing routes.
No unknown routes.
CompetitiveLandscape lineage must remain exact across WBB and SCB.
PageContentContract must contain a non-empty artifact reference.
StructuredContentPackage must contain a non-empty PCC reference.
The two PCC references must match exactly.
PCC determinism evidence must contain both digests and they must be equal.
---
# 16. Source assets and business truth
Safe Haven source assets are authorized for reuse under the case policy.
Donor assets are reference-only.
If eligible source project-proof photography exists and the blueprint requires it,
at least one eligible source project-proof image must be selected.
If eligible source gallery photography exists and the blueprint requires it,
at least one eligible source gallery image must be selected.
The real receipt must show:
unsupported business claims = 0
phone mismatches = 0
email mismatches = 0
prohibition violations = 0
Do not manufacture business claims to satisfy content requirements.
---
# 17. Real visual capture
The case defines five visual sentinel routes:
/
 /services/roof-replacement/
 /services/storm-damage/
 /gallery/
 /contact/
Two viewports are required:
desktop:
  1440 x 900
mobile:
  390 x 844
Total required pairs:
5 routes x 2 viewports = 10 pairs
The exact pair set is mandatory.
No duplicate pair may substitute for another pair.
Every real pair must match the expected route and viewport.
Candidate captures must belong to the current run:
pair.candidate_run_id == receipt.run.run_id
The receipt must explicitly contain:
visual.rendered_visual_qa_executed = true
Pair objects alone do not prove rendered QA.
---
# 18. Blind visual adjudication
Use:
tests/golden/safehaven/visual-judge.md
The judge receives only:
ROUTE PURPOSE
VIEWPORT
IMAGE A
IMAGE B
The judge must not receive:
candidate/baseline labels
repository identity
previous verdicts
engineering expectations
QualityDelta status
previous judge output
For every route+viewport pair execute exactly three trials.
Trial 1:
  randomize A/B orientation
Trial 2:
  reverse Trial 1 exactly
Trial 3:
  independently randomize orientation again
The orchestration layer must persist BOTH raw judge evidence and normalized evidence.
Each real trial must contain:
orientation
raw_judge
normalized_preference
normalized_candidate_delta
blind = true
judge_input_manifest
The verifier recomputes normalization from raw A/B evidence.
Do not hand-edit normalized values.
---
# 19. Visual score rules
The raw judge scores B relative to A.
Allowed dimension scores:
-2
-1
0
+1
+2
No values outside [-2, 2] are allowed.
The dimensions are:
visual_hierarchy
brand_coherence
conversion_clarity
trust_and_credibility
authentic_imagery
content_readability
information_density
spacing_and_rhythm
mobile_usability
professional_polish
Weights and thresholds MUST be read from `oracle.json`.
Do not hardcode them into the execution agent.
Current oracle pass requirements include:
at least 7 pair-majority wins
no more than 2 pair-majority losses
at least 21 candidate votes out of 30
95% Wilson lower bound > 0.5
weighted mean visual delta >= 0.25
Critical pairs may not lose.
Critical dimensions may not regress.
Any required visual inconclusive state blocks Golden PASS.
---
# 20. Real receipt verification
Assume the real run produced:
evidence/safehaven-real-golden-receipt.json
IMPORTANT:
Do NOT set GOLDEN_CALIBRATION_MODE.
Run:
unset GOLDEN_CALIBRATION_MODE
node scripts/verify-safehaven-golden.mjs \
  tests/golden/safehaven/case.json \
  evidence/safehaven-real-golden-receipt.json \
  tests/golden/safehaven/oracle.json \
  | tee evidence/safehaven-real-golden-verdict.json
A real Golden PASS requires:
exit code = 0
verdict = GOLDEN_E2E_PASS_IMPROVED
hard_gate_failures = []
blocking_inconclusive_states = []
oracle_evaluation_coverage.expected = 101
oracle_evaluation_coverage.executed = 101
calibration.synthetic = false
calibration.synthetic_receipt = false
calibration.calibration_mode = false
Anything else is NOT a Golden pass.
---
# 21. Verdict interpretation
Only this verdict authorizes Golden success:
GOLDEN_E2E_PASS_IMPROVED
This is NOT a Golden pass:
STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN
This is a failure:
GOLDEN_E2E_FAIL
The verifier intentionally returns nonzero for structural-only/inconclusive results.
Do not convert a structural-only result into success based on command execution,
human interpretation, or pipeline exit status.
---
# 22. Failure handling
On any failure:
1. preserve the receipt
2. preserve verifier output
3. preserve coverage audit
4. preserve negative-control report
5. identify exact failure codes
6. determine whether the failure is:
   - product/runtime failure
   - evidence-production failure
   - visual inconclusive
   - actual candidate regression
   - environment/configuration failure
7. repair the product/evidence producer if appropriate
8. rerun the full relevant gate
Do NOT:
- delete a failing assertion
- weaken thresholds
- edit oracle values to match the candidate
- replace real evidence with synthetic evidence
- enable calibration mode for a real receipt
- remove routes from the frozen case
- hand-edit visual votes
- declare PASS from pipeline exit code alone
---
# 23. Evidence bundle to retain
For a completed calibration retain:
evidence/oracle-coverage.json
tests/golden/safehaven/fixtures/positive-receipt.json
evidence/golden-positive-control.json
evidence/golden-negative-controls.json
evidence/synthetic-real-mode-rejection.json
For a real run additionally retain:
real Website-Bot SHA
real SEO-Bot SHA
real LLM-Router SHA
real Router package versions
real bot-interop version evidence
real Golden receipt
real Golden verifier result
visual baseline captures
visual candidate captures
all 30 raw visual judge outputs
all orientation manifests
all normalized trial evidence
donor crawl/screenshot evidence
CompetitiveLandscape lineage
WBB / SCB / PCC / SCP lineage
site-integrity evidence
---
# 24. Agent completion report
At the end of CALIBRATION return exactly:
SAFE HAVEN GOLDEN CALIBRATION
oracle properties:        101/101
coverage:                 100%
stale citations:          0
unenforced properties:    0
soundness failures:       0
hardcoded oracle values:  0
positive control:         PASS / FAIL
negative controls:        __/25 REJECTED
false accepts:            __
harness errors:           __
deterministic replay:     PASS / FAIL
synthetic real-mode rejection:
  PASS / FAIL
  expected failure code:
  SYNTHETIC_RECEIPT_FORBIDDEN
calibration verdict:
  GOLDEN_ORACLE_CALIBRATION_PASS / FAIL
real Golden authorized:
  YES / NO
Do not report YES unless every calibration gate above is exact.
At the end of a REAL GOLDEN return exactly:
SAFE HAVEN REAL GOLDEN
website_bot_sha:
seo_bot_sha:
llm_router_sha:
router_version:
bot_interop_version:
routes built:
routes reachable:
donors selected:
donor evidence sets:
visual pairs:
visual trials:
candidate votes:
pair wins:
pair losses:
Wilson lower bound:
weighted mean delta:
hard failures:
blocking inconclusives:
oracle evaluations:
  101/101
verdict:
  GOLDEN_E2E_PASS_IMPROVED
  OR
  STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN
  OR
  GOLDEN_E2E_FAIL
Never rewrite the verifier's verdict.
