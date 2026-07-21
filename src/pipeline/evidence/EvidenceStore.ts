// L9_META: layer=pipeline, role=evidence_store_port, status=active, version=2.0.0
import type { ExecutionMode } from '../BuildContext.js';
import type { WebsiteFactoryHandoffV3 } from '../../contracts/WebsiteFactoryHandoffV3.js';
import type { SeoBotRegistrationAck } from '../../contracts/SeoBotRegistrationAck.js';
import type { StageCheckpoint } from '../StageCheckpoint.js';
import type { AssemblyManifest } from './AssemblyManifest.js';
import type { BuildProof } from './BuildProof.js';
import type { DeploymentEvidence } from './DeploymentEvidence.js';
import type { EvidenceIndex } from './EvidenceIndex.js';
import type { EvidenceKind, EvidenceRecord, EvidenceReference } from './EvidenceReference.js';
import type { PublicationEvidence } from './PublicationEvidence.js';
import type { ReleaseReceipt } from './ReleaseReceipt.js';
import type { StageFailureEvidence } from './StageFailureEvidence.js';
import type {
  EvidenceChainValidation,
  LoadReleaseBundleOptions,
  StoredEvidence,
  ValidatedReleaseBundle,
} from './ValidatedReleaseBundle.js';

export interface EvidenceStore {
  readonly rootDir: string;

  initialize(): Promise<EvidenceIndex>;
  readIndex(): Promise<EvidenceIndex>;
  rebuildIndex(): Promise<EvidenceIndex>;
  repairIndex(): Promise<EvidenceIndex>;
  validateChain(mode?: ExecutionMode): Promise<EvidenceChainValidation>;

  referenceFor(kind: EvidenceKind): Promise<EvidenceReference | undefined>;
  verifyReference(reference: EvidenceReference): Promise<boolean>;

  writeAssembly(value: AssemblyManifest): Promise<EvidenceRecord>;
  readAssembly(): Promise<StoredEvidence<AssemblyManifest> | undefined>;
  writeBuild(value: BuildProof): Promise<EvidenceRecord>;
  readBuild(): Promise<StoredEvidence<BuildProof> | undefined>;
  writePublication(value: PublicationEvidence): Promise<EvidenceRecord>;
  readPublication(): Promise<StoredEvidence<PublicationEvidence> | undefined>;
  writeDeployment(value: DeploymentEvidence): Promise<EvidenceRecord>;
  readDeployment(): Promise<StoredEvidence<DeploymentEvidence> | undefined>;
  writeReleaseReceipt(value: ReleaseReceipt): Promise<EvidenceRecord>;
  readReleaseReceipt(): Promise<StoredEvidence<ReleaseReceipt> | undefined>;
  writeHandoff(value: WebsiteFactoryHandoffV3): Promise<EvidenceRecord>;
  readHandoff(): Promise<WebsiteFactoryHandoffV3 | undefined>;
  writeRegistrationAck(value: SeoBotRegistrationAck): Promise<EvidenceRecord>;
  readRegistrationAck(): Promise<SeoBotRegistrationAck | undefined>;
  writeFailure(value: StageFailureEvidence): Promise<EvidenceRecord>;
  readFailure(): Promise<StoredEvidence<StageFailureEvidence> | undefined>;

  requireBuildProof(): Promise<StoredEvidence<BuildProof>>;
  requirePublicationEvidence(): Promise<StoredEvidence<PublicationEvidence>>;
  requireDeploymentEvidence(): Promise<StoredEvidence<DeploymentEvidence>>;
  requireSucceededReleaseReceipt(): Promise<StoredEvidence<ReleaseReceipt>>;

  writeCheckpoint(value: StageCheckpoint): Promise<string>;
  readCheckpoint(stage: string): Promise<StageCheckpoint | undefined>;
  loadValidatedReleaseBundle(options?: LoadReleaseBundleOptions): Promise<ValidatedReleaseBundle>;
}
