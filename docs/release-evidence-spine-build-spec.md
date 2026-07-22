<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Website-Bot Release Evidence Spine

## Comprehensive Build Specification

```yaml
spec:
  id: website-bot.release-evidence-spine.build-spec.v1
  version: 1.0.0
  status: ready_for_implementation
  date: 2026-07-20
  target_repository: Quantum-L9/Website-Bot
  consumer_repository: Quantum-L9/SEO-Bot
  component_name: Release Evidence Spine
  component_role: authoritative_build_publication_deployment_and_handoff_evidence_subsystem
  supersedes:
    - unmerged_INT-01_evidence_assumptions
    - optional_BuildContext_evidence_chaining
    - handoff_emitter_owned_proof_assembly
  source_alignment:
    live_website_bot_main: 25174e3476d614e87189de0cc48a687aad0a2a14
    reference_pack: website-bot-complete-site-factory-v1.zip
  implementation_posture:
    fail_closed: true
    deterministic: true
    resumable: true
    secret_safe: true
    artifact_backed: true
    no_fake_validation: true
```

---

## 1. Executive mandate

Build and merge the complete evidence-producing subsystem that the Website-Bot v3 handoff emitter requires.

The v3 emitter must stop depending on evidence objects that happen to be present in memory. The authoritative Website-Bot pipeline must create, validate, persist, rehydrate, correlate, and expose the following evidence chain:

```text
AssemblyManifest
    -> BuildProof
    -> PublicationEvidence
    -> DeploymentEvidence
    -> ReleaseReceipt
    -> WebsiteFactoryHandoffV3
    -> SeoBotRegistrationAck
```

The subsystem is complete only when a clean checkout of `Quantum-L9/Website-Bot` can execute the configured pipeline mode and produce every required evidence artifact without depending on an unmerged overlay, hidden workspace state, prior chat output, or manually injected `BuildContext` properties.

The v3 emitter is the final consumer of the chain. It is not the owner, generator, fallback parser, or repair layer for missing upstream evidence.

---

## 2. Confirmed problem statement

### 2.1 Current integration defect

The consolidated pack includes a v3 handoff emitter that expects:

- `ctx.buildProof`
- `ctx.publicationEvidence`
- `ctx.deploymentEvidence`
- `ctx.releaseReceipt`

Those objects originated in an unmerged INT-01 overlay rather than the live repository's authoritative pipeline.

The live Website-Bot repository still exposes the older ten-stage execution model and the v2 handoff path. The live pipeline does not own the full evidence lifecycle described by the packaged v3 emitter.

Therefore, the pack currently has a contract consumer whose producer chain is not guaranteed to exist after ordinary repository application.

### 2.2 Failure modes

Without this component, the following failures are possible:

1. The v3 emitter compiles only when overlay-specific types and files are copied into the repository.
2. A stage succeeds but its evidence exists only in memory and disappears on process failure.
3. A resumed or durable workflow cannot reconstruct the release chain.
4. Publication can occur without a persisted local build proof.
5. Deployment can occur without a persisted publication receipt.
6. A release receipt can be synthesized from mutually inconsistent evidence.
7. Handoff can be emitted from a stale or partial `BuildContext`.
8. SEO-Bot can receive a structurally valid contract that was not produced by an authoritative release transaction.
9. Tests can pass by directly attaching fake evidence objects to a fixture context rather than exercising real stage outputs.
10. Documentation can describe P-B through P-E as implemented while the live repository still lacks the authoritative files and wiring.

### 2.3 Root cause

The evidence chain was treated as a collection of stage-local optional fields instead of a first-class subsystem with:

- one owner;
- versioned contracts;
- canonical storage paths;
- atomic persistence;
- schema validation;
- correlation rules;
- resumable state;
- deterministic identity;
- pipeline gating;
- CI proof;
- migration and rollback behavior.

---

## 3. Authority order

Implementation decisions must follow this order:

1. Current explicit operator instruction.
2. This build specification.
3. Verified live repository facts.
4. Existing public Website-Bot and SEO-Bot contracts.
5. Existing tests that reflect verified intended behavior.
6. The consolidated site-factory pack as a harvest source.
7. Existing repository coding and package conventions.
8. Generic correctness and security requirements.
9. `Unknown`.

When a pack file conflicts with live repository behavior, do not silently prefer the pack. Record the conflict, choose the behavior required by this specification, and update tests and documentation together.

---

## 4. Component identity

### 4.1 Canonical name

`Release Evidence Spine`

### 4.2 Responsibility

The component owns the release proof lifecycle from generated Astro source through SEO-Bot maintenance activation.

It owns:

- evidence contracts;
- evidence artifact persistence;
- deterministic evidence IDs and digests;
- evidence correlation;
- mode-specific proof gates;
- release receipt assembly;
- release evidence rehydration;
- evidence index generation;
- handoff readiness evaluation;
- evidence validation commands;
- evidence-specific tests and fixtures.

It does not own:

- LLM content generation;
- design generation;
- Astro page composition logic;
- GitHub or Vercel account provisioning;
- SEO-Bot's maintenance mutations;
- secret storage;
- human approval policy;
- production domain assignment;
- generic pipeline logging.

### 4.3 Architectural position

```text
Website-Bot pipeline stages
        |
        v
Release Evidence Spine
        |
        +--> local evidence files
        +--> BuildDB evidence index
        +--> CI artifacts
        +--> WebsiteFactoryHandoffV3
        |
        v
SEO-Bot readiness verifier
```

---

## 5. Goals

1. Make the full evidence chain part of the live Website-Bot repository.
2. Ensure every remote mutation is preceded by the required persisted proof.
3. Ensure every downstream proof names and verifies its upstream proof.
4. Make the pipeline resumable without reconstructing evidence from logs.
5. Make evidence artifacts deterministic except for explicitly volatile timestamps and provider IDs.
6. Make handoff v3 consume one validated release bundle rather than several optional context fields.
7. Prevent release success when commit, source, branch, project, or deployment identities disagree.
8. Support plan, local-proof, publish-proof, and end-to-end modes without ambiguous success claims.
9. Make deterministic local tests prove evidence production and failure behavior.
10. Make credential-bound integration tests prove the same contracts against disposable GitHub and Vercel resources.
11. Preserve secret references without persisting secret values.
12. Align the standard CLI pipeline, GitHub Actions workflows, and Inngest durable wrapper.

---

## 6. Non-goals

This component must not:

1. Create a second pipeline beside the existing `PipelineRunner`.
2. make the handoff emitter responsible for repairing missing evidence.
3. Treat logs as canonical proof.
4. Infer a commit SHA from a deployment URL.
5. Treat a Vercel deploy-hook HTTP acceptance as deployment completion.
6. Treat a GitHub API request as publication success before the branch ref is verified.
7. Store GitHub tokens, Vercel tokens, deploy-hook URLs, or SEO-Bot bearer tokens inside evidence files.
8. Introduce an event-sourced platform or external database solely for evidence.
9. Implement preview promotion or production rollback unless separately authorized.
10. Expand P-F provisioning scope.
11. Rebuild SEO-Bot's internal maintenance engine.
12. Preserve obsolete documentation claims that conflict with executable behavior.

---

## 7. Highest-level invariant

A successful end-to-end release is valid only when all of the following are true:

```text
assembly.source_digest
  == build.source_digest
  == publication.source_digest
  == release.source_digest

publication.commit_sha
  == deployment.requested_commit_sha
  == deployment.observed_commit_sha
  == handoff.site.repository.commit_sha
  == handoff.site.deployment.observed_commit_sha

release.status == succeeded
handoff.proof.release_receipt_id == release.receipt_id
seo_bot_ack.verified_commit_sha == publication.commit_sha
```

No stage may downgrade these equality requirements to warnings.

---

## 8. Canonical execution modes

```ts
export type ExecutionMode =
  | 'plan'
  | 'local-proof'
  | 'publish-proof'
  | 'end-to-end';
```

### 8.1 Plan

Permitted:

- validate configuration;
- calculate planned evidence paths;
- identify required gates;
- emit an in-memory plan result;
- report missing credentials and targets.

Forbidden:

