<!-- L9_META: layer=architecture, role=blueprint_v2_invariants, status=accepted, version=1.0.0 -->
# WebsiteBuildBlueprintV2 Invariants

**Authority:** [ADR-0018](../adr/ADR-0018-website-build-blueprint-v2-single-authority.md).
**Status:** Binding. **Scope:** Website-Bot and SEO-Bot.

Each invariant names its enforcement site. An invariant with no mechanical
enforcement is a comment, not a law; where enforcement is a test rather than a
runtime assertion, that is stated.

---

## WBV2-001 — SINGLE BLUEPRINT AUTHORITY

Exactly one active WebsiteBuildBlueprint contract exists:
`WebsiteBuildBlueprintV2` (`l9://website-intelligence/website-build-blueprint/v2`).
No production component may emit, consume, import, select, negotiate, or fall
back to `WebsiteBuildBlueprintV1`.

*Enforced by:* `scripts/validate-blueprint-v1-eradication.mjs` (repository-wide
static search, part of `verify:all`); `tests/unit/website-build-blueprint-v2.test.ts`.

## WBV2-002 — WEBSITE-BOT OWNERSHIP

Website-Bot exclusively produces `WebsiteBuildBlueprintV2`. SEO-Bot may not
produce, reinterpret, mutate, or become authoritative for it.

*Enforced by:* `sealWebsiteBuildBlueprint` pins `producer.repo = "Website-Bot"`
and `assertWebsiteBuildBlueprintProducer` rejects any other producer;
`contracts/WEBSITE_INTELLIGENCE_LOCK.json`.

## WBV2-003 — CLIENT VISION AUTHORITY

Explicit client design intent is represented by `ClientVision` and owned by
Website-Bot. Where they conflict, explicit client intent outranks inferred
source-site, donor-site, or reference-site style observations.

*Enforced by:* `resolveDesignDirection` applies the WBV2-019 ladder;
`tests/unit/client-vision-authority.test.ts`.

## WBV2-004 — DESIGN REFERENCE AUTHORITY

`DesignReferenceIntelligence` contains normalized design principles derived
from accepted reference evidence. It may carry layout / hierarchy / interaction
/ density principles, typography and imagery characteristics, conversion
patterns, positive and negative patterns, `evidence_refs`, and
`prohibited_transfers`.

It may **not** transfer raw donor or reference copy, markup, CSS, imagery, or
proprietary expression.

*Enforced structurally* — the type has no field able to hold raw expression —
*and mechanically* by `assertNoRawExpressionTransfer`, which rejects markup
tags, CSS declaration blocks, concrete color literals, and url()/data: asset
references inside any principle string.

## WBV2-005 — COMPETITIVE LANDSCAPE BOUNDARY

`CompetitiveLandscape` remains SEO-Bot-owned and is the only SEO-Bot-produced
artifact required to compile `WebsiteBuildBlueprintV2`.

*Enforced by:* `WebsiteBuildBlueprintCompilerInput` accepts exactly one SEO-Bot
artifact; `tests/unit/website-build-blueprint-compiler.test.ts`.

## WBV2-006 — NO SEO-BLUEPRINT CYCLE

`SEOContentBlueprint` is downstream of `WebsiteBuildBlueprintV2` route/structure
identity and MUST NOT become an upstream input to it.

*Enforced by:* the compiler's input type cannot express a `SEOContentBlueprint`
input; `tests/unit/website-build-blueprint-compiler.test.ts` asserts the
compiler module does not import the SEO blueprint type.

## WBV2-007 — PALETTE NON-AUTHORITY

Observed source-site, donor-site, competitor-site, and design-reference-site
palettes are non-authoritative. Observed colors MUST NOT deterministically
become redesigned theme tokens.

- Allowed: abstract characteristics (`warm`, `restrained`, `dark-dominant`,
  `high-contrast`, `muted`, `editorial`).
- Forbidden: `donor_hex -> redesign_hex`; `source_primary_color ->
  redesign_primary_color`; `reference_palette -> authoritative_theme`.

