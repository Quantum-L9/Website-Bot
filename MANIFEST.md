<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Website-Bot Overlay Manifest

Files: 119

## Core groups

- Pipeline contracts, evidence store, BuildDB index, checkpoints, runner, and error taxonomy.
- Provisioning, generation, build, publication, deployment, receipt, QA, and handoff stages.
- Canonical handoff v3 producer and acknowledgement contracts.
- Operator scripts, CI workflows, schemas, fixtures, and tests.
- Release Evidence Spine build specification under `docs/`.

## Files

```text
.env.example
.github/workflows/build-and-validate.yml
.github/workflows/provision-and-build-client.yml
.github/workflows/site-factory-disposable-e2e.yml
.github/workflows/site-factory-local-proof.yml
.gitignore
CHANGE_SUMMARY.md
MANIFEST.md
RUNBOOK.md
VALIDATION.md
contracts/CONTRACT_LOCK.json
contracts/website-factory-handoff.v3.example.json
contracts/website-factory-handoff.v3.schema.json
docs/release-evidence-spine-build-spec.md
examples/provisioning/domain-spec.provisioning.example.yaml
fixtures/ci-test-spec.yaml
package.json
schemas/assembly-manifest.schema.json
schemas/build-proof.schema.json
schemas/deployment-evidence.schema.json
schemas/evidence-index.schema.json
schemas/provisioning-receipt.schema.json
schemas/publication-evidence.schema.json
schemas/release-receipt.schema.json
schemas/seo-bot-registration-ack.schema.json
schemas/stage-checkpoint.schema.json
schemas/stage-failure-evidence.schema.json
scripts/evidence.ts
scripts/provision-client.ts
scripts/run-disposable-site-factory-e2e.ts
scripts/run-pipeline.ts
scripts/run-site-factory-tests.mjs
scripts/validate-contract-lock.mjs
scripts/validate-evidence-schemas.mjs
scripts/validate-site-factory.ts
src/contracts/SeoBotRegistrationAck.ts
src/contracts/WebsiteFactoryHandoffV3.ts
src/core/logger.ts
src/inngest/website-pipeline.ts
src/lib/budget-guard.ts
src/lib/compensation.ts
src/pipeline/BuildContext.ts
src/pipeline/BuildDB.ts
src/pipeline/BuildError.ts
src/pipeline/PipelineRunner.ts
src/pipeline/StageCheckpoint.ts
src/pipeline/evidence/AssemblyManifest.ts
src/pipeline/evidence/BuildProof.ts
src/pipeline/evidence/DeploymentEvidence.ts
src/pipeline/evidence/EvidenceCanonicalizer.ts
src/pipeline/evidence/EvidenceChainValidator.ts
src/pipeline/evidence/EvidenceIndex.ts
src/pipeline/evidence/EvidenceReference.ts
src/pipeline/evidence/EvidenceStore.ts
src/pipeline/evidence/FileEvidenceStore.ts
src/pipeline/evidence/MemoryEvidenceStore.ts
src/pipeline/evidence/PublicationEvidence.ts
src/pipeline/evidence/ReleaseReceipt.ts
src/pipeline/evidence/StageFailureEvidence.ts
src/pipeline/evidence/ValidatedReleaseBundle.ts
src/pipeline/validateDomainSpec.ts
src/provisioning/GitHubProvisioner.ts
src/provisioning/ProvisioningCoordinator.ts
src/provisioning/SpecDeploymentWriter.ts
src/provisioning/VercelProvisioner.ts
src/provisioning/http.ts
src/provisioning/request.ts
src/provisioning/secret-ref.ts
src/provisioning/types.ts
src/services/hashing.ts
src/services/llm.ts
src/stages/ClientSourcePublishStage.ts
src/stages/ContentGenerationStage.ts
src/stages/DesignIntelligenceStage.ts
src/stages/DomainSpecLoaderStage.ts
src/stages/HandoffEmitterStage.ts
src/stages/PostHogSnippetStage.ts
src/stages/ProvisionClientStage.ts
src/stages/ReleaseReceiptFinalizerStage.ts
src/stages/ReleaseReceiptStage.ts
src/stages/SEOBaselineStage.ts
src/stages/SchemaGeneratorStage.ts
src/stages/SiteAssemblerStage.ts
src/stages/SiteBuildStage.ts
src/stages/UnknownResolverStage.ts
src/stages/VercelDeployStage.ts
src/stages/VisualQAStage.ts
src/validation/validate-assembly-manifest.ts
src/validation/validate-build-proof.ts
src/validation/validate-deployment-evidence.ts
src/validation/validate-evidence-chain.ts
src/validation/validate-generated-site.ts
src/validation/validate-publication-evidence.ts
src/validation/validate-release-receipt.ts
tests/helpers/siteFactoryFixture.ts
tests/integration/github/disposable-publication.test.ts
tests/integration/local/evidence-process-boundary.test.ts
tests/integration/local/site-factory-local-proof.test.ts
tests/integration/vercel/disposable-deployment.test.ts
tests/unit/client-source-publish.test.ts
tests/unit/design-intelligence.test.ts
tests/unit/evidence-chain.test.ts
tests/unit/evidence-store.test.ts
tests/unit/failure-evidence.test.ts
tests/unit/generated-site-validation.test.ts
tests/unit/github-provisioner.test.ts
tests/unit/handoff-emitter-v3.test.ts
tests/unit/posthog-snippet.test.ts
tests/unit/provisioning-request.test.ts
tests/unit/provisioning-transaction.test.ts
tests/unit/release-receipt-stage.test.ts
tests/unit/release-receipt.test.ts
tests/unit/site-assembler.test.ts
tests/unit/site-build.test.ts
tests/unit/stage-checkpoint.test.ts
tests/unit/vercel-deploy.test.ts
tests/unit/vercel-provisioner.test.ts
tsconfig.json
tsconfig.provisioning.json
```
