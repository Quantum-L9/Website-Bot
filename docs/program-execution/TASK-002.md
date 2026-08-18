# TASK-002 — Machine-auth client contract

Campaign: `pe-website-bot-preflight-adoption` · Stacked on TASK-001

## What changed

- `src/intelligence/SeoBuildIntelligenceHttpClient.ts` — the HTTP-client
  comment now states the security contract precisely: `SEO_BOT_API_KEY` is
  the machine API credential for Website-Bot → SEO-Bot build-intelligence
  calls and travels ONLY in the Authorization header of build-intelligence
  route requests; the operator dashboard key (OPERATOR_API_KEY) is never used
  by this client. Fail-closed construction: an absent/blank `SEO_BOT_URL` or
  `SEO_BOT_API_KEY` throws before any network traffic, so missing
  configuration surfaces in seconds instead of an empty-credential request
  failing twenty minutes into the pipeline.
- `tests/unit/seo-build-intelligence-port.test.ts` — added the machine-auth
  client contract suite: the client sends `Authorization: Bearer <machine
  key>` on the exact build-intelligence route and consults no other
  credential, fails closed on an absent key, and fails closed on an absent
  URL.

## Validation (run on the finished tree)

- `npm run typecheck` — PASS
- `node --import tsx --test tests/unit/seo-build-intelligence-port.test.ts tests/unit/redesign-content-authority.test.ts` — PASS (18 tests)