- write generated site source;
- install packages;
- publish to GitHub;
- deploy to Vercel;
- write success evidence;
- call SEO-Bot registration.

Receipt status:

```text
planned
```

### 8.2 Local proof

Required evidence:

- `AssemblyManifest`
- `BuildProof`
- `ReleaseReceipt(status=partial)`

Forbidden:

- GitHub publication;
- Vercel deployment;
- SEO-Bot maintenance activation.

### 8.3 Publish proof

Required evidence:

- `AssemblyManifest`
- `BuildProof`
- `PublicationEvidence`
- `ReleaseReceipt(status=partial)`

Forbidden:

- claiming deployed status;
- SEO-Bot maintenance activation.

### 8.4 End to end

Required evidence:

- `AssemblyManifest`
- `BuildProof`
- `PublicationEvidence`
- `DeploymentEvidence`
- `ReleaseReceipt(status=succeeded)`
- `WebsiteFactoryHandoffV3`
- when auto-registration is enabled, `SeoBotRegistrationAck`

End-to-end mode must fail when any required artifact is missing, partial, invalid, or uncorrelated.

---

## 9. Canonical stage order

```text
1.  domain-spec-loader
2.  provision-client             conditional P-F
3.  unknown-resolver
4.  design-intelligence
5.  content-generation
6.  schema-generator
7.  site-assembler
8.  posthog-snippet
9.  site-build
10. client-source-publish
11. vercel-deploy
12. release-receipt
13. seo-baseline
14. visual-qa
15. handoff-emitter
```

### 9.1 Ordering rules

- `site-build` must not run before `site-assembler`.
- `client-source-publish` must not run before `site-build` has persisted a passed `BuildProof`.
- `vercel-deploy` must not run before `PublicationEvidence` is persisted and revalidated.
- `release-receipt` must run after the last proof boundary required by the selected mode.
- `handoff-emitter` must not build proof from stage-local fields. It must load the validated release bundle from the evidence store.
- SEO and visual QA may enrich release evidence after deployment, but they must not alter source, publication, or deployment identity.
- If QA is required for handoff activation, the final receipt must be finalized after QA. See Section 25 for the recommended two-step receipt model.

---

## 10. Evidence artifact directory

All release evidence must live under one build-specific root:

```text
build/evidence/<client-id>/<build-id>/
├── evidence-index.json
├── assembly-manifest.json
├── build-proof.json
├── publication-evidence.json
├── deployment-evidence.json
├── release-receipt.json
├── handoff-v3.json
├── handoff-v3.yaml
├── seo-bot-registration-ack.json
├── checkpoints/
│   ├── site-assembler.json
│   ├── site-build.json
│   ├── client-source-publish.json
│   ├── vercel-deploy.json
│   ├── release-receipt.json
│   └── handoff-emitter.json
└── failures/
    ├── latest.json
    └── <stage>-<attempt>.json
```

### 10.1 Generated site-local metadata

The generated client repository must contain only the evidence necessary for source ownership and maintenance:

```text
<outputDir>/.l9/
├── generated-manifest.json
└── assembly-manifest.json
```

Do not place provider tokens, deployment receipts, registration acknowledgements, or internal build logs in the client repository.

### 10.2 Git ignore policy

Website-Bot must ignore runtime evidence by default:

```gitignore
build/evidence/
build/sites/
build/checkpoints/
```

GitHub Actions must upload evidence as workflow artifacts when appropriate.

---

## 11. Evidence store

### 11.1 New component

```text
src/pipeline/evidence/EvidenceStore.ts
```

### 11.2 Interface

```ts
export interface EvidenceStore {
  readonly rootDir: string;

  writeAssemblyManifest(value: AssemblyManifest): Promise<EvidenceRecord>;
  writeBuildProof(value: BuildProof): Promise<EvidenceRecord>;
  writePublicationEvidence(value: PublicationEvidence): Promise<EvidenceRecord>;
  writeDeploymentEvidence(value: DeploymentEvidence): Promise<EvidenceRecord>;
  writeReleaseReceipt(value: ReleaseReceipt): Promise<EvidenceRecord>;
  writeHandoff(value: WebsiteFactoryHandoffV3): Promise<EvidenceRecord>;
  writeRegistrationAck(value: SeoBotRegistrationAck): Promise<EvidenceRecord>;
  writeFailure(value: StageFailureEvidence): Promise<EvidenceRecord>;

  readAssemblyManifest(): Promise<AssemblyManifest | null>;
  readBuildProof(): Promise<BuildProof | null>;
  readPublicationEvidence(): Promise<PublicationEvidence | null>;
  readDeploymentEvidence(): Promise<DeploymentEvidence | null>;
  readReleaseReceipt(): Promise<ReleaseReceipt | null>;
  readHandoff(): Promise<WebsiteFactoryHandoffV3 | null>;
  readRegistrationAck(): Promise<SeoBotRegistrationAck | null>;

  requireBuildProof(): Promise<BuildProof>;
  requirePublicationEvidence(): Promise<PublicationEvidence>;
  requireDeploymentEvidence(): Promise<DeploymentEvidence>;
  requireSucceededReleaseReceipt(): Promise<ReleaseReceipt>;

  rebuildIndex(): Promise<EvidenceIndex>;
  validateChain(mode: ExecutionMode): Promise<EvidenceChainValidation>;
}
```

### 11.3 Atomic write requirements

Every evidence write must:

1. Validate the typed object.
2. Canonicalize it.
3. Write to a temporary file in the destination directory.
4. Flush and close the file.
5. Rename the temporary file atomically.
6. Compute the final file SHA-256.
7. Update `evidence-index.json` atomically.
8. Return the artifact path, digest, schema, and logical ID.

Partial files must never be treated as evidence.

### 11.4 EvidenceRecord

```ts
export interface EvidenceRecord {
  kind: EvidenceKind;
  schema: string;
  logicalId: string;
  relativePath: string;
  sha256: string;
  writtenAt: string;
}
```

### 11.5 Canonical JSON

Use one canonical JSON function for IDs and payload digests:

- object keys sorted lexicographically;
- arrays preserve semantic order;
- UTF-8;
- no insignificant whitespace;
- no trailing newline in digest input;
- timestamps included only when the contract explicitly requires them;
- secret values prohibited before canonicalization.

Do not use `JSON.stringify` directly for cross-repository contract digests unless it calls the shared canonicalizer.

---

## 12. Evidence index

### 12.1 New contract

```text
src/pipeline/evidence/EvidenceIndex.ts
schemas/evidence-index.schema.json
```

### 12.2 Shape

```ts
export interface EvidenceIndex {
  schema: 'website-bot.evidence-index/v1';
  build_id: string;
  client_id: string;
  mode: ExecutionMode;
  revision: number;
  artifacts: Partial<Record<EvidenceKind, EvidenceRecord>>;
  chain_status: 'empty' | 'assembling' | 'built' | 'published' | 'deployed' | 'released' | 'handed_off' | 'failed';
  last_successful_stage?: string;
  failed_stage?: string;
  created_at: string;
  updated_at: string;
}
```

### 12.3 Purpose

The index is the authoritative locator for evidence artifacts. `BuildContext` may cache loaded values, but paths and existence must be resolved through the index.

### 12.4 Revision rules

- Start at revision 1.
- Increment on every successful index mutation.
- Never decrement.
- A resumed process must reject an index whose build/client identity differs from the active request.
- A stage may overwrite its own evidence only when the input identity is unchanged and retry policy permits replacement.

---

## 13. BuildContext contract

### 13.1 Required additions

```ts
export interface BuildContext {
  buildId: string;
  clientId: string;
  mode: ExecutionMode;
  outputDir: string;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  evidenceIndex: EvidenceIndex;

  // Optional in-memory caches only.
  assemblyManifest?: AssemblyManifest;
  buildProof?: BuildProof;
  publicationEvidence?: PublicationEvidence;
  deploymentEvidence?: DeploymentEvidence;
  releaseReceipt?: ReleaseReceipt;
}
```

### 13.2 Rule

The optional evidence properties are convenience caches, not authority.

