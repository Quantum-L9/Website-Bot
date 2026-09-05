# Website-Bot / SEO-Bot Full Pipeline Repair Brief

Date: 2026-09-03. Published early at the operator's request. Every claim is backed by a command that ran in this session; anything not executed is marked NOT_EXECUTED.

## Executive verdict

Final status: **REPAIRED_TO_POST_SEO_EXTERNAL_RUNTIME_BLOCKER**. All confirmed repository-owned gaps are repaired and tested. The clean end-to-end run is blocked by credentials this model-controlled surface cannot hold.

## Run identity

| Item | Value |
|---|---|
| Run pack | `reports/test-runs/quantum-ai-partners-20260901/quantum-ai-partners-benchmark/` |
| Run-bound Website-Bot SHA | `9a4a156ba9b67d392e4ee9f50810a44240536fde` |
| Run-bound SEO-Bot SHA | UNKNOWN (not recorded by the run pack) |
| Website-Bot HEAD audited | `96042da6bd9a3dd25b7cf56dd9be3ca571995672` |
| SEO-Bot HEAD audited | `c651050bc81fbf3b12bd5313942be64fed083d6b` |
| Previous failure | stage 3 `seo-build-intelligence-preflight`, `SEO_BOT_UNREACHABLE` (loopback `SEO_BOT_URL`, no listener) |

Previous run proved: raw-language flat DomainSpec validates; preflight fails closed before any paid call. It did not prove reference acquisition, blueprint, SEO intelligence, content, build or render; none of those stages ran.

## Gap revalidation

| Gap | Verdict | Evidence |
|---|---|---|
| GAP-1 no reference acquisition | CONFIRMED at run SHA and HEAD; **REPAIRED_AND_PROVEN** | `src/intelligence/DesignReferenceAcquisition.ts`, `src/stages/DesignReferenceAcquisitionStage.ts`; 13 tests pass |
| GAP-2 normalize-spec drops intent | **INVALIDATED_BY_CURRENT_EVIDENCE**: repaired at HEAD by `7346b1e` before this session | `normalize-spec --check OK`; QAP rich spec normalizes with `build_intent`, `client_vision`, 7 URL references; 2 round-trip tests added |
| GAP-3 SEO artifacts memory-only | CONFIRMED; **REPAIRED_AND_PROVEN** | `src/pipeline/evidence/RedesignIntelligenceArtifacts.ts`; 5 tests pass, including resume without re-spend |
| Build terminal, no render validation | CONFIRMED; **REPAIRED_AND_PROVEN** | `src/validation/rendered-site.ts`, `src/stages/RenderedSiteValidationStage.ts`; 4 unit tests pass; real-Chromium integration test written (see NOT_EXECUTED) |
| Environment: pnpm-provisioned `bot-interop` had no `dist/` | Machine-local, not repository | 35 baseline test failures and both repos' typecheck errors vanished after relinking the workspace package |

Full design record: `docs/adr/ADR-0019-client-design-reference-acquisition-and-run-bound-intelligence-persistence.md`.

## Cross-repo contract and SEO-Bot runtime

Request, response, readiness and auth contracts are compatible at HEAD. Proven against a locally started SEO-Bot (Postgres 16 and Redis 7 started without Docker, 6 migrations applied) using Website-Bot's real `SeoBuildIntelligenceHttpClient`:

- `/health` 200: database connected, scheduler active.
- Machine-auth preflight PASS, 9 of 9 checks; `bot-interop` 1.2.0 and `llm-router` 1.3.0 on both sides.
- Wrong key rejected: `SEO_BOT_AUTH_FAILED` (401).
- `competitive-landscape` request accepted by SEO-Bot and failed at the external provider boundary: 502 `DATAFORSEO_UNAVAILABLE` under placeholder credentials. That is the true blocker location.

No SEO-Bot code change was required. The run's claim that `L9_MEMORY_TOKEN` has no registry reference is invalidated: it aliases `GRAPHITI_MCP_TOKEN` (Infisical `/`, `infisical-cursor-governance.yaml`), and SEO-Bot `c651050` already names that alias at startup.

| Dependency | Class |
|---|---|
| Postgres, Redis | REQUIRED_ONLY_FOR_CURRENT_DEPLOYMENT_MODE (startup budgets, queues); local binaries suffice |
| `SEO_BOT_API_KEY`, DataForSEO, OpenRouter, Perplexity, PostHog, PageSpeed | REQUIRED_PRODUCT_DEPENDENCY (Infisical `infisical-seo-bot`) |
| `L9_MEMORY_TOKEN` / Graphiti plane | REQUIRED_PRODUCT_DEPENDENCY in `required` mode for every LLM call |

## Blockers

| ID | Blocker | Type | Exact unblock action | Proof after unblock |
|---|---|---|---|---|
| B1 | DataForSEO credentials absent | SECRET | hydrate `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` into SEO-Bot from Infisical `infisical-seo-bot` | `POST /api/build-intelligence/competitive-landscape` returns 201 sealed artifact |
| B2 | OpenRouter and Perplexity keys absent in both bots | SECRET | hydrate `OPENROUTER_API_KEY`, `PERPLEXITY_API_KEY` | reference analysis and blueprint calls succeed |
| B3 | Graphiti memory plane unreachable | SERVICE | reachable `L9_MEMORY_URL` with `GRAPHITI_MCP_TOKEN` | SEO-Bot LLM calls hydrate without error |
| B4 | Gemini key absent for required hero and logo slots | SECRET | `GEMINI_API_KEY` | image-generation fills required slots; integrity receipt reaches 100% |
| B5 | This surface holds no credentials (`resolve_secret.py --check` FAIL) | AUTHORITY | run from a surface with Infisical bootstrap | `npx tsx scripts/run-pipeline.ts --spec=<flat spec> --mode=local-proof --redesign` converges through `rendered-site-validation` |

## Unknowns

| ID | Unknown | Action to make KNOWN |
|---|---|---|
| U1 | SEO-Bot SHA of the 2026-09-01 run | read the operator's local SEO-Bot checkout history for that date |
| U2 | Whether `GRAPHITI_MCP_TOKEN` exists in the `infisical-seo-bot` project, not only `cursor-governance` | list that Infisical project's `/` secrets |
| U3 | Robots policies of the five reference sites for acquisition | the acquisition manifest records per-URL status on the first credentialed run |

## Validation executed

| Check | Result |
|---|---|
| Website-Bot `tsc --noEmit` | PASS, 0 errors |
| Website-Bot `site:test:local` at HEAD after environment relink | 530 passed, 0 failed |
| New unit suites (acquisition 13, persistence 5, render 4, normalize 2, plan 1) | all pass |
| Full `site:test:local` including the new browser integration test | NOT_EXECUTED (session interrupted before the run) |
| SEO-Bot `typecheck` | PASS |
| SEO-Bot vitest `tests/api tests/build-intelligence tests/core` | 447 passed, 31 files |
| Clean capability E2E from raw input | NOT_EXECUTED past preflight (B1, B2, B5) |
| Production build and browser render of the Quantum AI Partners site | NOT_EXECUTED (B1 to B4) |