A color becomes authoritative only through explicit `ClientVision` intent or
another explicit first-party design requirement.

`COPY` intent is out of scope: faithful reconstruction is the declared `COPY`
contract and preserving the source palette there is correct.

*Enforced by:* `assertPaletteNonAuthority` (an empty-source authority may carry
no tokens; no observed characteristic may be a concrete color literal);
`DesignIntelligenceStage` consults `palette_authority` under `REDESIGN_IMPROVE`;
`tests/unit/palette-non-authority.test.ts`.

## WBV2-008 — PATTERN PORTFOLIO ROLE

`PatternPortfolio` remains Website-Bot-owned and represents synthesized,
transferable patterns. Competitive evidence informs the blueprint but does not
become design authority by itself.

*Enforced by:* the WBV2-019 ladder places `PatternPortfolio` below
`DesignReferenceIntelligence`; `assertBlueprintPatternRefs` still requires every
section pattern ref to resolve.

## WBV2-009 — PROVENANCE COMPLETENESS

Every sealed `WebsiteBuildBlueprintV2` must carry provenance sufficient to
identify the authoritative semantic inputs used to derive it:

- `provenance.competitive_landscape_ref` (content-addressed `ArtifactRef`)
- `provenance.baseline_digest`
- `provenance.client_vision_digest`
- `provenance.design_reference_intelligence_digest`
- `provenance.pattern_portfolio_digest`

A digest over a well-formed "not declared" record is complete provenance. A
placeholder, a constant, or an empty string is not.

*Enforced by:* `assertProvenanceCompleteness` (each digest must be 64 hex
chars and must equal the digest of the corresponding compiler input).

## WBV2-010 — BLUEPRINT DESIGN AUTHORITY

`WebsiteBuildBlueprintV2` owns strategy, design direction, route structure,
section intent, content slots, proof requirements, conversion intent, visual
requirement intent, and acceptance tests. Asset planning chooses **which**
eligible asset satisfies a blueprint requirement; it may not decide **whether**
the blueprint requires imagery.

*Enforced by:* `ImageAssetPlanningStage` fails closed without the sealed
blueprint and merges spec slots only where the blueprint claims neither the id
nor the placement.

## WBV2-011 — SEO AUTHORITY PRESERVATION

SEO-Bot continues to own `CompetitiveLandscape`, `SEOContentBlueprint`, and
`StructuredContentPackage`. `WebsiteBuildBlueprintV2` must not absorb SEO-Bot's
independent content authority.

*Enforced by:* `SEOContentBlueprintRequest` still carries route identity and
verified business truth only; `tests/build-intelligence/seo-content-blueprint.test.ts`
(SEO-Bot) asserts the landscape is the sole input ref.

## WBV2-012 — PAGE CONTRACT DETERMINISM

`PageContentContract` remains a deterministic Website-Bot compiler artifact. No
LLM merge step may be introduced between `WebsiteBuildBlueprintV2` and
`SEOContentBlueprint`.

*Enforced by:* `compilePageContentContract` is a pure function with no LLM
handle in scope; `ctx.redesignEvidence.pageContentContractLlmCalls` is asserted
zero.

## WBV2-013 — PROVIDER ROUTING BOUNDARY

Application stages may not select provider/model. LLM-Router remains
provider/model authority.

*Enforced by:* `scripts/validate-llm-wiring.mjs` (part of `verify:all`).

## WBV2-014 — INTEROP SINGLE SOURCE PARITY

Every vendored copy of `bot-interop` participating in this seam must be
digest-identical for the canonical interop source set
(`packages/bot-interop/src/*.ts`). Distribution-only fields such as
`publishConfig` are outside the canonical set.

*Enforced by:* `scripts/validate-interop-parity.mjs` in both repos, comparing
per-file sha256 against the identical committed manifest
(`contracts/BOT_INTEROP_PARITY.json`). Two repos that both pass are thereby
proven identical to each other offline, with no cross-repo checkout.

Wiring differs by repo, and both paths run under `verify:all`:
- **Website-Bot** — the `interop:parity` npm script, called directly by
  `verify:all`.
