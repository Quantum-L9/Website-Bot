
One deliberate detail: each starts `preflight_blocked` because I will not fabricate a commit SHA. **Cursor must replace `<CAPTURE_FULL_SHA_BEFORE_EXECUTION>` and the baseline hashes with actual values before changing status to executable.**

```yaml
plan:
  metadata:
    plan_id: website-bot.push-1.real-seo-transaction.v1
    name: "Website-Bot Push 1 — Real SEO-Bot ↔ Website-Bot Intelligence Transaction"
    overview: >
      Implement and prove the real build-time intelligence transaction between
      Website-Bot and SEO-Bot using the accepted l9.website-intelligence/v1 seam.
      Website-Bot must obtain and validate a real CompetitiveLandscape, obtain
      and validate a real SEOContentBlueprint referencing that exact landscape,
      deterministically compile and seal a PageContentContract using a controlled
      integration-only WebsiteBuildBlueprint seam probe, send the exact sealed
      contract to SEO-Bot, receive a real StructuredContentPackage, and verify
      exact contract lineage. This push proves transport, shared contracts,
      deterministic reconciliation, artifact integrity, authentication,
      fail-closed behavior, and cross-repo cooperation. It does not implement
      donor intelligence, production WebsiteBuildBlueprint generation, design,
      assembly, quality delta, repair, or deployment.
    schema_version: 1.0.0
    status: preflight_blocked
    is_project: true
    owner: "Cursor under operator control"
    created_at: "2026-08-14"

  todos:
    - id: P1-00
      content: >
        Capture immutable Website-Bot and SEO-Bot baselines, verify shared
        protocol/package compatibility, inspect the landed SEO-Bot
        NEXT_WEBSITE_BOT_INPUTS contract, and prove required services and
        credentials are available before mutation.
      status: blocked
      phase: preflight
      evidence_property_refs:
        - P1-E01
        - P1-E02
        - P1-E03

    - id: P1-01
      content: >
        Implement or complete the Website-Bot SeoBuildIntelligencePort and one
        canonical HTTP transport adapter using SEO-Bot's actual landed API,
        authentication, timeout, retry, request, response, and error contracts.
      status: pending
      phase: transport
      depends_on:
        - P1-00
      evidence_property_refs:
        - P1-E04
        - P1-E05

    - id: P1-02
      content: >
        Request a real CompetitiveLandscape from SEO-Bot and validate its
        protocol, schema, integrity seal, artifact type, client/build identity,
        selected-donor evidence, and usability as the canonical competitive
        input for this transaction.
      status: pending
      phase: competitive_landscape
      depends_on:
        - P1-01
      evidence_property_refs:
        - P1-E06

    - id: P1-03
      content: >
        Request a real SEOContentBlueprint using the exact CompetitiveLandscape,
        production-like route identities/purposes, and verified business facts;
        validate schema, integrity, and exact CompetitiveLandscape lineage.
      status: pending
      phase: seo_blueprint
      depends_on:
        - P1-02
      evidence_property_refs:
        - P1-E07
        - P1-E08

    - id: P1-04
      content: >
        Create and seal one integration-only WebsiteBuildBlueprint seam probe
        referencing the exact real CompetitiveLandscape and route identities.
        Keep it outside production runtime and prohibit production imports.
      status: pending
      phase: seam_probe
      depends_on:
        - P1-03
      evidence_property_refs:
        - P1-E09

    - id: P1-05
      content: >
        Deterministically compile and seal PageContentContract from the
        integration-only WebsiteBuildBlueprint seam probe, the real
        SEOContentBlueprint, and verified business facts; prove repeated
        compilation yields identical semantic identity and zero LLM calls.
      status: pending
      phase: deterministic_contract
      depends_on:
        - P1-04
      evidence_property_refs:
        - P1-E10
        - P1-E11

    - id: P1-06
      content: >
        Send the exact sealed PageContentContract to real SEO-Bot, receive a
        real StructuredContentPackage, and validate its schema, integrity,
        content-validation status, and exact PageContentContract lineage.
      status: pending
      phase: structured_content
      depends_on:
        - P1-05
      evidence_property_refs:
        - P1-E12
        - P1-E13

    - id: P1-07
      content: >
        Execute adversarial integration tests covering authentication failure,
        malformed responses, tampered artifacts, mismatched landscape lineage,
        incompatible routes, stale/wrong content-contract refs, SEO-Bot outage,
        retry bounds, and the prohibition on Website-Bot generic final-copy
        fallback.
      status: pending
      phase: negative_validation
      depends_on:
        - P1-06
      evidence_property_refs:
        - P1-E14
        - P1-E15
        - P1-E16

    - id: P1-08
      content: >
        Run one controlled real cross-repo transaction with no mocked SEO-Bot
        endpoints, persist the complete Push-1 artifact-chain receipt, run
        canonical repository validation, and issue the Push-1 gate verdict.
      status: pending
      phase: convergence
      depends_on:
        - P1-07
      evidence_property_refs:
        - P1-E17
        - P1-E18

  architect_framing:
    planning_ssot: >
      Accepted five-push Website-Bot execution sequence,
      l9.website-intelligence/v1 contracts,
      WEBSITE_INTELLIGENCE_LOCK.json,
      installed @quantum-l9/bot-interop contract surface,
      and the landed SEO-Bot build-intelligence API.
    plan_class: integration_plan
    redesign_allowed: false
    follow_on_schema_evolution_separate: true
    framing_notes: >
      This push proves only the real Website-Bot ↔ SEO-Bot seam. The
      WebsiteBuildBlueprint used here is an integration-only seam probe because
      its real producer belongs to Push 2. The probe may exercise the canonical
      deterministic PageContentContract compiler but may never enter the
      production design/build path. Any genuine shared-contract collision stops
      execution and requires a separate remediation decision rather than local
      duplicate types or architecture invention.

  immutable_baseline:
    captured_at: null
    repository: "Quantum-L9/Website-Bot + read-only Quantum-L9/SEO-Bot integration target"
    workspace: "active Cursor worktrees"
    ssot_clone: "operator-selected Website-Bot and SEO-Bot clones"
    branch: "<CAPTURE_WEBSITE_BOT_BRANCH_AT_PREFLIGHT>"
    commit_sha: "<CAPTURE_WEBSITE_BOT_FULL_SHA_BEFORE_EXECUTION>"
    dirty: false
    artifact_hashes:
      website_bot_commit: "<CAPTURE_WEBSITE_BOT_FULL_SHA>"
      seo_bot_commit: "<CAPTURE_SEO_BOT_FULL_SHA>"
      WEBSITE_INTELLIGENCE_LOCK.json: "<CAPTURE_SHA256>"
      bot_interop_contract_surface: "<CAPTURE_SHA256>"
      page_content_contract_compiler: "<CAPTURE_SHA256>"
      seo_bot_next_website_bot_inputs: "<CAPTURE_SHA256_OR_SOURCE_HASH>"
      seo_bot_build_intelligence_api_surface: "<CAPTURE_SHA256>"
    allowed_local_dirt: []
    overlap_policy: stop_if_dirty_overlaps_may_modify
    verification_rule: reverify_at_execution_start
    on_drift: stop_and_replan

  objective:
    mission: >
      Prove a real, cryptographically traceable, fail-closed build-time
      transaction between Website-Bot and SEO-Bot from CompetitiveLandscape
      through StructuredContentPackage without provider leakage, duplicate wire
      contracts, generic Website-Bot content fallback, or non-deterministic
      PageContentContract reconciliation.

    success_properties:
      - id: P1-S01
        property: >
          Website-Bot communicates with SEO-Bot only through the canonical
          SeoBuildIntelligencePort and one transport adapter.
        evidence_type: structural
        proof: >
          Import/reference audit proves stages do not directly call SEO-Bot HTTP
          endpoints and transport concerns are centralized.
        blocking: true

      - id: P1-S02
        property: >
          Website-Bot receives and accepts a real CompetitiveLandscape only
          after shared-schema and integrity validation.
        evidence_type: network_observation
        proof: >
          Real SEO-Bot transaction returns a sealed CompetitiveLandscape whose
          artifact identity validates and whose selected donors resolve to source
          observations.
        blocking: true

      - id: P1-S03
        property: >
          SEOContentBlueprint references the exact CompetitiveLandscape used in
          the transaction.
        evidence_type: proof_receipt
        proof: >
          artifact_type, artifact_id, and payload_digest match exactly.
        blocking: true

      - id: P1-S04
        property: >
          The integration-only WebsiteBuildBlueprint seam probe references the
          exact same CompetitiveLandscape and cannot enter production runtime.
        evidence_type: structural
        proof: >
          Integration fixture/harness and production-import guard prove exact
          lineage and non-production isolation.
        blocking: true

      - id: P1-S05
        property: >
          PageContentContract compilation is deterministic and invokes no LLM.
        evidence_type: runtime_behavior
        proof: >
          Repeated equivalent inputs produce identical canonical payload,
          semantic digest, and artifact ID while an LLM invocation trap remains
          at zero.
        blocking: true

      - id: P1-S06
        property: >
          StructuredContentPackage references the exact sealed
          PageContentContract sent to SEO-Bot.
        evidence_type: proof_receipt
        proof: >
          Full ArtifactRef equality is verified before Website-Bot acceptance.
        blocking: true

      - id: P1-S07
        property: >
          Invalid authentication, malformed artifacts, lineage mismatch,
          producer outage, and contract failures fail closed.
        evidence_type: runtime_behavior
        proof: >
          Negative integration tests produce typed terminal failures without
          stale artifact reuse or generic Website-Bot content fallback.
        blocking: true

      - id: P1-S08
        property: >
          Website-Bot sends no caller-controlled model/provider/routing knobs
          through the build-intelligence API.
        evidence_type: structural
        proof: >
          Request schemas and adapter inspection contain no provider, model,
          temperature, raw prompt, Perplexity, or OpenRouter controls.
        blocking: true

      - id: P1-S09
        property: >
          One genuine no-mock SEO-Bot transaction completes and persists the
          complete artifact lineage required for Push 2.
        evidence_type: proof_receipt
        proof: >
          Push-1 receipt contains real CompetitiveLandscape,
          SEOContentBlueprint, seam-probe WebsiteBuildBlueprint,
          PageContentContract, and StructuredContentPackage artifact identities
          with all blocking checks marked passing.
        blocking: true

  capability_preflight:
    phase_id: P1-PREFLIGHT
    blocking: true
    probes:
      - id: P1-P01
        probe: >
          Capture Website-Bot and SEO-Bot branch, full commit SHA, worktree dirt,
          and required contract/source hashes.
        property: "Immutable baselines are real and execution paths are not obscured by overlapping dirt."
        pass_condition: >
          Both full SHAs and required hashes are captured; Website-Bot overlapping
          dirt is absent or explicitly allowed; SEO-Bot is treated read-only.
        evidence_type: command_receipt

      - id: P1-P02
        probe: >
          Import and validate the installed l9.website-intelligence shared
          artifact contracts from @quantum-l9/bot-interop.
        property: "Website-Bot can consume the canonical wire contract without local duplication."
        pass_condition: >
          CompetitiveLandscapeArtifact, SEOContentBlueprintArtifact,
          WebsiteBuildBlueprintArtifact, PageContentContractArtifact,
          StructuredContentPackageArtifact, ArtifactRef, integrity helpers, and
          compiler dependencies resolve successfully.
        evidence_type: import_probe

      - id: P1-P03
        probe: >
          Inspect SEO-Bot's actual landed build-intelligence endpoint schemas,
          authentication behavior, error payloads, and NEXT_WEBSITE_BOT_INPUTS.
        property: "Producer and consumer agree on the concrete transport contract."
        pass_condition: >
          No unresolved schema or protocol collision exists between Website-Bot
          expectations and SEO-Bot runtime behavior.
        evidence_type: structural

      - id: P1-P04
        probe: >
          Probe SEO-Bot endpoint reachability using existing runtime-injected
          authentication without performing full generative work.
        property: "Real producer is reachable."
        pass_condition: "Authenticated bounded health or controlled request succeeds."
        evidence_type: network_read

      - id: P1-P05
        probe: >
          Probe canonical PageContentContract compiler with controlled valid
          artifacts and an LLM invocation trap.
        property: "Deterministic reconciliation capability is available."
        pass_condition: "Compile succeeds and LLM call count is zero."
        evidence_type: runtime_behavior

      - id: P1-P06
        probe: >
          Verify required real/controlled route inputs and VerifiedBusinessFacts
          exist for the Push-1 transaction.
        property: "The seam can be exercised without fabricated business claims."
        pass_condition: >
          Route identities/purposes and verified facts are sourced from canonical
          Website-Bot inputs or explicitly controlled validation fixtures.
        evidence_type: filesystem

    failed_probe_status: blocked
    advisory_debt_policy: >
      Record unrelated repository debt but do not repair it during Push 1.
    touched_path_quality_policy: >
      Every touched Website-Bot path must pass canonical repository type, test,
      lint, and verification conventions.

  execution_envelope:
    filesystem:
      write_allow:
        - "Website-Bot SeoBuildIntelligencePort implementation"
        - "Website-Bot SEO-Bot HTTP transport adapter"
        - "Website-Bot build-intelligence integration configuration"
        - "Website-Bot targeted integration tests"
        - "Website-Bot integration-only seam-probe fixtures/harness"
        - "Website-Bot Push-1 validation scripts and receipts"
        - "minimal existing docs/contracts where actual landed execution truth must be synchronized"
      write_deny:
        - "SEO-Bot source code"
        - "LLM-Router source code"
        - "published @quantum-l9/bot-interop schema semantics"
        - "CompetitorIngestion"
        - "DonorPatternExtraction"
        - "PatternPortfolio"
        - "production WebsiteBuildBlueprint generation"
        - "DesignIntelligence implementation"
        - "ImageAssetPlanning implementation"
        - "SiteAssembler implementation"
        - "QualityDelta/RepairPlan"
        - "deployment/release infrastructure"
        - "Copy Mode or reconstruction fallback"
      delete_allow: []

    commands:
      allow:
        - "read-only git inspection"
        - "repository search/inspection commands"
        - "repository-declared typecheck/lint/test/verify commands"
        - "targeted integration tests"
        - "bounded local SEO-Bot integration harness"
        - "local service startup commands already defined by repository conventions"
      deny:
        - "git reset"
        - "git clean"
        - "force checkout/restore of operator work"
        - "publish commands"
        - "deployment commands"
        - "destructive database operations"
        - "unbounded retry loops"

    network:
      mode: named_services_only
      allowed_services:
        - "configured SEO-Bot build-intelligence API"
        - "SEO-Bot-owned downstream services reached indirectly through SEO-Bot"
        - "existing secret/configuration service if required by normal runtime bootstrap"

    secrets:
      access: runtime_injected_only
      redaction_required: true

    autonomous_merge: false

  side_effects_and_idempotency:
    - todo_id: P1-00
      side_effects:
        - filesystem_read
        - network_read
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: null
      irreversible: false

    - todo_id: P1-01
      side_effects:
        - filesystem_mutation
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: >
        Restore only Push-1 transport/configuration paths to immutable baseline.
      irreversible: false

    - todo_id: P1-02
      side_effects:
        - network_write
        - filesystem_mutation
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: >
        Discard build-scoped CompetitiveLandscape receipt locally; upstream SERP
        request cost/logging cannot be undone.
      irreversible: false

    - todo_id: P1-03
      side_effects:
        - network_write
        - filesystem_mutation
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: >
        Discard build-scoped SEOContentBlueprint locally; any producer LLM/token
        spend or external logs are non-recoverable.
      irreversible: false

    - todo_id: P1-04
      side_effects:
        - filesystem_mutation
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: >
        Remove/regenerate the integration-only seam-probe artifact.
      irreversible: false

    - todo_id: P1-05
      side_effects:
        - filesystem_mutation
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: >
        Discard/regenerate PageContentContract from immutable inputs.
      irreversible: false

    - todo_id: P1-06
      side_effects:
        - network_write
        - filesystem_mutation
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: >
        Discard local StructuredContentPackage artifact; producer model/token
        spend cannot be undone.
      irreversible: false

    - todo_id: P1-07
      side_effects:
        - filesystem_mutation
        - network_read
        - network_write
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: >
        Remove negative-test receipts and restore controlled local fixtures;
        external request logging/spend remains.
      irreversible: false

    - todo_id: P1-08
      side_effects:
        - filesystem_mutation
        - network_read
        - network_write
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: >
        Remove Push-1 validation receipt and build-scoped artifacts; external
        API/model request effects remain non-reversible.
      irreversible: false

  architecture_impact:
    - todo_id: P1-00
      bounded_context: "cross-repo integration assurance"
      layer: assurance
      owning_contract: "canonical.schema.plan_document.v1 + WEBSITE_INTELLIGENCE_LOCK"
      prohibited:
        - "mutation before immutable baseline lock"
        - "execution against unresolved protocol collision"

    - todo_id: P1-01
      bounded_context: "Website-Bot SEO build-intelligence transport"
      layer: runtime
      owning_contract: "SeoBuildIntelligencePort"
      prohibited:
        - "direct SEO-Bot HTTP calls from pipeline stages"
        - "provider/model controls in transport API"
        - "duplicate transport authority"

    - todo_id: P1-02
      bounded_context: "competitive market truth"
      layer: external_system
      owning_contract: "CompetitiveLandscape"
      prohibited:
        - "Website-Bot reranking"
        - "independent competitor discovery"
        - "accepting artifact without integrity validation"

    - todo_id: P1-03
      bounded_context: "SEO/content planning authority"
      layer: external_system
      owning_contract: "SEOContentBlueprint"
      prohibited:
        - "accepting mismatched CompetitiveLandscape lineage"
        - "Website-Bot reinterpretation of SEO semantics"

    - todo_id: P1-04
      bounded_context: "integration-only website blueprint fixture"
      layer: assurance
      owning_contract: "WebsiteBuildBlueprint shared schema"
      prohibited:
        - "production runtime import"
        - "production design/build use"
        - "fake competitor evidence"
        - "stale landscape ref"

    - todo_id: P1-05
      bounded_context: "cross-authority reconciliation"
      layer: control_plane
      owning_contract: "PageContentContract compiler"
      prohibited:
        - "LLM merge"
        - "heuristic conflict resolution"
        - "silent route/slot mismatch recovery"

    - todo_id: P1-06
      bounded_context: "final content package transaction"
      layer: external_system
      owning_contract: "StructuredContentPackage"
      prohibited:
        - "Website-Bot final-copy generation"
        - "accepting stale/wrong contract ref"
        - "accepting failed content validation"

    - todo_id: P1-07
      bounded_context: "integration failure assurance"
      layer: assurance
      owning_contract: "Push-1 negative-test matrix"
      prohibited:
        - "generic fallback"
        - "retry storm"
        - "stale artifact continuation"

    - todo_id: P1-08
      bounded_context: "Push-1 convergence"
      layer: assurance
      owning_contract: "PUSH_1_REAL_SEO_TRANSACTION gate"
      prohibited:
        - "mocked SEO-Bot success claim"
        - "implementation-only acceptance"

  rollback:
    supported: true

    trigger_conditions:
      - "Shared protocol or schema collision is discovered."
      - "Website-Bot cannot validate SEO-Bot artifacts through canonical bot-interop contracts."
      - "Transport implementation duplicates SEO-Bot access outside the canonical adapter."
      - "PageContentContract compilation invokes an LLM."
      - "StructuredContentPackage lineage does not exactly match the sent contract."
      - "Website-Bot generic final-copy generation executes as fallback."
      - "Seam-probe WebsiteBuildBlueprint becomes reachable from production runtime."
      - "Canonical repository validation regresses due to Push-1 changes."

    code:
      mode: git_restore_scoped_paths
      details: >
        Restore only Push-1-touched Website-Bot transport, configuration,
        integration-test, and validation paths to immutable baseline.

    data:
      mode: custom
      details: >
        Remove build-scoped local intelligence artifacts and validation receipts.
        Do not modify SEO-Bot producer artifacts or unrelated Website-Bot evidence.

    external_state:
      mode: manual_recovery
      details: >
        SEO-Bot API calls, DataForSEO activity, LLM/token spend, and external
        request logs cannot be reversed. Push 1 must not perform deployment or
        other product-state mutation.

    local_state:
      mode: restore_snapshot
      details: >
        Restore pre-Push-1 fixture/configuration snapshot or regenerate controlled
        integration artifacts from immutable inputs.

    verification:
      - "Website-Bot returns to immutable baseline for Push-1-touched code."
      - "SEO-Bot worktree remains unmodified."
      - "No seam-probe production import remains."
      - "No generic content fallback was reintroduced."
      - "Shared protocol/package state remains unchanged unless separately authorized."

    irreversible_operations:
      - "SEO-Bot/DataForSEO request cost and request logging."
      - "SEO-Bot LLM/token spend for blueprint/content operations."
      - "External observability generated by real integration requests."

  complexity_and_uncertainty:
    complexity: high
    uncertainty: low
    blast_radius: high
    architectural_boundaries_crossed: 4
    external_systems_touched: 3
    migration_required: false
    unknown_dependency_count: 0

  gated_write_pipeline:
    gates:
      - "Immutable baseline verified."
      - "Shared protocol compatibility verified."
      - "SEO-Bot authentication/reachability probe passed."
      - "Adapter fixture tests passed."
      - "Real CompetitiveLandscape validated."
      - "Real SEOContentBlueprint exact lineage validated."
      - "Deterministic PageContentContract compiled and sealed."
      - "Real StructuredContentPackage exact contract lineage validated."
      - "Negative fail-closed tests passed."
      - "Canonical repository validation passed."
    dedupe_before_non_idempotent_write: true
    bounded_write_count: 4
    receipt_required: true

  execution_DAG:
    graph_type: directed_acyclic_graph

    nodes:
      - P1-00
      - P1-01
      - P1-02
      - P1-03
      - P1-04
      - P1-05
      - P1-06
      - P1-07
      - P1-08

    edges:
      - from: P1-00
        to: P1-01

      - from: P1-01
        to: P1-02

      - from: P1-02
        to: P1-03

      - from: P1-03
        to: P1-04

      - from: P1-04
        to: P1-05

      - from: P1-05
        to: P1-06

      - from: P1-06
        to: P1-07

      - from: P1-07
        to: P1-08

    parallelism_rules:
      - >
        Adapter unit tests may execute in parallel with read-only SEO-Bot contract
        inspection after immutable baseline capture.
      - >
        No real SEOContentBlueprint request may begin before the exact real
        CompetitiveLandscape validates.
      - >
        No PageContentContract compile may begin before both blueprint artifacts
        reference the exact same CompetitiveLandscape.
      - >
        No StructuredContentPackage request may begin before the exact sealed
        PageContentContract exists.
      - >
        The final real transaction gate may not execute before all negative
        fixture tests pass.

    topological_sort_required: true
    cycle_policy: stop_and_repair_before_execution

  property_evidence_matrix:
    - property_id: P1-E01
      setup: "Read both repository states before mutation."
      check: >
        Capture Website-Bot and SEO-Bot full SHAs, branches, worktree status, and
        required contract/source hashes.
      expected_positive: >
        All baseline placeholders are replaced by actual immutable values and
        overlap policy passes.
      expected_negative: >
        Placeholder SHA, unclassified overlapping dirt, or baseline drift blocks
        execution.
      covers:
        - P1-S01
        - P1-S09
      blocking: true

    - property_id: P1-E02
      setup: "Load installed shared package."
      check: >
        Import canonical intelligence artifact types, ArtifactRef, sealing,
        integrity, and comparison helpers.
      expected_positive: >
        Canonical imports succeed without local wire-contract redefinition.
      expected_negative: >
        Missing or incompatible shared contract produces CONTRACT_COLLISION.
      covers:
        - P1-S02
        - P1-S03
        - P1-S06
      blocking: true

    - property_id: P1-E03
      setup: "Inspect SEO-Bot landed source read-only."
      check: >
        Compare actual endpoint request/response/authentication semantics with
        Website-Bot consumer expectations.
      expected_positive: >
        One concrete transport contract is supported by both repos.
      expected_negative: >
        Unresolved producer/consumer disagreement blocks mutation.
      covers:
        - P1-S01
      blocking: true

    - property_id: P1-E04
      setup: "Inspect Website-Bot imports/references."
      check: >
        Trace every SEO-Bot build-intelligence network call.
      expected_positive: >
        All calls flow through SeoBuildIntelligencePort and one adapter.
      expected_negative: >
        Pipeline stage performs direct fetch/Axios call to SEO-Bot.
      covers:
        - P1-S01
      blocking: true

    - property_id: P1-E05
      setup: "Inspect adapter request schemas and unit tests."
      check: >
        Search for caller-controlled provider/model/temperature/system-prompt
        fields and verify retry/timeout/auth handling.
      expected_positive: >
        Provider routing is absent; finite timeout and bounded safe retry rules
        are proven.
      expected_negative: >
        Provider leakage, unbounded retry, retry-on-auth/contract-error, or
        plaintext secret handling.
      covers:
        - P1-S07
        - P1-S08
      blocking: true

    - property_id: P1-E06
      setup: "Run real CompetitiveLandscape request."
      check: >
        Validate response schema, integrity, type, client/build identity, and
        donor evidence refs.
      expected_positive: >
        Real sealed CompetitiveLandscape is accepted only after all checks pass.
      expected_negative: >
        HTTP 200 with invalid/tampered/unsupported artifact is rejected.
      covers:
        - P1-S02
      blocking: true

    - property_id: P1-E07
      setup: "Use exact CompetitiveLandscape in SEOContentBlueprint request."
      check: >
        Validate returned SEOContentBlueprint schema and integrity.
      expected_positive: "Real sealed SEOContentBlueprint is accepted."
      expected_negative: "Malformed or invalid artifact is rejected."
      covers:
        - P1-S03
      blocking: true

    - property_id: P1-E08
      setup: "Compare SEO blueprint lineage."
      check: >
        Compare SEOContentBlueprint CompetitiveLandscape ArtifactRef against the
        exact source CompetitiveLandscape.
      expected_positive: >
        artifact_type, artifact_id, and payload_digest all match.
      expected_negative: >
        Mismatch produces COMPETITIVE_LANDSCAPE_MISMATCH.
      covers:
        - P1-S03
      blocking: true

    - property_id: P1-E09
      setup: "Construct integration-only seam probe."
      check: >
        Validate schema, exact landscape ref, exact route set, absence of final
        prose, and absence from production imports.
      expected_positive: >
        Probe is valid integration infrastructure and unreachable from production.
      expected_negative: >
        Static stale ref, production import, fake competitor evidence, or use in
        production design/build.
      covers:
        - P1-S04
      blocking: true

    - property_id: P1-E10
      setup: "Compile PageContentContract twice with equivalent inputs."
      check: >
        Compare canonical payload, semantic digest, and artifact identity.
      expected_positive: >
        All semantic outputs are identical.
      expected_negative: >
        Equivalent input produces different semantic identity.
      covers:
        - P1-S05
      blocking: true

    - property_id: P1-E11
      setup: "Trap Website-Bot LLM facade during compile."
      check: "Compile valid PageContentContract."
      expected_positive: "LLM call count = 0."
      expected_negative: "Any LLM invocation produces FORBIDDEN_LLM_OPERATION."
      covers:
        - P1-S05
      blocking: true

    - property_id: P1-E12
      setup: "Send exact sealed PageContentContract to real SEO-Bot."
      check: >
        Validate returned StructuredContentPackage schema, integrity, artifact
        type, and validation status.
      expected_positive: >
        Real package is accepted only when contract/SEO validation pass and no
        unresolved unsupported claims remain.
      expected_negative: >
        Invalid or failed content package is rejected.
      covers:
        - P1-S06
      blocking: true

    - property_id: P1-E13
      setup: "Compare content-package lineage."
      check: >
        Compare StructuredContentPackage page-content-contract ArtifactRef against
        the exact sent PageContentContract.
      expected_positive: >
        artifact_type, artifact_id, and payload_digest all match.
      expected_negative: >
        Mismatch produces CONTENT_CONTRACT_HASH_MISMATCH.
      covers:
        - P1-S06
      blocking: true

    - property_id: P1-E14
      setup: "Run tamper/mismatch fixtures."
      check: >
        Test tampered CompetitiveLandscape, mismatched SEOContentBlueprint
        landscape, incompatible route sets, and wrong/stale content contract refs.
      expected_positive: >
        Every case fails before invalid downstream consumption.
      expected_negative: >
        Invalid artifact is accepted, automatically repaired heuristically, or
        silently replaced.
      covers:
        - P1-S07
      blocking: true

    - property_id: P1-E15
      setup: "Run transport/auth/outage fixtures."
      check: >
        Test invalid auth, malformed response, timeout, transient server failure,
        and SEO-Bot unavailable.
      expected_positive: >
        Typed fail-closed outcomes occur with bounded retry semantics.
      expected_negative: >
        Retry storm, raw unbounded provider error, or stale artifact continuation.
      covers:
        - P1-S07
      blocking: true

    - property_id: P1-E16
      setup: "Instrument any remaining generic Website-Bot content generator."
      check: >
        Execute successful and failed SEO-Bot transaction paths.
      expected_positive: >
        Generic Website-Bot final-copy generation invocation count = 0.
      expected_negative: >
        SEO-Bot failure causes local generic copy fallback.
      covers:
        - P1-S07
        - P1-S08
      blocking: true

    - property_id: P1-E17
      setup: "Run complete real Push-1 integration harness."
      check: >
        Execute real CompetitiveLandscape → real SEOContentBlueprint →
        seam-probe WebsiteBuildBlueprint → deterministic PageContentContract →
        real StructuredContentPackage.
      expected_positive: >
        Entire artifact chain resolves and no mocked SEO-Bot endpoint participates.
      expected_negative: >
        Fixture substitution, unresolved lineage, or incomplete transaction.
      covers:
        - P1-S09
      blocking: true

    - property_id: P1-E18
      setup: "Run canonical Website-Bot repository validation."
      check: >
        Execute actual available typecheck, unit/integration tests, verify commands,
        and persist Push-1 validation receipt.
      expected_positive: >
        All Push-1 blocking properties pass and receipt records PASS.
      expected_negative: >
        Any unresolved blocking property or regression produces FAIL.
      covers:
        - P1-S01
        - P1-S02
        - P1-S03
        - P1-S04
        - P1-S05
        - P1-S06
        - P1-S07
        - P1-S08
        - P1-S09
      blocking: true

  stress_and_disconfirm:
    disconfirming_cases:
      - >
        SEO-Bot NEXT_WEBSITE_BOT_INPUTS differs from the installed shared
        bot-interop contract.
      - >
        SEO-Bot returns HTTP 200 with an artifact whose payload was modified
        after sealing.
      - >
        SEOContentBlueprint references a different CompetitiveLandscape than
        Website-Bot requested.
      - >
        WebsiteBuildBlueprint seam probe uses a stale/static CompetitiveLandscape
        ref instead of the real runtime artifact.
      - >
        PageContentContract compilation requires an LLM or non-deterministic
        heuristic to resolve incompatible requirements.
      - >
        StructuredContentPackage references a different/stale PageContentContract.
      - >
        SEO-Bot becomes unavailable after CompetitiveLandscape but before content
        generation.
      - >
        Invalid authentication triggers retries or a generic content fallback.
      - >
        Production Website-Bot source imports the integration-only seam probe.
      - >
        A real transaction succeeds only when provider/model fields are supplied
        by Website-Bot.

    assumption_failure_conditions:
      - "Website-Bot and SEO-Bot protocol versions are incompatible."
      - "Canonical bot-interop contracts cannot validate actual SEO-Bot outputs."
      - "SEO-Bot's build-intelligence endpoints are absent or materially different from the landed handoff."
      - "Required runtime authentication cannot be resolved through the existing secret plane."
      - "The deterministic PageContentContract compiler cannot consume the landed shared schemas."
      - "Real external service availability prevents the required no-mock transaction."

    blast_radius_notes:
      - >
        Do not modify SEO-Bot or LLM-Router from this plan to make Website-Bot
        tests pass.
      - >
        Do not create local duplicate artifact interfaces to hide a shared-schema
        collision.
      - >
        Do not weaken artifact equality from exact ArtifactRef matching to
        client/build/domain matching.
      - >
        Do not let Push-1 seam-probe infrastructure leak into the production
        redesign path.

    rollback_constraints:
      - >
        External request costs, DataForSEO activity, LLM/token spend, and request
        logging are non-reversible.
      - >
        Rollback must preserve unrelated operator work and all SEO-Bot source state.
      - >
        Failed Push-1 artifacts must never be marked as production-authoritative.

  out_of_scope:
    - "CompetitorIngestion"
    - "DonorPatternExtraction"
    - "PatternPortfolio"
    - "Baseline-vs-Market Gap Analysis"
    - "real WebsiteBuildBlueprint generation"
    - "DesignIntelligence changes"
    - "ImageAssetPlanning changes"
    - "SiteAssembler changes"
    - "site build"
    - "QualityDelta"
    - "RepairPlan"
    - "deployment/release"
    - "SEO-Bot source changes"
    - "LLM-Router source changes"
    - "shared protocol redesign"
    - "new workflow engine"
    - "new database architecture"

  follow_on_milestone:
    separate_plan_required: true
    items:
      - priority: P0
        change: >
          Push 2 — consume the proven CompetitiveLandscape and implement bounded
          donor ingestion, donor nugget extraction, PatternPortfolio,
          Baseline-vs-Market Gap Analysis, and the real WebsiteBuildBlueprint.
        why: >
          Push 1 proves the cross-repo seam; Push 2 supplies the production
          website-intelligence authority required to replace the integration-only
          seam probe.

  convergence:
    current_state: preflight_blocked

    executable_when:
      - >
        Website-Bot and SEO-Bot immutable baselines are captured using actual full
        commit SHAs and required hashes.
      - "Website-Bot worktree overlap policy passes."
      - "Shared l9.website-intelligence protocol compatibility is proven."
      - "SEO-Bot build-intelligence API/authentication contract is verified."
      - "Real SEO-Bot endpoint reachability passes."
      - "Canonical PageContentContract compiler preflight passes with zero LLM calls."
      - "Verified route/business-fact inputs exist."

    complete_when:
      - "One canonical Website-Bot SEO transport adapter exists behind SeoBuildIntelligencePort."
      - "Real CompetitiveLandscape is obtained and integrity-validated."
      - "Real SEOContentBlueprint is obtained and references the exact CompetitiveLandscape."
      - "Integration-only WebsiteBuildBlueprint seam probe references that same exact landscape and is unreachable from production runtime."
      - "PageContentContract compiles deterministically with zero LLM calls."
      - "Real StructuredContentPackage is obtained and references the exact PageContentContract."
      - "Structured content validation passes with no unresolved unsupported claims."
      - "Authentication, malformed-response, lineage, timeout, outage, and fail-closed negative cases pass."
      - "Website-Bot generic final-copy generation invocation count remains zero."
      - "No provider/model controls leak through Website-Bot's SEO integration API."
      - "One genuine no-mock SEO-Bot transaction is executed."
      - "Push-1 artifact-chain validation receipt is persisted."
      - "Canonical Website-Bot validation passes."

    next_convergence_gate: >
      Push 2 may start only when
      PUSH_1_REAL_SEO_TRANSACTION == PASS.

    broader_work_requires_separate_plan: true
```

