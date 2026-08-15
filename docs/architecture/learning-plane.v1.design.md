# Learning Plane v1 — Design Contract (Campaign 6)

Status: LOCKED (program GATE-002)
Campaign: `website-campaign-learning-loop-v1`
Design source: `.cursor-commands/WIP/Website Learning Loop.md`
(sha256 `46f45a64321b950923aa4845801dcae870b334fba2633f72c76775d287e69f9b`, 53105 B)

Every field below references an observed convention (baseline inspection of Website-Bot at
`3cc79d9a3cace532e34b3e0423dc8ddc0077107d`; golden-run corpus
`/Users/macm2/dev/website-bot-e2e-full-feature-20260813`) or is an explicit new definition. No field is
invented silently.

## 1. Purpose

The campaign, not the build, is the unit of work. This contract defines a thin, reference-heavy
learning plane over the existing content-addressed artifact DAG. The truth plane
(`BaselineSiteProfile`, `CompetitiveLandscape`, `DonorEvidence`, `PatternPortfolio`,
`BaselineMarketGap`, `WebsiteBuildBlueprint`, `SEOContentBlueprint`, `PageContentContract`,
`StructuredContentPackage`, `DesignArtifact`, `CandidateBuild`, `QualityDeltaReport`, `RepairPlan`)
stays authoritative and is not redefined here. Note from baseline observation: only
`CompetitiveLandscape`, `WebsiteBuildBlueprint`, `SEOContentBlueprint`, `PageContentContract`,
`StructuredContentPackage` have code-level envelope types
(`packages/bot-interop/src/website-intelligence.ts`); the rest exist only in ADRs. The learning plane
references logical artifact ids regardless, and never implements truth-plane artifacts.

## 2. Conventions inherited (observed)

- Artifact identity: `artifact_id = ${artifact_type}:${payload_digest}`;
  `payload_digest = sha256(canonicalJson(semanticBody(...)))` with input refs normalized
  (sorted by `artifact_type:artifact_id:payload_digest`); envelope
  `{protocol, protocol_version, artifact_type, artifact_id, client_id, build_id,
  producer{repo,version}, produced_at, input_refs, payload, integrity{algorithm,payload_digest}}`
  (`packages/bot-interop/src/website-intelligence.ts`, `handoff.ts` `canonicalJson` exported at
  `handoff.ts:91`).
- Digest canonicalization for the learning plane (DEC-002): the bot-interop convention — recursive
  key sort, `undefined` values dropped — implemented locally as `canonicalJsonStable` (see §6),
  because `packages/bot-interop/src/handoff.ts` `stableValue` semantics are the authority and
  `src/services/hashing.ts` deliberately differs (it keeps `undefined`).
- JSON documents carry `schema` + `schema_version` top-level keys (observed: evidence-index/v2,
  stage-checkpoint/v2, assembly-manifest/v2, handoff v3).
- Per-stage checkpoints already record `input_digest`/`output_digest` (observed:
  `run7/evidence/checkpoints/*.json`) — the memoization substrate this plane extends.

## 3. Storage layout (new, runtime-only)

Campaign root: `{--campaign-root | <repo>/.l9/campaigns}/<site>/<campaign-id>/`
(`.l9/` is gitignored — observed `.gitignore`). `<site>` is the source-URL hostname slug
(e.g. `safehavenrr`). Inside:

```text
baseline/                    immutable baseline evidence refs
candidates/C<n>/
  artifacts/                 build + dimension results
  mutation-plan.json         CandidateMutationPlan
  quality-delta.json         QualityDeltaIndex (aggregate over QualityDimensionResults)
  parent-ref.json            ArtifactRef to parent candidate
hypotheses/LH-<nnn>.json     hypothesis records
champion-history.json        append-only champion promotions
campaign-learning.json       LearningEvents index for the campaign
human-review.json            HumanReviewReceipt (created by campaign:review)
campaign-manifest.json       CampaignManifest — written ATOMICALLY (temp file + rename)
```

`campaign-manifest.json` is the single resume source of truth. A torn manifest is never loadable as
valid state (write-then-rename; load validates schema and recomputes its digest).

## 4. Six learning-plane artifacts

All learning-plane JSON files carry `schema` (e.g. `website-bot.campaign-manifest/v1`),
`schema_version`, and an `integrity` block `{algorithm: "sha256", payload_digest}`; their
`artifact_id` is `${artifact_type}:${payload_digest}` per §2. `ArtifactRef` values use the
bot-interop shape `{artifact_type, artifact_id, payload_digest}`.

