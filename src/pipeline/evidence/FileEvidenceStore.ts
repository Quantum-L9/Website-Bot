// L9_META: layer=pipeline, role=file_evidence_store, status=active, version=2.0.0
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ExecutionMode } from '../BuildContext.js';
import { validateStageCheckpoint, type StageCheckpoint } from '../StageCheckpoint.js';
import { assertWebsiteFactoryHandoffV3, type WebsiteFactoryHandoffV3 } from '../../contracts/WebsiteFactoryHandoffV3.js';
import { validateSeoBotRegistrationAck, type SeoBotRegistrationAck } from '../../contracts/SeoBotRegistrationAck.js';
import { canonicalJson, sha256File } from './EvidenceCanonicalizer.js';
import { validateAssemblyManifest, type AssemblyManifest } from './AssemblyManifest.js';
import { validateBuildProof, type BuildProof } from './BuildProof.js';
import { validateDeploymentEvidence, type DeploymentEvidence } from './DeploymentEvidence.js';
import { validateReleaseEvidenceChain } from './EvidenceChainValidator.js';
import { validateEvidenceIndex, type EvidenceChainStatus, type EvidenceIndex } from './EvidenceIndex.js';
import type { EvidenceKind, EvidenceRecord, EvidenceReference } from './EvidenceReference.js';
import { recordToReference } from './EvidenceReference.js';
import type { EvidenceStore } from './EvidenceStore.js';
import { validatePublicationEvidence, type PublicationEvidence } from './PublicationEvidence.js';
import { validateReleaseReceipt, type ReleaseReceipt } from './ReleaseReceipt.js';
import { validateStageFailureEvidence, type StageFailureEvidence } from './StageFailureEvidence.js';
import type {
  EvidenceChainValidation,
  LoadReleaseBundleOptions,
  StoredEvidence,
  ValidatedReleaseBundle,
} from './ValidatedReleaseBundle.js';

export interface FileEvidenceStoreOptions {
  evidenceRoot?: string;
  rootDir?: string;
  clientId: string;
  buildId: string;
  mode: ExecutionMode;
  now?: () => Date;
}

const FILES: Record<Exclude<EvidenceKind, 'failure'>, string> = {
  assembly: 'assembly-manifest.json',
  build: 'build-proof.json',
  publication: 'publication-evidence.json',
  deployment: 'deployment-evidence.json',
  release: 'release-receipt.json',
  handoff: 'handoff-v3.json',
  registration_ack: 'seo-bot-registration-ack.json',
};

const SCHEMAS: Record<EvidenceKind, string> = {
  assembly: 'website-bot.assembly-manifest/v1',
  build: 'website-bot.build-proof/v1',
  publication: 'website-bot.publication-evidence/v1',
  deployment: 'website-bot.deployment-evidence/v1',
  release: 'website-bot.release-receipt/v1',
  handoff: 'l9.website-factory.handoff/3.0',
  registration_ack: 'seo-bot.website-factory-registration-ack/v1',
  failure: 'website-bot.stage-failure/v1',
};

function safeStage(stage: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(stage)) throw new Error(`unsafe stage name: ${stage}`);
  return stage;
}

export class FileEvidenceStore implements EvidenceStore {
  readonly rootDir: string;
  private readonly indexPath: string;
  private readonly now: () => Date;