## Push 2 — Donor Intelligence → WebsiteBuildBlueprint

```yaml
plan:
  metadata:
    plan_id: website-bot.push-2.donor-intelligence.v1
    name: "Website-Bot Push 2 — Donor Intelligence and WebsiteBuildBlueprint"
    overview: >
      Consume the real CompetitiveLandscape proven in Push 1, ingest the selected
      donor cohort under strict crawl bounds, extract evidence-backed transferable
      website patterns, synthesize a canonical PatternPortfolio, compare those
      patterns against the source-site baseline, and produce the first real
      WebsiteBuildBlueprint. This push creates the redesign intelligence layer;
      it does not perform content convergence, site assembly, or quality-delta work.
    schema_version: 1.0.0
    status: preflight_blocked
    is_project: true
    owner: "Cursor under operator control"
    created_at: "2026-08-14"

  todos:
    - id: P2-00
      content: "Capture immutable Website-Bot baseline and prove Push-1 real SEO transaction PASS."
      status: blocked
      phase: preflight
      evidence_property_refs: [P2-E01, P2-E02]

    - id: P2-01
      content: "Implement bounded CompetitorIngestion using only the exact CompetitiveLandscape donor cohort."
      status: pending
      phase: donor_ingestion
      depends_on: [P2-00]
      evidence_property_refs: [P2-E03]

    - id: P2-02
      content: "Normalize donor page, screenshot, IA, conversion, trust, mobile, and visual evidence without creating reusable donor expression."
      status: pending
      phase: evidence_normalization
      depends_on: [P2-01]
      evidence_property_refs: [P2-E04]

    - id: P2-03
      content: "Implement per-donor nugget extraction with evidence, invariant, disposition, destination, risk, and acceptance-test requirements."
      status: pending
      phase: nugget_extraction
      depends_on: [P2-02]
      evidence_property_refs: [P2-E05, P2-E06]

    - id: P2-04
      content: "Implement deterministic/evidence-grounded cross-donor synthesis into PatternPortfolio with anti-pattern and rejection support."
      status: pending
      phase: pattern_synthesis
      depends_on: [P2-03]
      evidence_property_refs: [P2-E07, P2-E08]

    - id: P2-05
      content: "Implement Baseline-vs-Market Gap Analysis using canonical baseline evidence and PatternPortfolio."
      status: pending
      phase: gap_analysis
      depends_on: [P2-04]
      evidence_property_refs: [P2-E09]

    - id: P2-06
      content: "Generate and seal the real WebsiteBuildBlueprint from baseline evidence, PatternPortfolio, gap analysis, verified business facts, and the exact CompetitiveLandscape."
      status: pending
      phase: blueprint
      depends_on: [P2-05]
      evidence_property_refs: [P2-E10, P2-E11]

    - id: P2-07
      content: "Run Push-2 adversarial validation and persist the artifact/evidence chain required by Push 3."
      status: pending
      phase: validation
      depends_on: [P2-06]
      evidence_property_refs: [P2-E12]

  architect_framing:
    planning_ssot: "Accepted five-push Website-Bot execution sequence plus l9.website-intelligence/v1 contracts."
    plan_class: bounded_execution_contract
    redesign_allowed: false
    follow_on_schema_evolution_separate: true
    framing_notes: >
      Execute the locked architecture. Do not redesign the cross-repo seam,
      reintroduce Copy Mode, create a second competitor authority, or expand into
      content convergence/assembly. Pattern harvesting ports invariants, not donor expression.

  immutable_baseline:
    captured_at: null
    repository: "Quantum-L9/Website-Bot"
    workspace: "active Cursor worktree"
    ssot_clone: "operator-selected Website-Bot clone"
    branch: "<CAPTURE_AT_PREFLIGHT>"
    commit_sha: "<CAPTURE_FULL_SHA_BEFORE_EXECUTION>"
    dirty: false
    artifact_hashes:
      WEBSITE_INTELLIGENCE_LOCK.json: "<CAPTURE_SHA256>"
      bot_interop_contract_surface: "<CAPTURE_SHA256>"
      push_1_validation_receipt: "<CAPTURE_SHA256>"
    allowed_local_dirt: []
    overlap_policy: stop_if_dirty_overlaps_may_modify
    verification_rule: reverify_at_execution_start
    on_drift: stop_and_replan

  objective:
    mission: >
      Produce a real, evidence-backed WebsiteBuildBlueprint from the exact SEO-Bot
      CompetitiveLandscape donor cohort without copying competitor expression or
      allowing downstream design generation to invent strategy independently.
    success_properties:
      - id: P2-S01
        property: "Website-Bot consumes exactly the CompetitiveLandscape cohort produced by SEO-Bot."
        evidence_type: structural
        proof: "No independent competitor discovery path exists in Push-2 runtime."
        blocking: true

      - id: P2-S02
        property: "Donor ingestion is explicitly bounded."
        evidence_type: runtime_behavior
        proof: "Tests and execution receipts prove page/depth/screenshot/payload/concurrency bounds."
        blocking: true

      - id: P2-S03
        property: "Every adopted pattern is evidence-backed and dispositioned."
        evidence_type: quality_gate
        proof: "PatternPortfolio validator rejects adopted nuggets missing evidence, invariant, destination, risk, or acceptance test."
        blocking: true

      - id: P2-S04
        property: "Raw competitor expression is not propagated as generation authority."
        evidence_type: structural
        proof: "Inspection/tests prove no competitor copy/image/source-markup reuse path exists."
        blocking: true

      - id: P2-S05
        property: "WebsiteBuildBlueprint references the exact CompetitiveLandscape and canonical PatternPortfolio."
        evidence_type: proof_receipt
        proof: "Artifact refs and digests resolve exactly."
        blocking: true

      - id: P2-S06
        property: "WebsiteBuildBlueprint owns experience architecture but contains no final page prose."
        evidence_type: structural
        proof: "Schema/fixture inspection and negative test."
        blocking: true

  capability_preflight:
    phase_id: P2-PREFLIGHT
    blocking: true
    probes:
      - id: P2-P01
        probe: "Capture branch, full commit SHA, worktree dirt, and required artifact hashes."
        property: "Immutable baseline is real and complete."
        pass_condition: "Full SHA captured; overlapping local dirt absent or explicitly allowed."
        evidence_type: command_receipt

      - id: P2-P02
        probe: "Load Push-1 validation receipt."
        property: "Real SEO-Bot transaction already passed."
        pass_condition: "PUSH_1_REAL_SEO_TRANSACTION == PASS."
        evidence_type: filesystem

      - id: P2-P03
        probe: "Validate installed l9.website-intelligence contracts."
        property: "CompetitiveLandscape and WebsiteBuildBlueprint shared types are usable."
        pass_condition: "Canonical import/validation probe succeeds with no local duplicate contract."
        evidence_type: import_probe

      - id: P2-P04
        probe: "Probe source-site baseline evidence availability."
        property: "Baseline evidence exists before gap analysis."
        pass_condition: "Canonical source/baseline evidence can be loaded without reconstruction semantics."
        evidence_type: runtime_behavior

      - id: P2-P05
        probe: "Probe configured LLM-Router path for donor extraction, visual analysis, synthesis, and blueprint reasoning."
        property: "Required reasoning/vision operations are available without provider selection in application code."
        pass_condition: "Task-routing tests pass and search routing is false for pattern reasoning."
        evidence_type: runtime_behavior

    failed_probe_status: blocked
    advisory_debt_policy: "Non-blocking unrelated repository debt may be recorded but not repaired."
    touched_path_quality_policy: "All touched files must satisfy repository type/lint/test conventions."

  execution_envelope:
    filesystem:
      write_allow:
        - "Website-Bot donor intelligence stages/modules"
        - "Website-Bot PatternPortfolio and gap-analysis artifacts"
        - "Website-Bot WebsiteBuildBlueprint producer"
        - "targeted tests and validation receipts"
        - "existing architecture docs only where execution truth must be updated"
      write_deny:
        - "SEO-Bot repository"
        - "LLM-Router repository"
        - "published bot-interop wire semantics"
        - "deployment infrastructure"
        - "unrelated Website-Bot modules"
        - "Copy Mode resurrection artifacts"
      delete_allow: []

    commands:
      allow:
        - "read-only git inspection"
        - "repository-declared typecheck/lint/test/verify commands"
        - "targeted test runner commands"
        - "repository search/inspection commands"
        - "bounded local validation scripts"
      deny:
        - "git reset"
        - "git clean"
        - "force checkout/restore of operator work"
        - "publish/deploy commands"
        - "destructive database commands"

    network:
      mode: named_services_only
      allowed_services:
        - "configured SEO-Bot build-intelligence endpoint"
        - "CompetitiveLandscape-selected donor domains"
        - "configured LLM-Router upstream providers through the router only"

    secrets:
      access: runtime_injected_only
      redaction_required: true

    autonomous_merge: false

  side_effects_and_idempotency:
    - todo_id: P2-00
      side_effects: [filesystem_read]
      idempotency: safe_to_repeat
      retry: not_applicable
      compensation: null
      irreversible: false

    - todo_id: P2-01
      side_effects: [filesystem_mutation, network_read]
      idempotency: safe_with_dedupe
      retry: bounded_retry
      compensation: "Remove generated donor evidence/artifacts for this build ID and restore scoped code paths."
      irreversible: false

    - todo_id: P2-02
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Regenerate normalized evidence from immutable donor evidence."
      irreversible: false

    - todo_id: P2-03
      side_effects: [filesystem_mutation, network_write]
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: "Discard generated nugget artifacts; model/token spend is non-recoverable."
      irreversible: false

    - todo_id: P2-04
      side_effects: [filesystem_mutation, network_write]
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: "Discard synthesized PatternPortfolio; model/token spend is non-recoverable."
      irreversible: false

    - todo_id: P2-05
      side_effects: [filesystem_mutation, network_write]
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: "Discard gap-analysis artifact."
      irreversible: false

    - todo_id: P2-06
      side_effects: [filesystem_mutation, network_write]
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: "Discard WebsiteBuildBlueprint artifact and restore scoped implementation paths."
      irreversible: false

    - todo_id: P2-07
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Remove generated validation receipts only."
      irreversible: false

  architecture_impact:
    - todo_id: P2-00
      bounded_context: "Website-Bot execution assurance"
      layer: assurance
      owning_contract: "canonical.schema.plan_document.v1 + Push-1 gate"
      prohibited: ["mutation before baseline lock"]

    - todo_id: P2-01
      bounded_context: "competitive donor evidence"
      layer: data_plane
      owning_contract: "CompetitiveLandscape"
      prohibited: ["independent donor search", "unbounded crawl"]

    - todo_id: P2-02
      bounded_context: "donor evidence normalization"
      layer: data_plane
      owning_contract: "Website-Bot evidence model"
      prohibited: ["competitor expression reuse"]

    - todo_id: P2-03
      bounded_context: "per-donor pattern reasoning"
      layer: runtime
      owning_contract: "Gold-nugget disposition/evidence rules"
      prohibited: ["provider selection", "unsupported pattern claims"]

    - todo_id: P2-04
      bounded_context: "cross-donor synthesis"
      layer: runtime
      owning_contract: "PatternPortfolio"
      prohibited: ["frequency-equals-adoption", "duplicate authority"]

    - todo_id: P2-05
      bounded_context: "improvement-gap reasoning"
      layer: runtime
      owning_contract: "baseline + PatternPortfolio"
      prohibited: ["source site as target architecture"]

    - todo_id: P2-06
      bounded_context: "website redesign authority"
      layer: control_plane
      owning_contract: "WebsiteBuildBlueprint"
      prohibited: ["final prose", "SERP-rank invention", "raw competitor reuse"]

    - todo_id: P2-07
      bounded_context: "validation"
      layer: assurance
      owning_contract: "Push-2 convergence gate"
      prohibited: ["implementation claim without evidence"]

  rollback:
    supported: true
    trigger_conditions:
      - "Any blocking property fails."
      - "CompetitiveLandscape authority is duplicated."
      - "Donor expression enters generation artifacts."
      - "WebsiteBuildBlueprint contract/lineage cannot be proven."
    code:
      mode: git_restore_scoped_paths
      details: "Restore only Push-2-touched Website-Bot paths to immutable baseline."
    data:
      mode: custom
      details: "Remove build-scoped generated donor/pattern/blueprint artifacts; do not mutate upstream evidence."
    external_state:
      mode: manual_recovery
      details: "Network reads and model spend cannot be undone; no external product state mutation is permitted."
    local_state:
      mode: restore_snapshot
      details: "Restore validation fixture/output snapshot from pre-execution receipt where needed."
    verification:
      - "Baseline commit remains unchanged."
      - "No Push-2 runtime imports remain after scoped rollback."
      - "Push-1 seam tests still pass."
    irreversible_operations:
      - "LLM/token spend."
      - "External donor HTTP request observability/logging."

  complexity_and_uncertainty:
    complexity: high
    uncertainty: medium
    blast_radius: medium
    architectural_boundaries_crossed: 3
    external_systems_touched: 3
    migration_required: false
    unknown_dependency_count: 0

  execution_DAG:
    graph_type: directed_acyclic_graph
    nodes: [P2-00, P2-01, P2-02, P2-03, P2-04, P2-05, P2-06, P2-07]
    edges:
      - {from: P2-00, to: P2-01}
      - {from: P2-01, to: P2-02}
      - {from: P2-02, to: P2-03}
      - {from: P2-03, to: P2-04}
      - {from: P2-04, to: P2-05}
      - {from: P2-05, to: P2-06}
      - {from: P2-06, to: P2-07}
    parallelism_rules:
      - "Independent donor ingestion may run concurrently within explicit concurrency bounds."
      - "Per-donor nugget extraction may parallelize only after evidence for that donor is complete."
      - "Cross-donor synthesis cannot start until all selected donor dispositions are terminal."
    topological_sort_required: true
    cycle_policy: stop_and_repair_before_execution

  property_evidence_matrix:
    - property_id: P2-E01
      check: "Immutable baseline receipt contains actual full SHA and required hashes."
      expected_positive: "Baseline verified and non-overlapping."
      expected_negative: "Placeholder SHA, drift, or overlapping unapproved dirt blocks execution."
      covers: [P2-S01]
      blocking: true

    - property_id: P2-E02
      check: "Inspect Push-1 gate receipt."
      expected_positive: "PUSH_1_REAL_SEO_TRANSACTION == PASS."
      expected_negative: "Anything else blocks Push 2."
      covers: [P2-S01]
      blocking: true

    - property_id: P2-E03
      check: "Execute bounded donor-ingestion tests and inspect runtime receipt."
      expected_positive: "Only CompetitiveLandscape-selected donors are ingested within declared bounds."
      expected_negative: "Independent search, unbounded crawl, or cohort drift."
      covers: [P2-S01, P2-S02]
      blocking: true

    - property_id: P2-E04
      check: "Inspect normalized donor evidence."
      expected_positive: "Evidence supports IA/navigation/hero/conversion/trust/proof/content rhythm/mobile/visual/CTA analysis."
      expected_negative: "Unsupported fields are labeled UNKNOWN rather than invented."
      covers: [P2-S02]
      blocking: true

    - property_id: P2-E05
      check: "Validate all adopted nuggets against required fields."
      expected_positive: "Every adopted nugget has evidence, invariant, disposition, destination, risk, acceptance test."
      expected_negative: "Missing field causes rejection."
      covers: [P2-S03]
      blocking: true

    - property_id: P2-E06
      check: "Inspect donor-expression boundaries."
      expected_positive: "No raw competitor prose/image/source-markup reuse path exists."
      expected_negative: "Any reuse path fails gate."
      covers: [P2-S04]
      blocking: true

    - property_id: P2-E07
      check: "Run cross-donor synthesis fixture."
      expected_positive: "PatternPortfolio preserves donor support, confidence, disposition, anti-patterns, and destinations."
      expected_negative: "Single-site expression becomes canonical without evidence."
      covers: [P2-S03]
      blocking: true

    - property_id: P2-E08
      check: "Run high-frequency undesirable-pattern disconfirm fixture."
      expected_positive: "System may REJECT a pattern despite high donor frequency."
      expected_negative: "Frequency automatically forces PORT."
      covers: [P2-S03]
      blocking: true

    - property_id: P2-E09
      check: "Inspect baseline-vs-market gap artifact."
      expected_positive: "Recommendations explicitly compare current baseline against adopted market patterns."
      expected_negative: "Generic redesign advice without baseline or pattern refs."
      covers: [P2-S03]
      blocking: true

    - property_id: P2-E10
      check: "Validate WebsiteBuildBlueprint schema and lineage."
      expected_positive: "Exact CompetitiveLandscape ref and PatternPortfolio digest resolve."
      expected_negative: "Stale/mismatched input ref."
      covers: [P2-S05]
      blocking: true

    - property_id: P2-E11
      check: "Inspect WebsiteBuildBlueprint authority surface."
      expected_positive: "Routes/sections/content-slots/conversion/proof/pattern refs exist; final prose absent."
      expected_negative: "Blueprint contains final page copy or SERP rank invention."
      covers: [P2-S06]
      blocking: true

    - property_id: P2-E12
      check: "Run canonical type/tests/verification plus Push-2 targeted gate."
      expected_positive: "All blocking properties pass and validation receipt is persisted."
      expected_negative: "Any blocking property unresolved."
      covers: [P2-S01, P2-S02, P2-S03, P2-S04, P2-S05, P2-S06]
      blocking: true

  stress_and_disconfirm:
    disconfirming_cases:
      - "CompetitiveLandscape contains fewer qualified donors than expected."
      - "A donor blocks crawl/screenshot access."
      - "Eight of ten donors share a bad accessibility/conversion pattern."
      - "Source baseline lacks a fact or route needed by a proposed pattern."
      - "Pattern synthesis routes through search despite requiresSearch=false."
      - "Blueprint references stale CompetitiveLandscape evidence."
    assumption_failure_conditions:
      - "Push-1 seam no longer passes."
      - "Shared contract version has drifted."
      - "No canonical baseline evidence can be loaded."
      - "Pattern adoption cannot be tied to evidence."
    blast_radius_notes:
      - "Do not compensate for missing donor evidence by widening crawl scope without operator approval."
      - "Do not redesign shared protocol to accommodate one donor."
    rollback_constraints:
      - "External request/model costs are non-reversible."
      - "Never roll back unrelated operator changes."

  out_of_scope:
    - "SEOContentBlueprint production changes"
    - "PageContentContract convergence"
    - "StructuredContentPackage generation changes"
    - "DesignIntelligence implementation"
    - "ImageAssetPlanning implementation"
    - "Site assembly/build"
    - "QualityDelta"
    - "deployment"
    - "shared protocol redesign"

  follow_on_milestone:
    separate_plan_required: true
    items:
      - priority: P0
        change: "Push 3 — real WebsiteBuildBlueprint + SEOContentBlueprint convergence."
        why: "Production content transaction requires the real blueprint created here."

  convergence:
    current_state: preflight_blocked
    executable_when:
      - "Immutable baseline placeholders are replaced by actual SHA/hashes."
      - "Push-1 gate is PASS."
      - "All blocking capability probes pass."
      - "Worktree overlap policy passes."
    complete_when:
      - "CompetitiveLandscape donor cohort is the sole donor authority."
      - "Bounded donor evidence exists."
      - "PatternPortfolio passes evidence/disposition/anti-copy gates."
      - "Baseline-vs-Market Gap Analysis exists."
      - "Real WebsiteBuildBlueprint is sealed with exact lineage."
      - "Push-2 validation receipt passes all blocking properties."
    next_convergence_gate: "Push 3 may start only on Push-2 PASS."
    broader_work_requires_separate_plan: true
```

