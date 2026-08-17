# Regex Equivalence Proof — secureExecution redirect strip + denylist substitutions (S8786 #113)

## 1. Redirect prefix strip

### Before (flagged)

```js
trimmed = trimmed.replace(/^[<>]+\s*\S+\s*/, "");
```

Overlapping character classes: `[<>]+` and `\S+` both match `<>` characters,
allowing super-linear backtracking on adversarial inputs.

### After

```js
function stripLeadingRedirect(segment: string): string {
  return segment.replace(/^[<>]{1,64}\s*\S+\s*/, "");
}
```

The `<>` run is bounded at 64. Shell redirect prefixes are 1–2 characters
(`>`, `>>`, `2>`, `<` …); no valid redirect spelling exceeds 64.

### Equivalence domain

Equivalent on every input whose leading `<>` run is ≤ 64 characters. Inputs
with longer runs: the old pattern stripped them (as a degenerate `\S+` token);
the new pattern leaves them untouched. Divergence catalog from the fuzzer
shows only this class (5 cataloged samples, all >64-char `<>` runs).

## 2. Denylist command-substitution patterns

### Before (flagged)

```js
/\$\([^)]*rm[^)]*\)/gi   // and dd/curl + backtick variants
```

Two overlapping unbounded `[^)]*` classes around a word that is itself
inside the class.

### After

```js
/\$\((?=[^)]*rm)[^)]*\)/gi
```

Lookahead checks the dangerous word; the body then consumes the substitution
exactly once. Exact equivalence (presence check unchanged); every step linear.

## Fuzz evidence

`node scripts/fuzz_regex_equivalence.mjs`:

- pair `secure-exec-113-redirect-strip`: 150,000 inputs, **0 domain diffs**;
  5 outside-domain divergences, all in the documented >64-char `<>` class.
- pair `secure-exec-denylist-substitutions`: 200,000 inputs, **0 diffs**
  (exact equivalence, no domain bound).

## Verdict

Domain-bounded equivalence for the redirect strip (bound documented above);
exact equivalence for the denylist lookahead transform.
