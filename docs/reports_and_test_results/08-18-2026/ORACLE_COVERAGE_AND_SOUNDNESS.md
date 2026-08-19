# Oracle Coverage and Soundness

**Date:** 2026-08-18
**Generators:** `scripts/audit-safehaven-oracle-coverage.mjs`, `scripts/audit-safehaven-oracle-soundness.mjs`
**Machine output:** `evidence/oracle-coverage.json`, `evidence/oracle-soundness.json`

Two independent questions must both be answered before §26:

1. **Coverage** — does the verifier contain an assertion for each blocking property?
2. **Soundness** — does that assertion still fire when the evidence is *absent*?

Coverage alone is insufficient. An assertion reading `(x ?? 0) > 1` contains a real failure
code and passes a coverage audit, yet silently accepts a receipt that omits `x`.

---

## Part 1 — Coverage (§21)

```
oracle blocking properties : 101
enforced by verifier       :  62
coverage                   : 61.4%
stale citations            :   0
verdict  : ORACLE_IMPLEMENTATION_INCOMPLETE
```

The audit is hostile to itself: a property counts as enforced only when the authority table
claims enforcement **and** the cited failure code genuinely exists in the verifier source. A
stale citation fails the audit rather than inflating coverage.

`blocking_properties_total = 101` is this audit's enumeration of the oracle's blocking
surface. It was independently corroborated — `l9.golden-oracle-complete/v1` enumerates the
same 101 and the identical set of 39 unenforced paths, derived separately.

### The 39 unenforced, grouped

**Visual thresholds that decide PASS**
`minimum_weighted_mean_delta` (predicted by §20) · `dimensions` (the whole weight map is never
read; the critical-dimension check uses an unweighted mean) ·
`reveal_candidate_identity_to_judge` · all three `inconclusive` rules ·
`no_inconclusive_blocking_dimension`.

With every `inconclusive` rule absent, **"inconclusive" can never block a PASS** — directly
contradicting `philosophy.inconclusive_is_pass: false`.

**Visual capture integrity** — all five: candidate/baseline blank, route mismatch, viewport
mismatch, stale capture. A blank, stale, or cross-paired capture passes unnoticed, which is
the precise false-positive class §17 exists to prevent.

**Configuration read dynamically** — `critical_pairs_may_not_lose` and
`critical_dimensions_may_not_regress` *are* implemented, but from **hardcoded literals**.
Editing `oracle.json` changes nothing. Tracked as `hardcoded_corrections` ORACLE-090/091.

**Structurally undetectable** — `duplicate_routes`. `requireExactSet()` builds a `Set`, so a
duplicated route dedupes away before comparison. Needs multiset comparison, not a threshold change.

**Execution graph / preflight** — the 15-stage `required_ordered_subsequence`,
`forbidden_stages_under_redesign`, `preflight.required`, and all nine `required_checks`. Only
the single preflight→landscape ordering pair is checked.

**Content authority** — `section_alias_fields_forbidden`, `all_section_prose_must_use_blocks`,
`redesign_schema_llm_calls`, `invalid_business_facts`, PCC determinism, `unknown_content_slots`,
`invalid_internal_link_targets`.

**Site integrity** — all per-route checks (http_200, single_h1, title, meta, canonical, lang),
`unique_titles`, `unique_canonical_urls`. None are implemented in Website-Bot either.

**Remaining** — worktree cleanliness, bot-interop compatibility, `forbidden_selected_classes`,
donor timestamps, blueprint required/visual requirements, source-corpus completion, forbidden
candidate dispositions, conditional source-asset rules, `prohibition_violations`,
`VISUAL_QA` search policy, `unsupported_capability_combination_count`.

---

## Part 2 — Soundness (absence mutation)

The closure contract states:

```yaml
failure_behavior:
  missing_required_evidence:
    action: FAIL
    rule: do_not_default_missing_numeric_values_to_zero
```

`audit-safehaven-oracle-soundness.mjs` makes that executable. For each property it runs the
real verifier twice — once with a value that must trip the gate, once with the evidence path
(and its container) deleted — and classifies the result.

```
probes            : 41
sound             : 29
VACUOUS unguarded :  8   <- false-ACCEPT paths
vacuous guarded   :  4   <- backstopped by a count gate
inert             :  0
verdict           : ORACLE_SOUNDNESS_INCOMPLETE
```

### Unguarded — absent evidence passes and nothing catches it

| Property | Code | Defeated by deleting |
|---|---|---|
| ORACLE-043 | `STRUCTURED_CONTENT_SCHEMA_INVALID` | `structured_content.route_results` |
| ORACLE-044 | `UNSUPPORTED_CONTENT_CLAIM` | `structured_content.route_results` |
| ORACLE-045 | `CONTENT_REQUIREMENT_UNSATISFIED` | `structured_content.route_results` |
| ORACLE-046 | `CONTENT_REPAIR_BUDGET_EXCEEDED` | `structured_content.route_results` |
| ORACLE-047 | `CONTENT_GENERATION_BUDGET_EXCEEDED` | `structured_content.route_results` |
| ORACLE-074 | `UNEXPECTED_SEARCH_ROUTING` | `llm_audit.operations` |
| ORACLE-075 | `SEARCH_POLICY_NOT_EXPLICIT` | `llm_audit.operations` |
| ORACLE-076 | `UNEXPECTED_SEARCH_ROUTING` | `llm_audit.operations` |

Neither field has any count or presence assertion anywhere in the verifier, so omitting them
is completely undetected.

### Guarded — not independently enforced, but the receipt is still rejected

ORACLE-020/021/022 (per-donor pages, screenshots, digest) fall behind
`DONOR_EVIDENCE_INCOMPLETE`; ORACLE-085 (trials per pair) falls behind
`VISUAL_CAPTURE_INCOMPLETE`. Both count gates fire on container absence, so there is no
false-accept path — but the specific property is not independently proven.

### Why this matters most for NC-18

NC-18 maps to ORACLE-076. A receipt omitting `llm_audit.operations` passes it. When §22 runs
the 25 negative controls, NC-18 reports as rejected only if the mutation happens to populate
that key — otherwise it is a **false acceptance**, i.e. `ORACLE_FALSE_ACCEPTANCE`, which
§22 makes a hard stop on running the real E2E.

The same reasoning applies to the calibration suite generally: negative controls graded by a
verifier with known blind spots do not establish what they appear to establish.

---

## Honest arithmetic

| Measure | Value |
|---|---|
| Declared coverage | 62/101 = 61.4% |
| Vacuous among those 62 | 12 |
| **Soundly enforced** | **50/101 = 49.5%** |
| False-accept paths | 8 |

The coverage audit alone reported 61.4% and could not have found this — it verifies that a
failure code exists in the source, never that it fires when evidence is missing. Anchor
presence is not enforcement, which is the same error §21 warns about for JSON specs,
displaced one level.

---

## Required before §26

Per §21 every blocking property needs an implementation; per the closure contract every
implementation must fail closed on absent evidence. Per §20, `oracle.json` is authority and
must not be weakened to match missing verifier code — the gaps are to be implemented, not
deleted.

Acceptance target (`acceptance.oracle_implementation_complete_requires`): 101/101 enforced,
0 stale citations, 0 remaining unenforced — and, by the `failure_behavior` rule, 0 vacuous.
