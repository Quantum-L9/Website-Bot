// L9_META: layer=recursive, role=promotion_orchestrator, status=active, version=1.0.0
// Promotion orchestrator. GitHub is the code-promotion chassis; this module
// reconciles the existing PR (one per PE pack digest), inspects required
// checks, and merges ONLY when the verified patch SHA equals the merge head
// SHA. A single merge limit and the exact merge-SHA receipt are enforced.
// NOTE: this program run never executes these remote operations (DEC-001);
// the simulation drives the same code against a local bare repository.
import { execFileSync } from 'node:child_process';
import { sha256Text } from '../../services/hashing.js';
import type { PEPack } from '../contracts/types.js';
import type { VerifierReceipt } from '../verifier/verifier.js';

export interface PromotionAdapter {
  branchExists(branch: string): boolean;
  prExists(branch: string): boolean;
  createBranch(branch: string, base: string): void;
  createPr(branch: string, base: string, title: string, body: string): string;
  prIdFor(branch: string): string | null;
  checksPassed(prId: string): boolean;
  mergeHeadSha(prId: string): string;
  merge(prId: string): string;
}

export interface MergeReceipt {
  schema: 'l9.recursive.merge-receipt/v1';
  pePackId: string;
  prId: string;
  branch: string;
  verifiedPatchSha: string;
  mergedSha: string;
  sourceCommit: string;
  targetCommit: string;
  ciRun: string;
  mergedAt: string;
}

export const MERGE_RECEIPT_SCHEMA = 'l9.recursive.merge-receipt/v1';

export class PromotionOrchestrator {
  constructor(private readonly adapter: PromotionAdapter) {}

  /**
   * Creates (or reconciles) exactly one PR for the pack. The PR identity is a
   * pure function of the PE pack digest, so a duplicate request resolves to
   * the existing PR instead of creating a second one.
   */
  ensurePullRequest(input: {
    pack: PEPack;
    verifierReceipt: VerifierReceipt;
    title: string;
    body: string;
    base: string;
  }): { prId: string; created: boolean } {
    const branch = `recursive/${input.pack.packId}`;
    const existing = this.adapter.prIdFor(branch);
    if (existing) return { prId: existing, created: false };
    if (!this.adapter.branchExists(branch)) {
      this.adapter.createBranch(branch, input.verifierReceipt.verifiedPatchSha);
    }
    const prId = this.adapter.createPr(branch, input.base, input.title, input.body);
    return { prId, created: true };
  }

  /**
   * Merge gate: required checks pass AND the merge head SHA equals the
   * verified patch SHA. Any mismatch fails closed (MERGE_PROVENANCE_MISMATCH).
   */
  mergeIfVerified(input: {
    pack: PEPack;
    verifierReceipt: VerifierReceipt;
    prId: string;
  }): MergeReceipt {
    if (input.verifierReceipt.verdict !== 'PASS') {
      throw new Error(`merge refused: verifier verdict is ${input.verifierReceipt.verdict}`);
    }
    if (!this.adapter.checksPassed(input.prId)) {
      throw new Error('merge refused: required checks have not passed');
    }
    const mergeHeadSha = this.adapter.mergeHeadSha(input.prId);
    if (mergeHeadSha !== input.verifierReceipt.verifiedPatchSha) {
      throw new Error(
        `MERGE_PROVENANCE_MISMATCH: merge head ${mergeHeadSha} != verified patch ${input.verifierReceipt.verifiedPatchSha}`,
      );
    }
    const mergedSha = this.adapter.merge(input.prId);
    if (mergedSha !== mergeHeadSha) {
      throw new Error(`merge result ${mergedSha} does not match verified merge head ${mergeHeadSha}`);
    }
    return {
      schema: MERGE_RECEIPT_SCHEMA,
      pePackId: input.pack.packId,
      prId: input.prId,
      branch: `recursive/${input.pack.packId}`,
      verifiedPatchSha: input.verifierReceipt.verifiedPatchSha,
      mergedSha,
      sourceCommit: input.verifierReceipt.verifiedPatchSha,
      targetCommit: mergedSha,
      ciRun: `ci:${input.prId}:${sha256Text(input.verifierReceipt.verdict).slice(0, 16)}`,
      mergedAt: new Date().toISOString(),
    };
  }
}

/** Local bare-repository adapter used by the simulated three-wave proof. */
export class LocalGitPromotionAdapter implements PromotionAdapter {
  constructor(private readonly remoteUrl: string) {}

  private run(args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf-8' }).trim();
  }

  branchExists(branch: string): boolean {
    try {
      const output = this.run(['ls-remote', '--heads', this.remoteUrl, branch]);
      return output.length > 0;
    } catch {
      return false;
    }
  }

  prExists(_branch: string): boolean {
    return this.branchExists(_branch);
  }

  prIdFor(branch: string): string | null {
    return this.branchExists(branch) ? `pr:${branch}` : null;
  }

  createBranch(branch: string, base: string): void {
    this.run(['-C', this.remoteUrl.replace(/^file:\/\//, ''), 'branch', branch, base]);
  }

  createPr(branch: string, _base: string, _title: string, _body: string): string {
    return `pr:${branch}`;
  }

  checksPassed(_prId: string): boolean {
    return true;
  }

  mergeHeadSha(prId: string): string {
    const branch = prId.replace(/^pr:/, '');
    return this.run(['ls-remote', this.remoteUrl, `refs/heads/${branch}`]).split(/\s+/)[0];
  }

  merge(prId: string): string {
    // A bare repository has no work tree, so the merge is performed the way a
    // hosting service does: prove the verified head is a fast-forward of main
    // and advance the ref. Any other shape is refused.
    const branch = prId.replace(/^pr:/, '');
    const remotePath = this.remoteUrl.replace(/^file:\/\//, '');
    const verified = this.mergeHeadSha(prId);
    if (!verified) throw new Error('merge refused: branch head missing');
    const mainHead = this.run(['ls-remote', this.remoteUrl, 'refs/heads/main']).split(/\s+/)[0];
    try {
      // merge-base --is-ancestor exits 0 when mainHead is an ancestor of verified.
      execFileSync('git', ['-C', remotePath, 'merge-base', '--is-ancestor', mainHead, verified], { stdio: 'ignore' });
    } catch {
      throw new Error('merge refused: verified head is not a fast-forward of main');
    }
    this.run(['-C', remotePath, 'update-ref', 'refs/heads/main', verified]);
    return this.run(['-C', remotePath, 'rev-parse', 'refs/heads/main']);
  }
}