A stage entering after a process boundary, retry, or resume must load upstream evidence through `EvidenceStore.require*()` and then may cache it in `BuildContext`.

### 13.3 Forbidden behavior

```ts
if (!ctx.buildProof) {
  // infer success from ctx.distDir
}
```

This is forbidden.

Correct behavior:

```ts
const buildProof = await ctx.evidenceStore.requireBuildProof();
```

---

## 14. Contract set

The following contracts are mandatory and versioned independently.

### 14.1 AssemblyManifest

```ts
export interface AssemblyManifest {
  schema: 'website-bot.assembly-manifest/v1';
  buildId: string;
  clientId: string;
  outputDir: string;
  templateVersion: string;
  sourceDigest: string;
  files: Array<{
    path: string;
    sha256: string;
    sizeBytes: number;
    ownership: 'generated' | 'template';
  }>;
  routes: Array<{
    slug: string;
    sourcePath: string;
    components: string[];
  }>;
  generatedAt: string;
}
```

Required properties:

- complete source inventory;
- canonical relative paths;
- no symlinks;
- no paths outside `outputDir`;
- no `node_modules` or `dist` entries;
- deterministic file ordering;
- source digest computed from normalized path plus file digest entries.

### 14.2 BuildProof

The existing overlay contract may be harvested, but it must add upstream identity and validator results.

```ts
export interface BuildProof {
  schema: 'website-bot.build-proof/v1';
  proofId: string;
  buildId: string;
  clientId: string;
  assemblyManifestSha256: string;
  sourceDir: string;
  distDir: string;
  sourceDigest: string;
  distDigest: string;
  packageManager: 'npm';
  packageManagerVersion: string;
  installCommand: string[];
  checkCommand: string[];
  buildCommand: string[];
  checks: Array<{
    name: 'install' | 'astro-check' | 'astro-build' | 'route-assertion' | 'sitemap-assertion';
    status: 'passed';
    durationMs: number;
  }>;
  builtRoutes: string[];
  startedAt: string;
  completedAt: string;
  status: 'passed';
}
```

Rules:

- `sourceDigest` must equal the finalized `AssemblyManifest.sourceDigest` after dependency-lockfile creation.
- `assemblyManifestSha256` must identify the persisted manifest file.
- `builtRoutes` must exactly match the expected non-external routes.
- A passed proof must not include skipped required checks.
- Command output may be logged separately but is not part of the canonical digest.

### 14.3 PublicationEvidence

```ts
export interface PublicationEvidence {
  schema: 'website-bot.publication-evidence/v1';
  publicationId: string;
  buildId: string;
  clientId: string;
  buildProofId: string;
  buildProofSha256: string;
  repository: string;
  repositoryId?: string;
  branch: string;
  previousHeadSha: string | null;
  commitSha: string;
  treeSha: string;
  verifiedBranchHeadSha: string;
  sourceDigest: string;
  generatedManifestDigest: string;
  changedPaths: string[];
  deletedPaths: string[];
  noOp: boolean;
  publishedAt: string;
  status: 'passed';
}
```

Rules:

- `buildProofId` and digest must identify the exact persisted proof consumed.
- `sourceDigest` must equal `BuildProof.sourceDigest`.
- `verifiedBranchHeadSha` must equal `commitSha` after publication.
- A no-op is allowed only when the existing branch tree already represents the same source digest and managed manifest.
- Publication must never force-update the branch.
- Deleted paths must be limited to prior generator-owned paths in `.l9/generated-manifest.json`.

### 14.4 DeploymentEvidence

```ts
export interface DeploymentEvidence {
  schema: 'website-bot.deployment-evidence/v1';
  deploymentEvidenceId: string;
  buildId: string;
  clientId: string;
  publicationId: string;
  publicationSha256: string;
  provider: 'vercel';
  projectId: string;
  deploymentId: string;
  requestedCommitSha: string;
  observedCommitSha: string;
  state: 'READY';
  deploymentUrl: string;
  aliases: string[];
  sourceRepository: string;
  sourceBranch: string;
  triggerMode: 'api' | 'deploy_hook';
  target: 'preview' | 'production';
  createdAt?: string;
  readyAt: string;
  status: 'passed';
}
```

Rules:

- `requestedCommitSha` must equal `PublicationEvidence.commitSha`.
- `observedCommitSha` is required for passed evidence.
- `observedCommitSha` must equal `requestedCommitSha`.
- `projectId` is required.
- Deploy-hook acceptance alone is not evidence.
- The stage must poll or query until terminal `READY` or terminal failure.
- The deployment URL must use HTTPS.

### 14.5 ReleaseReceipt

```ts
export interface ReleaseReceipt {
  schema: 'website-bot.release-receipt/v1';
  receipt_id: string;
  build_id: string;
  client_id: string;
  mode: ExecutionMode;
  status: 'planned' | 'partial' | 'succeeded' | 'failed';
  missing_gates: ReleaseGate[];
  evidence: {
    assembly: EvidenceReference;
    build?: EvidenceReference;
    publication?: EvidenceReference;
    deployment?: EvidenceReference;
  };
  correlation: {
    source_digest: string;
    commit_sha?: string;
    deployment_id?: string;
    all_required_identities_match: boolean;
  };
  qa: {
    seo_baseline: EvidenceGateStatus;
    visual_qa: EvidenceGateStatus;
  };
  created_at: string;
  finalized_at?: string;
}
```

`EvidenceReference`:

```ts
export interface EvidenceReference {
  kind: EvidenceKind;
  schema: string;
  logical_id: string;
  relative_path: string;
  sha256: string;
}
```

Rules:

- The receipt references persisted evidence rather than copying every field.
- A human-readable summary may be embedded, but references remain authoritative.
- `succeeded` requires no missing gates and full correlation.
- `failed` records the stage and error evidence reference.
- The receipt validator must load referenced files and validate the entire chain.

### 14.6 WebsiteFactoryHandoffV3

The v3 handoff must consume:

```ts
buildWebsiteFactoryHandoffV3({
  domainSpec,
  releaseBundle,
  deployTarget,
  qualitySummary,
});
```

It must not consume the entire mutable `BuildContext`.

`releaseBundle` is produced only by:

```ts
await evidenceStore.loadValidatedReleaseBundle({
  requireStatus: 'succeeded',
});
```

### 14.7 SeoBotRegistrationAck

```ts
export interface SeoBotRegistrationAck {
  schema: 'seo-bot.website-factory-registration-ack/v1';
  registered: true;
  maintenance_ready: true;
  client_id: string;
  contract_id: string;
  contract_digest: string;
  release_receipt_id: string;
  verified_repository: string;
  verified_branch: string;
  verified_commit_sha: string;
  probes: Array<{
    name: string;
    ok: true;
    detail?: string;
  }>;
  acknowledged_at: string;
}
```

Website-Bot must verify all identity fields before persisting the acknowledgement.

---

## 15. JSON schemas

Add and maintain:

```text
schemas/
├── assembly-manifest.schema.json
├── build-proof.schema.json
├── publication-evidence.schema.json
├── deployment-evidence.schema.json
├── release-receipt.schema.json
├── evidence-index.schema.json
├── stage-checkpoint.schema.json
├── stage-failure-evidence.schema.json
└── seo-bot-registration-ack.schema.json
```

Schema requirements:

- JSON Schema Draft 2020-12;
- `additionalProperties: false` for closed records;
- strict SHA patterns;
- strict HTTPS URL patterns where applicable;
- strict repository `owner/name` pattern;
- strict branch and path constraints;
- explicit enums;
- minimum array sizes where proof requires content;
- no secret-shaped fields;
- examples that contain obviously synthetic IDs, never real credentials.

All TypeScript contracts and JSON schemas must be parity-tested.

---

## 16. Stage checkpoint contract

### 16.1 Purpose

Checkpoints prove stage completion and enable deterministic resume. They do not replace evidence artifacts.

### 16.2 Shape

```ts
export interface StageCheckpoint {
  schema: 'website-bot.stage-checkpoint/v1';
  buildId: string;
  clientId: string;
  stage: string;
  attempt: number;
  inputEvidence: EvidenceReference[];
  outputEvidence: EvidenceReference[];
  inputDigest: string;
  outputDigest: string;
  externalId?: string;
  status: 'passed' | 'failed';
  startedAt: string;
  completedAt: string;
}
```

