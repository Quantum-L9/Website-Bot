# QUANTUM_AI_PARTNERS_REBUILD_COMPARISON

**Contract:** `QAP-REBUILD-LOCAL-PROOF-01` · **Mode:** `local-proof --redesign` (no publish, no deploy)
**Website-Bot base:** `origin/main` @ `52f764b05b7c2e08e5bb3836ddfd43d9fb0b732e` (verified unmoved vs the compiled prompt)
**Branch:** `agent/claude-code/qap-rebuild-local-proof` · **Final buildId:** `quantumaipartners_com-1794595664326` (attempt 7 of 7)
**SEO-Bot runtime:** worktree @ `origin/main` `1ed274806ffea8c64ca1d8c984ed2592a68555c0`, served `127.0.0.1:3100`, isolated compose project `seo-bot-qap-runtime`, LLM provider llm-router (OpenRouter + Perplexity).

---

## Verdict: INCONCLUSIVE

The build did not reach terminal convergence. The failure is classified, evidence-backed, and upstream: the DataForSEO account rejects concurrent live-SERP tasks, and SEO-Bot's competitive-landscape call submits ten queries that collide with that limit. The factory itself (spec intake, normalizer, preflight, DeepSeek LLM, redesign stages) executed correctly up to the SEO-Bot seam. No after-build exists, so every comparison dimension that measures the built site is `UNKNOWN` / not run. **No claim of BETTER or NOT_BETTER is made.**

One sentence per dimension:

| Dimension | One-sentence outcome |
|---|---|
| Routes built / E2E pass | Not measurable — no site was assembled; before-build numbers (6 / 12 of 12) stand as the only record. |
| Blueprint execution | Not measurable — the blueprint stage was never reached (blocked one stage earlier). |
| Required images visible | Not measurable — no rendered site produced. |
| Client logo in header | Not measurable — logo intake and spec wiring are proven (byte-identical `0da4b5b1…`), but no header was rendered. |
| Images provided / generated / spend | Not measurable — image planning is downstream of the blocked landscape stage; spend so far is zero Gemini calls. |
| Composition / visual review | Not measurable — no `build/qap-compare/` pairs exist; capture driver is prepared (`build/qap-capture.mjs`). |
| Per-route metadata quality | Not measurable — no built HTML to inspect. |
| LLM provider / calls / tokens / spend | Observed: direct DeepSeek initialized (`deepseek-flash`, budget 10 USD, 200 req cap); design-reference-acquisition completed (~2 min) before the block; token totals not re-fetchable (SEO-Bot run-audit debt, brief). |
| SEO-Bot calls (ordering) | Observed preflight 200 (machine-auth PASS); competitive-landscape failed twice with `DATAFORSEO_TASK_ERROR` `40101` — ordering stops there. |
| Zero-LLM counters | Not measurable — the contract/SCP stages were never reached. |
| Release receipt | Not produced — no convergence; prior build's receipt was `partial` (publication, deployment). |

---

## Failure analysis

**What failed:** `competitive-intelligence` stage — `POST /api/build-intelligence/competitive-landscape` returned 502 `DATAFORSEO_TASK_ERROR: Internal SE Server Error. (status 40101)`, identically on attempts 6 and 7 (`build/qap-run-attempt-dfseo-40101.log`, `build/qap-after-run.log`), after ~3–4 min of SERP task polling each.

**Why:** A direct probe with the same canonical credentials shows the DataForSEO account itself is healthy for single tasks:
- single-task probe → HTTP 200, `status_code 20000 Ok.` (keyword "AI consulting", location 2840);
- ten-task batch probe → first task `20000`, remaining nine `40000 "You can set only one task at a time."`

SEO-Bot submits the ten landscape queries without serialization, the account's plan allows one concurrent task, and the resulting task errors surface as `40101` inside SEO-Bot's landscape call. This also explains the earlier `401`-family failures: the first `401` was the stale seam key (`seo-bot-seam-key-drift`), the second `401`-class failure was the stale DataForSEO credential pair (`seo-bot-stale-datforseo-creds`) — both fixed by injecting canonical vault values in-process; the remaining `40101` is the concurrency limit.

**Tried before:** YES — one classified retry after the first `40101` (upstream-transient hypothesis). Identical result. Not a blind retry: the retry followed credential repair and a 4-minute upstream settle window.

