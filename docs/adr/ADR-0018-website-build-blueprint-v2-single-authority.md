<!-- L9_META: layer=architecture, role=blueprint_v2_authority_adr, status=accepted, version=1.0.0 -->
# ADR-0018: WebsiteBuildBlueprintV2 as the Single Blueprint Authority

## Status
Accepted.

## Date
2026-09-01

## Supersession

This ADR supersedes every V1 architectural assumption that conflicts with it.
Specifically:

- **ADR-0004** (Competitive Pattern Harvest and Blueprint Gate) is amended: the
  gate, the bounded donor ingestion, the pattern portfolio, and the acceptance
  test requirement are all retained, but the artifact the gate seals is now
  `WebsiteBuildBlueprintV2`, and `CompetitiveLandscape` + `PatternPortfolio` are
  no longer the only semantic inputs. `ClientVision` and
  `DesignReferenceIntelligence` join them as first-class first-party
  authorities.
- **ADR-0002** (SEO-Bot build-time boundary) is unchanged in substance and
  re-affirmed here: SEO-Bot does not consume the website build blueprint.
- `contracts/WEBSITE_INTELLIGENCE_LOCK.json` is updated by this decision.

`WebsiteBuildBlueprintV1` is deprecated immediately by architectural decision
and removed from active code in the same change. It survives only as prose in
this ADR and in historical records that explain provenance.

## Context

