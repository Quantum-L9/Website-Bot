// L9_META: layer=pipeline, role=plan_evidence_store, status=active, version=1.0.0
import type { ExecutionMode } from '../BuildContext.js';
import type { StageCheckpoint } from '../StageCheckpoint.js';
import type { WebsiteFactoryHandoffV3 } from '../../contracts/WebsiteFactoryHandoffV3.js';
import type { SeoBotRegistrationAck } from '../../contracts/SeoBotRegistrationAck.js';
import type { AssemblyManifest } from './AssemblyManifest.js';
import type { BuildProof } from './BuildProof.js';
import type { DeploymentEvidence } from './DeploymentEvidence.js';
import type { EvidenceIndex } from './EvidenceIndex.js';
import type { EvidenceKind, EvidenceRecord, EvidenceReference } from './EvidenceReference.js';
import type { EvidenceStore } from './EvidenceStore.js';
import type { PublicationEvidence } from './PublicationEvidence.js';
import type { ReleaseReceipt } from './ReleaseReceipt.js';
import type { StageFailureEvidence } from './StageFailureEvidence.js';
import type { EvidenceChainValidation, LoadReleaseBundleOptions, StoredEvidence, ValidatedReleaseBundle } from './ValidatedReleaseBundle.js';

/**
 * Non-persistent store used only for plan mode. It prevents dry-run validation
 * from creating evidence files that could later be mistaken for runtime proof.
 */
export class MemoryEvidenceStore implements EvidenceStore {
  readonly rootDir = 'memory://plan';
  private readonly index: EvidenceIndex;

  constructor(clientId: string, buildId: string, mode: ExecutionMode = 'plan') {
    const now = new Date().toISOString();
    this.index = {
      schema: 'website-bot.evidence-index/v2',
      build_id: buildId,
      client_id: clientId,
      mode,
      revision: 1,
      artifacts: {},
      failure_history: [],
      chain_status: 'empty',
      created_at: now,
      updated_at: now,
    };
  }

  async initialize() { return this.index; }
  async readIndex() { return this.index; }
  async rebuildIndex() { return this.index; }
  async repairIndex() { return this.index; }
  async transitionStageSucceeded(_stage: string) { return this.index; }
  async transitionStageFailed(_stage: string, _failure: EvidenceRecord) { return this.index; }
  async transitionRunConverged() { return this.index; }
  async validateChain(): Promise<EvidenceChainValidation> {
    return { valid: false, mode: this.index.mode, checkedAt: new Date().toISOString(), gates: [], identities: {}, errors: ['plan mode has no persisted evidence'] };
  }
  async referenceFor(_kind: EvidenceKind) { return undefined; }
  async verifyReference(_reference: EvidenceReference) { return false; }
  async writeAssembly(_value: AssemblyManifest): Promise<EvidenceRecord> { return this.forbidden(); }
  async readAssembly(): Promise<StoredEvidence<AssemblyManifest> | undefined> { return undefined; }
  async writeBuild(_value: BuildProof): Promise<EvidenceRecord> { return this.forbidden(); }
  async readBuild(): Promise<StoredEvidence<BuildProof> | undefined> { return undefined; }
  async writePublication(_value: PublicationEvidence): Promise<EvidenceRecord> { return this.forbidden(); }
  async readPublication(): Promise<StoredEvidence<PublicationEvidence> | undefined> { return undefined; }
  async writeDeployment(_value: DeploymentEvidence): Promise<EvidenceRecord> { return this.forbidden(); }
  async readDeployment(): Promise<StoredEvidence<DeploymentEvidence> | undefined> { return undefined; }
  async writeReleaseReceipt(_value: ReleaseReceipt): Promise<EvidenceRecord> { return this.forbidden(); }
  async readReleaseReceipt(): Promise<StoredEvidence<ReleaseReceipt> | undefined> { return undefined; }
  async writeHandoff(_value: WebsiteFactoryHandoffV3): Promise<EvidenceRecord> { return this.forbidden(); }
  async readHandoff(): Promise<WebsiteFactoryHandoffV3 | undefined> { return undefined; }
  async writeRegistrationAck(_value: SeoBotRegistrationAck): Promise<EvidenceRecord> { return this.forbidden(); }
  async readRegistrationAck(): Promise<SeoBotRegistrationAck | undefined> { return undefined; }
  async writeFailure(_value: StageFailureEvidence): Promise<EvidenceRecord> { return this.forbidden(); }
  async readFailure(): Promise<StoredEvidence<StageFailureEvidence> | undefined> { return undefined; }
  async requireBuildProof(): Promise<StoredEvidence<BuildProof>> { return this.forbidden(); }
  async requirePublicationEvidence(): Promise<StoredEvidence<PublicationEvidence>> { return this.forbidden(); }
  async requireDeploymentEvidence(): Promise<StoredEvidence<DeploymentEvidence>> { return this.forbidden(); }
  async requireSucceededReleaseReceipt(): Promise<StoredEvidence<ReleaseReceipt>> { return this.forbidden(); }
  async writeCheckpoint(_value: StageCheckpoint): Promise<string> { return this.forbidden(); }
  async readCheckpoint(_stage: string): Promise<StageCheckpoint | undefined> { return undefined; }
  async loadValidatedReleaseBundle(_options?: LoadReleaseBundleOptions): Promise<ValidatedReleaseBundle> { return this.forbidden(); }

  private forbidden(): never {
    throw new Error('plan mode cannot persist or consume runtime evidence');
  }
}