### 16.3 Resume rule

A stage may be skipped on resume only when:

1. A passed checkpoint exists.
2. All referenced input and output evidence files exist.
3. Their SHA-256 values match the checkpoint.
4. The current stage implementation version is compatible.
5. The current requested mode still permits the checkpoint.
6. External state is reverified when the stage mutated a provider.

For GitHub publication, reverify branch head.

For Vercel deployment, reverify deployment state and observed commit.

---

## 17. Stage failure evidence

Every non-recoverable stage failure must create:

```ts
export interface StageFailureEvidence {
  schema: 'website-bot.stage-failure/v1';
  buildId: string;
  clientId: string;
  stage: string;
  attempt: number;
  code: BuildErrorCode;
  message: string;
  recoverable: boolean;
  inputEvidence: EvidenceReference[];
  providerStatus?: number;
  providerRequestId?: string;
  sanitizedDetails?: Record<string, unknown>;
  failedAt: string;
}
```

Forbidden in failure evidence:

- authorization headers;
- token values;
- deploy-hook URLs containing secrets;
- complete provider response bodies without sanitization;
- environment dumps;
- generated content not needed to diagnose the stage.

---

## 18. SiteAssemblerStage requirements

### 18.1 Inputs

- validated `DomainSpec`;
- design tokens;
- generated content;
- generated schemas;
- client-neutral Astro template;
- output directory.

### 18.2 Outputs

- materialized Astro source tree;
- generated `.l9/assembly-manifest.json`;
- persisted build evidence `assembly-manifest.json`;
- passed stage checkpoint.

### 18.3 Required behavior

1. Create output in a temporary sibling directory.
2. Validate every route slug and target path.
3. Reject duplicate normalized routes.
4. Reject symlinks in the template and output.
5. Render required sections fail-closed when content is absent.
6. Write site config, design tokens, routes, robots, and source metadata.
7. Compute deterministic file inventory.
8. Compute source digest.
9. Validate the manifest.
10. Atomically replace the final output directory.
11. Persist the authoritative manifest through `EvidenceStore`.

### 18.4 Idempotency

Given identical normalized inputs and template version, repeated assembly must produce the same source digest.

Timestamps must not influence the source digest.

---

## 19. SiteBuildStage requirements

### 19.1 Inputs

Load the authoritative `AssemblyManifest` from `EvidenceStore`.

### 19.2 Required commands

```text
npm ci --no-audit --no-fund
npm run check
npm run build
```

When no lockfile exists, the first build may use `npm install --package-lock-only` followed by `npm ci`, or another explicitly documented deterministic bootstrap. The final proof must always identify the finalized lockfile-bearing source digest.

### 19.3 Finalization sequence

```text
assembly manifest A0
    -> dependency lockfile creation/update
    -> refresh source inventory
    -> assembly manifest A1
    -> Astro check
    -> Astro build
    -> output assertions
    -> BuildProof referencing A1
```

### 19.4 Required assertions

- `dist/` exists and is a directory;
- one HTML output exists for every expected route;
- sitemap exists when configured;
- no extra unexpected route output unless explicitly allowed;
- `BuildProof.sourceDigest == AssemblyManifest.sourceDigest`;
- `distDigest` is deterministic over distribution files;
- all required command checks passed.

### 19.5 Output

- persisted refreshed assembly manifest;
- persisted `BuildProof`;
- stage checkpoint referencing both.

---

## 20. ClientSourcePublishStage requirements

### 20.1 Entry gate

The stage must call:

```ts
const buildProof = await evidenceStore.requireBuildProof();
```

It must then re-hash the current source tree and reject source drift.

### 20.2 Required behavior

1. Resolve secret reference at runtime.
2. Verify target repository identity.
3. Verify source branch and current head.
4. Read prior `.l9/generated-manifest.json` when present.
5. Compute changed, unchanged, and stale generator-owned files.
6. Refuse deletion of any path not owned by the prior manifest.
7. Build Git blobs and tree.
8. Create one commit.
9. Update branch without force.
10. Re-read branch head.
11. Verify branch head equals the created or adopted commit.
12. Persist `PublicationEvidence`.
13. Write passed checkpoint.

### 20.3 Concurrency

If branch head changes between read and update:

- do not force;
- do not retry blindly;
- fail with `PUBLICATION_CONFLICT`;
- record expected and observed head SHAs;
- permit an operator or higher-level retry to rerun from a fresh read.

---

## 21. VercelDeployStage requirements

### 21.1 Entry gate

Load persisted `PublicationEvidence`.

### 21.2 Required behavior

1. Resolve Vercel credentials at runtime.
2. Verify project identity and Git repository linkage.
3. Request a deployment for the exact publication commit.
4. Record provider deployment ID immediately in failure-safe runtime state.
5. Poll with bounded retries and exponential backoff.
6. Treat terminal Vercel errors as failures.
7. Require terminal `READY`.
8. Read observed source commit from provider metadata.
9. Require observed commit to equal publication commit.
10. Persist `DeploymentEvidence`.
11. Write passed checkpoint.

### 21.3 Deploy hook mode

Deploy hook mode is allowed only when the implementation can resolve the resulting deployment ID and observed commit.

The following is not success:

```text
POST hook -> 200/201/202
```

The following is success:

```text
POST hook
  -> resolve deployment ID
  -> poll deployment
  -> state READY
  -> observed commit matches publication commit
```

### 21.4 Timeouts

- request timeout configurable;
- overall deployment timeout configurable;
- default overall timeout no greater than 15 minutes;
- all timeout failures produce typed evidence.

---

## 22. ReleaseReceiptStage requirements

### 22.1 Role

The stage is the sole release-chain aggregator.

### 22.2 Input behavior

It must load evidence from the store. It must not trust only in-memory context caches.

### 22.3 Validation algorithm

```text
load assembly
validate assembly schema and digest

if mode >= local-proof:
  load build proof
  validate build proof
  verify assembly reference and source digest

if mode >= publish-proof:
  load publication evidence
  validate publication evidence
  verify build proof reference and source digest
  optionally reverify GitHub branch head

if mode == end-to-end:
  load deployment evidence
  validate deployment evidence
  verify publication reference and commit identity
  optionally reverify Vercel deployment state

compute missing gates
compute chain correlation
emit receipt
validate receipt and all references
persist receipt
```

### 22.4 Two-step finalization

Recommended model:

1. `release-receipt` creates a release receipt after deployment.
2. SEO and visual QA update only the QA status through `ReleaseReceiptFinalizerStage` before handoff.

This avoids allowing later stages to mutate a previously signed or digested receipt in place.

Add:

```text
src/stages/ReleaseReceiptFinalizerStage.ts
```

Final stage order becomes:

```text
12 release-receipt
13 seo-baseline
14 visual-qa
15 release-receipt-finalizer
16 handoff-emitter
```

If the project intentionally treats SEO baseline and visual QA as non-release gates, preserve one receipt stage and clearly mark QA as informational. Do not mix the two policies.

### 22.5 Success policy

`status: succeeded` is allowed only in `end-to-end` mode with all required evidence and correlations passed.

---

## 23. HandoffEmitterStage requirements

### 23.1 New dependency boundary

Replace:

```ts
buildWebsiteFactoryHandoffV3(ctx)
```

With:

```ts
const bundle = await ctx.evidenceStore.loadValidatedReleaseBundle({
  requireStatus: 'succeeded',
  reverifyExternalState: true,
});

const contract = buildWebsiteFactoryHandoffV3({
  domainSpec: ctx.domainSpec,
  releaseBundle: bundle,
  deployTarget: ctx.deployTarget,
  qualitySummary: bundle.releaseReceipt.qa,
});
```

### 23.2 Required gates

Before emitting:

- execution mode must be `end-to-end`;
- release receipt must be `succeeded`;
- all referenced evidence files must exist and match SHA-256;
- publication and deployment commits must match;
- maintenance credential references must be valid references, not values;
- repository and branch must be present;
- required editable source paths must be listed;
- handoff schema must validate;
- payload digest must be computed canonically.

