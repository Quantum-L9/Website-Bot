// L9_META: layer=pipeline, role=publication_evidence_contract, status=active, version=2.1.0
export interface PublicationEvidence {
  schema: 'website-bot.publication-evidence/v2';
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
  managedManifestDigest: string;
  changedPaths: string[];
  deletedPaths: string[];
  noOp: boolean;
  publishedAt: string;
  status: 'passed';
}

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validatePublicationEvidence(value: unknown): asserts value is PublicationEvidence {
  if (!value || typeof value !== 'object') throw new Error('publication evidence must be an object');
  const evidence = value as Partial<PublicationEvidence>;
  if (evidence.schema !== 'website-bot.publication-evidence/v2' || evidence.status !== 'passed' || !evidence.publicationId || !evidence.buildId || !evidence.clientId || !evidence.buildProofId) {
    throw new Error('publication identity or status is invalid');
  }
  if (!SHA256.test(String(evidence.buildProofSha256)) || !SHA256.test(String(evidence.sourceDigest)) || !SHA256.test(String(evidence.managedManifestDigest))) {
    throw new Error('publication digest is invalid');
  }
  if (!REPOSITORY.test(String(evidence.repository)) || !evidence.branch) throw new Error('publication repository or branch is invalid');
  if (!SHA1.test(String(evidence.commitSha)) || !SHA1.test(String(evidence.treeSha)) || !SHA1.test(String(evidence.verifiedBranchHeadSha))) {
    throw new Error('publication Git identity is invalid');
  }
  if (evidence.previousHeadSha !== null && !SHA1.test(String(evidence.previousHeadSha))) throw new Error('previousHeadSha is invalid');
  if (evidence.commitSha !== evidence.verifiedBranchHeadSha) throw new Error('published commit is not the verified branch head');
  if (!Array.isArray(evidence.changedPaths) || !Array.isArray(evidence.deletedPaths)) throw new Error('publication path lists are missing');
  if (!evidence.publishedAt || Number.isNaN(Date.parse(evidence.publishedAt))) throw new Error('publication timestamp is invalid');
}