  constructor(private readonly options: FileEvidenceStoreOptions) {
    this.rootDir = resolve(
      options.rootDir ?? join(options.evidenceRoot ?? join('build', 'evidence'), options.clientId, options.buildId),
    );
    this.indexPath = join(this.rootDir, 'evidence-index.json');
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<EvidenceIndex> {
    mkdirSync(this.rootDir, { recursive: true });
    if (existsSync(this.indexPath)) {
      const index = await this.readIndex();
      this.assertIdentity(index);
      return index;
    }
    const timestamp = this.now().toISOString();
    const index: EvidenceIndex = {
      schema: 'website-bot.evidence-index/v1',
      build_id: this.options.buildId,
      client_id: this.options.clientId,
      mode: this.options.mode,
      revision: 1,
      artifacts: {},
      chain_status: 'empty',
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.atomicJson(this.indexPath, index);
    return index;
  }

  async readIndex(): Promise<EvidenceIndex> {
    if (!existsSync(this.indexPath)) return this.initialize();
    const value = JSON.parse(readFileSync(this.indexPath, 'utf-8')) as unknown;
    validateEvidenceIndex(value);
    this.assertIdentity(value);
    return value;
  }

  async rebuildIndex(): Promise<EvidenceIndex> {
    const existing = existsSync(this.indexPath)
      ? await this.readIndex()
      : await this.initialize();
    const artifacts: EvidenceIndex['artifacts'] = {};

    for (const [kind, relativePath] of Object.entries(FILES) as Array<[Exclude<EvidenceKind, 'failure'>, string]>) {
      const path = join(this.rootDir, relativePath);
      if (!existsSync(path)) continue;
      const value = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      this.validateByKind(kind, value);
      artifacts[kind] = this.recordFor(kind, relativePath, value, existing.updated_at);
    }

    const failurePath = join(this.rootDir, 'failures', 'latest.json');
    if (existsSync(failurePath)) {
      const value = JSON.parse(readFileSync(failurePath, 'utf-8')) as Record<string, unknown>;
      validateStageFailureEvidence(value);
      artifacts.failure = this.recordFor('failure', 'failures/latest.json', value, existing.updated_at);
    }

    const index: EvidenceIndex = {
      ...existing,
      revision: existing.revision + 1,
      artifacts,
      chain_status: this.statusFor(artifacts),
      updated_at: this.now().toISOString(),
    };
    this.atomicJson(this.indexPath, index);
    return index;
  }

  async repairIndex(): Promise<EvidenceIndex> {
    return this.rebuildIndex();
  }

  async validateChain(mode = this.options.mode): Promise<EvidenceChainValidation> {
    const assembly = await this.readAssembly();
    const receipt = await this.readReleaseReceipt();
    if (!assembly || !receipt) {
      return {
        valid: false,
        mode,
        checkedAt: this.now().toISOString(),
        gates: [],
        identities: {},
        errors: ['assembly manifest and release receipt are required'],
      };
    }
    return validateReleaseEvidenceChain({
      mode,
      assembly,
      build: await this.readBuild(),
      publication: await this.readPublication(),
      deployment: await this.readDeployment(),
      receipt,
      checkedAt: this.now().toISOString(),
    });
  }

  async referenceFor(kind: EvidenceKind): Promise<EvidenceReference | undefined> {
    const record = (await this.readIndex()).artifacts[kind];
    return record ? recordToReference(record) : undefined;
  }

  async verifyReference(reference: EvidenceReference): Promise<boolean> {
    try {
      const path = this.safeResolve(reference.relative_path);
      return existsSync(path) && sha256File(path) === reference.sha256;
    } catch {
      return false;
    }
  }

  async writeAssembly(value: AssemblyManifest): Promise<EvidenceRecord> {
    validateAssemblyManifest(value);
    return this.write('assembly', value);
  }
  async readAssembly(): Promise<StoredEvidence<AssemblyManifest> | undefined> {
    return this.read('assembly', validateAssemblyManifest);
  }
  async writeBuild(value: BuildProof): Promise<EvidenceRecord> {
    validateBuildProof(value);
    return this.write('build', value);
  }
  async readBuild(): Promise<StoredEvidence<BuildProof> | undefined> {
    return this.read('build', validateBuildProof);
  }
  async writePublication(value: PublicationEvidence): Promise<EvidenceRecord> {
    validatePublicationEvidence(value);
    return this.write('publication', value);
  }
  async readPublication(): Promise<StoredEvidence<PublicationEvidence> | undefined> {
    return this.read('publication', validatePublicationEvidence);
  }
  async writeDeployment(value: DeploymentEvidence): Promise<EvidenceRecord> {
    validateDeploymentEvidence(value);
    return this.write('deployment', value);
  }
  async readDeployment(): Promise<StoredEvidence<DeploymentEvidence> | undefined> {
    return this.read('deployment', validateDeploymentEvidence);
  }
  async writeReleaseReceipt(value: ReleaseReceipt): Promise<EvidenceRecord> {
    validateReleaseReceipt(value);
    return this.write('release', value);
  }
  async readReleaseReceipt(): Promise<StoredEvidence<ReleaseReceipt> | undefined> {
    return this.read('release', validateReleaseReceipt);
  }
  async writeHandoff(value: WebsiteFactoryHandoffV3): Promise<EvidenceRecord> {
    assertWebsiteFactoryHandoffV3(value);
    return this.write('handoff', value);
  }
  async readHandoff(): Promise<WebsiteFactoryHandoffV3 | undefined> {
    const stored = await this.readRaw<WebsiteFactoryHandoffV3>('handoff');
    if (!stored) return undefined;
    assertWebsiteFactoryHandoffV3(stored.value);
    return stored.value;
  }
  async writeRegistrationAck(value: SeoBotRegistrationAck): Promise<EvidenceRecord> {
    validateSeoBotRegistrationAck(value);
    return this.write('registration_ack', value);
  }
  async readRegistrationAck(): Promise<SeoBotRegistrationAck | undefined> {
    const stored = await this.readRaw<SeoBotRegistrationAck>('registration_ack');
    if (!stored) return undefined;
    validateSeoBotRegistrationAck(stored.value);
    return stored.value;
  }
  async writeFailure(value: StageFailureEvidence): Promise<EvidenceRecord> {
    validateStageFailureEvidence(value);
    await this.initialize();
    const relativePath = `failures/${safeStage(value.stage)}-${value.attempt}.json`;
    this.atomicJson(join(this.rootDir, relativePath), value);
    this.atomicJson(join(this.rootDir, 'failures', 'latest.json'), value);
    return this.updateIndex('failure', value, 'failures/latest.json', 'failed');
  }
  async readFailure(): Promise<StoredEvidence<StageFailureEvidence> | undefined> {
    return this.read('failure', validateStageFailureEvidence);
  }

  async requireBuildProof(): Promise<StoredEvidence<BuildProof>> {
    const stored = await this.readBuild();
    if (!stored) throw new Error('build proof evidence is required');
    return stored;
  }
  async requirePublicationEvidence(): Promise<StoredEvidence<PublicationEvidence>> {
    const stored = await this.readPublication();
    if (!stored) throw new Error('publication evidence is required');
    return stored;
  }
  async requireDeploymentEvidence(): Promise<StoredEvidence<DeploymentEvidence>> {
    const stored = await this.readDeployment();
    if (!stored) throw new Error('deployment evidence is required');
    return stored;
  }
  async requireSucceededReleaseReceipt(): Promise<StoredEvidence<ReleaseReceipt>> {
    const stored = await this.readReleaseReceipt();
    if (!stored || stored.value.status !== 'succeeded') throw new Error('succeeded release receipt evidence is required');
    return stored;
  }

  async writeCheckpoint(value: StageCheckpoint): Promise<string> {
    validateStageCheckpoint(value);
    const path = join(this.rootDir, 'checkpoints', `${safeStage(value.stage)}.json`);
    this.atomicJson(path, value);
    return path;
  }

  async readCheckpoint(stage: string): Promise<StageCheckpoint | undefined> {
    const path = join(this.rootDir, 'checkpoints', `${safeStage(stage)}.json`);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    validateStageCheckpoint(value);
    return value;
  }

  async loadValidatedReleaseBundle(options: LoadReleaseBundleOptions = {}): Promise<ValidatedReleaseBundle> {
    const index = await this.readIndex();
    const assembly = await this.readAssembly();
    const receipt = await this.readReleaseReceipt();
    if (!assembly || !receipt) throw new Error('release bundle requires assembly and receipt evidence');
    const build = await this.readBuild();
    const publication = await this.readPublication();
    const deployment = await this.readDeployment();
    const validation = validateReleaseEvidenceChain({
      mode: index.mode,
      assembly,
      build,
      publication,
      deployment,
      receipt,
      checkedAt: this.now().toISOString(),
    });
    if (!validation.valid) throw new Error(`release evidence chain is invalid: ${validation.errors.join('; ')}`);
    if (options.requireStatus && receipt.value.status !== options.requireStatus) {
      throw new Error(`release receipt status ${receipt.value.status} does not satisfy ${options.requireStatus}`);
    }
    if (options.requireMode && index.mode !== options.requireMode) {
      throw new Error(`evidence mode ${index.mode} does not satisfy ${options.requireMode}`);
    }
    return {
      index,
      assemblyManifest: assembly.value,
      buildProof: build?.value,
      publicationEvidence: publication?.value,
      deploymentEvidence: deployment?.value,
      releaseReceipt: receipt.value,
      validation,
      references: {
        assembly: assembly.record,
        build: build?.record,
        publication: publication?.record,
        deployment: deployment?.record,
        release: receipt.record,
      },
      assembly,
      build,
      publication,
      deployment,
      receipt,
    };
  }

  private async write(kind: Exclude<EvidenceKind, 'failure'>, value: object): Promise<EvidenceRecord> {
    await this.initialize();
    const relativePath = FILES[kind];
    this.atomicJson(join(this.rootDir, relativePath), value);
    return this.updateIndex(kind, value, relativePath);
  }

  private async updateIndex(
    kind: EvidenceKind,
    value: object,
    relativePath: string,
    forcedStatus?: EvidenceChainStatus,
  ): Promise<EvidenceRecord> {
    const record = this.recordFor(kind, relativePath, value, this.now().toISOString());
    const index = await this.readIndex();
    index.artifacts[kind] = record;
    index.revision += 1;
    index.chain_status = forcedStatus ?? this.statusFor(index.artifacts);
    index.updated_at = this.now().toISOString();
    if (forcedStatus === 'failed') {
      const stage = (value as Record<string, unknown>).stage;
      index.failed_stage = typeof stage === 'string' ? stage : index.failed_stage;
    }
    this.atomicJson(this.indexPath, index);
    return record;
  }

  private async read<T>(
    kind: EvidenceKind,
    validate: (value: unknown) => asserts value is T,
  ): Promise<StoredEvidence<T> | undefined> {
    const stored = await this.readRaw<T>(kind);
    if (!stored) return undefined;
    validate(stored.value);
    return stored;
  }

  private async readRaw<T>(kind: EvidenceKind): Promise<StoredEvidence<T> | undefined> {
    const index = await this.readIndex();
    const record = index.artifacts[kind];
    if (!record) return undefined;
    const path = this.safeResolve(record.relativePath);
    if (!existsSync(path)) throw new Error(`${kind} evidence file is missing`);
    if (sha256File(path) !== record.sha256) throw new Error(`${kind} evidence hash mismatch`);
    return { value: JSON.parse(readFileSync(path, 'utf-8')) as T, record };
  }

  private recordFor(kind: EvidenceKind, relativePath: string, value: object, writtenAt: string): EvidenceRecord {
    const path = this.safeResolve(relativePath);
    return {
      kind,
      schema: String((value as Record<string, unknown>).schema ?? SCHEMAS[kind]),
      logicalId: this.logicalId(kind, value),
      relativePath,
      sha256: sha256File(path),
      writtenAt,
    };
  }

  private logicalId(kind: EvidenceKind, value: object): string {
    const record = value as Record<string, unknown>;
    return String(
      record.proofId
      ?? record.publicationId
      ?? record.deploymentEvidenceId
      ?? record.receipt_id
      ?? record.contract_id
      ?? `${this.options.buildId}:${kind}`,
    );
  }

  private statusFor(artifacts: EvidenceIndex['artifacts']): EvidenceChainStatus {
    if (artifacts.failure) return 'failed';
    if (artifacts.registration_ack) return 'handed_off';
    if (artifacts.handoff) return 'released';
    if (artifacts.release) return 'released';
    if (artifacts.deployment) return 'deployed';
    if (artifacts.publication) return 'published';
    if (artifacts.build) return 'built';
    if (artifacts.assembly) return 'assembling';
    return 'empty';
  }

  private validateByKind(kind: EvidenceKind, value: unknown): void {
    switch (kind) {
      case 'assembly': validateAssemblyManifest(value); break;
      case 'build': validateBuildProof(value); break;
      case 'publication': validatePublicationEvidence(value); break;
      case 'deployment': validateDeploymentEvidence(value); break;
      case 'release': validateReleaseReceipt(value); break;
      case 'handoff': assertWebsiteFactoryHandoffV3(value as WebsiteFactoryHandoffV3); break;
      case 'registration_ack': validateSeoBotRegistrationAck(value); break;
      case 'failure': validateStageFailureEvidence(value); break;
    }
  }

  private assertIdentity(index: EvidenceIndex): void {
    if (index.client_id !== this.options.clientId || index.build_id !== this.options.buildId || index.mode !== this.options.mode) {
      throw new Error('evidence root identity does not match current run');
    }
  }

  private safeResolve(relativePath: string): string {
    const path = resolve(this.rootDir, relativePath);
    if (path !== this.rootDir && !path.startsWith(`${this.rootDir}/`)) throw new Error('evidence path escapes root');
    return path;
  }

  private atomicJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const stable = JSON.parse(canonicalJson(value)) as unknown;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(stable, null, 2)}\n`, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
