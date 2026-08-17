# Regex Equivalence Proof — validate-generated-site (S8786 #57)

## Verification (no rewrite required)

Full regex inventory of `src/validation/validate-generated-site.ts` at the
remediation commit:

| Line | Pattern | Analysis |
|---|---|---|
| 36 | `/\{\{\s*[A-Za-z_][A-Za-z0-9_.-]*\s*\}\}/` | disjoint classes (`\s` vs word class) — linear |
| 37 | `/__PLACEHOLDER__/` | literal — linear |
| 38 | `/<%[=-]?/` | bounded — linear |
| 39 | `/REPLACE_ME/` | literal — linear |
| 44 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` | single bounded quantifier — linear |
| 70 | `/^[A-Za-z0-9][A-Za-z0-9._~-]*$/` | single quantifier, anchored — linear |
| 82–83 | `/[^a-z0-9]+/g`, `/^_+|_+$/g` | single quantifiers — linear |
| 93 | `/^[A-Za-z][A-Za-z0-9+.-]*:/` | single quantifier — linear |
| 107 | `/\/$/` | literal — linear |
| 173 | `/\.(?:astro|css|html|js|json|mjs|ts|txt)$/i` | fixed alternation — linear |

The register anchor (:57) predates the current `normalizeRouteSlug`
implementation; the file no longer contains any polynomial regex.

## Verdict

Verified linear; no change. Closure confirmed by SonarCloud re-analysis at
CP5 — if the stale anchor still reports, this file must be re-inspected
before merge.
