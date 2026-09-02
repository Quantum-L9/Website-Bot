# Campaign 7 — REDESIGN_IMPROVE Runtime Convergence

> **Historical record.** This campaign describes the `WebsiteBuildBlueprintV1`
> era. V1 was superseded and removed by
> [ADR-0018](../adr/ADR-0018-website-build-blueprint-v2-single-authority.md);
> every V1 reference below is a historical supersession reference, not an
> active contract. The R11 visual-requirement authority described here was
> ported to V2 unchanged.


**REDESIGN_EXECUTION_INTEGRITY: FAIL**

The Website-Bot runtime graph is wired and fail-closed. The one completing Safe Haven seam (`safehavenrr-1786991794769`) reached a sealed PageContentContract, then died inside SEO-Bot `createStructuredContent`. No integrity receipt was emitted. Golden E2E is not authorized.

## 1. BASELINE

| Item | Value |
|---|---|
| Repository | `Quantum-L9/Website-Bot` |
| Locked SHA | `3eb3536f2bf3f7aad4500748bf028ccc3038f7c2` |
| Work branch | `feat/campaign7-redesign-convergence` |
| LLM-Router | `@quantum-l9/llm-router@1.1.2` |
| bot-interop | `file:packages/bot-interop` |
| Playwright | `1.62.1` (devDependency; required for donor screenshots) |
| SEO-Bot | real local process on `http://localhost:3100`, version `1.0.0`, `/health` = healthy |
| Secrets | Infisical Universal Auth (`openclaw-igorbot/infisical-website-bot` + `infisical-seo-bot`); `SEO_BOT_API_KEY` from `openclaw-igorbot/seo-bot#apikey` |

## 2. EXECUTION-GRAPH ROOT CAUSE

`recursive:improve` previously sealed a spec without `build_intent=REDESIGN_IMPROVE`, so the factory constructed the legacy COPY graph (no mandatory competitive intelligence, LLM content/schema still on the path). Campaign 7 binds the intent before plan construction, swaps the authority stages, and fail-closes every missing edge.

## 3. CHANGES BY REQUIREMENT

| Req | Change |
|---|---|
| R1/R2 | `buildRedesignRunSpec` + `requireRedesignIntent`; sealed spec re-read |
| R3 | `CompetitiveIntelligenceStage` mandatory under `REDESIGN_IMPROVE` |
| R4/R5 | `acquireAcceptedDonors` hard `==10`; `HttpDonorIngestor` crawl + screenshot |
| R6–R8 | `RedesignContentAuthorityStage`: real SEO blueprint, zero-LLM PCC, real SCP |
| R9 | `StructuredContentProjectionStage` replaces `ContentGenerationStage` |
| R10 | `RedesignSchemaSerializerStage`; legacy schema stage trips `FORBIDDEN_LLM_OPERATION` |
| R11 | `visual_requirements` on `WebsiteBuildBlueprintV1`; planner consumes them |
| R12 | source-asset `SELECTED`/`REJECTED` ledger; donor images excluded |
| §16 | `RedesignExecutionIntegrityReceipt` + `RedesignIntegrityReceiptStage` |
| R13 | one real Safe Haven seam against live SEO-Bot + DataForSEO |

## 4. FINAL REDESIGN EXECUTION GRAPH

`DomainSpecLoader → UnknownResolver → CompetitiveIntelligence → SourceSiteIngestion → DesignIntelligence → RedesignContentAuthority → StructuredContentProjection → RedesignSchemaSerializer → ImageAssetPlanning → ImageGeneration → PlaceholderScan → SiteAssembler → … → VisualQA → RedesignIntegrityReceipt → TerminalConvergence`

Absent under `REDESIGN_IMPROVE`: `ContentGenerationStage`, `SchemaGeneratorStage`.

## 5. INTENT PROOF

`recursive:improve` writes `build_intent: REDESIGN_IMPROVE` and re-reads it. Redesign surfaces throw `BUILD_INTENT_REQUIRED` on missing/empty/`COPY`. Legacy `parseBuildIntent(undefined) === "COPY"` remains only on the explicit legacy parser.

## 6. COMPETITIVE INTELLIGENCE

Live `POST /api/build-intelligence/competitive-landscape` is required. Missing `SEO_BOT_URL`/`SEO_BOT_API_KEY` → `COMPETITIVE_INTELLIGENCE_REQUIRED`. Completing seam: landscape sealed, `donors: 10` requested, acquisition accepted 10.

## 7. DONOR HARVEST