### 23.3 Output paths

Write build-specific artifacts first:

```text
build/evidence/<client>/<build>/handoff-v3.json
build/evidence/<client>/<build>/handoff-v3.yaml
```

A convenience copy may be written to:

```text
contracts/website_factory_integration.yaml
```

The convenience copy is not authoritative and must include the contract ID and source evidence path.

### 23.4 Registration acknowledgement

When auto-registration is enabled:

- registration failure is fatal for end-to-end activation;
- acknowledgement must match contract ID, digest, release receipt ID, repository, branch, and commit;
- acknowledgement must be persisted through `EvidenceStore`;
- final index status becomes `handed_off` only after acknowledgement validation.

---

## 24. Release bundle API

### 24.1 New type

```ts
export interface ValidatedReleaseBundle {
  index: EvidenceIndex;
  assemblyManifest: AssemblyManifest;
  buildProof: BuildProof;
  publicationEvidence: PublicationEvidence;
  deploymentEvidence: DeploymentEvidence;
  releaseReceipt: ReleaseReceipt;
  validation: EvidenceChainValidation;
}
```

### 24.2 Validation result

```ts
export interface EvidenceChainValidation {
  valid: boolean;
  mode: ExecutionMode;
  checkedAt: string;
  gates: Array<{
    name: string;
    status: 'passed' | 'failed' | 'not_required';
    detail?: string;
  }>;
  identities: {
    sourceDigest?: string;
    commitSha?: string;
    deploymentId?: string;
  };
  errors: string[];
}
```

### 24.3 Fail closed

`loadValidatedReleaseBundle` must throw when `valid` is false. It must not return a partial bundle under a type that implies validity.

---

## 25. Error taxonomy

Add or confirm these codes:

```ts
export type BuildErrorCode =
  | 'EVIDENCE_STORE_FAILED'
  | 'EVIDENCE_SCHEMA_INVALID'
  | 'EVIDENCE_DIGEST_MISMATCH'
  | 'EVIDENCE_REFERENCE_MISSING'
  | 'EVIDENCE_CHAIN_INCOMPLETE'
  | 'EVIDENCE_IDENTITY_MISMATCH'
  | 'EVIDENCE_RESUME_CONFLICT'
  | 'ASSEMBLY_FAILED'
  | 'BUILD_FAILED'
  | 'BUILD_PROOF_INVALID'
  | 'PUBLICATION_FAILED'
  | 'PUBLICATION_CONFLICT'
  | 'PUBLICATION_PROOF_INVALID'
  | 'DEPLOYMENT_FAILED'
  | 'DEPLOYMENT_TIMEOUT'
  | 'DEPLOYMENT_COMMIT_MISMATCH'
  | 'DEPLOYMENT_PROOF_INVALID'
  | 'RELEASE_RECEIPT_INVALID'
  | 'HANDOFF_NOT_READY'
  | 'HANDOFF_EMIT_FAILED'
  | 'SEO_BOT_ACK_INVALID';
```

Every code must map to:

- default recoverability;
- stage owner;
- retry policy;
- evidence redaction policy;
- operator remediation text.

---

## 26. BuildDB integration

### 26.1 New tables

```sql
CREATE TABLE IF NOT EXISTS evidence_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  logical_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(build_id, kind),
  UNIQUE(logical_id)
);

CREATE TABLE IF NOT EXISTS evidence_chain_status (
  build_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  last_successful_stage TEXT,
  failed_stage TEXT,
  evidence_index_path TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 26.2 Authority

Files are the canonical evidence payloads.

BuildDB is the local index and query surface. A database row without a matching validated file is not proof.

### 26.3 Transaction rules

- Write evidence file first.
- Verify file digest.
- Commit DB index row second.
- If DB write fails, leave the file but mark the index repairable.
- `evidence:repair-index` can reconstruct DB rows from evidence files.

---

## 27. CLI changes

### 27.1 Existing commands

```json
{
  "pipeline:plan": "npx tsx scripts/run-pipeline.ts --mode=plan",
  "pipeline:local-proof": "npx tsx scripts/run-pipeline.ts --mode=local-proof",
  "pipeline:publish-proof": "npx tsx scripts/run-pipeline.ts --mode=publish-proof",
  "pipeline:end-to-end": "npx tsx scripts/run-pipeline.ts --mode=end-to-end"
}
```

### 27.2 New evidence commands

```json
{
  "evidence:validate": "npx tsx scripts/evidence.ts validate",
  "evidence:show": "npx tsx scripts/evidence.ts show",
  "evidence:resume": "npx tsx scripts/evidence.ts resume",
  "evidence:repair-index": "npx tsx scripts/evidence.ts repair-index",
  "evidence:verify-external": "npx tsx scripts/evidence.ts verify-external"
}
```

### 27.3 CLI output

All evidence commands must support:

```text
--json
```

JSON mode must write machine-readable output to stdout and logs to stderr.

### 27.4 Required arguments

```text
--build-id=<id>
--client-id=<id>
--evidence-dir=<path> optional override
```

`resume` must additionally require explicit operator intent:

```text
--from=<stage|auto>
```

---

## 28. PipelineRunner integration

### 28.1 Initialization

`run-pipeline.ts` must create the evidence store before stage registration:

```ts
const evidenceDir = resolve('build', 'evidence', clientId, buildId);
const evidenceStore = new FileEvidenceStore({
  buildId,
  clientId,
  mode,
  rootDir: evidenceDir,
});

