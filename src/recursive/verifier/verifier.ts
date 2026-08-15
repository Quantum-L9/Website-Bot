// L9_META: layer=recursive, role=independent_verifier, status=active, version=1.0.0
// Independent verifier. The coding executor may implement the PE Pack but may
// NOT decide that its own work passes: every verdict below is produced by this
// module under a bound verifier identity, and the pack's requiredVerifier must
// match this identity for any promotion to proceed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { sha256Text } from '../../services/hashing.js';
import type {
  CodeChangeOutcome,
  CodeChangeVerdict,
  PEPack,
  RegressionCaseRef,
  ValidationSetResult,
} from '../contracts/types.js';
import { evaluateMutationEnvelope } from '../executor/envelope.js';
import { computeBlastRadius, snapshotFiles, type ArtifactSnapshot } from './blast-radius.js';

export interface ReplayCaseInput {
  caseRef: RegressionCaseRef;
  beforeResult: string;
  afterResult: string;
  expectedDirection: 'IMPROVE' | 'UNCHANGED';
}

export interface VerifierInput {
  pack: PEPack;
  verifierIdentity: string;
  beforeSha: string;
  patchedSha: string;
  changedFiles: string[];
  diffLines: number;
  repositoryRoot: string;
  patchWorkdir: string;
  originating: ReplayCaseInput[];
  controls: ReplayCaseInput[];
  disconfirm: ReplayCaseInput[];
  holdoutCases: Array<{ caseId: string; passed: boolean }>;
  repositoryChecks: Array<{ name: string; passed: boolean }>;
  expectedChangedArtifacts: string[];
  expectedUnchangedArtifacts: string[];
  artifactRoot: string;
  beforeArtifacts: ArtifactSnapshot[];
  afterArtifacts: ArtifactSnapshot[];
}

export interface VerifierReceipt {
  schema: 'l9.recursive.verifier-receipt/v1';
  verifierIdentity: string;
  pePackId: string;
  verifiedPatchSha: string;
  verdict: CodeChangeVerdict;
  validation: CodeChangeOutcome['validation'];
  causalResult: CodeChangeOutcome['causalResult'];
  producedAt: string;
}

export const VERIFIER_RECEIPT_SCHEMA = 'l9.recursive.verifier-receipt/v1';

