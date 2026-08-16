// L9_META: layer=recursive, role=protected_holdout_manifest, status=active, version=1.0.0
// Protected holdout: cases hidden from the coding agent. The PE pack binds a
// manifest digest; the verifier replays the hidden cases against the patched
// tree. The coding agent never receives the case bodies — only the digest.
import { sha256Text } from '../../services/hashing.js';

export interface HoldoutCase {
  caseId: string;
  description: string;
  evaluator: (patchedRoot: string) => boolean;
}

export interface HoldoutManifest {
  schema: 'l9.recursive.holdout-manifest/v1';
  selectorVersion: string;
  caseIds: string[];
  manifestDigest: string;
  createdAt: string;
}

export const HOLDOUT_MANIFEST_SCHEMA = 'l9.recursive.holdout-manifest/v1';

export function buildHoldoutManifest(cases: HoldoutCase[], selectorVersion = 'v1'): HoldoutManifest {
  const caseIds = [...cases.map(holdout => holdout.caseId)].sort((left, right) => left.localeCompare(right));
  const manifestDigest = sha256Text(
    JSON.stringify({ schema: HOLDOUT_MANIFEST_SCHEMA, selectorVersion, caseIds }),
  );
  return {
    schema: HOLDOUT_MANIFEST_SCHEMA,
    selectorVersion,
    caseIds,
    manifestDigest,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Replays hidden holdout cases against a patched tree. The evaluator list is
 * held only by the verifier; the coding agent sees the manifest digest alone.
 */
export function replayHoldout(cases: HoldoutCase[], patchedRoot: string): Array<{ caseId: string; passed: boolean }> {
  return cases.map(holdout => ({ caseId: holdout.caseId, passed: holdout.evaluator(patchedRoot) }));
}