const evidenceIndex = await evidenceStore.initialize();
```

### 28.2 StageRunner behavior

Before each stage:

- record start time;
- resolve required evidence;
- validate resume eligibility;
- write running state to BuildDB.

After success:

- ensure expected output evidence exists;
- validate output evidence;
- persist checkpoint;
- update index and BuildDB.

After failure:

- persist failure evidence;
- update index state to failed;
- do not mark the build successful or partial without explicit mode semantics.

### 28.3 Stage declarations

Extend `Stage`:

```ts
export interface Stage {
  name: string;
  version: string;
  requiresEvidence?: EvidenceKind[];
  producesEvidence?: EvidenceKind[];
  run(ctx: BuildContext): Promise<void>;
}
```

The runner must verify declared outputs after stage success.

---

## 29. Inngest durable workflow alignment

### 29.1 Current constraint

The live Inngest wrapper executes the entire pipeline as one durable step because the current `PipelineRunner` owns one SQLite connection for the run.

### 29.2 Required near-term behavior

Do not split stages across Inngest steps until pipeline state is decoupled from a long-lived database connection.

Instead:

- pass `buildId`, `clientId`, `mode`, and evidence root into the single pipeline step;
- use evidence checkpoints for internal resume after whole-step retry;
- before rerunning a provider stage, reverify external state;
- emit `website/pipeline.completed` with references to the release receipt and evidence index;
- emit `website/pipeline.failed` with a reference to sanitized failure evidence.

### 29.3 Future optional refactor

A later change may move each stage into a durable step after:

- BuildDB operations become per-stage and connection-scoped;
- BuildContext becomes serializable;
- evidence files become the only cross-step state;
- provider clients are recreated per step;
- stage contracts are stable.

This future refactor is out of scope for this build.

---

## 30. GitHub Actions workflows

### 30.1 Pull request validation

Update `build-and-validate.yml` to run:

```text
npm ci --no-audit --no-fund
npm run typecheck
npm run normalize-spec:check
npm run evidence:test
npm run site:test:local
npm run pipeline:plan
npm run evidence:contract-parity
```

### 30.2 Local proof workflow

Add:

```text
.github/workflows/site-factory-local-proof.yml
```

It must:

- run against a deterministic fixture;
- perform real generated Astro install/check/build;
- validate evidence chain through `BuildProof`;
- upload the evidence directory;
- never require GitHub write or Vercel credentials.

### 30.3 Disposable release proof workflow

Add or revise:

```text
.github/workflows/site-factory-disposable-e2e.yml
```

Requirements:

- explicit `workflow_dispatch` only;
- dedicated disposable repository and Vercel project;
- environment protection when production-like credentials are used;
- publish exact generated source;
- deploy exact commit;
- validate release receipt;
- register with a disposable SEO-Bot instance or mock readiness endpoint;
- perform cleanup in `always()` steps;
- upload all evidence even on failure;
- never log tokens or deploy-hook URLs.

### 30.4 Handoff artifact workflow

Do not run a standalone handoff workflow that guesses deployment state from previous workflow artifacts.

Handoff must be part of the same release transaction or consume a validated evidence bundle identified by build ID.

---

## 31. Test architecture

### 31.1 Unit tests

Add or harden:

```text
tests/unit/evidence-store.test.ts
tests/unit/evidence-index.test.ts
tests/unit/evidence-canonical-json.test.ts
tests/unit/evidence-chain-validator.test.ts
tests/unit/stage-checkpoint.test.ts
tests/unit/stage-failure-evidence.test.ts
tests/unit/assembly-manifest.test.ts
tests/unit/build-proof.test.ts
tests/unit/publication-evidence.test.ts
tests/unit/deployment-evidence.test.ts
tests/unit/release-receipt.test.ts
tests/unit/handoff-emitter-v3.test.ts
```

### 31.2 Integration tests

```text
tests/integration/local/evidence-local-proof.test.ts
tests/integration/local/evidence-resume.test.ts
tests/integration/local/evidence-corruption.test.ts
tests/integration/github/disposable-publication.test.ts
tests/integration/vercel/disposable-deployment.test.ts
tests/integration/e2e/handoff-readiness.test.ts
```

### 31.3 Test rule

Tests must not establish proof by directly assigning evidence objects to `BuildContext` except in isolated contract-unit tests.

Pipeline integration tests must exercise:

```text
stage -> EvidenceStore -> persisted file -> reload -> next stage
```

### 31.4 Required negative tests

1. Missing assembly manifest blocks build.
2. Corrupted assembly manifest blocks build.
3. Source drift after build blocks publication.
4. Publication branch conflict fails without force.
5. Missing publication evidence blocks deployment.
6. Vercel READY with wrong commit fails.
7. Deploy-hook acceptance without resolved deployment fails.
8. Receipt reference digest mismatch fails.
9. Handoff with partial receipt fails.
10. Handoff with missing provider evidence fails.
11. Registration acknowledgement with wrong commit fails.
12. Registration acknowledgement with wrong contract digest fails.
13. Resume with changed source fails.
14. Resume with branch-head drift requires revalidation.
15. Raw token-like values in evidence fail secret scan.
16. Evidence path traversal is rejected.
17. Symlink evidence files are rejected.
18. Stale evidence from another build/client is rejected.
19. A copied `BuildContext` without evidence files cannot emit handoff.
20. A pass-only validation report cannot mark the chain valid.

### 31.5 Property tests

Where practical, add property tests for:

- canonical JSON key ordering;
- source digest stability under file traversal order changes;
- path normalization rejection;
- evidence identity stability;
- secret-reference acceptance and secret-value rejection.

---

## 32. Cross-repository contract tests

Website-Bot and SEO-Bot must share contract parity through immutable schema copies and lock metadata.

### 32.1 Contract lock

```json
{
  "schema": "l9.contract-lock/v1",
  "contract": "l9.website-factory.handoff/3.0",
  "authority_repository": "Quantum-L9/SEO-Bot",
  "authority_path": "contracts/website-factory-handoff.v3.schema.json",
  "consumer_path": "contracts/website-factory-handoff.v3.schema.json",
  "sha256": "<calculated>",
  "compatibility": "exact"
}
```

### 32.2 Wire test

The cross-repo test must:

1. Produce a handoff from a persisted validated release bundle.
2. Validate against Website-Bot's schema copy.
3. Validate against SEO-Bot's authority schema.
4. Verify canonical payload digest parity.
5. Submit to SEO-Bot registration route.
6. Verify readiness acknowledgement identities.
7. Confirm SEO-Bot persisted only secret references and verified source identity.

---

## 33. Security requirements

### 33.1 Secret boundary

Evidence may contain:

- `env://NAME` references;
- repository names;
- branch names;
- project IDs;
- deployment IDs;
- public HTTPS deployment URLs;
- commit SHAs;
- artifact digests.

Evidence must not contain:

- PATs;
- bearer tokens;
- Vercel API tokens;
- deploy-hook URLs containing credentials;
- SEO-Bot API keys;
- environment dumps;
- authorization headers.

### 33.2 Path safety

- Evidence root resolved once.
- Every artifact path resolved under root.
- Reject `..`, absolute paths, NUL, and platform-specific traversal variants.
- Reject symlinks for evidence artifacts.
- Use fixed filenames by evidence kind.

### 33.3 Permissions

Locally written evidence containing internal provider metadata should use restrictive file permissions where supported.

### 33.4 Logs

Log logical IDs and short digests, not complete payloads by default.

---

## 34. Observability

### 34.1 Structured fields

Every evidence-related log should include when known:

```text
buildId
clientId
mode
stage
evidenceKind
logicalId
artifactSha256
sourceDigest
commitSha
deploymentId
attempt
```

### 34.2 Metrics

Emit counters or structured events for:

- evidence writes;
- evidence validation failures;
- digest mismatches;
- resume hits;
- resume invalidations;
- publication conflicts;
- deployment commit mismatches;
- handoff acknowledgement failures.

### 34.3 No central observability expansion

Do not introduce a new observability platform. Use the repository's current logging and workflow artifact mechanisms.

---

## 35. Documentation convergence

### 35.1 Existing plan

`docs/factory-upgrade-build-plan.md` must no longer remain a plan that implies unimplemented work without a status ledger.

Choose one:

1. Update it into the canonical architecture and status document, or
2. Archive it under `docs/archive/` and replace it with a concise pointer to the implemented evidence-spine architecture.

Recommended:

```text
docs/site-factory-evidence-spine.md
```

### 35.2 Required documentation updates

```text
README.md
ARCHITECTURE.md
RUNBOOK.md
MANIFEST.md
VALIDATION.md
CHANGE_SUMMARY.md
docs/factory-upgrade-build-plan.md or replacement
```

### 35.3 Documentation rule

Every capability claim must name:

- implementation file;
- command;
- test or evidence artifact;
- credential-bound status when applicable.

Do not mark P-D or deployment as live-proven based only on mocks.

---

## 36. Canonical file tree

