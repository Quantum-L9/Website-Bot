<!-- L9_META: layer=architecture, role=llm_provider_adr, status=accepted, version=1.0.0 -->
# ADR-0020: Direct DeepSeek LLM Provider (LLM-Router Retired From the Execution Path)

## Status
Accepted. Supersedes, in part, ADR-0003 (the provider-resolution clauses listed below) and
amends ADR-0017 (its credential list and model-selection clause; its launch-vs-generation-claim
policy stands).

## Date
2026-11-06

## Authority
Current explicit operator instruction (AGENTS.md source-of-truth order #1), campaign
`WB-DEEPSEEK-DIRECT-01`: replace the runtime LLM-Router dependency with direct DeepSeek for
text and reasoning, and keep Nano Banana (Gemini) for image generation.

## Context
ADR-0003 placed provider/model resolution in `@quantum-l9/llm-router` and forbade direct
provider HTTP calls from Website-Bot. The router dispatched to OpenRouter (general) and
Perplexity (search-grounded) and required both keys before any call.

## Decision
1. `src/services/llm.ts` is the **single approved provider adapter**. It calls the DeepSeek
   Chat Completions API (`https://api.deepseek.com/chat/completions`) directly and is the only
   module permitted to hold the DeepSeek hostname or read `DEEPSEEK_API_KEY`.
2. Runtime credentials for text, reasoning and vision: `DEEPSEEK_API_KEY` only. Image
   generation keeps `GEMINI_API_KEY` in `src/services/images/GeminiImageGenerator.ts` and never
   crosses the text adapter.
3. Default model `deepseek-flash`; `DEEPSEEK_MODEL` may select `deepseek-v4-pro`. Only models
   with verified pricing are accepted; there is **no automatic model escalation**.
4. Thinking is enabled (`reasoning_effort: low`, output bounded by
   `expectedOutputTokens + DEEPSEEK_REASONING_TOKEN_ALLOWANCE`) only for tasks that declare
   `requiresReasoning`; routine content, schema and vision calls run with thinking disabled.
5. **No provider fallback and no automatic retry.** HTTP errors, timeouts, empty content and
   any `finish_reason` other than `stop` are explicit `LLM_CALL_FAILED` errors.
6. **Search-grounded intelligence is not provided.** Tasks that request search, or whose type
   was search-grounded (competitor research, fact verification, market research, citation
   check, link prospecting), fail closed. No web-search subsystem or chargeable DeepSeek
   server-side tool is enabled by this decision.
7. Spending boundary, enforced before every dispatch, per adapter instance (one per build):
   `LLM_MAX_REQUESTS_PER_BUILD` (default 200), `LLM_BUILD_BUDGET_USD` (default 10, a reservation
   of worst-case cost at verified **peak** rates), `LLM_MAX_INPUT_TOKENS` (default 400000,
   bounded by UTF-8 bytes plus DeepSeek's 1024-token per-image ceiling) and explicit per-call
   `max_tokens`. Actual cost is computed from provider-reported usage at peak rates (an upper
   bound; off-peak bills half). A failure without reported usage keeps its full reservation
   charged, because billing of failed requests is not verified.

ADR-0003 remains in force for capability-based declarations: stages declare capability
(`TaskType`, `TaskComplexity`, `requiresReasoning`, `requiresSearch`) and never name a
provider or model; `REDESIGN_IMPROVE` still may not use `generateContent`. The capability
vocabulary now lives in `src/services/llm.ts` with unchanged string values.

### ADR-0003 clauses superseded
- "Provider/model resolution belongs to `@quantum-l9/llm-router` policy." → belongs to the
  DeepSeek adapter in `src/services/llm.ts`.
- "Direct provider HTTP calls from Website-Bot are forbidden." → forbidden everywhere except the
  approved adapter `src/services/llm.ts`.

## Known limits (not claimed)
- The per-build allowance is process-local. It is **not** durable across workers, restarts or
  Inngest step retries; a durable cross-worker hard budget is BLOCKED (no existing store
  provides reservation semantics). The retired router's monthly/weekly per-client windows were
  also process-local (`InMemoryBudgetStore`); they are not reproduced.
- `@quantum-l9/llm-router` stays a declared dependency (`file:packages/llm-router`) solely
  because two consumers outside the pipeline execution path still require it:
  1. `src/intelligence/SeoBuildIntelligenceHttpClient.ts` preflight step 6 compares the
     installed router version with SEO-Bot's (`SEO_BOT_ROUTER_VERSION_MISMATCH`), an interop
     contract mirrored in the peer-identical `contracts/WEBSITE_INTELLIGENCE_LOCK.json`;
  2. the golden SafeHaven visual adjudication harnesses (`scripts/run-safehaven-golden-visual.ts`,
     `scripts/golden-safehaven/run-visual-trials.mjs`) dispatch through the router and still
     need `OPENROUTER_API_KEY`/`PERPLEXITY_API_KEY` when an operator runs them.
  Retiring either requires a coordinated SEO-Bot change or a visual-QA harness decision and is
  out of scope here. `npm run llm:wiring` proves no module under `src/` imports or dispatches
  through the router.

## Enforcement
- `npm run llm:wiring` (`scripts/validate-llm-wiring.mjs`): static scan of `src/` for the retired
  router, OpenRouter and Perplexity paths and for DeepSeek egress outside the adapter; Gemini
  isolation; and a behavioral probe (capturing transport) proving a real call reaches
  `api.deepseek.com` with only `DEEPSEEK_API_KEY` and that retired keys alone never dispatch.
- `npm run alignment:boundaries`: the adapter must not import the router and must target DeepSeek.
- `tests/unit/llm-adapter.test.ts` (D01–D18): deterministic adapter contract.

## Related Artifacts
- `src/services/llm.ts`, `contracts/llm_router_integration.yaml` (revised to v2.0.0)
- DeepSeek API reference and pricing, verified 2026-11-06:
  `https://api-docs.deepseek.com/api/create-chat-completion`,
  `https://api-docs.deepseek.com/quick_start/pricing`
