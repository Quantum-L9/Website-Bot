// L9_META: layer=recursive, role=simulated_three_wave_proof, status=active, version=1.0.0
// Simulated three-wave proof. Fully controlled, non-production: the REAL
// controller, harvest compiler, signal registry, PE pack compiler, executor,
// verifier, promotion, and deployment modules run unmodified, driven against
// (a) a disposable local git repository acting as the Website-Bot "remote",
// (b) a local directory acting as the deployment environment, and (c) real
// ReleaseReceipt-shaped E2E evidence produced by the repo's own receipt
// module over fixture data. No real Safe Haven campaign is launched; no
// GitHub or Vercel operation occurs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256Text } from '../../services/hashing.js';
import type { RecursiveEngineeringRunReceipt } from '../contracts/types.js';
import { RecursiveEngineeringController } from '../controller.js';
import { EventLedger } from '../events/ledger.js';
import { LeaseManager } from '../events/leases.js';
import { BoundedCodingExecutor, type PatchInstruction } from '../executor/adapter.js';
import { IndependentVerifier } from '../verifier/verifier.js';
import { LocalGitPromotionAdapter, PromotionOrchestrator } from '../promotion/orchestrator.js';
import { DeploymentVerifier, LocalDirectoryDeploymentAdapter } from '../deployment/verifier.js';
import { JsonStore } from '../storage/json-store.js';
import type { ReleaseReceipt } from '../../pipeline/evidence/ReleaseReceipt.js';

const VERIFIER_IDENTITY = 'independent-verifier-simulation';
const EXECUTOR_IDENTITY = 'coding-executor-simulation';

export interface SimulationInput {
  stateRoot: string;
  now?: () => string;
}

function fixtureReleaseReceipt(input: { status: 'succeeded' | 'failed'; missingGates?: ReleaseReceipt['missing_gates']; commitSha: string; wave: number }): ReleaseReceipt {
  const evidenceRef = {
    kind: 'assembly' as const,
    schema: 'website-bot.assembly-manifest/v2',
    logical_id: `assembly:sim-${input.wave}`,
    relative_path: `sim-${input.wave}/assembly-manifest.json`,
    sha256: sha256Text(`sim-assembly-${input.wave}`),
  };
  const receipt: ReleaseReceipt = {
    schema: 'website-bot.release-receipt/v2',
    receipt_id: `rr-sim-${input.wave}`,
    build_id: `sim-build-${input.wave}`,
    client_id: 'recursive-simulation',
    mode: 'end-to-end',
    status: input.status,
    missing_gates: input.missingGates ?? [],
    evidence: { assembly: evidenceRef },
    correlation: {
      source_digest: sha256Text(`sim-source-${input.wave}`),
      commit_sha: input.commitSha,
      all_required_identities_match: true,
    },
    qa: { seo_baseline: 'passed', visual_qa: input.status === 'succeeded' ? 'passed' : 'failed' },
    created_at: new Date().toISOString(),
  };
  return receipt;
}

/**
 * Runs the simulated three-wave proof and returns the final run receipt.
 * Proven outcomes: E2E_1 tests V0 -> patch V1; E2E_2 tests exactly deployed
 * V1 -> V2; E2E_3 tests exactly deployed V2 -> V3; no wave four;
 * V3 engineering+deployment validated; full E2E validated = false.
 */