```text
Website-Bot/
├── .github/workflows/
│   ├── build-and-validate.yml                         [MODIFY]
│   ├── site-factory-local-proof.yml                  [NEW]
│   └── site-factory-disposable-e2e.yml               [NEW]
├── contracts/
│   ├── website-factory-handoff.v3.schema.json        [KEEP/ALIGN]
│   └── CONTRACT_LOCK.json                            [KEEP/ALIGN]
├── docs/
│   ├── factory-upgrade-build-plan.md                 [MODIFY OR ARCHIVE]
│   └── site-factory-evidence-spine.md                [NEW]
├── schemas/
│   ├── assembly-manifest.schema.json                 [NEW]
│   ├── build-proof.schema.json                       [NEW]
│   ├── publication-evidence.schema.json              [NEW]
│   ├── deployment-evidence.schema.json               [NEW]
│   ├── release-receipt.schema.json                   [REPLACE/HARDEN]
│   ├── evidence-index.schema.json                    [NEW]
│   ├── stage-checkpoint.schema.json                  [NEW]
│   ├── stage-failure-evidence.schema.json            [NEW]
│   └── seo-bot-registration-ack.schema.json          [NEW]
├── scripts/
│   ├── run-pipeline.ts                               [MODIFY]
│   ├── evidence.ts                                   [NEW]
│   ├── validate-site-factory.ts                      [MODIFY]
│   ├── run-site-factory-tests.mjs                    [MODIFY]
│   └── run-disposable-site-factory-e2e.ts            [MODIFY]
├── src/
│   ├── contracts/
│   │   └── WebsiteFactoryHandoffV3.ts                [MODIFY]
│   ├── pipeline/
│   │   ├── BuildContext.ts                           [MODIFY]
│   │   ├── BuildDB.ts                                [MODIFY]
│   │   ├── BuildError.ts                             [MODIFY]
│   │   ├── PipelineRunner.ts                         [MODIFY]
│   │   ├── StageCheckpoint.ts                        [REPLACE/HARDEN]
│   │   └── evidence/
│   │       ├── AssemblyManifest.ts                   [KEEP/HARDEN]
│   │       ├── BuildProof.ts                         [KEEP/HARDEN]
│   │       ├── PublicationEvidence.ts                [KEEP/HARDEN]
│   │       ├── DeploymentEvidence.ts                 [KEEP/HARDEN]
│   │       ├── ReleaseReceipt.ts                     [REPLACE/HARDEN]
│   │       ├── EvidenceIndex.ts                      [NEW]
│   │       ├── EvidenceStore.ts                      [NEW]
│   │       ├── FileEvidenceStore.ts                  [NEW]
│   │       ├── EvidenceChainValidator.ts             [NEW]
│   │       ├── EvidenceCanonicalizer.ts              [NEW]
│   │       ├── EvidenceReference.ts                  [NEW]
│   │       ├── StageFailureEvidence.ts               [NEW]
│   │       └── ValidatedReleaseBundle.ts             [NEW]
│   ├── stages/
│   │   ├── SiteAssemblerStage.ts                     [KEEP/HARDEN]
│   │   ├── SiteBuildStage.ts                         [KEEP/HARDEN]
│   │   ├── ClientSourcePublishStage.ts               [KEEP/HARDEN]
│   │   ├── VercelDeployStage.ts                      [KEEP/HARDEN]
│   │   ├── ReleaseReceiptStage.ts                    [REPLACE/HARDEN]
│   │   ├── ReleaseReceiptFinalizerStage.ts           [NEW, POLICY-DEPENDENT]
│   │   └── HandoffEmitterStage.ts                    [MODIFY]
│   ├── validation/
│   │   ├── validate-assembly-manifest.ts             [NEW]
│   │   ├── validate-build-proof.ts                   [NEW]
│   │   ├── validate-publication-evidence.ts          [NEW]
│   │   ├── validate-deployment-evidence.ts           [NEW]
│   │   ├── validate-release-receipt.ts               [REPLACE/HARDEN]
│   │   └── validate-evidence-chain.ts                [NEW]
│   └── inngest/
│       └── website-pipeline.ts                       [MODIFY]
├── tests/
│   ├── fixtures/evidence/                             [NEW]
│   ├── unit/evidence-*.test.ts                       [NEW]
│   ├── integration/local/evidence-*.test.ts          [NEW]
│   ├── integration/github/disposable-publication.test.ts [MODIFY]
│   ├── integration/vercel/disposable-deployment.test.ts  [MODIFY]
│   └── integration/e2e/handoff-readiness.test.ts     [NEW]
├── package.json                                      [MODIFY]
├── tsconfig.json                                     [MODIFY IF NEEDED]
├── README.md                                         [MODIFY]
├── ARCHITECTURE.md                                   [MODIFY]
├── RUNBOOK.md                                        [MODIFY]
├── MANIFEST.md                                       [MODIFY]
├── VALIDATION.md                                     [MODIFY]
└── CHANGE_SUMMARY.md                                 [MODIFY]
```

---

## 37. Harvest map from the existing pack

### 37.1 Directly reusable with validation

- evidence contract naming;
- `BuildProof` core fields;
- `PublicationEvidence` core fields;
- `DeploymentEvidence` core fields;
- source and distribution hashing utilities;
- generated-site route assertions;
- GitHub publication managed-manifest behavior;
- Vercel commit-correlation concept;
- release receipt schema baseline;
- v3 handoff contract and SEO-Bot acknowledgement correlation;
- disposable integration test scaffolding.

### 37.2 Reuse but rewrite

- `ReleaseReceiptStage`: rewrite to load persisted evidence references.
- `HandoffEmitterStage`: rewrite to consume a validated release bundle.
- `BuildContext`: retain caches but add `EvidenceStore` authority.
- `StageCheckpoint`: add input/output evidence references and resume rules.
- `PipelineRunner`: enforce stage evidence declarations.
- tests that manually attach evidence: convert to store-backed integration tests.

### 37.3 Do not port as-is

- assumptions that optional `BuildContext` fields prove stage execution;
- receipt construction with `Unknown` placeholder values;
- handoff emission from a partial mode;
- tests whose only proof is fixture object assignment;
- docs that claim merged implementation when only an overlay contains it;
- evidence file paths scattered across `build/receipts`, generated site `.l9`, and root `contracts` without an index.

---

## 38. Migration plan

### Phase E0: Baseline lock and inventory

Deliverables:

- record live commit SHA;
- inventory existing stage files, workflows, docs, and schemas;
- identify every overlay-only file;
- create source-to-target migration map;
- run baseline typecheck and tests;
- record failures without repair claims.

Exit gate:

```text
baseline inventory complete
```

### Phase E1: Contract lock

Deliverables:

- TypeScript contracts;
- JSON schemas;
- canonical JSON rules;
- contract parity tests;
- error taxonomy.

Exit gate:

```text
all evidence contracts validate independently
```

### Phase E2: Evidence store and index

Deliverables:

- `EvidenceStore`;
- atomic file persistence;
- index;
- BuildDB index tables;
- path safety;
- secret scan;
- repair-index command.

Exit gate:

```text
write/read/corrupt/recover tests pass
```

### Phase E3: Assembly and build proof integration

Deliverables:

- assembler persists manifest;
- build stage reloads manifest;
- lockfile refresh behavior;
- build proof persistence;
- local proof workflow.

Exit gate:

```text
clean checkout generates Astro source and persisted local proof
```

### Phase E4: Publication proof integration

Deliverables:

- publication consumes persisted build proof;
- source drift gate;
- branch conflict behavior;
- publication evidence persistence;
- guarded disposable GitHub test.

Exit gate:

```text
published branch head equals persisted publication commit
```

### Phase E5: Deployment proof integration

Deliverables:

- deployment consumes publication evidence;
- Vercel project/repo linkage verification;
- READY polling;
- commit correlation;
- deployment evidence persistence;
- guarded disposable Vercel test.

Exit gate:

```text
observed deployment commit equals publication commit
```

### Phase E6: Release receipt and handoff integration

Deliverables:

- chain validator;
- release receipt references;
- handoff bundle API;
- v3 emitter rewrite;
- acknowledgement persistence;
- cross-repo test.

Exit gate:

```text
handoff can only be emitted from a succeeded persisted release receipt
```

### Phase E7: Resume and Inngest integration

Deliverables:

- checkpoint validation;
- resume command;
- whole-step Inngest retry alignment;
- external state reverification;
- failure evidence events.

Exit gate:

```text
retry reconstructs state from evidence files without duplicate remote mutation
```

### Phase E8: Documentation and release convergence

Deliverables:

- update or archive old build plan;
- complete manifest;
- validation report;
- regression guard;
- live credential-bound checks marked accurately;
- final repository tree.

Exit gate:

```text
no documentation claims exceed executable proof
```

---

## 39. Validation commands

