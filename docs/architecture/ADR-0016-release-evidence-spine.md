<!-- L9_META: layer=architecture, role=evidence_spine_adr, status=accepted, version=1.0.0 -->
# ADR-0016: Release Evidence Spine

## Status
Accepted.

## Date
2026-07-20

## Context
Handoff v3 expected `buildProof`, `publicationEvidence`, `deploymentEvidence`,
and `releaseReceipt` on `BuildContext`. Those fields were overlay-local. A
stage could succeed with evidence only in memory; a resume could not
reconstruct the chain; the emitter could synthesize a receipt from
inconsistent objects. Logs are not proof.

## Decision
The **Release Evidence Spine** is a first-class subsystem. It owns evidence
contracts, persistence, digests, correlation, mode gates, receipt assembly,
rehydration, and the evidence index. It does not own LLM/design generation,
Astro composition, provisioning, SEO-Bot mutations, secrets, or approval
policy.

Canonical chain:

```
AssemblyManifest
  → BuildProof
  → PublicationEvidence
  → DeploymentEvidence
  → ReleaseReceipt
  → WebsiteFactoryHandoffV3
  → SeoBotRegistrationAck
```

1. **`EvidenceStore` is authoritative.** `BuildContext` may cache loaded
   values. After a process boundary, stages load via `EvidenceStore.require*()`.
   Attaching fabricated evidence to a fixture context is forbidden as a
   substitute for exercising real stage outputs.
2. **The v3 emitter consumes one validated release bundle.** It does not
   generate, repair, or parse missing upstream evidence.
3. **One pipeline.** Do not add a second runner beside `PipelineRunner`.
4. **Persisted proof before remote mutation.** `client-source-publish` requires
   a passed `BuildProof`. `vercel-deploy` requires persisted, revalidated
   `PublicationEvidence`.
5. **Correlation is fail-closed.** Assembly/build/publication/release source
   digests must be equal. Publication commit SHA must equal deployment
   requested and observed SHAs and the handoff site identities. No stage may
   downgrade these equalities to warnings.
6. **Execution modes:** `plan` | `local-proof` | `publish-proof` | `end-to-end`.
   Plan writes no site source, success evidence, or remote calls. Local-proof
   forbids GitHub/Vercel/SEO-Bot activation. Publish-proof forbids claiming
   deployed status. End-to-end fails on any missing, partial, invalid, or
   uncorrelated required artifact.
7. **Storage.** Runtime evidence lives under
   `build/evidence/<client-id>/<build-id>/` (gitignored). The generated client
   repo receives only source-ownership metadata, not the factory evidence
   tree. Secret values are prohibited in evidence files.
8. **Canonical JSON** from the shared canonicalizer is used for IDs and
   digests. Do not `JSON.stringify` contract digests directly.
9. **No new observability platform** and no external database solely for
   evidence.

## Consequences
- Handoff cannot succeed from stale or partial in-memory context.
- Tests must produce evidence through stages, not by stuffing `BuildContext`.
- Preview promotion and automated production rollback remain out of scope
  (see ADR-0006).
- Full implementation notes remain in the archived build spec; this ADR is
  the living decision.

## Related Artifacts
- `src/pipeline/evidence/`
- `schemas/*-evidence*.json`, `schemas/assembly-manifest.schema.json`,
  `schemas/build-proof.schema.json`, `schemas/release-receipt.schema.json`
- `contracts/website-factory-handoff.v3.schema.json`
- Archived source: `docs/archive/release-evidence-spine-build-spec.md`