### 4.1 CampaignManifest — `website-bot.campaign-manifest/v1`

```text
campaign_id, source_url, site_slug,
status: RUNNING | REVIEWABLE | EXHAUSTED | BLOCKED | APPROVED | REJECTED
convergence_target: REVIEWABLE
context_signature: ContextSignature            (signal, §5.1)
baseline_ref: ArtifactRef
champion: {candidate_id, build_ref: ArtifactRef, evaluation_ref: ArtifactRef}
attempts: {total_candidates, no_progress_rounds, blueprint_replans, content_regenerations,
           repairs_by_candidate}
budget: CampaignBudget                          (§10)
reviewable: boolean
created_at, updated_at (ISO-8601 UTC)
```

### 4.2 CandidateMutationPlan — `website-bot.candidate-mutation-plan/v1`

```text
artifact_type: CandidateMutationPlan
candidate_id, parent_candidate_id: string | null
mutation:
  layer: INITIAL | INTELLIGENCE | BLUEPRINT | CONTENT | DESIGN | ASSET | ASSEMBLY | REPAIR
  target_paths: string[]          (e.g. ["tokens.cta.primary.background"])
  forbidden_paths: string[]
  unchanged_contract: string[]    (artifact or path prefixes that MUST NOT change)
hypothesis:
  primary_dimension: string       (one quality-dimension key, §7)
  guardrail_dimensions: string[]
expected_causal_path: string[]    (ordered causal narrative)
expected_effects: {dimension: IMPROVED | NON_REGRESSED}
confidence_before: number 0..1
inherited_artifacts: {name: ArtifactRef}        (exact upstream refs to reuse)
experimental_control: {inherited_exact: ArtifactRef[], changed: string[]}
mutation_signature: MutationSignature            (signal, §5.2)
```

`assertMutationEnvelope(plan, buildDiff)`: rejects any build whose diff touches a `forbidden_path`
or a member of `unchanged_contract`, or whose layer implies an invalid frontier (§8). A plan missing
`hypothesis.primary_dimension`, `guardrail_dimensions`, or `experimental_control` is invalid.

### 4.3 CandidateEvaluation — `website-bot.candidate-evaluation/v1`

```text
candidate_id, campaign_id
evaluated_against: [BASELINE, CHAMPION]          (dual evaluation is mandatory)
dimension_results: QualityDimensionResult[]      (§7)
groups: {target: string[], guardrail: string[], side_effects: string[]}
failure_fingerprint: FailureFingerprint | null   (signal, §5.3)
champion_delta: ChampionDelta | null
reviewable: boolean                              (deterministic, §9)
disposition: CHAMPION | REJECTED | SUPERSEDED | REVIEWABLE
```

`ChampionDelta`: `{target_dimension: string, verdict_vs_champion: IMPROVED|REGRESSED|NON_REGRESSED,
material: boolean, utility_vs_champion: number, utility_vs_baseline: number}` where utility is a
deterministic count of improved minus regressed hard-gate dimensions (no invented aesthetic scores).

### 4.4 LearningEvent — `website-bot.learning-event/v1`

```text
learning_id: LE-<nnnnn>, artifact_type: LearningEvent
source: {campaign_id, candidate_id, parent_candidate_id}
context: {vertical, page_archetype, component, viewport, quality_dimension}   (from ContextSignature)
hypothesis: string
mutation_ref: ArtifactRef                       (the CandidateMutationPlan)
before: {quality_result: verdict}  after: {quality_result: verdict}
side_effects: {dimension: verdict}
outcome: CONFIRMED_FOR_CAMPAIGN | REJECTED | INCONCLUSIVE | CONTRADICTED
anti_pattern: {invariant: string} | null        (negative learning is first-class)
counterfactual_pair: CounterfactualPair | null  (signal, §5.4)
attribution_feedback: {original_layer, actual_layer, original_confidence,
                       result: MISATTRIBUTED | CONFIRMED} | null
scope_recommendation: RUN_LOCAL | SITE_CAMPAIGN | VERTICAL | GLOBAL
evidence_refs: ArtifactRef[] | string[]         (evidence references)
confidence: {class: LOW | MEDIUM | HIGH,
             causal_isolation: boolean, confirmations: number, contradictions: number,
             human_approval_correlation: number, context_similarity: number}
```

One run may create a hypothesis; it may not create a high-confidence global learning.

### 4.5 PromotionCandidate — `website-bot.promotion-candidate/v1`