Minimum expected commands:

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run normalize-spec:check
npm run evidence:test
npm run evidence:contract-parity
npm run site:test:local
npm run pipeline:plan
npm run pipeline:local-proof -- --spec=fixtures/ci-test-spec.yaml
npm run evidence:validate -- --client-id=ci-test-client --build-id=<build-id>
```

Credential-bound commands:

```bash
npm run site:test:github
npm run site:test:vercel
npm run site:test:e2e
```

These may be marked passed only when actually executed with disposable resources.

---

## 40. Acceptance criteria

### 40.1 Repository acceptance

- All new files are present in the live repository branch.
- `package.json` exposes evidence commands.
- `run-pipeline.ts` initializes `EvidenceStore`.
- `PipelineRunner` enforces stage evidence declarations.
- Handoff v3 does not depend on overlay-only imports.
- The old v2 handoff path is removed or explicitly version-routed.

### 40.2 Local proof acceptance

- A clean checkout runs local proof.
- Real Astro check and build pass.
- Evidence files survive process exit.
- A second process validates the chain from disk.
- Source digest reflects the finalized lockfile-bearing source tree.

### 40.3 Publication acceptance

- Publication is blocked without a valid build proof.
- Source drift is detected.
- Managed-file deletion is safe.
- Branch conflict does not force-update.
- Persisted publication commit equals verified branch head.

### 40.4 Deployment acceptance

- Deployment is blocked without publication evidence.
- Vercel project is linked to the expected repository.
- Deployment reaches `READY`.
- Observed commit equals publication commit.
- Deployment proof persists and revalidates.

### 40.5 Release and handoff acceptance

- `ReleaseReceipt.status=succeeded` only for complete end-to-end proof.
- Handoff uses a validated release bundle.
- Contract digest is deterministic.
- SEO-Bot acknowledgement matches contract, receipt, repository, branch, and commit.
- Registration acknowledgement is persisted.

### 40.6 Resume acceptance

- Interrupted local build can rerun safely.
- Completed publication is not duplicated when external state matches.
- Deployment is not duplicated when the persisted deployment remains READY for the same commit.
- Drift invalidates the checkpoint and blocks unsafe resume.

### 40.7 Security acceptance

- Secret scans find no raw provider credentials.
- Evidence path traversal tests pass.
- Provider error bodies are sanitized.
- Contract examples contain no real credentials.

---

## 41. Regression guards

The build must preserve:

- existing DomainSpec validation;
- existing LLM router behavior;
- content quality gates;
- schema generation;
- per-client output directories;
- P-F provisioning contracts;
- SEO-Bot v3 contract authority;
- non-force publication;
- generated-file ownership manifest;
- plan mode with no external mutation;
- launch environment verification;
- current BuildDB usage and LLM cost recording.

Add regression checks for:

- stage ordering;
- evidence producer/consumer dependencies;
- no handoff before release receipt;
- no v2 payload accidentally sent to v3 endpoint;
- no duplicate receipt implementation;
- no direct `ctx.*Evidence = fixture` in integration tests.

---

## 42. Rollback plan

### 42.1 Code rollback

The implementation must be mergeable in coherent commits:

1. evidence contracts and store;
2. local proof integration;
3. publication proof;
4. deployment proof;
5. receipt and handoff;
6. resume and workflows;
7. docs.

Each commit must compile and pass the tests appropriate to its stage.

### 42.2 Runtime rollback

Rolling back the code must not delete evidence directories.

Older code may ignore newer evidence but must not mutate or reinterpret it.

### 42.3 Schema compatibility

- v1 evidence contracts are immutable after merge.
- breaking changes require `/v2` schemas and migration code.
- handoff v3 exact parity remains locked across repos.

---

## 43. Traceability matrix

| Gap | Required fix | Primary files | Validation |
|---|---|---|---|
| v3 emitter assumes optional context evidence | Make persisted release bundle its only proof input | `HandoffEmitterStage.ts`, `ValidatedReleaseBundle.ts`, `EvidenceStore.ts` | Handoff fails when files are absent even if context is populated |
| Evidence exists only in overlay | Merge contracts and stages into live repo | `src/pipeline/evidence/*`, stage files, package scripts | Clean checkout typecheck and local proof |
| No authoritative evidence storage | Add atomic store and index | `FileEvidenceStore.ts`, `EvidenceIndex.ts` | Corruption, atomicity, rehydration tests |
| Build proof not guaranteed before publish | Require persisted proof and source rehash | `SiteBuildStage.ts`, `ClientSourcePublishStage.ts` | Source drift negative test |
| Deployment may not correlate to commit | Require observed commit equality | `VercelDeployStage.ts`, `DeploymentEvidence.ts` | Wrong-commit test |
| Receipt copies optional fields | Reference persisted artifacts and validate chain | `ReleaseReceiptStage.ts`, `EvidenceChainValidator.ts` | Reference digest mismatch test |
| Durable retry cannot reconstruct state | Add checkpoints and resume | `StageCheckpoint.ts`, `evidence.ts`, Inngest wrapper | Interrupted-run resume test |
| Docs describe unimplemented plan | Converge plan with executable status | docs and manifests | Documentation claim audit |
| Fixture tests fabricate proof | Exercise store-backed stage chain | integration tests | Ban direct fixture assignment in integration scope |

---

## 44. Leverage-ranked implementation priorities

### Priority 1: EvidenceStore plus chain validator

Why first:

Every other fix depends on authoritative persistence and validation. Without it, stages remain coupled through volatile memory.

Unlocks:

- resume;
- safe handoff;
- deterministic receipts;
- CI artifacts;
- credible cross-repo tests.

### Priority 2: Build proof and publication gating

Why second:

This prevents publishing unproven or drifted source, the earliest irreversible provider boundary.

### Priority 3: Deployment commit correlation

Why third:

This converts Vercel success from provider status into release identity proof.

### Priority 4: Handoff rewrite

Why fourth:

The emitter becomes simple and trustworthy only after upstream evidence is authoritative.

### Priority 5: Resume and durable workflow alignment

Why fifth:

It compounds reliability after the evidence files exist and provider stages are idempotent.

---

## 45. Unknown register

```yaml
unknowns:
  - id: U-001
    item: Whether visual QA is a mandatory release gate or informational evidence.
    impact: Determines whether ReleaseReceiptFinalizerStage is required.
    resolution: Lock policy before Phase E6.

  - id: U-002
    item: Whether deploy-hook mode exposes enough metadata to resolve a deployment and observed commit in every configured Vercel setup.
    impact: Hook mode may need to be disabled in favor of API deployment.
    resolution: Verify against disposable Vercel project.

  - id: U-003
    item: Final retention duration for build evidence in GitHub Actions and local hosts.
    impact: Storage and audit availability.
    resolution: Operator policy; default 90 days in CI unless changed.

  - id: U-004
    item: Whether BuildDB remains SQLite in all execution environments.
    impact: Affects future per-stage Inngest split, not this build.
    resolution: Keep current SQLite behavior for this scope.

  - id: U-005
    item: Whether the old root contracts/website_factory_integration.yaml path has external consumers beyond SEO-Bot.
    impact: Determines deprecation window for convenience copy.
    resolution: Search downstream repos before removal.

  - id: U-006
    item: Exact disposable GitHub repository and Vercel project names.
    impact: Credential-bound test execution only.
    resolution: Operator supplies or P-F provisions disposable targets.
```

Unknowns must not be resolved by invention.

---

## 46. Definition of done

The component is done only when all statements below are true:

```yaml
definition_of_done:
  live_repo_contains_evidence_producers: true
  evidence_store_is_authoritative: true
  build_context_is_cache_only: true
  clean_checkout_local_proof_passes: true
  evidence_rehydrates_in_second_process: true
  publication_requires_build_proof: true
  deployment_requires_publication_proof: true
  deployment_commit_is_verified: true
  release_receipt_references_persisted_evidence: true
  v3_handoff_requires_succeeded_release_bundle: true
  seo_bot_ack_is_identity_checked: true
  resume_is_checkpoint_and_external_state_safe: true
  docs_match_executable_state: true
  no_raw_secrets_in_evidence: true
  no_fake_validation_claims: true
```

The following are not sufficient:

- files existing only in a ZIP;
- files existing only in an overlay installer;
- fixture contexts with manually assigned evidence;
- schema validation without stage execution;
- Vercel hook acceptance without deployment correlation;
- publication API success without branch-head verification;
- a handoff contract that validates structurally but cannot trace to persisted evidence.

---

## 47. Convergence block

```yaml
convergence:
  status: spec_converged
  artifact_identity: release_evidence_spine_build_spec
  confirmed_primary_gap: v3_handoff_consumer_not_backed_by_merged_authoritative_evidence_pipeline
  highest_leverage_fix: persisted_evidence_store_plus_chain_validator
  architecture_drift_allowed: false
  parallel_pipeline_allowed: false
  overlay_only_runtime_dependency_allowed: false
  optional_context_as_proof_allowed: false
  external_success_without_identity_correlation_allowed: false
  raw_secrets_in_evidence_allowed: false
  implementation_ready: true
  remaining_unknowns: 6
  stop_condition: implement_E0_through_E8_and_validate_clean_checkout
```
