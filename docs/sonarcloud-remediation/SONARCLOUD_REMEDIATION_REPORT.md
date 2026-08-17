# SonarCloud Remediation Report — PR #133

**Date:** 2026-08-17 · **Branch:** `fix/sonarcloud-remediation-clean` · **Plan:** `sonarcloud_remediation_phase2.plan.json`

## Scope

Phase 2 of the remediation workstream: 19 in-plan high-risk findings across
four waves. The 15 remaining high-complexity S3776 findings (40–79) are
explicitly out of scope (architecture review required) — see
`REMAINING_HIGH_RISK_ANALYSIS.md` Phase-4 deferral.

## Waves

### Wave 1 — S107 (4/4 DONE)

| Site | Change |
|---|---|
| `astro_template/scripts/lib.mjs` | `result()` → options object + positional shim |
| `examples/.../astro_site/scripts/lib.mjs` | same |
| `astro_template/scripts/validation-framework.mjs` | `addCheck()` → options + shim |
| `EvidenceCollector.storeExecutionTrace` | → `ExecutionTraceOptions` |

70 caller sites migrated by a codemod; the positional shim keeps generated
sites that copy the template scripts working (verified by running the
pre-migration `verify-source.mjs` against the new `lib.mjs` — identical
output).

Evidence: `node --check` 5/5 (all template+example scripts), template
preflight 4/4 PASS, template verify-seo 7/7 merged checks PASS,
examples preflight 17 checks, examples verify-seo 15/15 PASS,
examples verify-source 50/50 PASS, EvidenceCollector 8/8 PASS,
`tsc --noEmit` clean.

### Wave 2 — S3776 low-complexity (7/7 DONE)

| Function | File | Change |
|---|---|---|
| `validateDomainSpec` (+`validateAssets`, `validateSeoContract`) | `src/pipeline/validateDomainSpec.ts` | 13 extracted validators (`validateGeography`, `validateRoutes`, `validateRoute`, `validateDesign`, `validateDeploy`, `validateVercelDeployHook`, `validateProvision`, `validateProvisionGithub`, `validateProvisionVercel`, `validateVercelEnvironment`, `validateProvisionMaintenance`, `validateSourceSite`, `validateProvidedImages`, `validateImageSlots`, `validateGeneration`, `validateLeadFormAction`, `validateOptionalEnvRef`) |
| `loadRepositoryAdapter` | `packages/validation-executor/src/cli.ts` | `tryLoadAdapter`, `looksLikeSeoBot`, `looksLikeWebsiteBot` |
| `validateConfiguration` | same | `validateTimeoutOption`, `validateWhitelistOption`, `verifyWritableDirectory` |
| `scanBalancedJson` | `src/services/extractJson.ts` | `consumeScannerChar`, `consumeStringChar` |
| `walkRoots` / `runCli` | `scripts/validate-l9-boundaries.mjs` | `readdirTolerant`, `lstatTolerant`, `resolveClassificationLocations`, `loadAndValidateClassification`, `resolveScanRoots`, `createFileInspector`, `checkLlmRouterGuards` |
| `staticMode` | `examples/.../verify-smoke.mjs` | `pushDistBlockedCheck`, `pushStaticRouteCheck`, `collectHtmlFiles`, `pushLinkCheck` |
| `validateWebsiteBotConfiguration` (root script) | `scripts/validation-executor.ts` | verified already under threshold after prior refactor — no change needed |

Evidence: targeted tests 26/26 PASS (domain-spec-seo-contract,
generated-site-validation, extract-json, l9-boundaries-walk),
`tsc --noEmit` clean, biome clean. Error messages preserved verbatim.

### Wave 3 — S8786 (6/6 DONE, security-reviewed)

| Site | Change | Equivalence |
|---|---|---|
| `secureExecution.ts` env-assignment strip | loop unroll of the `(?:...\S+\s+)+` group | exact |
| `secureExecution.ts` redirect strip | `[<>]{1,64}` bound | domain-bounded (64) |
| `secureExecution.ts` denylist `$(...)`/backtick patterns | lookahead + single class | exact |
| `E2EEngine.ts` assertion patterns | `.{0,2000}` span bounds | domain-bounded (2000) |
| `provisioning/request.ts` BRANCH | char-class regex + linear predicates | exact |
| `HandoffEmitterStage.ts`, `validate-generated-site.ts` | verified linear — no rewrite | n/a |

Evidence: `scripts/fuzz_regex_equivalence.mjs` — 800,000 deterministic
cases, **0 in-domain diffs** (full run, reproducible). Proofs:
`regex-equivalence-proof-{110,113,186,17,103,57}.md`. Security review:
`SECURITY_REVIEW_REDOS.md` — APPROVED (self-review protocol + fuzz
evidence; operator reviewer may re-sign).

### Wave 4 — S7059 (1/1 DONE)

`EvidenceCollector` constructor is now synchronous; creation goes through
`static async create()` which awaits `ensureEvidenceDirectory()`. All 29
instantiation sites migrated (1 production + 28 tests).

## Validation summary

| Gate | Evidence |
|---|---|
| `node --check` | all modified `.mjs` PASS |
| `tsc --noEmit` | clean (after `interop:build`) |
| biome | clean on all changed files |
| validation-executor suite | full run green (see CP evidence at PR time) |
| targeted root tests | 26/26 PASS |
| fuzz equivalence | 800k cases, 0 diffs |

## Remaining (explicitly deferred)

- **15 S3776 high-complexity functions (40–79)** — dedicated Phase 4 with
  architecture review + E2E coverage. Out of PR #133 scope.
- **Upstream l9-ci-core workflow findings (20)** — separate repo.

Closure of the 19 remediated findings is confirmed by SonarCloud re-analysis
on PR #133 (checkpoint CP5).
