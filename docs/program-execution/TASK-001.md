# TASK-001 — Adopt the exact Router patch version (1.3.0)

Campaign: `pe-website-bot-preflight-adoption` · Base: main @ 2a430aa

## What changed

- `package.json` / `package-lock.json` — `@quantum-l9/llm-router` pinned to the
  exact promoted Router patch `1.3.0` (no caret, no latest, no star), replacing
  the stale `1.1.2` pin from the full-quality-remediation line. Lockfile
  updated via `npm install --save-exact` against the GHP registry.
- Installed dependency proven with `npm ls @quantum-l9/llm-router` →
  `@quantum-l9/llm-router@1.3.0`.

## Validation (run on the finished tree)

- `npm ls @quantum-l9/llm-router` — PASS (`@quantum-l9/llm-router@1.3.0`)
- `npm run typecheck` — PASS
- `node --import tsx --test tests/unit/seo-build-intelligence-port.test.ts tests/unit/redesign-content-authority.test.ts` — PASS (15 tests)

Invariant: Website-Bot Router version (1.3.0) equals SEO-Bot Router version
(1.3.0) equals the promoted Router patch (1.3.0).