**Correct approach:** Operator restores/upgrades the DataForSEO plan tier, or SEO-Bot serializes its SERP tasks (and/or retries `40101` with replacement donors). Both are separately scoped follow-up work; this contract forbids `src/` patches in either repo. Then re-run this contract from Step 5; the spec delta and logo are already committed and reusable.

**Classification:** upstream DataForSEO account limit + SEO-Bot concurrency handling. Not a Website-Bot factory defect. No build gates were weakened; memory hydration ran `optional` per this contract's own advisory stance (finding `website-bot-memory-mcp-stale`).

---

## Before / after comparison

Before numbers are the recorded brief `examples/quantum-ai-partners/QUANTUM_AI_PARTNERS_FULL_BUILD_BRIEF.md` (build `quantumaipartners_com-1788300273737`, Website-Bot `9a4a156`, 2026-09-01). The previous site output was **absent on this machine** (`build/qap-before-20261111T195632Z/MANIFEST.txt` records `UNKNOWN: prior site output`), so the brief is the "before" by contract.

| Dimension | Before (`…1788300273737`) | After (`…1794595664326`) | Evidence |
|---|---|---|---|
| Routes built / E2E pass | 6 / 12 of 12 (brief) | UNKNOWN — no site built | `build/qap-after-run.log` (attempt 7, stopped at competitive-intelligence) |
| Blueprint execution (section order per route) | not asserted then | UNKNOWN | not reached |
| Required images visible in their sections | 2/2 slots (brief) | UNKNOWN | not reached |
| Client logo in header, byte-identical | none (`logo_status: none_deferred`) | wired but unrendered: committed logo sha256 `0da4b5b16334950e2fc9bd955ca695b43644c15068761f76bb4e9baa51f89b02`, `providedImages[global:logo]` in normalized IR | `examples/quantum-ai-partners/assets/quantum-ai-partners-logo.jpg`, `domain_spec.normalized.yaml` |
| Images: provided / generated / spend | 0 / 20 / $0.60 of $15 | 1 provided / 0 generated / $0.00 of $15 (image stage not reached) | `build/qap-after-run.log` |
| Composition / visual review | — | UNKNOWN (no `build/qap-compare/` pairs; capture driver ready at `build/qap-capture.mjs`) | — |
| Per-route metadata quality (known debt `wb-generic-metadata`) | generic titles | UNKNOWN | not reached |
| LLM: provider, calls, tokens, spend vs budget | llm-router/OpenRouter (brief) | DeepSeek direct (`deepseek-flash`, 10 USD / 200 req); design-reference-acquisition completed; totals UNKNOWN | `build/qap-after-run.log` ("LLM service initialized (direct DeepSeek)") |
| SEO-Bot calls (preflight → landscape → blueprint → SCP), ordering | recorded (brief) | preflight 200 → landscape 502 ×2; ordering stops at landscape | `build/qap-after-run.log`, `build/qap-run-attempt-dfseo-40101.log` |
| Zero-LLM counters (contract, schema, legacy content) | 0/0/0 (brief) | UNKNOWN | not reached |
| Release receipt status / missing gates | partial: publication, deployment | not produced | — |

---

## Pre-build verification results (observed, evidence-backed)