## Push 3 — Real Blueprint Convergence

```yaml
plan:
  metadata:
    plan_id: website-bot.push-3.blueprint-convergence.v1
    name: "Website-Bot Push 3 — Production Blueprint Convergence and Structured Content"
    overview: >
      Replace the Push-1 seam-probe with the real WebsiteBuildBlueprint produced
      by Push 2, obtain the real SEOContentBlueprint for the identical
      CompetitiveLandscape, deterministically compile the production
      PageContentContract, obtain and validate the real StructuredContentPackage,
      and establish these artifacts as the only production authorities consumed
      by later design/content/assembly stages.
    schema_version: 1.0.0
    status: preflight_blocked
    is_project: true
    owner: "Cursor under operator control"
    created_at: "2026-08-14"

  todos:
    - id: P3-00
      content: "Capture immutable baseline and prove Push-1 and Push-2 gates PASS with exact artifact identities."
      status: blocked
      phase: preflight
      evidence_property_refs: [P3-E01]

    - id: P3-01
      content: "Load and verify the real WebsiteBuildBlueprint and exact CompetitiveLandscape lineage from Push 2."
      status: pending
      phase: website_authority
      depends_on: [P3-00]
      evidence_property_refs: [P3-E02]

    - id: P3-02
      content: "Request the real SEOContentBlueprint from SEO-Bot for the same CompetitiveLandscape and production route/business inputs."
      status: pending
      phase: seo_authority
      depends_on: [P3-01]
      evidence_property_refs: [P3-E03, P3-E04]

    - id: P3-03
      content: "Compile and seal the production PageContentContract deterministically from the two real blueprints and verified business facts."
      status: pending
      phase: deterministic_convergence
      depends_on: [P3-02]
      evidence_property_refs: [P3-E05, P3-E06]

    - id: P3-04
      content: "Send the exact sealed PageContentContract to SEO-Bot and receive the real StructuredContentPackage."
      status: pending
      phase: content_generation
      depends_on: [P3-03]
      evidence_property_refs: [P3-E07]

    - id: P3-05
      content: "Validate structured-content lineage, route/section identity, content requirements, unsupported claims, and final SEO contract status."
      status: pending
      phase: content_validation
      depends_on: [P3-04]
      evidence_property_refs: [P3-E08, P3-E09]

    - id: P3-06
      content: "Wire the real WebsiteBuildBlueprint and StructuredContentPackage into production BuildContext/evidence state as exclusive downstream authorities without invoking design/assembly."
      status: pending
      phase: authority_wiring
      depends_on: [P3-05]
      evidence_property_refs: [P3-E10]

    - id: P3-07
      content: "Run negative lineage, deterministic-compiler, fail-closed, and production-convergence tests; persist Push-3 receipt."
      status: pending
      phase: validation
      depends_on: [P3-06]
      evidence_property_refs: [P3-E11]

  architect_framing:
    planning_ssot: "Accepted five-push execution sequence and l9.website-intelligence/v1 ownership contract."
    plan_class: integration_plan
    redesign_allowed: false
    follow_on_schema_evolution_separate: true
    framing_notes: >
      This push proves the two independent authorities converge. Website-Bot owns
      experience structure; SEO-Bot owns search/content semantics and final prose.
      The deterministic compiler is the only reconciliation authority.

  immutable_baseline:
    captured_at: null
    repository: "Quantum-L9/Website-Bot"
    workspace: "active Cursor worktree"
    ssot_clone: "operator-selected Website-Bot clone"
    branch: "<CAPTURE_AT_PREFLIGHT>"
    commit_sha: "<CAPTURE_FULL_SHA_BEFORE_EXECUTION>"
    dirty: false
    artifact_hashes:
      WEBSITE_INTELLIGENCE_LOCK.json: "<CAPTURE_SHA256>"
      push_1_validation_receipt: "<CAPTURE_SHA256>"
      push_2_validation_receipt: "<CAPTURE_SHA256>"
      website_build_blueprint: "<CAPTURE_PAYLOAD_DIGEST>"
    allowed_local_dirt: []
    overlap_policy: stop_if_dirty_overlaps_may_modify
    verification_rule: reverify_at_execution_start
    on_drift: stop_and_replan

  objective:
    mission: >
      Prove the production WebsiteBuildBlueprint and SEOContentBlueprint converge
      through a zero-LLM deterministic PageContentContract and produce a validated
      StructuredContentPackage with exact artifact lineage.
    success_properties:
      - id: P3-S01
        property: "Both blueprints reference the exact same CompetitiveLandscape."
        evidence_type: proof_receipt
        proof: "Full ArtifactRefs match."
        blocking: true

      - id: P3-S02
        property: "WebsiteBuildBlueprint and SEOContentBlueprint preserve independent ownership."
        evidence_type: structural
        proof: "Website blueprint owns experience; SEO blueprint owns search/content semantics."
        blocking: true

      - id: P3-S03
        property: "PageContentContract compilation is deterministic and uses zero LLM calls."
        evidence_type: runtime_behavior
        proof: "Repeated compile produces same semantic digest with LLM invocation trap remaining at zero."
        blocking: true

      - id: P3-S04
        property: "StructuredContentPackage references the exact production PageContentContract."
        evidence_type: proof_receipt
        proof: "Artifact type, ID, and digest match exactly."
        blocking: true

      - id: P3-S05
        property: "Website-Bot performs no final-copy generation or rewrite."
        evidence_type: runtime_behavior
        proof: "Generic Website-Bot content generator invocation count remains zero."
        blocking: true

      - id: P3-S06
        property: "Production downstream state contains only validated WebsiteBuildBlueprint and StructuredContentPackage authorities."
        evidence_type: structural
        proof: "BuildContext/evidence state inspection."
        blocking: true

  capability_preflight:
    phase_id: P3-PREFLIGHT
    blocking: true
    probes:
      - id: P3-P01
        probe: "Capture real branch/SHA/hashes and inspect worktree overlap."
        property: "Immutable baseline."
        pass_condition: "Full SHA and hashes captured; overlap policy passes."
        evidence_type: command_receipt

      - id: P3-P02
        probe: "Read Push-1 and Push-2 gate receipts."
        property: "Required upstream capabilities are proven."
        pass_condition: "Both gates == PASS."
        evidence_type: filesystem

      - id: P3-P03
        probe: "Validate real WebsiteBuildBlueprint artifact."
        property: "Push-2 production authority is available and intact."
        pass_condition: "Schema/integrity/CompetitiveLandscape refs validate."
        evidence_type: runtime_behavior

      - id: P3-P04
        probe: "Probe real SEO-Bot build-intelligence endpoint."
        property: "SEOContentBlueprint and StructuredContentPackage operations are reachable."
        pass_condition: "Authenticated health/controlled request succeeds."
        evidence_type: network_read

      - id: P3-P05
        probe: "Probe deterministic PageContentContract compiler."
        property: "Compiler accepts canonical real-artifact shapes."
        pass_condition: "Controlled compile succeeds without LLM invocation."
        evidence_type: runtime_behavior

    failed_probe_status: blocked
    advisory_debt_policy: "Record unrelated debt only."
    touched_path_quality_policy: "All touched paths must pass repository validation."

  execution_envelope:
    filesystem:
      write_allow:
        - "Website-Bot production intelligence integration"
        - "BuildContext/evidence state required for canonical artifacts"
        - "PageContentContract integration"
        - "targeted tests and Push-3 validation receipt"
      write_deny:
        - "SEO-Bot source"
        - "LLM-Router source"
        - "bot-interop schema redesign"
        - "DesignIntelligence implementation"
        - "SiteAssembler implementation"
        - "deployment/release infrastructure"
      delete_allow: []

    commands:
      allow:
        - "read-only git inspection"
        - "repository-declared typecheck/lint/test/verify commands"
        - "targeted integration tests"
        - "local validation harness"
      deny:
        - "git reset"
        - "git clean"
        - "deployment/publish"
        - "destructive database operations"

    network:
      mode: named_services_only
      allowed_services:
        - "configured SEO-Bot build-intelligence endpoint"
        - "configured LLM-Router providers as invoked by SEO-Bot, not Website-Bot content generation"

    secrets:
      access: runtime_injected_only
      redaction_required: true

    autonomous_merge: false

  side_effects_and_idempotency:
    - todo_id: P3-00
      side_effects: [filesystem_read]
      idempotency: safe_to_repeat
      retry: not_applicable
      compensation: null
      irreversible: false

    - todo_id: P3-01
      side_effects: [filesystem_read]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: null
      irreversible: false

    - todo_id: P3-02
      side_effects: [network_write, filesystem_mutation]
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: "Discard build-scoped SEOContentBlueprint artifact; token/external logs remain."
      irreversible: false

    - todo_id: P3-03
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Discard generated PageContentContract artifact."
      irreversible: false

    - todo_id: P3-04
      side_effects: [network_write, filesystem_mutation]
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: "Discard StructuredContentPackage locally; token/external logging cannot be undone."
      irreversible: false

    - todo_id: P3-05
      side_effects: [filesystem_read]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: null
      irreversible: false

    - todo_id: P3-06
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Restore scoped integration paths."
      irreversible: false

    - todo_id: P3-07
      side_effects: [filesystem_mutation, network_read]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Remove validation outputs."
      irreversible: false

  architecture_impact:
    - todo_id: P3-00
      bounded_context: "integration assurance"
      layer: assurance
      owning_contract: "Push-1/Push-2 receipts"
      prohibited: ["execution on stale baseline"]

    - todo_id: P3-01
      bounded_context: "website experience authority"
      layer: control_plane
      owning_contract: "WebsiteBuildBlueprint"
      prohibited: ["probe blueprint", "stale artifact"]

    - todo_id: P3-02
      bounded_context: "SEO/content authority"
      layer: external_system
      owning_contract: "SEOContentBlueprint"
      prohibited: ["WebsiteBuildBlueprint dependency inside SEO-Bot", "provider override"]

    - todo_id: P3-03
      bounded_context: "cross-authority reconciliation"
      layer: control_plane
      owning_contract: "PageContentContract compiler"
      prohibited: ["LLM merge", "heuristic conflict resolution"]

    - todo_id: P3-04
      bounded_context: "final content production"
      layer: external_system
      owning_contract: "StructuredContentPackage"
      prohibited: ["Website-Bot final-copy generation"]

    - todo_id: P3-05
      bounded_context: "content assurance"
      layer: assurance
      owning_contract: "SEO/content validation"
      prohibited: ["accept invalid or unsupported claims"]

    - todo_id: P3-06
      bounded_context: "production downstream authority"
      layer: runtime
      owning_contract: "WebsiteBuildBlueprint + StructuredContentPackage"
      prohibited: ["raw competitors as downstream authority"]

    - todo_id: P3-07
      bounded_context: "convergence assurance"
      layer: assurance
      owning_contract: "Push-3 gate"
      prohibited: ["advance on partial lineage proof"]

  rollback:
    supported: true
    trigger_conditions:
      - "Landscape refs differ."
      - "PageContentContract requires an LLM to compile."
      - "StructuredContentPackage references wrong contract."
      - "Website-Bot generic final-copy generation executes."
      - "Production runtime uses seam-probe artifacts."
    code:
      mode: git_restore_scoped_paths
      details: "Restore Push-3-touched Website-Bot integration paths."
    data:
      mode: custom
      details: "Discard build-scoped generated contracts/content artifacts; preserve upstream Push-2 evidence."
    external_state:
      mode: manual_recovery
      details: "SEO-Bot generation requests/token spend are not reversible."
    local_state:
      mode: restore_snapshot
      details: "Restore pre-Push-3 fixture/validation outputs."
    verification:
      - "Push-2 WebsiteBuildBlueprint remains intact."
      - "Push-1 adapter tests remain green."
      - "No production seam-probe import remains."
    irreversible_operations:
      - "LLM/token spend."
      - "External request logs."

  complexity_and_uncertainty:
    complexity: high
    uncertainty: low
    blast_radius: high
    architectural_boundaries_crossed: 4
    external_systems_touched: 2
    migration_required: false
    unknown_dependency_count: 0

  execution_DAG:
    graph_type: directed_acyclic_graph
    nodes: [P3-00, P3-01, P3-02, P3-03, P3-04, P3-05, P3-06, P3-07]
    edges:
      - {from: P3-00, to: P3-01}
      - {from: P3-01, to: P3-02}
      - {from: P3-02, to: P3-03}
      - {from: P3-03, to: P3-04}
      - {from: P3-04, to: P3-05}
      - {from: P3-05, to: P3-06}
      - {from: P3-06, to: P3-07}
    parallelism_rules:
      - "No production PageContentContract compile until both real blueprints validate."
      - "No structured-content request until the exact sealed production contract exists."
    topological_sort_required: true
    cycle_policy: stop_and_repair_before_execution

  property_evidence_matrix:
    - property_id: P3-E01
      check: "Verify baseline plus Push-1/Push-2 receipts."
      expected_positive: "Actual SHA/hashes captured and both prior gates PASS."
      expected_negative: "Any drift or failed prior gate blocks execution."
      covers: [P3-S01]
      blocking: true

    - property_id: P3-E02
      check: "Validate production WebsiteBuildBlueprint."
      expected_positive: "Artifact is real Push-2 output with exact CompetitiveLandscape ref."
      expected_negative: "Seam probe, stale ref, or invalid integrity."
      covers: [P3-S01, P3-S02]
      blocking: true

    - property_id: P3-E03
      check: "Request/validate SEOContentBlueprint."
      expected_positive: "Real SEO artifact received and sealed."
      expected_negative: "Mock/local replacement."
      covers: [P3-S02]
      blocking: true

    - property_id: P3-E04
      check: "Compare both CompetitiveLandscape refs."
      expected_positive: "Full ArtifactRefs exactly equal."
      expected_negative: "Any mismatch causes COMPETITIVE_LANDSCAPE_MISMATCH."
      covers: [P3-S01]
      blocking: true

    - property_id: P3-E05
      check: "Compile PageContentContract twice."
      expected_positive: "Same semantic payload/digest/artifact ID."
      expected_negative: "Non-deterministic contract."
      covers: [P3-S03]
      blocking: true

    - property_id: P3-E06
      check: "Trap Website-Bot LLM calls during contract compilation."
      expected_positive: "LLM call count = 0."
      expected_negative: "Any call fails the gate."
      covers: [P3-S03]
      blocking: true

    - property_id: P3-E07
      check: "Request real StructuredContentPackage using exact sealed contract."
      expected_positive: "Real SEO-Bot package returned."
      expected_negative: "Mock/local generation."
      covers: [P3-S04, P3-S05]
      blocking: true

    - property_id: P3-E08
      check: "Compare StructuredContentPackage contract ref."
      expected_positive: "Full ArtifactRef equals exact production PageContentContract."
      expected_negative: "CONTENT_CONTRACT_HASH_MISMATCH."
      covers: [P3-S04]
      blocking: true

    - property_id: P3-E09
      check: "Inspect package validation status."
      expected_positive: "Contract and SEO validation pass; no unresolved unsupported claims."
      expected_negative: "Package rejected."
      covers: [P3-S04]
      blocking: true

    - property_id: P3-E10
      check: "Trace downstream production authority state."
      expected_positive: "Only validated WebsiteBuildBlueprint and StructuredContentPackage are exposed for Push 4."
      expected_negative: "Raw donor pages or generic content become downstream authority."
      covers: [P3-S05, P3-S06]
      blocking: true

    - property_id: P3-E11
      check: "Run lineage, route mismatch, tamper, fail-closed, and canonical repository validation."
      expected_positive: "All negative cases fail with typed errors and production gate passes."
      expected_negative: "Silent fallback or stale artifact acceptance."
      covers: [P3-S01, P3-S02, P3-S03, P3-S04, P3-S05, P3-S06]
      blocking: true

  stress_and_disconfirm:
    disconfirming_cases:
      - "SEOContentBlueprint references a different CompetitiveLandscape."
      - "Required SEO content has no compatible WebsiteBuildBlueprint slot."
      - "PageContentContract payload is tampered after sealing."
      - "StructuredContentPackage is stale."
      - "SEO-Bot becomes unavailable mid-transaction."
      - "Legacy Website-Bot generic content generator is invoked."
    assumption_failure_conditions:
      - "Push-2 WebsiteBuildBlueprint cannot validate."
      - "Shared protocol versions differ."
      - "Production route sets cannot be reconciled deterministically."
    blast_radius_notes:
      - "Do not fix convergence failures by letting an LLM merge the blueprints."
      - "Do not relax exact artifact identity into client/build matching."
    rollback_constraints:
      - "External content-generation spend is non-reversible."
      - "Preserve Push-2 artifacts during rollback."

  out_of_scope:
    - "donor harvesting redesign"
    - "DesignIntelligence"
    - "ImageAssetPlanning"
    - "site assembly"
    - "site build"
    - "QualityDelta"
    - "repair"
    - "deployment"
    - "schema evolution"

  follow_on_milestone:
    separate_plan_required: true
    items:
      - priority: P0
        change: "Push 4 — assemble the first real redesign from the validated production authorities."
        why: "The intelligence/content transaction is now real and ready for deterministic downstream consumption."

  convergence:
    current_state: preflight_blocked
    executable_when:
      - "Immutable baseline captured."
      - "Push 1 == PASS."
      - "Push 2 == PASS."
      - "Real WebsiteBuildBlueprint validates."
      - "SEO-Bot endpoint capability probe passes."
    complete_when:
      - "Both real blueprints reference the same CompetitiveLandscape."
      - "Production PageContentContract compiles deterministically with zero LLM calls."
      - "Real StructuredContentPackage references exact contract."
      - "Content validation passes."
      - "Website-Bot generic final-copy generation remains unused."
      - "Production downstream authority state is ready for Push 4."
    next_convergence_gate: "Push 4 may start only on Push-3 PASS."
    broader_work_requires_separate_plan: true
```