```text
promotion_id, learning_ids: string[]
scope: SITE | VERTICAL | GLOBAL
vertical: string | null
supporting_campaigns: string[], contradicting_campaigns: string[]
wins, losses, inconclusive: number
human_approved_campaigns: number
confidence: LOW | MEDIUM | HIGH
owning_component: string
proposed_invariant: string
acceptance_test: string
risk: string
human_approval_required: boolean
status: PROPOSED | APPROVED_BY_HUMAN | REJECTED
```

Promotion is proposal-only. `GLOBAL_CONFIRMED` requires repeated evidence across independent sites
or explicit human approval. The runtime never self-modifies prompts or canonical heuristics.

### 4.6 HumanReviewReceipt — `website-bot.human-review-receipt/v1`

```text
receipt_id, campaign_id, candidate_id
decision: APPROVED | REJECTED | APPROVE_WITH_NOTES
positives: string[], negatives: string[], blocking_negatives: string[]
preference_signals: string[]
tags: string[]                  (generic | weak_branding | weak_hero | too_busy | too_sparse |
                                 great_hierarchy | great_conversion | great_mobile)
human_machine_gap: HumanMachineGap | null        (signal, §5.5)
created_at
```

A `REJECTED` receipt on a machine-`REVIEWABLE` candidate produces a `HumanMachineGap` naming
unmeasured signal candidates (e.g. `brand_distinction`) — gaps propose new measurable dimensions;
they never edit prompts.

## 5. Five signal structures

### 5.1 ContextSignature

```text
vertical, market_model, conversion_model, consideration_level, service_complexity,
location_strategy, trust_dependency, page_archetypes: string[], brand_maturity, baseline_quality
```

Tells where a learning applies; the ranking input for retrieval (§12).

### 5.2 MutationSignature

```text
layer, archetype, component,
operation_class: string          (normalized, e.g. INCREASE_PRIMARY_ACTION_SALIENCE —
                                 literal edits like "#3D842C -> #166534" are evidence, never the signal)
dimensions: {target: string[], guardrails: string[]}
context: {vertical, conversion_model, mobile_priority}
```

### 5.3 FailureFingerprint

```text
dimensions: {dimension: verdict}
location: {page_archetype, component, viewport}
structural_state: {cta_count, proof_elements, heading_levels}   (deterministic measurements, §7)
suspected_layer: mutation-layer
```

Built from QualityDimensionResults; used as a retrieval key (§12).

### 5.4 CounterfactualPair

```text
before_candidate, after_candidate: string
controlled_differences: string[]   (e.g. ["DesignArtifact.hero.primary_action"])
unchanged: string[]                (content, topology, SEO, donor intelligence)
quality_movements: {dimension: verdict}
```

Persisted for every champion/challenger relationship.

### 5.5 HumanMachineGap

```text
human_reason: string
machine_quality: {dimension: verdict}     (what the machine measured)
unmeasured_signal_candidate: string       (e.g. brand_distinction)
```

## 6. Incremental reuse: semantic_input_digest

`semantic_input_digest = sha256(canonicalJsonStable({stage_version,
input_artifact_refs_sorted, configuration}))`

- `canonicalJsonStable`: recursive key sort with `localeCompare`, `undefined` values dropped —
  mirroring bot-interop `stableValue` semantics (DEC-002); exported from the learning-plane module.
- Same digest ⇒ reuse the exact artifact (its recorded `artifact_id`/`payload_digest` must match;
  completed content-addressed artifacts are never recomputed).
- Different digest ⇒ recompute.
- Every candidate records `experimental_control` from the reuse decision: `inherited_exact` refs are
  the control group, `changed` refs the intervention — this feeds the LearningEvent confidence.

## 7. QualityDimensionResult and the aggregate index

`QualityDimensionResult` — `website-bot.quality-dimension-result/v1` (atomic, hashable, queryable):

```text
dimension: string            (keys below)
baseline: {evidence_ref}  champion: {evidence_ref}  challenger: {evidence_ref}
verdict_vs_baseline: IMPROVED | REGRESSED | NON_REGRESSED
verdict_vs_champion: IMPROVED | REGRESSED | NON_REGRESSED
hard_gate: boolean
evidence: string[]            (screenshot/dom-probe refs; observed evidence-reference style)
responsible_layer: mutation-layer
confidence: LOW | MEDIUM | HIGH
measurements: {name: number} (deterministic measurements only, below)
status: PASS | FAIL | INCONCLUSIVE
```

