<!-- L9_META: layer=architecture, role=llm_launch_gate_adr, status=accepted, version=1.0.0 -->
# ADR-0017: LLM Credentials Required for Generation Claims, Not Launch

## Status
Accepted. Credential list and model-selection clause amended by
[ADR-0020](ADR-0020-direct-deepseek-llm-provider.md); the launch-vs-generation-claim policy
is unchanged.

## Date
2026-08-14

## Context
A recursive-optimization pass aligned the LLM-router integration with the
launch contract, Makefile, and operator docs. The remaining policy question
was whether missing router credentials should fail launch.

A site can deploy from already-resolved copy and a materialized template.
Claiming that Website-Bot generated that copy requires the intelligence
layer.

## Decision
LLM router credentials and budget vars (`OPENROUTER_API_KEY`,
`PERPLEXITY_API_KEY`, `CLIENT_ID`, `MONTHLY_BUDGET_PER_CLIENT`,
`WEEKLY_BUDGET_TARGET`, and related `llm_intelligence` launch-env keys) are:

- **not** required for launch (`required_for_launch: false`);
- **required** for generation claims (`required_for_generation_claims: true`).

Model selection remains the router’s job (ADR-0003). Website-Bot owns site
generation through `src/services/llm.ts`. Contracts own the interface
(`contracts/llm_router_integration.yaml`). Operators own secrets.

## Consequences
- `verify:launch-env` may pass without router keys.
- Any claim of AI-generated content, design intelligence, or visual QA that
  depends on the router must fail closed when those keys are absent.
- Command surface for router/build/generation stays on the Makefile
  (`build-router`, `generate-domain-spec`, `generate-content`,
  `verify-visual-qa`).

## Amendment (ADR-0020, 2026-11-06)
The `llm_intelligence` credentials are now `DEEPSEEK_API_KEY` (required for generation
claims) plus the optional per-build limits `LLM_BUILD_BUDGET_USD` and
`LLM_MAX_REQUESTS_PER_BUILD`. `OPENROUTER_API_KEY`, `PERPLEXITY_API_KEY`,
`MONTHLY_BUDGET_PER_CLIENT` and `WEEKLY_BUDGET_TARGET` are retired. Model selection belongs
to the direct DeepSeek adapter in `src/services/llm.ts`, not the router. Claims of
AI-generated content, design intelligence or visual QA fail closed when `DEEPSEEK_API_KEY` is
absent. There is no router build step.

## Related Artifacts
- `config/launch-env.required.yaml` (`llm_intelligence` group)
- `src/services/llm.ts`
- `contracts/llm_router_integration.yaml`
- ADR-0003
- Archived source: `docs/archive/recursive_optimization_report.md`
