# Website-Bot v2.0 — Change Summary

## L9 Recursive Optimization — Cycle 1

**Source intent preserved.** All 8 violations fixed. No new scope added.

## What Was Strengthened

| File | Change |
|------|--------|
| `package.json` | Added — npm CI no longer fails |
| `tsconfig.json` | Added — tsc --noEmit works out of box |
| `src/services/llm.ts` | Added — entire LLM layer was missing; fixes pipeline |
| `src/pipeline/PipelineRunner.ts` | LLM usage flushed to llm_usage table post-run |
| `.github/workflows/emit-handoff.yml` | DEPLOYMENT_URL now sourced from deploy-to-vercel artifact |
| `src/stages/ContentGenerationStage.ts` | Word count gate (80 words) + banned-claim gate with 1 auto-retry |
| `src/stages/SchemaGeneratorStage.ts` | ServiceArea schema added (5th schema type) |
| `RUNBOOK.md` | tsconfig.json documented; stage skip table added |
| `MANIFEST.md` | File count corrected (28) |
| `VALIDATION.md` | File count corrected (28); gates updated |

## What Was Removed

Nothing removed. No scope reduced.

## Breaking Changes

None. All interfaces backward-compatible with Phase 1 pipeline consumers.
