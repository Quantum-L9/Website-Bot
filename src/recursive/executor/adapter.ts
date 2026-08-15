// L9_META: layer=recursive, role=bounded_coding_executor_adapter, status=active, version=1.0.0
// Bounded coding executor adapter. The executor applies exactly one bounded
// code hypothesis inside the PE Pack's mutation envelope, inside a disposable
// worktree clone. It emits patch provenance (before/after SHAs, changed files,
// diff digest) and the raw CodeChangeOutcome skeleton — but it never decides
// that its own work passes: the independent verifier owns every verdict.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256File, sha256Text } from '../../services/hashing.js';
import type { CodeChangeOutcome, PEPack } from '../contracts/types.js';
import { execTrusted } from '../exec.js';
import { refForArtifact } from '../contracts/digest.js';
import { evaluateMutationEnvelope } from './envelope.js';

export interface PatchInstruction {
  changedFiles: string[];
  diffLines: number;
  apply: (workdir: string) => void;
  /** Publishes the committed patch (e.g. pushes the recursive branch). */
  publish?: (workdir: string, branch: string) => void;
}

export interface PatchExecutionResult {
  applied: boolean;
  violations?: string[];
  outcome?: {
    beforeFullSha: string;
    patchedFullSha: string;
    changedFiles: string[];
    diffDigest: string;
  };
}

export class BoundedCodingExecutor {
  constructor(private readonly verifierIdentity: string) {}

  /**
   * Applies one bounded patch inside a disposable clone of `repositoryRoot`,
   * checked out at the exact deployed base revision the pack binds. Envelope
   * evaluation happens BEFORE any file is written; violations stop the
   * execution without touching the clone. After the commit, the instruction's
   * publish hook (if any) may push the recursive branch to the promotion
   * remote — publishing is the only remote side effect, and only the verified
   * patch SHA may ever merge.
   */
  executePatch(input: {
    pack: PEPack;
    repositoryRoot: string;
    baseSha: string;
    workdir: string;
    instruction: PatchInstruction;
    /** Promotion remote; when set the clone is taken from it so the exact
     * promoted revision is the patch base (never a stale working tree). */
    remoteUrl?: string;
  }): PatchExecutionResult {
    const envelopeVerdict = evaluateMutationEnvelope(input.pack, input.instruction);
    if (!envelopeVerdict.allowed) {
      return { applied: false, violations: envelopeVerdict.violations };
    }
    if (input.instruction.changedFiles.length === 0) {
      return { applied: false, violations: ['patch changed no files'] };
    }
    const clone = this.clone(input.remoteUrl ?? input.repositoryRoot, input.workdir);
    execTrusted('git', ['-C', clone, 'checkout', '--quiet', input.baseSha]);
    const beforeFullSha = execTrusted('git', ['-C', clone, 'rev-parse', 'HEAD']).trim();
    if (beforeFullSha !== input.baseSha) {
      return { applied: false, violations: [`clone base ${beforeFullSha} != bound base ${input.baseSha}`] };
    }
    input.instruction.apply(clone);
    const patchedFullSha = this.commitPatch(clone, input.pack.packId);
    const diffDigest = sha256Text(
      input.instruction.changedFiles.map(file => `${file}:${sha256File(resolve(clone, file))}`).join('\n'),
    );
    const branch = `recursive/${input.pack.packId}`;
    input.instruction.publish?.(clone, branch);
    return {
      applied: true,
      outcome: {
        beforeFullSha,
        patchedFullSha,
        changedFiles: [...input.instruction.changedFiles].sort((left, right) => left.localeCompare(right)),
        diffDigest,
      },
    };
  }

  /** The executor may never act as the authoritative verifier of its own work. */
  assertNotVerifier(requestedVerifier: string): void {
    if (requestedVerifier === this.verifierIdentity) {
      throw new Error('coding executor cannot invoke itself as the independent verifier');
    }
  }

  private clone(root: string, workdir: string): string {
    if (existsSync(workdir)) throw new Error(`workdir already exists: ${workdir}`);
    execTrusted('git', ['clone', '--quiet', '--no-hardlinks', root, workdir]);
    return workdir;
  }

  private commitPatch(workdir: string, packId: string): string {
    execTrusted('git', ['-C', workdir, 'add', '-A']);
    execTrusted('git', ['-C', workdir, '-c', 'user.email=recursive@local', '-c', 'user.name=recursive-runner', 'commit', '--quiet', '-m', `bounded patch for ${packId}`]);
    return execTrusted('git', ['-C', workdir, 'rev-parse', 'HEAD']).trim();
  }
}

export function outcomeSkeleton(input: {
  pack: PEPack;
  beforeFullSha: string;
  patchedFullSha: string;
  changedFiles: string[];
  diffDigest: string;
  outcomeId: string;
}): CodeChangeOutcome {
  const pePackRef = refForArtifact('pe-pack', input.pack);
  return {
    schema: 'l9.code-change-outcome/v1',
    outcomeId: input.outcomeId,
    pePackRef,
    code: {
      repository: input.pack.mutationEnvelope.repository,
      beforeFullSha: input.beforeFullSha,
      patchedFullSha: input.patchedFullSha,
    },
    diff: {
      changedFiles: input.changedFiles,
      diffDigest: input.diffDigest,
    },
    validation: {
      originating: { verdict: 'FAIL', caseRefs: [], summary: 'not yet independently verified' },
      controls: { verdict: 'FAIL', caseRefs: [], summary: 'not yet independently verified' },
      disconfirm: { verdict: 'FAIL', caseRefs: [], summary: 'not yet independently verified' },
      protectedHoldout: { verdict: 'FAIL', caseRefs: [], summary: 'not yet independently verified' },
      repositoryCI: { verdict: 'FAIL', caseRefs: [], summary: 'not yet independently verified' },
      semanticArtifactDiff: {
        expectedChangedArtifacts: [],
        observedChangedArtifacts: [],
        expectedUnchangedArtifacts: [],
        unexpectedlyChangedArtifacts: [],
        verdict: 'FAIL',
      },
    },
    causalResult: {
      expectedSystemEffect: input.pack.hypothesis.expectedSystemEffect,
      observedSystemEffect: 'pending independent verification',
      verdict: 'INCONCLUSIVE',
    },
    verdict: 'FAIL_CI',
  };
}
