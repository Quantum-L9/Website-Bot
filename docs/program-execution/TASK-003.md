# TASK-003 — Authenticated REDESIGN preflight

Campaign: `pe-website-bot-preflight-adoption` · Stacked on TASK-002

## What changed

- `src/intelligence/SeoBuildIntelligencePort.ts` — the port interface gains
  `preflight(): Promise<SeoBotPreflightResult>` plus the typed
  `SeoBotPreflightError` carrying one of the four SEO_BOT_* failure codes
  (`SEO_BOT_UNREACHABLE`, `SEO_BOT_AUTH_FAILED`,
  `SEO_BOT_CAPABILITY_MISMATCH`, `SEO_BOT_ROUTER_VERSION_MISMATCH`) and the
  readiness snapshot type mirroring the SEO-Bot preflight payload.
- `src/intelligence/SeoBuildIntelligenceHttpClient.ts` — implements the
  preflight: GET `/health` proves network reachability; GET
  `/api/build-intelligence/preflight` (machine-authenticated) proves auth
  (401/403 → AUTH_FAILED), required capabilities
  (competitive_landscape, seo_content_blueprint, structured_content),
  provider configuration (DataForSEO + LLM), bot-interop compatibility
  against the local workspace bot-interop version, and Router patch equality
  against the locally pinned `@quantum-l9/llm-router` version (1.3.0). Every
  failure throws `SeoBotPreflightError` with its mapped code — fail closed,
  no partial readiness.
- `src/pipeline/BuildError.ts` — added the four SEO_BOT_* codes to the
  `BuildErrorCode` union.
- `src/stages/RedesignContentAuthorityStage.ts` — for REDESIGN_IMPROVE
  builds, the stage runs the authenticated preflight immediately after the
  port is constructed and BEFORE any expensive pipeline work (R6+);
  `SeoBotPreflightError` maps 1:1 onto a `BuildError` with the same code.
- `tests/unit/seo-build-intelligence-port.test.ts` — preflight client suite:
  happy path, network failure → UNREACHABLE, unhealthy service →
  UNREACHABLE, 401 → AUTH_FAILED, missing capability → CAPABILITY_MISMATCH,
  incomplete provider configuration → CAPABILITY_MISMATCH, bot-interop
  mismatch → CAPABILITY_MISMATCH, Router patch mismatch →
  ROUTER_VERSION_MISMATCH.
- `tests/unit/redesign-content-authority.test.ts` — preflight ordering
  (runs before any SEO-Bot call) and fail-closed mapping of each of the four
  failure codes onto the build.

## Validation (run on the finished tree)

- `npm run typecheck` — PASS
- `node --import tsx --test tests/unit/seo-build-intelligence-port.test.ts tests/unit/redesign-content-authority.test.ts` — PASS (31 tests)
- `npm run site:test -- --scope=local` — PASS (368 pass, 0 fail, 2 skipped)