- **SEO-Bot** — `tests/build-intelligence/design-blindness.test.ts` asserts
  every file digest against the manifest, and the test suite is itself a
  `verify:all` step. The standalone script is present and runnable
  (`node scripts/validate-interop-parity.mjs`) but is deliberately not wired
  into that repo's `package.json`, so this contract adds no edit to a file
  several unrelated open PRs are already changing.

## WBV2-015 — NO DUAL-RUNTIME COMPATIBILITY

There is no runtime negotiation between V1 and V2: no union input type, no
fallback parser, no feature flag selecting V1, no schema downgrade, no
conversion shim used by production, no legacy producer mode.

*Enforced by:* `scripts/validate-blueprint-v1-eradication.mjs`, which also
rejects the suspicious-compatibility identifiers
(`legacyBlueprint`, `upgradeBlueprint`, `downgradeBlueprint`, `compatBlueprint`).

## WBV2-016 — V1 VALUE EXTRACTION BEFORE DELETION

Before deleting a V1 implementation surface, every legitimate semantic
guarantee it carries must be identified and proven present in V2. Deletion
without a traced replacement is forbidden.

*Recorded in:* `docs/architecture/website-build-blueprint-v1-value-extraction.md`.

## WBV2-017 — V1 REMOVAL COMPLETENESS

Repository-wide search for `WebsiteBuildBlueprintV1` and
`website-build-blueprint/v1` must return no active implementation, runtime,
fixture, test, export, or consumer reference. Historical ADR prose may mention
V1 only as superseded architecture.

*Enforced by:* `scripts/validate-blueprint-v1-eradication.mjs`, which allows
matches only in an explicit, enumerated historical-document list.

## WBV2-018 — FAIL CLOSED

Missing required `ClientVision`, `DesignReferenceIntelligence`, competitive
lineage, pattern provenance, route consistency, or blueprint integrity must
produce an explicit typed failure. Fake provenance must never be synthesized,
and V1 behavior must never be used as a fallback.

*Enforced by:* `BlueprintCompileError` with a closed code set; every compiler
assertion throws rather than defaulting.

## WBV2-019 — DESIGN INPUT PRIORITY

```
explicit first-party constraint
  > explicit ClientVision preference
  > accepted DesignReferenceIntelligence
  > synthesized PatternPortfolio
  > generic model preference
```

No lower authority may overwrite a higher authority silently.

*Enforced by:* `resolveDesignDirection` composes strictly in ladder order and
records each attribute's origin; `tests/unit/client-vision-authority.test.ts`.

## WBV2-020 — BLUEPRINT BEFORE REALIZATION

No redesign realization stage may make material design decisions that the
blueprint should have made. Downstream stages realize, validate, or satisfy the
blueprint.

*Enforced by:* `ImageAssetPlanningStage` and `DesignIntelligenceStage` both
fail closed under `REDESIGN_IMPROVE` without the sealed blueprint.

---

## Discovered in executable V1 behavior

The following were live V1 guarantees with no written invariant. They are
locked here so the migration cannot silently drop them.

## WBV2-021 — ROUTE IDENTITY IS SPEC-OWNED

The blueprint's route set must equal the `DomainSpec` route set exactly, and
each route's `path` and `purpose` come from the spec, never from a model. A
model may choose sections, objectives, content slots, pattern refs, and proof
requirements — never route identity.

*Enforced by:* the compiler re-asserts route identity from the spec before
sealing, and `assertBlueprintRouteSet` rejects any divergence.

## WBV2-022 — CANONICAL SLOT COVERAGE AND SECTION PARITY

Every sealed route must expose the full canonical `ContentSlot` set, and a
route must carry at least as many sections as the spec declares components.
Both exist because a sparse model response otherwise makes a valid required SEO
requirement structurally unplaceable, or makes structured-content projection
impossible.

*Enforced by:* `ensureCanonicalSlotCoverage` (retained from V1 unchanged) and
`tests/unit/website-build-blueprint-compiler.test.ts`.
