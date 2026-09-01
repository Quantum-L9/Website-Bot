<!-- L9_META: layer=architecture, role=v1_value_extraction_matrix, status=accepted, version=1.0.0 -->
# WebsiteBuildBlueprintV1 → V2 Value Extraction Matrix

**Authority:** [ADR-0018](../adr/ADR-0018-website-build-blueprint-v2-single-authority.md),
invariant `WBV2-016`.

Burn the boats only after transferring the cargo. Every V1 surface below was
read in the executable code, not inferred from its type name. Deletion is
licensed only by a traced destination and a test.

Baseline commit inspected: Website-Bot `82959e15`, SEO-Bot `846fcc03`.

---

## Contract surfaces

| V1 surface | Guarantee it carried | Consumers found | V2 destination | Test | Status |
|---|---|---|---|---|---|
| `WebsiteBuildBlueprintV1` (type) | payload shape for the sealed blueprint | interop, stage, compiler, 3 test files | `WebsiteBuildBlueprintV2` | `website-build-blueprint-v2.test.ts` | PORTED |
| `schema` URI `.../website-build-blueprint/v1` | artifact self-identification | stage, fixtures, golden fixture | `.../website-build-blueprint/v2` via `WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint` | `website-build-blueprint-v2.test.ts` (V1 URI rejected) | PORTED |
| `artifact_type: "website_build_blueprint"` | envelope routing + content-addressed id | interop union, evidence adapter | unchanged — envelope is not migrated (ADR-0018 §2) | existing integrity tests | UNCHANGED |
| `IntelligenceArtifact` sealing / `integrity.payload_digest` | content-addressed identity, tamper detection | all artifacts | unchanged; V2 seals through the same `sealIntelligenceArtifact` | `assertIntelligenceArtifactIntegrity` tests | UNCHANGED |
| `build_intent: "REDESIGN_IMPROVE"` | blueprint only exists for redesign | `assertBlueprintIdentity` | `WebsiteBuildBlueprintV2.build_intent`, same literal type | `website-build-blueprint-compiler.test.ts` | PORTED |

## Provenance surfaces

| V1 surface | Guarantee | Consumers | V2 destination | Test | Status |
|---|---|---|---|---|---|
| `competitive_landscape_ref` | blueprint is bound to one exact landscape | PCC compiler, `RedesignContentAuthorityStage`, `assertWebsiteBlueprintLandscape`, golden evidence, golden receipt | `provenance.competitive_landscape_ref` | `website-build-blueprint-compiler.test.ts`, `page-content-contract-compiler.test.ts` | PORTED (relocated) |
| `baseline_digest` | binds blueprint to the frozen route baseline | sealed payload only | `provenance.baseline_digest` | `website-build-blueprint-v2.test.ts` | PORTED (relocated) |
| `pattern_portfolio_digest` | blueprint's patterns are the ones synthesized this run | `assertBlueprintIdentity` | `provenance.pattern_portfolio_digest` | `website-build-blueprint-compiler.test.ts` | PORTED (relocated) |
| — (absent in V1) | client intent provenance | — | `provenance.client_vision_digest` | `website-build-blueprint-v2.test.ts` | **NEW (WBV2-009)** |
| — (absent in V1) | design reference provenance | — | `provenance.design_reference_intelligence_digest` | `website-build-blueprint-v2.test.ts` | **NEW (WBV2-009)** |

## Decision surfaces

| V1 surface | Guarantee | V2 destination | Status |
|---|---|---|---|
| `strategy.{experience_attributes,differentiation,preserve,evolve,forbid}` | market-informed strategic posture; read by `DesignIntelligenceStage` | `strategy` — identical five fields | PORTED |
| `content_guardrails.forbidden_claims` | claims the site may never make; merged into every PCC route | `content_guardrails.forbidden_claims` | PORTED |
| `conversion.{primary_action,secondary_actions,persistent_mobile_action}` | conversion intent; `primary_action` defaults to a real string, `persistent_mobile_action` defaults true | `conversion` — identical, same defaults | PORTED |
| `routes[]` (`route_id`, `path`, `purpose`, `sections[]`) | route structure; identity re-asserted from spec | `routes` — `WebsiteBlueprintRoute` reused unchanged | PORTED |
| `sections[]` (`section_id`, `component_class`, `objective`, `content_slots`, `pattern_refs`, `proof_requirements`, `conversion_action?`, `acceptance_tests?`) | section intent + slot targets for PCC placement | `WebsiteBlueprintSection` reused unchanged | PORTED |
| `visual_requirements[]` | blueprint owns *whether* imagery is needed (Campaign 7 R11) | `visual_requirements` — `VisualRequirement` reused unchanged | PORTED |
| `acceptance_tests[]` | site-level acceptance tests merged into every PCC route | `acceptance_tests` | PORTED |
| — (absent in V1) | design direction as a first-class decision | `design_direction.{principles,desired_attributes,rejected_attributes,reference_pattern_refs,prohibited_transfers,palette_authority}` | **NEW (WBV2-007/019)** |

## Validation surfaces