Deterministic measurements permitted (design source list): `contrast_ratio`, `dom_depth`,
`cta_count`, `scroll_depth`, `lcp`, `heading_count`, `link_errors`, `viewport_overflow_pixels`,
`asset_weight`, `content_requirement_coverage`. Subjective aesthetics carry verdicts only — never
invented numeric scores.

Quality dimensions (locked key list): `business.fact_accuracy`, `architecture.route_coverage`,
`architecture.section_conformance`, `content.requirement_coverage`, `content.unsupported_claims`,
`seo.metadata`, `seo.internal_links`, `seo.intent_alignment`, `conversion.primary_cta`,
`conversion.mobile_cta`, `conversion.trust_visibility`, `visual.hierarchy`, `visual.legibility`,
`visual.spacing`, `visual.coherence`, `visual.brand_distinction`, `responsive.overflow`,
`responsive.navigation`, `responsive.touch_targets`, `accessibility.contrast`,
`accessibility.structure`, `performance.asset_weight`, `runtime.broken_links`,
`runtime.asset_failures`.

`QualityDeltaIndex` — `website-bot.quality-delta-index/v1` (aggregate, stored as
`quality-delta.json`): `{campaign_id, candidate_id, results: QualityDimensionResult[],
aggregate: {hard_gate_failures: string[], regressions_vs_baseline: string[],
regressions_vs_champion: string[], inconclusive: string[]}}`. It is the index a future
truth-plane `QualityDeltaReport` producer consumes; it does not redefine the ADR-0005 report.

## 8. Invalidation frontier (per mutation layer)

| Layer | Reuse | Invalidate |
|---|---|---|
| INITIAL | — | everything (cold start) |
| INTELLIGENCE | — | intelligence outputs onward (donor evidence, pattern portfolio, gap, blueprints, content, design, assembly, build, quality) |
| BLUEPRINT | intelligence (donor, patterns, landscape, gap) | WebsiteBuildBlueprint, PageContentContract, StructuredContentPackage, DesignArtifact, assembly, build, quality |
| CONTENT | intelligence + blueprints | PageContentContract/StructuredContentPackage, design, assembly, build, quality |
| DESIGN | intelligence, blueprints, content contract, structured content | DesignArtifact, affected assembly, affected screenshots, affected QualityDimensionResults |
| ASSET | all upstream | asset plan/manifest, assembly, screenshots, quality |
| ASSEMBLY | all upstream | assembly output, build, screenshots, quality |
| REPAIR | everything not repaired | the repaired artifact and its downstream only |

Enforcement: the frontier is computed from `CandidateMutationPlan.mutation.layer`; a DESIGN mutation
must not trigger donor crawl, DataForSEO, pattern synthesis, or content generation (conformance
gate GATE-005). If a BLUEPRINT mutation actually changes inputs relevant to intelligence, the layer
is reclassified INTELLIGENCE. Reuse is recorded as `experimental_control`.

## 9. Deterministic REVIEWABLE gate

`REVIEWABLE` is a pure boolean over `QualityDeltaIndex` + campaign state:

```text
REVIEWABLE =
    build == PASS
AND business_truth == PASS          (business.fact_accuracy PASS)
AND artifact_lineage == PASS        (every inherited ref resolves; digests verified)
AND blueprint_conformance == PASS   (architecture.route_coverage + section_conformance PASS)
AND seo_content_contract == PASS    (seo.metadata + internal_links + intent_alignment PASS)
AND no blocking accessibility regression   (accessibility.* status != FAIL)
AND no blocking responsive regression      (responsive.* status != FAIL)
AND conversion_clarity IN {IMPROVED, NON_REGRESSED}
AND visual_hierarchy  IN {IMPROVED, NON_REGRESSED}
AND trust_presentation IN {IMPROVED, NON_REGRESSED}
AND no hard-gate dimension FAIL
AND no hard-gate dimension INCONCLUSIVE
AND candidate >= champion            (no regression vs champion on any hard-gate dimension)
AND campaign confidence sufficient  (no unknown blocking verdicts)
```

Subjective dimensions may be judged by vision or reasoning models upstream, but the final boolean is
deterministic: identical inputs ⇒ identical output (test `TASK-028` determinism suite). QualityDelta
PASS means technically acceptable; REVIEWABLE means worth the operator's time. Exhaustion produces an
operator escalation (best candidate, persistent blocking dimension, earliest responsible layer,
attempt count, recommendation) — never a normal design review of a non-reviewable candidate.

## 10. Budgets, runner, no-progress

