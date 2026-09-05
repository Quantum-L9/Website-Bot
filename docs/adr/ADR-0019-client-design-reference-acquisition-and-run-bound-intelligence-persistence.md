<!-- L9_META: layer=architecture, role=design_reference_acquisition_adr, status=accepted, version=1.0.0 -->
# ADR-0019: Client Design Reference Acquisition, Run-Bound Intelligence Persistence, and Rendered-Site Validation

## Status
Accepted.

## Date
2026-09-03

## Context

The Quantum AI Partners clean capability test (2026-09-01, tracked under
`reports/test-runs/quantum-ai-partners-20260901/`) stopped at
`seo-build-intelligence-preflight` because no SEO-Bot was listening. The
forensic re-audit against the code that produced it (`9a4a156`) and the
current head confirmed three repository-owned gaps that would have blocked
the run even with SEO-Bot reachable:

1. **GAP-1 — client references were descriptions, not inputs.**
   `DesignReferenceSpec.principles` had to be operator-authored;
   `deriveDesignReferenceIntelligence` merged spec-declared principles only,
   so five client URLs with verbatim reactions contributed nothing to the
   sealed design direction. The only crawl/screenshot machinery
   (`HttpDonorIngestor`) served SEO-Bot SERP-selected donors.
2. **GAP-3 — paid intelligence lived only in process memory.** The CLI wrote
   `website-build-blueprint.json` and `page-content-contract.json` and nothing
   else; `CompetitiveLandscape`, `SEOContentBlueprint`,
   `StructuredContentPackage`, `ClientVision`, `DesignReferenceSet` and
   `DesignReferenceIntelligence` were lost on exit, and a benchmark driver
   had to capture them in-process.
3. **Build was terminal.** `local-proof` ended at `site-build` (`astro build`
   plus route-file assertions). Nothing rendered the built site; the only
   browser validation (`visual-qa`) ran after a Vercel deploy.

GAP-2 (`normalize-spec.ts` dropping `build_intent`, `client_vision`,
`design_references`) was already repaired at head by `7346b1e` and is covered
by regression tests; it is not re-decided here.

## Decision

### 1. `design-reference-acquisition` is a mandatory REDESIGN_IMPROVE stage

`src/stages/DesignReferenceAcquisitionStage.ts` runs after
`seo-build-intelligence-preflight` and before `competitive-intelligence`.
For every accepted `design_references[]` entry with a URL it:

- fetches the page through the same SSRF policy and `HttpPageFetcher` the
  source-site crawler uses (redirects re-validated per hop, resolved
  addresses checked);
- stores the raw page and an extraction as **evidence** under
  `build/assets/<client>/<build>/design-reference-evidence/<id>/` and takes a
  best-effort Playwright screenshot;
- reduces the page to deterministic, abstract `ObservedDesignCharacteristics`
  (hierarchy, density, motion signals, media emphasis, conversion prominence,
  palette characteristics) — a type with no field able to carry markup, CSS,
  prose or a color literal;
- asks the governed LLM (`DESIGN_REFERENCE_ANALYSIS`, strategic reasoning, no
  search) to interpret the **observed evidence** relative to the **client's
  reaction**, explicitly labelled as preference rather than observation;
- guards the output mechanically with `assertNoRawExpressionTransfer`
  (WBV2-004) and a copy-transfer guard rejecting any principle that
  reproduces the reference's title or headings.

Derived principles are unioned with operator-authored ones on the
`DesignReference`, which now records `acquisition` (status, final URL,
content digest, failure reason), `principle_source` and an `analysis` block.
The set's provenance becomes `domain_spec+acquisition`. Everything downstream
(`deriveDesignReferenceIntelligence`, `resolveDesignDirection`, the V2
compiler, provenance digests) is unchanged and now receives real evidence.

`CompetitiveIntelligenceStage` consumes the resolved authorities from the
context. Resolving from the spec is permitted only when no accepted reference
carries a URL; a spec that declares URLs without acquisition evidence fails
closed with `DESIGN_REFERENCE_UNACQUIRED`.

**Policy:** a reference without a URL contributes operator-authored
principles only; an unreachable, erroring, non-HTML, invalid or forbidden
URL is recorded with its reason and contributes operator-authored principles
only; when every URL-bearing reference fails, the run fails with
`DESIGN_REFERENCE_UNACQUIRED`. Partial acquisition is honest and allowed;
`design-reference-acquisition.json` is the ledger.