| V1 validator | Guarantee | V2 destination | Test | Status |
|---|---|---|---|---|
| `assertBlueprintIdentity` | build_intent, landscape ref, portfolio digest | split into `assertBlueprintIdentity` + `assertProvenanceCompleteness` in the compiler | `website-build-blueprint-compiler.test.ts` | PORTED (strengthened) |
| `assertBlueprintRouteSet` | route set == spec route set | same, in the compiler | `website-build-blueprint-compiler.test.ts` | PORTED (`WBV2-021`) |
| `assertBlueprintPatternRefs` | every section pattern ref resolves | same, in the compiler | `website-build-blueprint-compiler.test.ts` | PORTED |
| `assertAdoptedPatternTests` | every non-rejected pattern has an acceptance test | same, in the compiler | `website-build-blueprint-compiler.test.ts` | PORTED |
| `ensureCanonicalSlotCoverage` | full canonical slot set + section/component parity | moved verbatim into the compiler module | `website-build-blueprint-compiler.test.ts` | PORTED (`WBV2-022`) |
| `deriveVisualRequirements` | deterministic imagery intent from route/section structure | moved verbatim into the compiler module | `website-build-blueprint-compiler.test.ts` | PORTED |
| `assertWebsiteBlueprintLandscape` | boundary helper proving blueprint↔landscape lineage | same name, reads `provenance.competitive_landscape_ref` | `seo-build-intelligence-port.test.ts` | PORTED |
| `assertIntelligenceArtifactIntegrity` | envelope + digest integrity | unchanged | existing | UNCHANGED |
| — (absent in V1) | producer must be Website-Bot | `assertWebsiteBuildBlueprintProducer` | `website-build-blueprint-v2.test.ts` | **NEW (WBV2-002)** |
| — (absent in V1) | no raw expression transfer from references | `assertNoRawExpressionTransfer` | `design-reference-intelligence.test.ts` | **NEW (WBV2-004)** |
| — (absent in V1) | observed palette cannot be authoritative | `assertPaletteNonAuthority` | `palette-non-authority.test.ts` | **NEW (WBV2-007)** |

## Runtime / persistence / evidence surfaces

| V1 surface | Guarantee | V2 destination | Status |
|---|---|---|---|
| `ctx.websiteBlueprint` (BuildContext) | in-run blueprint carrier | same field, retyped to the V2 artifact | PORTED |
| `clientAssetRoot/website-build-blueprint.json` | sealed artifact on disk for the golden receipt adapter (golden run #61 fix) | unchanged path, V2 payload | PORTED |
| `build-receipt.mjs` path `competitive_landscape_ref.artifact_id` | receipt projects landscape lineage from the persisted payload | repointed to `provenance.competitive_landscape_ref.artifact_id` — repointed, **not** made a fallback (`WBV2-015`) | PORTED |
| `safehaven-golden-runtime-evidence.ts` blueprint projection | golden runtime evidence: artifact ref, landscape ref, visual requirements | same, reading `provenance.*` | PORTED |
| `scripts/golden-safehaven/fixtures/build-fixtures.mjs` blueprint fixture | golden fixture payload | rewritten as a V2 payload | PORTED |
| `tests/unit/redesign-fixtures.ts` `makeWebsiteBlueprint` | shared test factory | rewritten as a V2 factory | PORTED |
| `PageContentContract.inputs.website_build_blueprint` | PCC records which blueprint it compiled from | unchanged (`ArtifactRef` — version-agnostic) | UNCHANGED |

## Cross-repo surfaces

| V1 surface | Finding | V2 destination | Status |
|---|---|---|---|
| SEO-Bot `packages/bot-interop/src/website-intelligence.ts` | vendored copy, byte-identical to Website-Bot's at baseline | identical V2 source ported | PORTED |
| SEO-Bot `seo-content-blueprint.ts` | **no code dependency** — one comment asserting non-consumption | comment updated to name V2 | PORTED |
| SEO-Bot `seo-content-blueprint.test.ts:254` | test *name* asserting no blueprint dependency | name updated; assertion unchanged and still meaningful | PORTED |
| SEO-Bot `contracts/WEBSITE_INTELLIGENCE_LOCK.json` | declares `website_build_blueprint.version: 1` | rewritten to v2 + `V1: SUPERSEDED_REMOVED` | PORTED |

---

## Intentionally not ported

| V1 behavior | Why superseded |
|---|---|
| Flat top-level provenance fields (`competitive_landscape_ref`, `baseline_digest`, `pattern_portfolio_digest` as siblings of `strategy`) | `INTENTIONALLY_NOT_PORTED` — V2 groups all five provenance fields under one `provenance` block so `WBV2-009` completeness is a single checkable object rather than a convention spread across the payload. The three values themselves are ported; only their location changes. |
| Implicit "design direction lives in the LLM prompt" | `INTENTIONALLY_NOT_PORTED` — V1 had no design-direction field; direction survived only as prose passed to `DesignIntelligenceStage` via `blueprintContext()`. ADR-0018 §7 makes design direction a sealed decision. The prompt-context path is retained as a *reader* of the sealed field, not as the place the decision lives. |
| Source-site palette as a deterministic redesign theme (`DesignIntelligenceStage` lines 79–113 under `REDESIGN_IMPROVE`) | `INTENTIONALLY_NOT_PORTED` — this is the exact mapping `WBV2-007` forbids. Retained unchanged for `COPY`, where faithful reconstruction is the declared contract. |
| `PENDING_PUBLICATION` dependency-coordination semantics in the lock | `INTENTIONALLY_NOT_PORTED` — the live runtime consumes `file:packages/bot-interop`; registry publication is not the active convergence mechanism. Replaced by a vendored-parity rule with a mechanical validator (`WBV2-014`). |
