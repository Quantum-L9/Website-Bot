# Regex Equivalence Proof — E2EEngine assertion classification patterns (S8786 #186)

## Before (flagged)

```js
const assertionPatterns = [
  /expected.*but.*received/i,
  /assertion.*failed/i,
  /test.*failed/i,
  /expected:.*actual:/i,
  /✕.*expect/i,
  /error:.*expect/i,
];
```

Overlapping unbounded `.*` spans (e.g. `expected.*but.*received` can backtrack
quadratically on long non-matching outputs).

## After

```js
const assertionPatterns = [
  /expected.{0,2000}but.{0,2000}received/i,
  /assertion.{0,2000}failed/i,
  /test.{0,2000}failed/i,
  /expected:.{0,2000}actual:/i,
  /✕.{0,2000}expect/i,
  /error:.{0,2000}expect/i,
];
```

Every span between keywords is bounded at 2,000 characters, making matching
linear in input length.

## Equivalence domain

Equivalent on all outputs whose keyword spans are ≤ 2,000 characters.
Assertion diagnostics pair their keywords within a few hundred characters
(typically a single line), and command evidence is truncated to 10,000
characters upstream (`EvidenceCollector.truncateOutput`). A 2,000-character
window therefore covers every realistic test output. On outputs with longer
spans the classification falls through to the next failure branch
(`error:`/`crash` → `ApplicationRuntimeFailure`) — still a FAIL verdict, so
the gate decision is unchanged.

## Fuzz evidence

`node scripts/fuzz_regex_equivalence.mjs` — pair `e2e-engine-186-assertion-patterns`:

- corpus: 100,000 inputs (keyword permutations, noise, negative samples)
- domain diffs: **0**

## Verdict

Domain-bounded equivalence with a 2,000-character span window; verdict-level
behavior preserved for out-of-domain inputs (documented above).