CampaignBudget (defaults): `max_candidate_builds: 4`, `max_targeted_repairs_per_candidate: 1`,
`max_blueprint_replans: 1`, `max_content_regenerations: 1`, `stop_after_no_improvement_rounds: 2`,
`require_reviewable: true`.

Runner terminal states: `REVIEWABLE | EXHAUSTED | BLOCKED | NO_PROGRESS | FATAL`. Central loop:
load manifest (assert integrity) → evaluate champion incrementally → REVIEWABLE? stop : diagnose
earliest responsible failure → retrieve learnings → propose bounded hypothesis → assert envelope →
build incrementally (frontier reuse) → cheapest adequate test → promote only if challenger beats
champion on the promotion predicate → persist atomically → loop.

Champion promotion predicate (all required): target dimension materially improves; all hard gates
pass; no new blocking regression; absolute baseline comparison still passes; challenger utility >
champion utility. Champion is immutable; challenger failure never destroys it.

No-progress: counts when a challenger does not beat the champion, the same failure fingerprint
persists, or a repair yields no material target improvement. Two rounds trip attribution
reconsideration and emit an `attribution_feedback` LearningEvent.

## 11. Test ladder (early rejection)

- Level 0 — artifact, lineage, business facts, route compatibility, content slots, forbidden claims
  (schema + digest validation over CandidateMutationPlan and referenced artifacts; milliseconds).
- Level 1 — affected component probes at relevant viewports (renders/probes restricted to the
  components the mutation touches).
- Level 2 — sentinel routes: one page per page archetype selected dynamically from the blueprint;
  desktop/mobile/accessibility/visual/conversion probes.
- Level 3 — full candidate build (only for challengers that cleared Levels 0–2).
- Level 4 — full QualityDelta + reviewability.

Any failed level stops that challenger. Levels 1–3 accept probe providers; the default providers
evaluate available dimension results and evidence refs (observed corpus shapes); full rendering
probes are campaign-runtime providers, out of scope for this program (live customer campaign
execution is excluded).

## 12. LearningRegistry, promotion ladder, retrieval

Promotion states: `CAMPAIGN_LOCAL → SITE_CONFIRMED → VERTICAL_CANDIDATE → VERTICAL_CONFIRMED →
GLOBAL_CANDIDATE → GLOBAL_CONFIRMED`. Memory scopes: `RUN_LOCAL → SITE_CAMPAIGN → VERTICAL → GLOBAL`.

Retrieval is problem-first, not website-first. Keys (all six): `responsible_layer`,
`quality_dimension`, `page_archetype`, `component`, `vertical`, `failure_fingerprint`. Ranking:
context-signature similarity vs the querying campaign. Normal source: PROMOTED plus high-confidence
LEARNING. Exploit when confidence is high; explore with two bounded competing hypotheses at cheap
test levels when low. Priority:
`(expected_improvement * success_probability) + learning_value − execution_cost − regression_risk`.

## 13. CLI surface (four everyday commands)

```text
npm run campaign -- --source=<url> --until=reviewable [--max-candidates=<n>] [--max-no-progress=<n>] [--watch]
npm run campaign -- --campaign=<id> --until=reviewable
npm run campaign:status -- --campaign=<id>
npm run campaign:review -- --campaign=<id>
```

Flag parsing accepts both `--name=value` (repo-idiomatic, DEC-003) and space-separated forms.
`--watch` prints progress events only (`[hh:mm:ss] BASELINE reused`, `CHAMPION C1`, `FAILURE
visual.hierarchy / hero / mobile`, `PROBE PASS`, `PROMOTE C2`, `CONVERGED REVIEWABLE`, ...) and never
changes runtime semantics. Normal use requires no flags beyond `--source` and `--until`.
Implementation: flat scripts following the repo convention (`scripts/campaign.ts`,
`scripts/campaign-status.ts`, `scripts/campaign-review.ts`) wired in `package.json`.

## 14. Determinism contract (all implemented as tests)

1. reviewable predicate is deterministic for identical inputs
2. repeated evaluation yields the same semantic identity
3. manifest writes are atomic
4. campaign resumes from persisted state after process death
5. completed content-addressed artifacts are not recomputed
6. a design mutation does not trigger donor / DataForSEO / pattern synthesis
7. a blueprint mutation invalidates downstream content and design
8. forbidden-path mutation is rejected before build
9. champion remains immutable after a failed challenger
10. unknowns and inconclusives do not disappear between runs
11. checkout path does not change semantic identity