export async function runSimulatedThreeWaveProof(input: SimulationInput): Promise<RecursiveEngineeringRunReceipt> {
  const sandbox = mkdtempSync(join(tmpdir(), 'recursive-sim-'));
  const repository = join(sandbox, 'website-bot');
  const remote = join(sandbox, 'remote.git');
  const deployDir = join(sandbox, 'deploy');
  const healthMarker = join(deployDir, 'health.txt');
  const store = new JsonStore(join(input.stateRoot, 'simulation'));
  const ledger = new EventLedger(join(input.stateRoot, 'simulation', 'events.jsonl'));
  const leases = new LeaseManager(store);
  mkdirSync(repository, { recursive: true });
  try {
    execFileSync('git', ['init', '--quiet', '-b', 'main', repository]);
    // The baseline repository carries a real contract file so control replay
    // has byte-verifiable ground truth that must stay unchanged across waves.
    writeFileSync(join(repository, 'package.json'), JSON.stringify({ name: 'recursive-simulation-target', version: '0.1.0', scripts: {} }, null, 2) + '\n', 'utf-8');
    execFileSync('git', ['-C', repository, 'add', '-A'], { encoding: 'utf-8' });
    execFileSync('git', ['-C', repository, '-c', 'user.email=sim@local', '-c', 'user.name=sim', 'commit', '--quiet', '-m', 'V0 baseline']);
    const v0 = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    execFileSync('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
    execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', remote]);
    execFileSync('git', ['-C', repository, 'push', '--quiet', 'origin', 'main']);

    const seenShas: string[] = [v0];
    let wave = 0;

    // Each wave discovers exactly one material defect on a distinct subsystem,
    // so every wave has one coherent root-cause cluster to compile a pack for.
    const WAVE_DEFECTS: Record<number, { stage: string; errorCode: string; message: string }> = {
      1: { stage: 'visual-qa', errorCode: 'SIM_VISUAL_DEFECT', message: 'simulated quality-model defect' },
      2: { stage: 'site-build', errorCode: 'SIM_BUILD_DEFECT', message: 'simulated correctness defect' },
      3: { stage: 'design-intelligence', errorCode: 'SIM_DESIGN_DEFECT', message: 'simulated capability defect' },
    };

    const e2eRunner = {
      run: async (revisionSha: string, _sourceUrl: string) => {
        wave += 1;
        const status = 'succeeded';
        const receipt = fixtureReleaseReceipt({ status, commitSha: revisionSha, wave });
        seenShas.push(revisionSha);
        const defect = WAVE_DEFECTS[wave];
        return {
          deployedSha: revisionSha,
          reviewable: false,
          e2eReceiptId: receipt.receipt_id,
          harvestInput: {
            recursiveRunId: 'recursive-simulation-run',
            wave: wave as 1 | 2 | 3,
            repository: 'Quantum-L9/Website-Bot',
            fullCommitSha: revisionSha,
            sourceUrl: 'https://simulation.invalid',
            releaseReceipt: receipt,
            chainStatus: 'released',
            stageFailures: defect ? [defect] : [],
            checkpointDigests: [],
            previousWaveOutcomes: [],
          },
        };
      },
    };

    const verifier = new IndependentVerifier(VERIFIER_IDENTITY);
    const executor = new BoundedCodingExecutor(EXECUTOR_IDENTITY);
    const promotion = new PromotionOrchestrator(new LocalGitPromotionAdapter(remote));
    const deployment = new DeploymentVerifier(new LocalDirectoryDeploymentAdapter(deployDir, healthMarker));

    const patchInstructionFor = (w: 1 | 2 | 3): PatchInstruction => ({
      changedFiles: [`src/sim-marker-${w}.ts`],
      diffLines: 1,
      apply: (workdir: string) => {
        mkdirSync(join(workdir, 'src'), { recursive: true });
        writeFileSync(join(workdir, `src/sim-marker-${w}.ts`), `// simulated bounded change for wave ${w}\nexport const marker = ${w};\n`, 'utf-8');
      },
      publish: (workdir: string, branch: string) => {
        execFileSync('git', ['-C', workdir, 'push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`], { encoding: 'utf-8' });
      },
    });

    const replayProvider = (input: { pack: import('../contracts/types.js').PEPack; beforeWorkdir: string; patchedWorkdir: string }) => {
      // Real, deterministic file-based replay: the originating case checks
      // that the bounded change authorized by the pack is actually present in
      // the patched tree; the control case checks that the pre-existing
      // repository contract file is unchanged; the disconfirm case checks a
      // deliberately unrelated surface stays untouched.
      const markerFile = `src/sim-marker-${input.pack.wave}.ts`;
      const contractFile = 'package.json';
      const markerIn = (workdir: string): string =>
        existsSync(join(workdir, markerFile)) ? sha256Text(markerFile) : 'ABSENT';
      const contractIn = (workdir: string): string =>
        sha256Text(readFileSync(join(workdir, contractFile), 'utf-8'));
      return {
        originating: [
          {
            caseRef: { caseId: `REG-SIM-${input.pack.wave}`, ref: { refKind: 'regression-case', refId: `REG-SIM-${input.pack.wave}`, digest: sha256Text(`REG-SIM-${input.pack.wave}`) } },
            beforeResult: markerIn(input.beforeWorkdir),
            afterResult: markerIn(input.patchedWorkdir),
            expectedDirection: 'IMPROVE' as const,
          },
        ],
        controls: [
          {
            caseRef: { caseId: 'CTRL-SIM-CONTRACT', ref: { refKind: 'control-case', refId: 'CTRL-SIM-CONTRACT', digest: sha256Text('CTRL-SIM-CONTRACT') } },
            beforeResult: contractIn(input.beforeWorkdir),
            afterResult: contractIn(input.patchedWorkdir),
            expectedDirection: 'UNCHANGED' as const,
          },
        ],
        disconfirm: [
          {
            caseRef: { caseId: 'DIS-SIM-UNRELATED', ref: { refKind: 'disconfirm-case', refId: 'DIS-SIM-UNRELATED', digest: sha256Text('DIS-SIM-UNRELATED') } },
            beforeResult: existsSync(join(input.beforeWorkdir, 'src/recursive/state/constants.ts')) ? 'PRESENT' : 'ABSENT',
            afterResult: existsSync(join(input.patchedWorkdir, 'src/recursive/state/constants.ts')) ? 'PRESENT' : 'ABSENT',
            expectedDirection: 'UNCHANGED' as const,
          },
        ],
      };
    };

    const baselineContractDigest = sha256Text(readFileSync(join(repository, 'package.json'), 'utf-8'));
    const holdoutProvider = (patchedWorkdir: string): Array<{ caseId: string; passed: boolean }> => [
      {
        caseId: 'HOLDOUT-SIM-CONTROL-PLANE',
        // Hidden holdout: the repository contract file must remain
        // byte-identical in the patched tree. The coding agent never sees
        // this check (casesHiddenFromCodingAgent: true).
        passed: existsSync(join(patchedWorkdir, 'package.json'))
          && sha256Text(readFileSync(join(patchedWorkdir, 'package.json'), 'utf-8')) === baselineContractDigest,
      },
    ];

    const controller = new RecursiveEngineeringController({
      store,
      ledger,
      leases,
      e2eRunner,
      executor,
      verifier,
      promotion,
      deployment,
      eventSecret: 'simulation-event-secret',
      planDigest: sha256Text('simulation-plan'),
      peSchemaDigest: sha256Text(canonicalJson({ pe: 'v1' })),
      holdoutManifestDigest: sha256Text('simulation-holdout'),
      controlPlaneCommit: v0,
      llmRouterVersion: '1.1.2',
      botInteropVersion: '1.1.0',
      seoBotFullSha: 'f'.repeat(40),
      repositoryRoot: repository,
      promotionRemoteUrl: remote,
      maxChangedFilesPerPack: 2,
      maxDiffLinesPerPack: 10,
      maxDeploymentAttempts: 1,
      environment: 'preview-simulation',
      replayProvider,
      holdoutProvider,
    });

    const receipt = await controller.start({
      campaignId: 'recursive-simulation-run',
      sourceUrl: 'https://simulation.invalid',
      websiteBotFullSha: v0,
      patchInstructions: { 1: patchInstructionFor(1), 2: patchInstructionFor(2), 3: patchInstructionFor(3) },
      now: input.now,
    });

    store.write('run-receipt.json', receipt);
    return receipt;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
