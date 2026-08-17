# Regex Equivalence Proof — provisioning branch validator (S8786 #17)

## Before (flagged)

```ts
const BRANCH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,255}$/;
```

Negative lookaheads with dot-star scans (`(?!.*\.\.)`, `(?!.*\/\/)`).

## After

```ts
const BRANCH_CHARS = /^[A-Za-z0-9._/-]{1,255}$/;

function isValidSourceBranch(value: string): boolean {
  return (
    BRANCH_CHARS.test(value) &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("//")
  );
}
```

The three negative conditions are the same, expressed as linear string
predicates after the (single-quantifier) character-class test.

## Equivalence argument (exact)

Old: anchored match where (a) first char is not `/`, (b) no `..` substring,
(c) no `//` substring, (d) 1–255 chars from `[A-Za-z0-9._/-]`.

New: (d) then (a), (b), (c) as plain checks. Same four conjuncts, no domain
bound — the rewrite is exactly equivalent on every input.

## Fuzz evidence

`node scripts/fuzz_regex_equivalence.mjs` — pair `request-17-branch`:

- corpus: 200,000 inputs (including `/`-heavy, `..`, `//`, boundary lengths)
- domain diffs: **0** (no domain bound — exact equivalence)

## Verdict

Exact equivalence, linear on all inputs.
