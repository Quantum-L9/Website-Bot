// L9_META: layer=pipeline, role=evidence_chain_validator, status=active, version=2.0.0
import type { ExecutionMode } from '../BuildContext.js';
import { validateAssemblyManifest } from './AssemblyManifest.js';
import { validateBuildProof } from './BuildProof.js';
import { validateDeploymentEvidence } from './DeploymentEvidence.js';
import { validatePublicationEvidence } from './PublicationEvidence.js';
import { validateReleaseReceipt } from './ReleaseReceipt.js';
import type { EvidenceChainGate, EvidenceChainValidation, StoredEvidence } from './ValidatedReleaseBundle.js';
import type { AssemblyManifest } from './AssemblyManifest.js';
import type { BuildProof } from './BuildProof.js';
import type { PublicationEvidence } from './PublicationEvidence.js';
import type { DeploymentEvidence } from './DeploymentEvidence.js';
import type { ReleaseReceipt } from './ReleaseReceipt.js';

export interface EvidenceChainInput {
  mode: ExecutionMode;
  assembly: StoredEvidence<AssemblyManifest>;
  build?: StoredEvidence<BuildProof>;
  publication?: StoredEvidence<PublicationEvidence>;
  deployment?: StoredEvidence<DeploymentEvidence>;
  receipt: StoredEvidence<ReleaseReceipt>;
  checkedAt?: string;
}

function gate(name: string, status: EvidenceChainGate['status'], detail?: string): EvidenceChainGate {
  return detail ? { name, status, detail } : { name, status };
}

export function validateReleaseEvidenceChain(input: EvidenceChainInput): EvidenceChainValidation {
  const errors: string[] = [];
  const gates: EvidenceChainGate[] = [];
  const { mode, assembly, build, publication, deployment, receipt } = input;

  try { validateAssemblyManifest(assembly.value); gates.push(gate('assembly', 'passed')); }
  catch (error) { const message = String((error as Error).message ?? error); errors.push(message); gates.push(gate('assembly', 'failed', message)); }
  try { validateReleaseReceipt(receipt.value); gates.push(gate('release_receipt', 'passed')); }
  catch (error) { const message = String((error as Error).message ?? error); errors.push(message); gates.push(gate('release_receipt', 'failed', message)); }

  if (assembly.value.buildId !== receipt.value.build_id || assembly.value.clientId !== receipt.value.client_id) {
    errors.push('release evidence build or client identity mismatch');
  }
  if (receipt.value.evidence.assembly.sha256 !== assembly.record.sha256) errors.push('receipt assembly reference is stale');
  if (receipt.value.correlation.source_digest !== assembly.value.sourceDigest) errors.push('receipt source digest differs from assembly');

  const buildRequired = mode !== 'plan';
  if (!build) {
    gates.push(gate('local_build', buildRequired ? 'failed' : 'not_required', buildRequired ? 'build proof is missing' : undefined));
    if (buildRequired) errors.push('build proof is missing');
  } else {
    try { validateBuildProof(build.value); gates.push(gate('local_build', 'passed')); }
    catch (error) { const message = String((error as Error).message ?? error); errors.push(message); gates.push(gate('local_build', 'failed', message)); }
    if (build.value.buildId !== assembly.value.buildId || build.value.clientId !== assembly.value.clientId) errors.push('build proof identity differs from assembly');
    if (build.value.sourceDigest !== assembly.value.sourceDigest) errors.push('build source digest differs from assembly');
    if (build.value.assemblyManifestSha256 !== assembly.record.sha256) errors.push('build proof is bound to a stale assembly manifest');
    if (receipt.value.evidence.build?.sha256 !== build.record.sha256) errors.push('receipt build reference is stale');
    if (receipt.value.correlation.dist_digest !== build.value.distDigest) errors.push('receipt dist digest differs from build');
  }

  const publicationRequired = mode === 'publish-proof' || mode === 'end-to-end';
  if (!publication) {
    gates.push(gate('github_publication', publicationRequired ? 'failed' : 'not_required', publicationRequired ? 'publication evidence is missing' : undefined));
    if (publicationRequired) errors.push('publication evidence is missing');
  } else {
    try { validatePublicationEvidence(publication.value); gates.push(gate('github_publication', 'passed')); }
    catch (error) { const message = String((error as Error).message ?? error); errors.push(message); gates.push(gate('github_publication', 'failed', message)); }
    if (!build) errors.push('publication evidence exists without build proof');
    else {
      if (publication.value.buildProofId !== build.value.proofId || publication.value.buildProofSha256 !== build.record.sha256) errors.push('publication is not bound to build proof');
      if (publication.value.sourceDigest !== build.value.sourceDigest) errors.push('publication source digest differs from build');
    }
    if (receipt.value.evidence.publication?.sha256 !== publication.record.sha256) errors.push('receipt publication reference is stale');
    if (receipt.value.correlation.commit_sha !== publication.value.commitSha) errors.push('receipt commit correlation differs from publication');
  }

  const deploymentRequired = mode === 'end-to-end';
  if (!deployment) {
    gates.push(gate('vercel_deployment', deploymentRequired ? 'failed' : 'not_required', deploymentRequired ? 'deployment evidence is missing' : undefined));
    if (deploymentRequired) errors.push('deployment evidence is missing');
  } else {
    try { validateDeploymentEvidence(deployment.value); gates.push(gate('vercel_deployment', 'passed')); }
    catch (error) { const message = String((error as Error).message ?? error); errors.push(message); gates.push(gate('vercel_deployment', 'failed', message)); }
    if (!publication) errors.push('deployment evidence exists without publication evidence');
    else {
      if (deployment.value.publicationId !== publication.value.publicationId || deployment.value.publicationSha256 !== publication.record.sha256) errors.push('deployment is not bound to publication evidence');
      if (deployment.value.requestedCommitSha !== publication.value.commitSha || deployment.value.observedCommitSha !== publication.value.commitSha) errors.push('deployment commit differs from published commit');
      if (deployment.value.sourceRepository !== publication.value.repository || deployment.value.sourceBranch !== publication.value.branch) errors.push('deployment source differs from publication target');
    }
    if (receipt.value.evidence.deployment?.sha256 !== deployment.record.sha256) errors.push('receipt deployment reference is stale');
    if (receipt.value.correlation.deployment_id !== deployment.value.deploymentId) errors.push('receipt deployment correlation is stale');
  }

  if (receipt.value.status === 'succeeded') {
    if (mode !== 'end-to-end' || !build || !publication || !deployment) errors.push('succeeded release bundle is incomplete');
    if (!receipt.value.correlation.all_required_identities_match) errors.push('succeeded release receipt does not confirm identity correlation');
  }

  return {
    valid: errors.length === 0,
    mode,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    gates,
    identities: {
      sourceDigest: assembly.value.sourceDigest,
      distDigest: build?.value.distDigest,
      commitSha: publication?.value.commitSha,
      deploymentId: deployment?.value.deploymentId,
    },
    errors,
  };
}