### 2. Redesign intelligence is persisted through one run-bound store

`src/pipeline/evidence/RedesignIntelligenceArtifacts.ts` owns
`build/assets/<client>/<build>/redesign-intelligence/` with an `index.json`
(`website-bot.redesign-intelligence-index/v1`) carrying run identity,
per-file sha256 digests and, for sealed artifacts, artifact id, payload
digest and input refs. Every producing stage persists at acceptance:

| Artifact | Persisted by |
|---|---|
| `client-vision`, `design-reference-acquisition`, `design-reference-set`, `design-reference-intelligence` | `design-reference-acquisition` |
| `competitive-landscape`, `seo-bot-ordering`, `accepted-donors`, `website-build-blueprint` | `competitive-intelligence` |
| `seo-content-blueprint`, `page-content-contract`, `pcc-determinism`, `structured-content-package`, `redesign-counters` | `redesign-content-authority` |
| `redesign-integrity-receipt` | `redesign-integrity-receipt` |

Reload is fail-closed (`REDESIGN_ARTIFACT_INVALID`): file digest, sealed
integrity, `(client_id, build_id)` identity and cross-artifact lineage
(landscape → blueprints → contract → package) are re-verified. On
`--resume`, the three producing stages hydrate from the store and skip their
paid work when the persisted chain for **this** build verifies. The legacy
`website-build-blueprint.json` / `page-content-contract.json` files under the
asset root are still written for the golden adapter.

### 3. `rendered-site-validation` is mandatory in every mode that builds

`src/stages/RenderedSiteValidationStage.ts` runs after `site-build` in
`local-proof`, `publish-proof` and `end-to-end`. It serves the persisted
`dist/` from a loopback static server and renders every spec route at
desktop (1440) and mobile (390) widths in headless Chromium, checking HTTP
status, title, single `<h1>`, `<main>` landmark, primary navigation, final
content, meta description, canonical, horizontal overflow, image loading and
alt text, internal link resolution against `dist/`, JSON-LD parseability,
console errors and failed same-origin requests, plus `robots.txt` and
`sitemap-index.xml`. The report (`website-bot.rendered-site-validation/v1`)
is written beside the run's evidence with full-page screenshots under the
asset root. Any failure, and an unavailable browser, is
`RENDERED_SITE_VALIDATION_FAILED` — never a skip. CI provisions Playwright
Chromium for Gate 5 and the local-proof workflow.

`scripts/validate-site-factory.ts --build` (`npm run site:validate:build`)
runs the same real build and render on the structural fixture with no LLM.

## Consequences

- A raw client brief (rich `domain_spec.source.yaml`, or the flat
  `DomainSpec` carrying only first-party language) is sufficient input: no
  operator hand-translation of references, no benchmark driver, no
  hand-authored internal artifact.
- Redesign builds spend one governed LLM call per acquired reference before
  the first paid SEO-Bot call; an unreachable SEO-Bot still fails the run
  before that spend because preflight runs first.
- Boundaries are unchanged: SEO-Bot stays design-blind (WBV2-002), the
  compiler still cannot express an `SEOContentBlueprint` input (WBV2-006),
  and observed palettes enter only as abstract characteristics (WBV2-007).

## Invariants added

| Id | Statement | Enforced by |
|---|---|---|
| DRA-001 | A client reference URL is acquired by repository code; operator-authored principles are optional. | `DesignReferenceAcquisitionStage`, `resolveDesignAuthorities` |
| DRA-002 | Derived principles never carry raw expression or verbatim reference copy. | `assertNoRawExpressionTransfer`, `assertNoReferenceCopyTransfer` |
| DRA-003 | The client's reaction is preference, never observation; preserved verbatim, never rewritten into principles. | prompt contract, `tests/unit/design-reference-acquisition.test.ts` |
| RIP-001 | Every sealed redesign artifact is persisted at acceptance with digest, identity and input refs. | `persistRedesignArtifact` call sites |
| RIP-002 | Reload verifies digest, integrity, identity and lineage; nothing falls back. | `loadRedesignArtifact`, `loadPersistedRedesignIntelligence` |
| RSV-001 | A build converges only after every route renders in a real browser at desktop and mobile widths. | `RenderedSiteValidationStage` in `MANDATORY` |

## Related
ADR-0002, ADR-0015, ADR-0016, ADR-0018; run pack
`reports/test-runs/quantum-ai-partners-20260901/`.
