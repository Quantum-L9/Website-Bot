# Regex Equivalence Proof — secureExecution env-assignment strip (S8786 #110)

## Before (flagged)

```js
trimmed = trimmed.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "");
```

Nested quantifier: a `+`-quantified group containing `\S+` / `\s+`. SonarCloud
S8786 flags the structure regardless of practical ambiguity.

## After

```js
function stripLeadingEnvAssignments(segment: string): string {
  let rest = segment;
  for (;;) {
    const next = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/, "");
    if (next === rest) break;
    rest = next;
  }
  return rest;
}
```

The repeated group is unrolled into an equivalent loop: each iteration strips
exactly one `NAME=value ` assignment; the loop repeats until no progress. A
greedy `(X)+` match equals iterated single-step `X` stripping to fixpoint.

## Equivalence argument

- Old semantics: maximal prefix of `(NAME=value<spaces>)` repetitions.
- New semantics: repeatedly strip one `NAME=value<spaces>` prefix; the loop
  terminates when no prefix matches, i.e. exactly the maximal prefix.
- Each iteration is a single linear regex pass (no nested quantifiers).

## Fuzz evidence

`node scripts/fuzz_regex_equivalence.mjs` — pair `secure-exec-110-env-assignments`:

- corpus: 150,000 inputs (realistic prefixes, near-misses, adversarial runs)
- domain diffs: **0**
- outside-domain divergences: 0 (no domain bound — exact equivalence)

## Verdict

Exact, domain-unbounded equivalence. Linear worst case on every input.