/** Reject shell metacharacters so repository checks never go through `bash -lc`. */
function argvFromSimpleCommand(command: string): [string, ...string[]] {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error('empty repository check command');
  if (parts.some(part => /[;&|`$<>(){}\\*?[~]/.test(part))) {
    throw new Error('repository check command must be a simple argv');
  }
  return parts as [string, ...string[]];
}

function replaySet(cases: ReplayCaseInput[]): ValidationSetResult {
  const failures = cases.filter(item => {
    const improved = item.expectedDirection === 'IMPROVE' && item.afterResult !== item.beforeResult;
    const unchanged = item.expectedDirection === 'UNCHANGED' && item.afterResult === item.beforeResult;
    return !(improved || unchanged);
  });
  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    caseRefs: cases.map(item => item.caseRef.ref),
    summary: failures.length === 0 ? 'all cases met their expected direction' : `${failures.length} cases failed their expected direction`,
  };
}

export class IndependentVerifier {
  constructor(private readonly identity: string) {}

  get identityValue(): string {
    return this.identity;
  }

  /**
   * Runs every required validation. The coding executor is fenced out by
   * identity: a pack whose requiredVerifier differs from this identity is
   * rejected before any verdict is computed.
   */
  verify(input: VerifierInput): VerifierReceipt {
    if (input.pack.mergePolicy.requiredVerifier !== this.identity) {
      throw new Error(
        `verifier identity mismatch: pack requires ${input.pack.mergePolicy.requiredVerifier}, this verifier is ${this.identity}`,
      );
    }
    const originating = replaySet(input.originating);
    const controls = replaySet(input.controls);
    const disconfirm = replaySet(input.disconfirm);
    const holdoutFailures = input.holdoutCases.filter(holdout => !holdout.passed);
    const protectedHoldout: ValidationSetResult = {
      verdict: holdoutFailures.length === 0 ? 'PASS' : 'FAIL',
      caseRefs: input.holdoutCases.map(holdout => ({ refKind: 'holdout-case', refId: holdout.caseId, digest: sha256Text(holdout.caseId) })),
      summary: holdoutFailures.length === 0 ? 'all hidden holdout cases passed' : `${holdoutFailures.length} hidden holdout cases failed`,
    };
    const failedChecks = input.repositoryChecks.filter(check => !check.passed);
    const repositoryCI: ValidationSetResult = {
      verdict: failedChecks.length === 0 ? 'PASS' : 'FAIL',
      caseRefs: [],
      summary: failedChecks.length === 0 ? 'all repository checks passed' : `failed repository checks: ${failedChecks.map(check => check.name).join(', ')}`,
    };

    const blastRadius = computeBlastRadius({
      expectedChangedArtifacts: input.expectedChangedArtifacts,
      expectedUnchangedArtifacts: input.expectedUnchangedArtifacts,
      before: input.beforeArtifacts,
      after: input.afterArtifacts,
    });

    const envelopeVerdict = evaluateMutationEnvelope(input.pack, {
      changedFiles: input.changedFiles,
      diffLines: input.diffLines,
    });
    const scopeOk = envelopeVerdict.allowed;

    let verdict: CodeChangeVerdict;
    if (!scopeOk) verdict = 'FAIL_SCOPE';
    else if (originating.verdict === 'FAIL') verdict = 'FAIL_TARGET';
    else if (controls.verdict === 'FAIL') verdict = 'FAIL_CONTROL';
    else if (disconfirm.verdict === 'FAIL') verdict = 'FAIL_DISCONFIRM';
    else if (protectedHoldout.verdict === 'FAIL') verdict = 'FAIL_HOLDOUT';
    else if (blastRadius.verdict === 'FAIL') verdict = 'FAIL_BLAST_RADIUS';
    else if (repositoryCI.verdict === 'FAIL') verdict = 'FAIL_CI';
    else verdict = 'PASS';

    const causalResult: CodeChangeOutcome['causalResult'] = {
      expectedSystemEffect: input.pack.hypothesis.expectedSystemEffect,
      observedSystemEffect:
        verdict === 'PASS'
          ? 'target properties improved and guardrails held under independent replay'
          : `verification failed with ${verdict}`,
      verdict: verdict === 'PASS' ? 'CONFIRMED' : 'INCONCLUSIVE',
    };

    return {
      schema: VERIFIER_RECEIPT_SCHEMA,
      verifierIdentity: this.identity,
      pePackId: input.pack.packId,
      verifiedPatchSha: input.patchedSha,
      verdict,
      validation: {
        originating,
        controls,
        disconfirm,
        protectedHoldout,
        repositoryCI,
        semanticArtifactDiff: blastRadius,
      },
      causalResult,
      producedAt: new Date().toISOString(),
    };
  }

  /** Typecheck + unit test gates for a patched workdir, per repositoryChecks. */
  runRepositoryCheck(checkName: string, workdir: string, command: string): { name: string; passed: boolean } {
    if (checkName !== 'typecheck' && checkName !== 'unit') throw new Error(`unknown repository check: ${checkName}`);
    try {
      const argv = argvFromSimpleCommand(command);
      execFileSync(argv[0], argv.slice(1), { cwd: workdir, stdio: 'ignore' });
      return { name: checkName, passed: true };
    } catch {
      return { name: checkName, passed: false };
    }
  }
}

export function snapshotArtifacts(root: string, paths: string[]): ArtifactSnapshot[] {
  if (!existsSync(root)) throw new Error(`artifact root does not exist: ${root}`);
  return snapshotFiles({ root, paths }).map(snapshot => ({ ...snapshot, artifactId: snapshot.relativePath }));
}