| Gate | Result | Evidence |
|---|---|---|
| `normalize-spec` + `normalize-spec:check` | PASS (both committed pairs) | run output, commit `b9be9db5` |
| `npm run typecheck` (tsc --noEmit + interop build) | PASS | `build/qap-preflight-validate.log` session (exit 0) |
| `npm run validate` | PASS — required_checked 4, missing_required [], missing_secrets [], 19 secrets injected from Infisical prod | `build/qap-preflight-validate.log` |
| Plan-mode (`--mode=plan --redesign`) | FAILED CLOSED as expected — redesign plan-mode rejection at `seo-build-intelligence-preflight` (the brief's documented `PLAN_MODE_UNSUPPORTED_FOR_REDESIGN` behavior) | `build/qap-plan-mode.log` |
| Playwright Chromium | installed (pinned version) | step 4.4 output |
| SEO-Bot preflight | HTTP 200, machine-auth PASS, DataForSEO configured, llm provider llm-router | `build/qap-after-run.log` (attempt 6+) |
| Logo byte-identity | source == committed copy, sha256 `0da4b5b1…` | step 1 hashes |

## Deviations from the compiled contract (all operator-visible, none silent)

1. **Version/`value_proposition` conflict**: main's normalizer requires a `value_proposition` section for v1.1.0 source specs (`normalize-spec.ts:161-164`); the Step-3 table both mandated 1.1.0 and limited the delta to five fields. Operator chose: bump to 1.1.0 and author a minimal `value_proposition` (status `locked`) derived strictly from the spec's existing facts; revision note added recording the deviation.
2. **`logo_status: provided`** — no enum validation exists on main (observed values repo-wide: `none_deferred`, `placeholder`); `provided` passes through and is recorded.
3. **Rendered-site evidence path**: main writes `build/evidence/<clientId>/<buildId>/rendered-site-validation.json` (FileEvidenceStore), not `build/validation-evidence/…` as the compiled table said. Recorded; no action needed (stage never reached).
4. **`npm run validate` gate** is `scripts/verify-launch-env.mjs` (4 hardcoded required vars + secrets), not a launch-env.required.yaml parser. PASS observed.
5. **e2e desktop viewport is 1280** (`e2e.mjs:73`), not 1440; the 1440/390 pin applies to `captureScreenshots` (`visual-regression.ts:31-34`). Both recorded.
6. **Agent id**: worktree started as `claude-code` (this surface's actor), not `cursor` (the compiled prompt's surface).
7. **`npm ci` ran before Step 4.3** — mechanically required for Step 3's normalize.
8. **Prior build preservation**: `UNKNOWN: prior site output` on this machine; nothing to snapshot or quarantine (no image cache existed). Recorded in the SNAP manifest.
9. **Seam/environment repairs** (all in-process vault binds; no files, no logs, no src/ changes): `seo-bot-seam-key-drift`, `website-bot-infisical-deepseek-gap`, `seo-bot-stale-datforseo-creds`, `website-bot-memory-mcp-stale` — see findings.
10. **Memory hydration**: pipeline memory MCP on this machine lacks `memory.hydrate`; run proceeded with `L9_MEMORY_MODE=optional` (contract Step 0.2 calls hydration advisory).

## Findings (recorded on the session-debt ledger, deferred with owners — none fixed in this contract)

| Id | Owner | Summary |
|---|---|---|
| `seo-bot-seam-key-drift` | operator / SEO-Bot | Local SEO-Bot `.env` (2026-08-11) and the Website-Bot Infisical project carry stale `SEO_BOT_API_KEY`s; canonical vault key injected in-process. |
| `website-bot-infisical-deepseek-gap` | operator / Website-Bot | Website-Bot Infisical project lacks `DEEPSEEK_API_KEY` though main requires it (ADR-0020). |
| `seo-bot-stale-datforseo-creds` | operator / SEO-Bot | Same `.env` carries DataForSEO credentials that 401; canonical vault pair injected in-process. |
| `website-bot-memory-mcp-stale` | operator / environment | MCP surface at the GRAPHITI_MCP_URL (C1 tunnel :8100) lacks `memory.hydrate`; MemoryService CLI lane healthy. |
| `seo-bot-datforseo-concurrency` | operator (plan tier) + SEO-Bot | DataForSEO account allows one concurrent SERP task; SEO-Bot's 10-query landscape collides → `40101`. Blocks build convergence. |

## Evidence index

- Run logs: `build/qap-run-attempt-401.log`, `build/qap-run-attempt-401b.log`, `build/qap-run-attempt-deepseek-missing.log`, `build/qap-run-attempt-memory-tool.log`, `build/qap-run-attempt-dfseo-401.log`, `build/qap-run-attempt-dfseo-40101.log`, `build/qap-after-run.log` (attempt 7, final)
- Pipeline evidence (one dir per attempt): `build/evidence/quantumaipartners_com/quantumaipartners_com-1794594*`
- Preservation manifest: `build/qap-before-20261111T195632Z/MANIFEST.txt`
- Preflight gates: `build/qap-plan-mode.log`, `build/qap-preflight-validate.log`
- Prepared but unused: `build/qap-capture.mjs` (Step 7 driver), `build/qap-run-with-seam-key.py`, `build/qap-runtime-seam.py`, SEO-Bot runtime `qap-seam-override.yml`

## Re-run path (operator-owned)

1. Restore the DataForSEO plan tier (concurrent live-SERP tasks) **or** land a SEO-Bot change that serializes landscape SERP tasks / retries `40101` with replacement donors.
2. Re-run this contract from Step 5: `python3 build/qap-run-with-seam-key.py` in the worktree (or the same env contract on the Cursor surface); the spec delta, logo, and normalization are already committed on this branch.
3. Steps 6–8 (E2E, rendered validation, logo fidelity, image accounting, before/after captures, verdict) complete against the converged buildId.