The V1 blueprint had one semantic upstream that carried design weight:
`CompetitiveLandscape` (SEO-Bot's deterministic SERP evidence), plus a
`PatternPortfolio` synthesized from competitor crawl evidence. Two consequences
followed, and both were observable in the running system:

1. **The client had no represented voice.** Nothing in the sealed artifact
   recorded what the client actually asked for. Explicit client intent could
   not outrank an inferred observation, because explicit client intent was not
   a modelled input at all.

2. **Observed colors were becoming redesign decisions.**
   `DesignIntelligenceStage` read `sourceSiteManifest.palette` and wrote those
   exact values into `designTokens` and back into `DomainSpec.design.palette`
   for every build intent, `REDESIGN_IMPROVE` included. A "redesign" that
   deterministically inherits the source site's palette is a recolored copy.
   The blueprint — the artifact that is supposed to own design direction — had
   no say and no field to say it with.

The blueprint contract had also accumulated its responsibilities inside
`CompetitiveIntelligenceStage`, a stage that already owned SEO-Bot preflight,
landscape acquisition, bounded donor ingestion, per-donor LLM extraction, and
cross-donor synthesis. Blueprint compilation and its gate were the sixth
concern in one 900-line file.

## Decision

### 1. Exactly one active blueprint contract

The architecture has exactly one active website-build-blueprint contract:

```
WebsiteBuildBlueprintV2 — l9://website-intelligence/website-build-blueprint/v2
```

No production component may emit, consume, import, select, negotiate, or fall
back to `WebsiteBuildBlueprintV1`. There is no union type, no fallback parser,
no feature flag, no schema downgrade, no conversion shim, and no legacy
producer mode. The V1 schema URI is rejected.

`WebsiteBuildBlueprint` — the unqualified name — now means V2.

### 2. Protocol envelope is unchanged

`WEBSITE_INTELLIGENCE_PROTOCOL_VERSION` stays `"1.0"`. The
`IntelligenceArtifact<TType, TPayload>` envelope — protocol, artifact_type,
content-addressed `artifact_id`, `input_refs`, sha256 `integrity` — did not
change, and `CompetitiveLandscape`, `SEOContentBlueprint`,
`PageContentContract`, and `StructuredContentPackage` are not migrated by this
decision. Blueprint identity is carried where it belongs: in the blueprint
payload's own `schema` URI. Bumping the shared envelope version to express a
single artifact's revision would have forced four unmigrated artifacts through
a compatibility break they do not need.

### 3. Authority map

| Concern | Owner | Authority |
|---|---|---|
| `ClientVision` | Website-Bot | explicit client design intent |
| `DesignReferenceSet` | Website-Bot | accepted reference portfolio |
| `DesignReferenceIntelligence` | Website-Bot | abstracted design evidence and principles |
| `CompetitiveLandscape` | SEO-Bot | deterministic SERP / competitive evidence |
| `PatternPortfolio` | Website-Bot | synthesized transferable competitive patterns |
| `WebsiteBuildBlueprintV2` | Website-Bot | final pre-realization website design/build intent |
| `SEOContentBlueprint` | SEO-Bot | search/content strategy |
| `PageContentContract` | Website-Bot | deterministic reconciliation of structure, SEO requirements, verified business truth |
| `StructuredContentPackage` | SEO-Bot | final structured page copy satisfying the contract |
| `site_source_mutation` | Website-Bot | — |
| `provider_model_selection` | LLM-Router | — |

`ClientVision`, `DesignReferenceSet`, and `DesignReferenceIntelligence` are
Website-Bot-local types. They are deliberately **not** placed in
`@quantum-l9/bot-interop`: SEO-Bot stays design-blind by construction, unable
to import what it must not own. Only their provenance digests cross into the
sealed blueprint.

### 4. Dependency law

```
ClientVision ─────────────────────┐
DesignReferenceIntelligence ──────┤
CompetitiveLandscape ─────────────┼──► WebsiteBuildBlueprintV2
PatternPortfolio ─────────────────┤
DomainSpec / architecture truth ──┘
                                         │
                                         ▼
                             route identity / structure
                                         │
                             ┌───────────┴───────────┐
                             ▼                       ▼
                    SEOContentBlueprint      realization planning
                             │
                             ▼
                    PageContentContract
                             │
                             ▼
                 StructuredContentPackage
                             │
                             ▼
                    Website realization
```

`SEOContentBlueprint` MUST NOT become an upstream dependency of
`WebsiteBuildBlueprintV2`. No dependency cycle is permitted. SEO-Bot continues
to receive route identity and verified business truth, never the blueprint.

### 5. V2 philosophy

`WebsiteBuildBlueprintV2` is:

```
DECISIONS + PROVENANCE
```

It is not:

```
RAW EVIDENCE + EVERYTHING WE KNOW
```

Raw crawls, screenshots, reference-site content, donor markup, and complete
`ClientVision` source material remain with their owning planes. V2 carries
normalized decisions plus digests and content-addressed refs sufficient to
prove where each decision came from.

### 6. Palette non-authority

Observed source-site, donor-site, competitor-site, and design-reference-site
palettes are **non-authoritative** under `REDESIGN_IMPROVE`. Observed colors
must not deterministically become redesigned theme tokens.

- Allowed: abstract characteristics — `warm`, `restrained`, `dark-dominant`,
  `high-contrast`, `muted`, `editorial`.
- Forbidden: `donor_hex -> redesign_hex`, `source_primary_color ->
  redesign_primary_color`, `reference_palette -> authoritative_theme`.

A color becomes authoritative only through explicit `ClientVision` intent or
another explicit first-party design requirement. The blueprint records which of
the two it was, in `design_direction.palette_authority.source`; when neither
exists the source is `none` and the token set is empty, and downstream design
resolution must ask rather than inherit.

**`COPY` intent is explicitly out of scope for this rule.** Under `COPY` the
declared contract is faithful reconstruction
(`copy_mode.existing_reconstruction_semantics_preserved`), and preserving the
source palette is the correct behavior, not a leak. Palette non-authority is a
redesign invariant, because only a redesign claims to be a new design.

### 7. Blueprint design authority vs. realization

`WebsiteBuildBlueprintV2` owns strategy, design direction, route structure,
section intent, content slots, proof requirements, conversion intent, visual
requirement intent, and acceptance tests. Asset planning chooses **which**
eligible asset satisfies a requirement; it may not decide **whether** the
blueprint requires imagery. Downstream realization stages realize, validate, or
satisfy the blueprint. They do not quietly redesign it.

### 8. Design input priority

```
explicit first-party constraint
  > explicit ClientVision preference
  > accepted DesignReferenceIntelligence
  > synthesized PatternPortfolio
  > generic model preference
```

No lower authority may overwrite a higher authority silently.

### 9. Dedicated compiler

Blueprint compilation moves out of `CompetitiveIntelligenceStage` into
`src/intelligence/WebsiteBuildBlueprintCompiler.ts`. The compiler owns the
cross-plane consistency validation required to seal V2.
`CompetitiveIntelligenceStage` orchestrates acquisition and synthesis and hands
the compiler its inputs; it is no longer the permanent owner of redesign
intelligence.

## Consequences

- Every legitimate V1 guarantee is traced to a V2 replacement before deletion.
  The trace is recorded in
  [`docs/architecture/website-build-blueprint-v1-value-extraction.md`](../architecture/website-build-blueprint-v1-value-extraction.md).
- Provenance widens from three fields to five: the competitive landscape ref
  and baseline digest are joined by client-vision, design-reference-intelligence,
  and pattern-portfolio digests, all under one `provenance` block so
  completeness is checkable as a unit.
- A REDESIGN build whose spec declares no client vision and no first-party
  palette now reaches design resolution with `palette_authority.source ==
  "none"` instead of silently inheriting the source site's colors. That is a
  deliberate, visible behavior change and the point of the migration.
- Both repos ship the identical vendored `bot-interop` source. Parity is
  mechanically validated (`scripts/validate-interop-parity.mjs`) rather than
  documented as an intention.

## Invariants

Locked in [`docs/architecture/WEBSITE_BUILD_BLUEPRINT_V2_INVARIANTS.md`](../architecture/WEBSITE_BUILD_BLUEPRINT_V2_INVARIANTS.md)
as `WBV2-001` … `WBV2-022`.