Hard `qualified_donor_count == 10` with bounded replacement. Each accepted donor has ≥1 fetched page and ≥1 Playwright screenshot; disposition `DONOR_REFERENCE_ONLY`. Completing seam: 10 accepted.

## 8. BLUEPRINTS

WebsiteBuildBlueprint is sealed in-repo from the landscape + pattern portfolio, with deterministic `visual_requirements` and `ensureCanonicalSlotCoverage` so every canonical `ContentSlot` exists on each route. Completing seam: blueprint sealed and gated; `SEOContentBlueprint` accepted with landscape lineage verified.

## 9. CONTENT AUTHORITY

PCC is compiled in-process with an LLM proxy that increments `pageContentContractLlmCalls` and throws `FORBIDDEN_LLM_OPERATION`. Completing seam: `PageContentContract sealed deterministically (0 LLM calls)`. SCP call then failed (section 14).

## 10. SCHEMA AUTHORITY

`RedesignSchemaSerializerStage` is deterministic and zero-LLM. Not reached on the seam. Unit tests prove determinism and the legacy-schema tripwire.

## 11. VISUAL ASSET AUTHORITY

Planner derives slots from blueprint `visual_requirements`; required slots must be 100% filled. Source assets are `SELECTED` or `REJECTED` with reason. Not reached on the seam. Unit matrices H/I pass.

## 12. VISUAL QA

`VisualQAStage` remains mandatory for `end-to-end`. Receipt validation requires `visual_qa.status === "verified"` when `requireVisualQa` is set. Not reached on the seam.

## 13. VALIDATION

Targeted Campaign 7 unit matrices, `npx tsc --noEmit`, and `npm run verify:all` passed after the graph was wired (todo-19). `make pr` re-runs the repository `pr-check` gate.

## 14. SAFE HAVEN SEAM PROOF

One completing real run, no mocks, no seeded landscape:

| Field | Value |
|---|---|
| Source | `https://www.safehavenrr.com` |
| Spec | `fixtures/safehavenrr-seam-spec.yaml` (strict subset of `fixtures/safehavenrr-spec.yaml`; same client, market, keywords, palette — 4 routes so the SEO blueprint stays inside the LLM output budget) |
| Build | `safehavenrr-1786991794769` |
| SEO-Bot | `http://localhost:3100` (real process, Bearer `SEO_BOT_API_KEY`) |
| DataForSEO | live `/serp/google/organic/live/advanced` |
| Passed | domain-spec-loader, unknown-resolver, competitive-intelligence (10 donors), source-site-ingestion, design-intelligence, SEOContentBlueprint lineage, PageContentContract (0 LLM) |
| Failed | `redesign-content-authority` → `POST /api/build-intelligence/structured-content` HTTP 500 |
| SEO-Bot error | model returned section `content` (unrecognized) and omitted required `blocks` array; SEO-Bot schema-guards reject it after one bounded repair |
| Receipt | not emitted (stage sits after SCP projection / schema / QA) |

Earlier starts that did not complete the graph (DataForSEO `40101`/timeout, missing Playwright, blueprint JSON truncation, `CONTENT_REQUIREMENT_UNPLACED` before slot coverage) are not seam proofs. They are discarded starts of the same required run.

## 15. FINAL RECEIPT

`RedesignExecutionIntegrityReceipt` was **not** written. Missing SCP, schema path, asset ledger, and rendered visual QA make `REDESIGN_EXECUTION_INTEGRITY = PASS` impossible. Emitter + impossibility-matrix tests exist and pass on synthetic fixtures.

## 16. BLOCKERS / REMAINING RISKS

1. **CROSS_REPOSITORY_BLOCKER** — SEO-Bot `structured-content` producer does not reliably emit `sections[].blocks`. Website-Bot must not locally substitute or LLM-repair the package. Fix belongs in SEO-Bot (`schema-guards` / `strategizeJson` repair), not here.
2. DataForSEO live `40101` / 30s timeout is intermittent. Direct probe of the same endpoint succeeded in ~3s; SEO-Bot's client is single-shot fail-closed (no retry). Not weakened.
3. Full 8-route Safe Haven spec overflows the SEO-Bot blueprint token budget (~21.5k truncated JSON). Seam used a 4-route subset with no invented facts.
4. `SEO_BOT_URL` is not in the Website-Bot Infisical vault. Seam bound it to the live local process.

## 17. NEXT ACTION

Do not run Golden E2E. Repair SEO-Bot structured-content JSON compliance, then run **one** new Safe Haven seam from this branch. A PASS receipt is the only authorization to consider Golden E2E.

DO_NOT_RUN_GOLDEN_E2E