## Push 4 — Assembly and First Real Redesign

```yaml
plan:
  metadata:
    plan_id: website-bot.push-4.assembly-build.v1
    name: "Website-Bot Push 4 — Blueprint-Constrained Assembly and First Real Redesign Build"
    overview: >
      Consume the validated real WebsiteBuildBlueprint and StructuredContentPackage,
      translate the blueprint into a coherent design system, plan approved imagery,
      assemble exactly the planned routes/sections, serialize structured data
      deterministically, and produce one complete real candidate website build.
      This push proves the system can build what it planned. It does not yet judge
      whether the candidate is materially better than the baseline.
    schema_version: 1.0.0
    status: preflight_blocked
    is_project: true
    owner: "Cursor under operator control"
    created_at: "2026-08-14"

  todos:
    - id: P4-00
      content: "Capture immutable baseline and prove Push-3 production convergence PASS."
      status: blocked
      phase: preflight
      evidence_property_refs: [P4-E01]

    - id: P4-01
      content: "Constrain DesignIntelligence to translate WebsiteBuildBlueprint strategy into design tokens/system without altering route/section/content authority."
      status: pending
      phase: design_system
      depends_on: [P4-00]
      evidence_property_refs: [P4-E02, P4-E03]

    - id: P4-02
      content: "Implement blueprint-constrained ImageAssetPlanning using approved business/source assets and allowed image acquisition/generation policy."
      status: pending
      phase: image_planning
      depends_on: [P4-01]
      evidence_property_refs: [P4-E04]

    - id: P4-03
      content: "Ingest StructuredContentPackage as the exclusive final page-content authority and bind route/section IDs without rewriting prose."
      status: pending
      phase: content_ingestion
      depends_on: [P4-00]
      evidence_property_refs: [P4-E05]

    - id: P4-04
      content: "Constrain SiteAssembler to implement WebsiteBuildBlueprint routes and section order using validated content and design assets."
      status: pending
      phase: assembly
      depends_on: [P4-01, P4-02, P4-03]
      evidence_property_refs: [P4-E06, P4-E07]

    - id: P4-05
      content: "Serialize approved schema.org/JSON-LD structures deterministically from structured content and verified business facts."
      status: pending
      phase: structured_data
      depends_on: [P4-03]
      evidence_property_refs: [P4-E08]

    - id: P4-06
      content: "Build one real target website candidate and capture route/build/screenshot evidence."
      status: pending
      phase: site_build
      depends_on: [P4-04, P4-05]
      evidence_property_refs: [P4-E09]

    - id: P4-07
      content: "Generate Blueprint Conformance Report and run Push-4 assembly/build gate."
      status: pending
      phase: validation
      depends_on: [P4-06]
      evidence_property_refs: [P4-E10, P4-E11]

  architect_framing:
    planning_ssot: "Push-3 production artifacts plus accepted five-push architecture."
    plan_class: bounded_execution_contract
    redesign_allowed: false
    follow_on_schema_evolution_separate: true
    framing_notes: >
      Design is now an implementation layer, not a strategy authority.
      SiteAssembler implements the blueprint; it does not invent page architecture.
      Content is immutable downstream except deterministic rendering/escaping.

  immutable_baseline:
    captured_at: null
    repository: "Quantum-L9/Website-Bot"
    workspace: "active Cursor worktree"
    ssot_clone: "operator-selected Website-Bot clone"
    branch: "<CAPTURE_AT_PREFLIGHT>"
    commit_sha: "<CAPTURE_FULL_SHA_BEFORE_EXECUTION>"
    dirty: false
    artifact_hashes:
      push_3_validation_receipt: "<CAPTURE_SHA256>"
      website_build_blueprint: "<CAPTURE_PAYLOAD_DIGEST>"
      structured_content_package: "<CAPTURE_PAYLOAD_DIGEST>"
      verified_business_facts: "<CAPTURE_SHA256_OR_DIGEST>"
    allowed_local_dirt: []
    overlap_policy: stop_if_dirty_overlaps_may_modify
    verification_rule: reverify_at_execution_start
    on_drift: stop_and_replan

  objective:
    mission: >
      Produce one complete real candidate website that conforms to the production
      WebsiteBuildBlueprint and StructuredContentPackage without downstream
      reinterpretation of competitors, SEO strategy, page architecture, or final prose.
    success_properties:
      - id: P4-S01
        property: "DesignIntelligence is constrained to design-system translation."
        evidence_type: structural
        proof: "Inputs/prompts and tests show it cannot alter route/section authority."
        blocking: true

      - id: P4-S02
        property: "StructuredContentPackage is the exclusive final prose authority."
        evidence_type: runtime_behavior
        proof: "No generic content rewrite/generation calls occur during assembly."
        blocking: true

      - id: P4-S03
        property: "SiteAssembler implements planned route and section topology exactly."
        evidence_type: quality_gate
        proof: "Blueprint Conformance Report matches planned vs actual routes/sections."
        blocking: true

      - id: P4-S04
        property: "Structured-data serialization uses zero LLM calls."
        evidence_type: runtime_behavior
        proof: "LLM invocation trap remains zero during schema serialization."
        blocking: true

      - id: P4-S05
        property: "One real candidate site builds successfully."
        evidence_type: runtime_behavior
        proof: "Canonical site-build command passes and outputs inspectable candidate artifacts."
        blocking: true

      - id: P4-S06
        property: "Candidate screenshots can be captured at required representative viewports."
        evidence_type: filesystem
        proof: "Screenshot evidence exists for Push-5 quality comparison."
        blocking: true

  capability_preflight:
    phase_id: P4-PREFLIGHT
    blocking: true
    probes:
      - id: P4-P01
        probe: "Capture real branch/SHA/hashes and inspect worktree overlap."
        property: "Immutable baseline."
        pass_condition: "Actual SHA/hashes captured; overlap policy passes."
        evidence_type: command_receipt

      - id: P4-P02
        probe: "Load Push-3 receipt and production artifacts."
        property: "Convergence prerequisites are proven."
        pass_condition: "Push-3 PASS and both production artifacts validate."
        evidence_type: filesystem

      - id: P4-P03
        probe: "Probe existing DesignIntelligence, ImageAssetPlanning, SiteAssembler, schema, and SiteBuild capabilities."
        property: "Required downstream chassis exists."
        pass_condition: "Components are inspectable and can be constrained without architecture redesign."
        evidence_type: structural

      - id: P4-P04
        probe: "Probe real target baseline/business assets."
        property: "Approved business/source assets are available."
        pass_condition: "Required assets/facts resolve or are explicitly UNKNOWN."
        evidence_type: filesystem

      - id: P4-P05
        probe: "Probe site build toolchain."
        property: "Candidate can be built locally."
        pass_condition: "Repository-defined build/type dependency probe succeeds."
        evidence_type: runtime_behavior

    failed_probe_status: blocked
    advisory_debt_policy: "Unrelated UI/build debt is recorded, not repaired."
    touched_path_quality_policy: "Touched components must satisfy canonical repository checks."

  execution_envelope:
    filesystem:
      write_allow:
        - "Website-Bot DesignIntelligence implementation"
        - "Website-Bot ImageAssetPlanning implementation"
        - "Website-Bot Improve content ingestion"
        - "Website-Bot SiteAssembler implementation"
        - "deterministic schema serialization"
        - "site build output under existing generated/output locations"
        - "targeted tests and Push-4 receipts"
      write_deny:
        - "SEO-Bot source"
        - "LLM-Router source"
        - "shared protocol redesign"
        - "CompetitiveLandscape/PatternPortfolio semantics"
        - "QualityDelta/repair implementation"
        - "production deployment state"
      delete_allow:
        - "build-scoped generated candidate output only, using repository cleanup conventions"

    commands:
      allow:
        - "read-only git inspection"
        - "repository-declared typecheck/lint/test/verify/build commands"
        - "targeted screenshot/build validation"
      deny:
        - "git reset"
        - "git clean"
        - "deployment/publish"
        - "destructive external-state commands"

    network:
      mode: named_services_only
      allowed_services:
        - "configured LLM-Router upstream providers through router"
        - "approved image asset services if already part of repository policy"
        - "target source-site reads only where existing baseline/approved assets require it"

    secrets:
      access: runtime_injected_only
      redaction_required: true

    autonomous_merge: false

  side_effects_and_idempotency:
    - todo_id: P4-00
      side_effects: [filesystem_read]
      idempotency: safe_to_repeat
      retry: not_applicable
      compensation: null
      irreversible: false

    - todo_id: P4-01
      side_effects: [filesystem_mutation, network_write]
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: "Restore scoped design implementation and discard generated design-system artifact."
      irreversible: false

    - todo_id: P4-02
      side_effects: [filesystem_mutation, network_read, network_write]
      idempotency: safe_with_dedupe
      retry: bounded_retry
      compensation: "Discard build-scoped planned/generated asset artifacts; paid/request side effects are non-reversible."
      irreversible: false

    - todo_id: P4-03
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Restore scoped content-ingestion implementation."
      irreversible: false

    - todo_id: P4-04
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Restore generated candidate tree and scoped assembler code."
      irreversible: false

    - todo_id: P4-05
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Regenerate deterministic schema from immutable inputs."
      irreversible: false

    - todo_id: P4-06
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Delete build-scoped output and screenshots."
      irreversible: false

    - todo_id: P4-07
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Remove validation/conformance receipt."
      irreversible: false

  architecture_impact:
    - todo_id: P4-00
      bounded_context: "assembly assurance"
      layer: assurance
      owning_contract: "Push-3 receipt"
      prohibited: ["assembly on stale artifacts"]

    - todo_id: P4-01
      bounded_context: "design-system translation"
      layer: runtime
      owning_contract: "WebsiteBuildBlueprint"
      prohibited: ["route mutation", "section-order mutation", "SEO reinterpretation"]

    - todo_id: P4-02
      bounded_context: "image planning"
      layer: data_plane
      owning_contract: "WebsiteBuildBlueprint + approved asset policy"
      prohibited: ["competitor image reuse", "image-driven page architecture"]

    - todo_id: P4-03
      bounded_context: "final content ingestion"
      layer: data_plane
      owning_contract: "StructuredContentPackage"
      prohibited: ["prose rewrite", "generic page generation"]

    - todo_id: P4-04
      bounded_context: "site assembly"
      layer: runtime
      owning_contract: "WebsiteBuildBlueprint"
      prohibited: ["invented routes", "invented section topology"]

    - todo_id: P4-05
      bounded_context: "structured data"
      layer: data_plane
      owning_contract: "StructuredContentPackage + VerifiedBusinessFacts"
      prohibited: ["LLM schema invention"]

    - todo_id: P4-06
      bounded_context: "candidate build"
      layer: runtime
      owning_contract: "repository site-build contract"
      prohibited: ["deployment"]

    - todo_id: P4-07
      bounded_context: "blueprint conformance"
      layer: assurance
      owning_contract: "Push-4 gate"
      prohibited: ["build-success-only acceptance"]

  rollback:
    supported: true
    trigger_conditions:
      - "Design stage mutates blueprint authority."
      - "Final prose is rewritten by Website-Bot."
      - "SiteAssembler silently omits/plants routes or sections."
      - "Schema serialization invokes LLM."
      - "Candidate fails canonical build."
    code:
      mode: git_restore_scoped_paths
      details: "Restore only Push-4-touched Website-Bot paths."
    data:
      mode: custom
      details: "Delete build-scoped candidate outputs and regenerated artifacts."
    external_state:
      mode: manual_recovery
      details: "LLM/image request cost cannot be undone; deployment is prohibited."
    local_state:
      mode: restore_snapshot
      details: "Restore candidate/output snapshot or regenerate from immutable Push-3 inputs."
    verification:
      - "Push-3 artifacts remain unchanged."
      - "No production deployment occurred."
      - "No stale candidate is presented as passing."
    irreversible_operations:
      - "LLM/image service spend."
      - "External request logs."

  complexity_and_uncertainty:
    complexity: high
    uncertainty: medium
    blast_radius: high
    architectural_boundaries_crossed: 4
    external_systems_touched: 2
    migration_required: false
    unknown_dependency_count: 0

  execution_DAG:
    graph_type: directed_acyclic_graph
    nodes: [P4-00, P4-01, P4-02, P4-03, P4-04, P4-05, P4-06, P4-07]
    edges:
      - {from: P4-00, to: P4-01}
      - {from: P4-00, to: P4-03}
      - {from: P4-01, to: P4-02}
      - {from: P4-01, to: P4-04}
      - {from: P4-02, to: P4-04}
      - {from: P4-03, to: P4-04}
      - {from: P4-03, to: P4-05}
      - {from: P4-04, to: P4-06}
      - {from: P4-05, to: P4-06}
      - {from: P4-06, to: P4-07}
    parallelism_rules:
      - "Design translation and content ingestion may proceed independently after Push-3 preflight."
      - "Image planning waits for design direction."
      - "Assembly waits for design, images, and content."
      - "SiteBuild waits for assembled site plus deterministic schema."
    topological_sort_required: true
    cycle_policy: stop_and_repair_before_execution

  property_evidence_matrix:
    - property_id: P4-E01
      check: "Verify immutable baseline and Push-3 gate."
      expected_positive: "Push-3 PASS and exact production artifact digests captured."
      expected_negative: "Stale/unverified artifact blocks."
      covers: [P4-S01, P4-S02]
      blocking: true

    - property_id: P4-E02
      check: "Inspect DesignIntelligence inputs/prompts."
      expected_positive: "Consumes WebsiteBuildBlueprint; outputs design system only."
      expected_negative: "Invents routes/sections/SEO/content strategy."
      covers: [P4-S01]
      blocking: true

    - property_id: P4-E03
      check: "Run mutation-authority negative fixture."
      expected_positive: "Design cannot alter blueprint route/section identity."
      expected_negative: "Silent blueprint mutation."
      covers: [P4-S01]
      blocking: true

    - property_id: P4-E04
      check: "Inspect image plan lineage and provenance."
      expected_positive: "Only approved/source/generated/licensed assets; no competitor asset reuse."
      expected_negative: "Competitor image reuse or unexplained provenance."
      covers: [P4-S01]
      blocking: true

    - property_id: P4-E05
      check: "Trap Website-Bot final-copy generation during content ingestion/assembly."
      expected_positive: "Call count = 0 and exact StructuredContentPackage text is bound."
      expected_negative: "Rewrite/generation occurs."
      covers: [P4-S02]
      blocking: true

    - property_id: P4-E06
      check: "Compare planned vs assembled routes."
      expected_positive: "Exact route identity set."
      expected_negative: "Missing/extra route."
      covers: [P4-S03]
      blocking: true

    - property_id: P4-E07
      check: "Compare planned vs assembled section topology."
      expected_positive: "Required sections/order/content slots conform."
      expected_negative: "Material silent omission or invention."
      covers: [P4-S03]
      blocking: true

    - property_id: P4-E08
      check: "Trap LLM calls during structured-data serialization."
      expected_positive: "LLM call count = 0."
      expected_negative: "Any LLM schema-generation call."
      covers: [P4-S04]
      blocking: true

    - property_id: P4-E09
      check: "Run canonical real site build."
      expected_positive: "Build succeeds; routes/assets resolve; screenshots can be captured."
      expected_negative: "Compile/build/runtime asset failure."
      covers: [P4-S05, P4-S06]
      blocking: true

    - property_id: P4-E10
      check: "Generate Blueprint Conformance Report."
      expected_positive: "Planned/actual route, section, CTA, content-slot mapping is explicit."
      expected_negative: "Only build exit code supplied."
      covers: [P4-S03, P4-S05]
      blocking: true

    - property_id: P4-E11
      check: "Run canonical repository validation."
      expected_positive: "All blocking checks pass and Push-4 receipt is persisted."
      expected_negative: "Any unresolved blocking defect."
      covers: [P4-S01, P4-S02, P4-S03, P4-S04, P4-S05, P4-S06]
      blocking: true

  stress_and_disconfirm:
    disconfirming_cases:
      - "Blueprint contains a component class not supported by assembler."
      - "StructuredContentPackage section identity cannot map to blueprint section."
      - "Approved image asset is missing."
      - "Design reasoning proposes topology changes."
      - "Schema stage attempts to generate new FAQ prose."
      - "Build succeeds despite missing required route."
    assumption_failure_conditions:
      - "Push-3 production artifacts fail integrity."
      - "Assembler cannot implement canonical blueprint without shared-schema change."
      - "Site-build toolchain is unavailable."
    blast_radius_notes:
      - "Do not change blueprint to fit an implementation shortcut without returning to prior gate."
      - "Do not let build success override conformance failures."
    rollback_constraints:
      - "Generated build artifacts may be deleted; external request spend cannot be recovered."

  out_of_scope:
    - "QualityDelta"
    - "baseline-vs-candidate improvement judgment"
    - "automatic repair"
    - "deployment/release"
    - "new competitor research"
    - "content regeneration"
    - "SEO-Bot changes"
    - "shared architecture redesign"

  follow_on_milestone:
    separate_plan_required: true
    items:
      - priority: P0
        change: "Push 5 — prove the candidate is materially improved and bound repair/release behavior."
        why: "A successful build does not prove product success."

  convergence:
    current_state: preflight_blocked
    executable_when:
      - "Immutable baseline captured."
      - "Push-3 gate PASS."
      - "Production WebsiteBuildBlueprint and StructuredContentPackage validate."
      - "Required downstream capabilities pass preflight."
    complete_when:
      - "Design system is blueprint-constrained."
      - "StructuredContentPackage remains final prose authority."
      - "Candidate route/section topology conforms."
      - "Schema serialization is deterministic."
      - "One real candidate website builds."
      - "Representative candidate screenshots exist."
      - "Push-4 Blueprint Conformance Report passes."
    next_convergence_gate: "Push 5 may start only on Push-4 PASS."
    broader_work_requires_separate_plan: true
```

## Push 5 — Quality Delta, Bounded Repair, Final Golden Proof

```yaml
plan:
  metadata:
    plan_id: website-bot.push-5.quality-delta-golden-proof.v1
    name: "Website-Bot Push 5 — Quality Delta, Bounded Repair, and Full-System Golden Proof"
    overview: >
      Compare the real Push-4 candidate against the exact captured source-site
      baseline, combine deterministic quality checks with bounded visual reasoning,
      emit a canonical QualityDeltaReport, permit at most one targeted repair cycle,
      re-evaluate the repaired candidate, and prove one full genuine no-mock
      Website-Bot + SEO-Bot redesign transaction from baseline through
      release-ready candidate. This push closes the original failure mode where
      a successful build could still produce a worse website.
    schema_version: 1.0.0
    status: preflight_blocked
    is_project: true
    owner: "Cursor under operator control"
    created_at: "2026-08-14"

  todos:
    - id: P5-00
      content: "Capture immutable baseline and bind the exact source baseline and Push-4 candidate identities."
      status: blocked
      phase: preflight
      evidence_property_refs: [P5-E01]

    - id: P5-01
      content: "Implement deterministic baseline-vs-candidate checks for business truth, routes/content, links, CTA availability, accessibility/responsive integrity, assets, and SEO contract compliance."
      status: pending
      phase: deterministic_quality
      depends_on: [P5-00]
      evidence_property_refs: [P5-E02, P5-E03]

    - id: P5-02
      content: "Implement paired visual comparison over equivalent baseline/candidate viewports for hierarchy, legibility, coherence, mobile usability, conversion clarity, and rendering defects."
      status: pending
      phase: visual_quality
      depends_on: [P5-00]
      evidence_property_refs: [P5-E04, P5-E05]

    - id: P5-03
      content: "Produce sealed QualityDeltaReport with explicit IMPROVED/NON_REGRESSED/REGRESSED/INCONCLUSIVE outcomes and evidence."
      status: pending
      phase: quality_delta
      depends_on: [P5-01, P5-02]
      evidence_property_refs: [P5-E06]

    - id: P5-04
      content: "Implement deterministic RepairPlan generation constrained only to failed dimensions."
      status: pending
      phase: repair_plan
      depends_on: [P5-03]
      evidence_property_refs: [P5-E07]

    - id: P5-05
      content: "Permit at most one automatic targeted repair cycle, rebuild affected candidate portions, and rerun the complete quality evaluation."
      status: pending
      phase: bounded_repair
      depends_on: [P5-04]
      evidence_property_refs: [P5-E08, P5-E09]

    - id: P5-06
      content: "Implement release-readiness gate requiring successful build, preserved business truth, valid SEO/content contract, and no unresolved material regression."
      status: pending
      phase: release_gate
      depends_on: [P5-03, P5-05]
      evidence_property_refs: [P5-E10]

    - id: P5-07
      content: "Run one full-system golden execution with genuine artifacts and no mocks from baseline through release-ready candidate; audit artifact chain and LLM calls."
      status: pending
      phase: golden_run
      depends_on: [P5-06]
      evidence_property_refs: [P5-E11, P5-E12, P5-E13]

  architect_framing:
    planning_ssot: "Accepted five-push Website-Bot architecture and Push-4 candidate/build evidence."
    plan_class: bounded_execution_contract
    redesign_allowed: false
    follow_on_schema_evolution_separate: true
    framing_notes: >
      This is an assurance/convergence push, not another redesign stage.
      Quality evaluation must prove properties rather than rely on command success.
      Subjective judgments must use evidence and categorical outcomes rather than
      invented numerical precision. No deployment is required for convergence.

  immutable_baseline:
    captured_at: null
    repository: "Quantum-L9/Website-Bot"
    workspace: "active Cursor worktree"
    ssot_clone: "operator-selected Website-Bot clone"
    branch: "<CAPTURE_AT_PREFLIGHT>"
    commit_sha: "<CAPTURE_FULL_SHA_BEFORE_EXECUTION>"
    dirty: false
    artifact_hashes:
      push_4_validation_receipt: "<CAPTURE_SHA256>"
      source_baseline_artifact: "<CAPTURE_PAYLOAD_DIGEST>"
      website_build_blueprint: "<CAPTURE_PAYLOAD_DIGEST>"
      page_content_contract: "<CAPTURE_PAYLOAD_DIGEST>"
      structured_content_package: "<CAPTURE_PAYLOAD_DIGEST>"
      candidate_build: "<CAPTURE_SHA256_OR_DIGEST>"
    allowed_local_dirt: []
    overlap_policy: stop_if_dirty_overlaps_may_modify
    verification_rule: reverify_at_execution_start
    on_drift: stop_and_replan

  objective:
    mission: >
      Prove that the new candidate is materially improved or non-regressed across
      all blocking dimensions, bound automatic repair to one targeted iteration,
      fail closed on persistent material defects, and complete one real no-mock
      golden run of the entire website-improvement system.
    success_properties:
      - id: P5-S01
        property: "Quality comparison uses the exact source baseline and exact candidate."
        evidence_type: proof_receipt
        proof: "Baseline and candidate digests are persisted in QualityDeltaReport."
        blocking: true

      - id: P5-S02
        property: "Deterministic quality dimensions contain no unresolved material regressions."
        evidence_type: quality_gate
        proof: "Business truth, routes/content, links, CTA, accessibility/responsive, assets, SEO checks pass."
        blocking: true

      - id: P5-S03
        property: "Visual quality is evidence-grounded and contains no unresolved material regression."
        evidence_type: quality_gate
        proof: "Paired screenshots plus categorical findings for required visual dimensions."
        blocking: true

      - id: P5-S04
        property: "Automatic repair is bounded to one targeted iteration."
        evidence_type: runtime_behavior
        proof: "Retry/repair counter and targeted diff prove one maximum automatic cycle."
        blocking: true

      - id: P5-S05
        property: "Persistent second failure stops release readiness."
        evidence_type: runtime_behavior
        proof: "Negative fixture produces terminal failure after one repair."
        blocking: true

      - id: P5-S06
        property: "Full golden run uses genuine artifacts and no mock substitution between stages."
        evidence_type: proof_receipt
        proof: "Complete artifact chain resolves from baseline through QualityDeltaReport."
        blocking: true

      - id: P5-S07
        property: "LLM call audit contains no forbidden operations."
        evidence_type: proof_receipt
        proof: "CompetitiveLandscape and PageContentContract remain zero-LLM; Website-Bot final-copy generation remains absent."
        blocking: true

      - id: P5-S08
        property: "System reaches release-ready candidate state."
        evidence_type: quality_gate
        proof: "Release gate returns YES with no silent waiver."
        blocking: true

  capability_preflight:
    phase_id: P5-PREFLIGHT
    blocking: true
    probes:
      - id: P5-P01
        probe: "Capture real branch/SHA/hashes and inspect overlap."
        property: "Immutable code baseline."
        pass_condition: "Full SHA/hashes captured; overlap policy passes."
        evidence_type: command_receipt

      - id: P5-P02
        probe: "Load Push-4 gate receipt and candidate identity."
        property: "Real build candidate is proven."
        pass_condition: "Push-4 == PASS and candidate artifact resolves."
        evidence_type: filesystem

      - id: P5-P03
        probe: "Load exact baseline site evidence/screenshots."
        property: "Comparison baseline is real and build-specific."
        pass_condition: "Baseline digest and equivalent viewport evidence resolve."
        evidence_type: filesystem

      - id: P5-P04
        probe: "Probe deterministic quality tooling."
        property: "Required non-LLM checks are available."
        pass_condition: "Link/route/content/accessibility/responsive/build checks can execute."
        evidence_type: runtime_behavior

      - id: P5-P05
        probe: "Probe visual-delta reasoning route."
        property: "Vision comparison is available without search routing."
        pass_condition: "Expected visual reasoning task resolves through approved router policy."
        evidence_type: runtime_behavior

      - id: P5-P06
        probe: "Probe real SEO-Bot and donor/network capabilities required for full golden rerun."
        property: "Full system can execute without mocks."
        pass_condition: "Required services and credentials are available."
        evidence_type: network_read

    failed_probe_status: blocked
    advisory_debt_policy: "Non-blocking quality ideas are deferred until after golden-run convergence."
    touched_path_quality_policy: "All Push-5 paths must satisfy canonical repository validation."

  execution_envelope:
    filesystem:
      write_allow:
        - "Website-Bot QualityDelta implementation"
        - "bounded RepairPlan/repair orchestration"
        - "quality receipts/reports"
        - "build-scoped repaired candidate output"
        - "targeted tests and golden-run evidence"
      write_deny:
        - "SEO-Bot source"
        - "LLM-Router source"
        - "shared protocol redesign"
        - "new product features"
        - "production deployment infrastructure"
        - "unrelated site templates/components"
      delete_allow:
        - "build-scoped candidate/repaired outputs using repository cleanup conventions"

    commands:
      allow:
        - "read-only git inspection"
        - "repository-declared test/typecheck/lint/verify/build commands"
        - "quality/a11y/link/screenshot validation commands already available or narrowly added"
        - "full local golden-run command"
      deny:
        - "git reset"
        - "git clean"
        - "production deploy/publish"
        - "unbounded repair loops"
        - "destructive external-state commands"

    network:
      mode: named_services_only
      allowed_services:
        - "configured SEO-Bot build-intelligence endpoint"
        - "CompetitiveLandscape-selected donor domains"
        - "configured LLM-Router upstream providers via router only"
        - "source baseline website where live evidence is explicitly required"

    secrets:
      access: runtime_injected_only
      redaction_required: true

    autonomous_merge: false

  side_effects_and_idempotency:
    - todo_id: P5-00
      side_effects: [filesystem_read]
      idempotency: safe_to_repeat
      retry: not_applicable
      compensation: null
      irreversible: false

    - todo_id: P5-01
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Regenerate deterministic results from immutable baseline/candidate."
      irreversible: false

    - todo_id: P5-02
      side_effects: [filesystem_mutation, network_write]
      idempotency: safe_with_dedupe
      retry: retry_once
      compensation: "Discard visual analysis artifact; model spend cannot be undone."
      irreversible: false

    - todo_id: P5-03
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Regenerate report from immutable quality evidence."
      irreversible: false

    - todo_id: P5-04
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Discard RepairPlan."
      irreversible: false

    - todo_id: P5-05
      side_effects: [filesystem_mutation, network_write]
      idempotency: unsafe_blind_repeat
      retry: none
      compensation: "Restore pre-repair candidate output/code state; model spend remains."
      irreversible: false

    - todo_id: P5-06
      side_effects: [filesystem_mutation]
      idempotency: safe_to_repeat
      retry: retry_once
      compensation: "Recompute release gate from immutable final quality evidence."
      irreversible: false

    - todo_id: P5-07
      side_effects: [filesystem_mutation, network_read, network_write]
      idempotency: safe_with_dedupe
      retry: manual_only
      compensation: "Discard golden-run local artifacts; external reads/model spend remain."
      irreversible: false

  architecture_impact:
    - todo_id: P5-00
      bounded_context: "quality baseline identity"
      layer: assurance
      owning_contract: "BaselineSiteProfile + candidate identity"
      prohibited: ["stale baseline"]

    - todo_id: P5-01
      bounded_context: "deterministic quality assurance"
      layer: assurance
      owning_contract: "QualityDelta deterministic checks"
      prohibited: ["LLM use for deterministic properties"]

    - todo_id: P5-02
      bounded_context: "visual quality assurance"
      layer: assurance
      owning_contract: "visual-delta policy"
      prohibited: ["fake precision", "search routing"]

    - todo_id: P5-03
      bounded_context: "quality verdict"
      layer: assurance
      owning_contract: "QualityDeltaReport"
      prohibited: ["silent regression", "unsupported aggregate score"]

    - todo_id: P5-04
      bounded_context: "repair control"
      layer: control_plane
      owning_contract: "RepairPlan"
      prohibited: ["whole-site regeneration for localized defect"]

    - todo_id: P5-05
      bounded_context: "bounded repair execution"
      layer: runtime
      owning_contract: "repair budget = 1"
      prohibited: ["second automatic repair", "unbounded loop"]

    - todo_id: P5-06
      bounded_context: "release readiness"
      layer: policy
      owning_contract: "release quality gate"
      prohibited: ["silent waiver", "build-success-only release"]

    - todo_id: P5-07
      bounded_context: "full-system convergence"
      layer: assurance
      owning_contract: "five-push golden-run contract"
      prohibited: ["mock substitution", "forbidden LLM operation"]

  rollback:
    supported: true
    trigger_conditions:
      - "QualityDelta evaluates stale/mismatched baseline."
      - "Repair exceeds one automatic iteration."
      - "Repair changes passing unrelated areas materially."
      - "Second quality evaluation still has material regression."
      - "Golden run contains a mock or forbidden LLM call."
    code:
      mode: git_restore_scoped_paths
      details: "Restore Push-5-touched quality/repair implementation."
    data:
      mode: restore_snapshot
      details: "Restore pre-repair candidate and remove build-scoped repaired outputs/reports."
    external_state:
      mode: manual_recovery
      details: "No production deployment is permitted; external request/model spend cannot be undone."
    local_state:
      mode: restore_snapshot
      details: "Restore pre-repair candidate and golden-run local evidence snapshot."
    verification:
      - "Push-4 candidate remains recoverable."
      - "No production deployment occurred."
      - "Repair counter resets only on a new build transaction, not within same failed run."
      - "Golden-run failed artifacts are not marked release-ready."
    irreversible_operations:
      - "LLM/vision/token spend."
      - "External HTTP observability/logging."

  complexity_and_uncertainty:
    complexity: high
    uncertainty: medium
    blast_radius: high
    architectural_boundaries_crossed: 5
    external_systems_touched: 4
    migration_required: false
    unknown_dependency_count: 0

  execution_DAG:
    graph_type: directed_acyclic_graph
    nodes: [P5-00, P5-01, P5-02, P5-03, P5-04, P5-05, P5-06, P5-07]
    edges:
      - {from: P5-00, to: P5-01}
      - {from: P5-00, to: P5-02}
      - {from: P5-01, to: P5-03}
      - {from: P5-02, to: P5-03}
      - {from: P5-03, to: P5-04}
      - {from: P5-04, to: P5-05}
      - {from: P5-03, to: P5-06}
      - {from: P5-05, to: P5-06}
      - {from: P5-06, to: P5-07}
    parallelism_rules:
      - "Deterministic and visual baseline comparison may run in parallel after identity lock."
      - "Repair executes only if QualityDelta has blocking regression."
      - "If initial QualityDelta passes, P5-05 is skipped and P5-06 consumes initial report."
      - "No second automatic repair node may be introduced."
    topological_sort_required: true
    cycle_policy: stop_and_repair_before_execution

  property_evidence_matrix:
    - property_id: P5-E01
      check: "Compare source baseline and candidate identities to persisted build refs."
      expected_positive: "Exact expected digests resolve."
      expected_negative: "Stale/mismatched baseline or candidate blocks."
      covers: [P5-S01]
      blocking: true

    - property_id: P5-E02
      check: "Run deterministic business/route/content/link/CTA/asset/SEO checks."
      expected_positive: "No unresolved blocking failures."
      expected_negative: "Any material failure is REGRESSED."
      covers: [P5-S02]
      blocking: true

    - property_id: P5-E03
      check: "Run accessibility/responsive integrity checks."
      expected_positive: "Candidate is improved or non-regressed."
      expected_negative: "Material accessibility/overflow regression."
      covers: [P5-S02]
      blocking: true

    - property_id: P5-E04
      check: "Capture equivalent baseline/candidate screenshots."
      expected_positive: "Comparable viewport evidence exists."
      expected_negative: "Visual judgment without paired evidence."
      covers: [P5-S03]
      blocking: true

    - property_id: P5-E05
      check: "Evaluate hierarchy/legibility/coherence/mobile/conversion/rendering."
      expected_positive: "Each dimension has categorical verdict and evidence."
      expected_negative: "Invented numerical precision or unsupported judgment."
      covers: [P5-S03]
      blocking: true

    - property_id: P5-E06
      check: "Validate QualityDeltaReport."
      expected_positive: "Every blocking dimension is explicit; no silent regression."
      expected_negative: "Aggregate PASS hides failing dimension."
      covers: [P5-S02, P5-S03]
      blocking: true

    - property_id: P5-E07
      check: "Inspect RepairPlan for a controlled failing fixture."
      expected_positive: "Only failed dimensions/components are targeted."
      expected_negative: "Whole-site regeneration."
      covers: [P5-S04]
      blocking: true

    - property_id: P5-E08
      check: "Execute one repairable-defect fixture."
      expected_positive: "Exactly one targeted repair followed by full re-evaluation."
      expected_negative: "Passing areas regenerated materially or multiple automatic retries."
      covers: [P5-S04]
      blocking: true

    - property_id: P5-E09
      check: "Execute persistent-failure fixture."
      expected_positive: "Second material failure stops with terminal quality failure."
      expected_negative: "Another automatic repair or silent waiver."
      covers: [P5-S05]
      blocking: true

    - property_id: P5-E10
      check: "Evaluate release-readiness gate."
      expected_positive: "YES only when build/business/SEO/content/deterministic/visual conditions all pass."
      expected_negative: "Build success alone produces release-ready."
      covers: [P5-S08]
      blocking: true

    - property_id: P5-E11
      check: "Run one genuine full-system golden execution."
      expected_positive: "No mocks between baseline, SEO-Bot, donor intelligence, blueprint, content, assembly, build, quality."
      expected_negative: "Fixture substitution in production chain."
      covers: [P5-S06]
      blocking: true

    - property_id: P5-E12
      check: "Audit complete artifact chain."
      expected_positive: "Baseline, CompetitiveLandscape, PatternPortfolio, WebsiteBuildBlueprint, SEOContentBlueprint, PageContentContract, StructuredContentPackage, CandidateBuild, QualityDeltaReport refs all resolve."
      expected_negative: "Missing/stale/unresolved artifact edge."
      covers: [P5-S06]
      blocking: true

    - property_id: P5-E13
      check: "Audit every LLM operation during golden run."
      expected_positive: "Expected reasoning calls only; CompetitiveLandscape/PageContentContract/Website-Bot-final-copy forbidden calls absent."
      expected_negative: "Any forbidden operation."
      covers: [P5-S07]
      blocking: true

  stress_and_disconfirm:
    disconfirming_cases:
      - "Candidate builds but omits a key source business fact."
      - "Candidate visually improves desktop while regressing mobile."
      - "Candidate improves aesthetics but loses primary CTA availability."
      - "SEO contract passes but accessibility materially regresses."
      - "Visual evaluator returns unsupported numeric scoring."
      - "Repair fixes one component but modifies unrelated passing pages."
      - "Second repair would be required."
      - "Golden run silently substitutes fixtures for real SEO/donor operations."
    assumption_failure_conditions:
      - "Push-4 candidate identity cannot be proven."
      - "Equivalent baseline screenshots cannot be produced."
      - "Required external services for no-mock golden run are unavailable."
      - "Quality dimensions cannot distinguish blocking from advisory issues."
    blast_radius_notes:
      - "A worse candidate must fail even if all code/tests compile."
      - "Do not widen repair budget to achieve convergence."
      - "Do not convert INCONCLUSIVE into PASS without evidence."
    rollback_constraints:
      - "No deployment means release-readiness rollback remains local."
      - "External request/model costs remain irreversible."

  out_of_scope:
    - "production deployment"
    - "multi-niche generalization"
    - "continuous autonomous repair"
    - "more than one automatic repair cycle"
    - "new ranking algorithms"
    - "new competitor discovery architecture"
    - "schema evolution"
    - "post-launch SEO feedback implementation beyond existing registration"
    - "optimization after the first proven golden run"

  follow_on_milestone:
    separate_plan_required: true
    items:
      - priority: P1
        change: "Tune design/content quality using evidence from the first proven golden run."
        why: "After system convergence, remaining work is optimization rather than architecture."
      - priority: P1
        change: "Operationalize repeatable golden-run regression fixtures across additional niches."
        why: "Generalization should follow proof on one real representative target."

  convergence:
    current_state: preflight_blocked
    executable_when:
      - "Immutable baseline captured."
      - "Push-4 gate PASS."
      - "Exact source baseline and candidate identities resolve."
      - "Quality and visual capabilities pass preflight."
      - "Real external services required by golden run are available."
    complete_when:
      - "QualityDeltaReport exists against exact baseline/candidate."
      - "All blocking deterministic dimensions are improved/non-regressed."
      - "All blocking visual dimensions are improved/non-regressed or explicitly evidence-supported non-regressions."
      - "Automatic repair is proven bounded to one targeted iteration."
      - "Persistent second failure is proven terminal."
      - "Release-readiness gate returns YES."
      - "One no-mock full-system golden run succeeds."
      - "Complete artifact chain resolves."
      - "LLM audit contains zero forbidden operations."
    next_convergence_gate: "Five-push implementation converged; subsequent work is optimization under a separate plan."
    broader_work_requires_separate_plan: true
```

These now make the five-push sequence mechanically stronger:

**Push 1 proves transport → Push 2 proves intelligence → Push 3 proves contractual convergence → Push 4 proves construction → Push 5 proves improvement.**

And each one has its own preflight, bounded mutation envelope, side-effect/retry semantics, rollback, DAG, adversarial evidence matrix, and explicit convergence gate rather than an informal “if it works, continue.”
