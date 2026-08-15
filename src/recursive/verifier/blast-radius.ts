// L9_META: layer=recursive, role=semantic_blast_radius_validation, status=active, version=1.0.0
// Semantic artifact blast-radius validation: the expected-changed artifacts
// must be exactly the observed-changed ones, and every expected-unchanged
// artifact must be byte-identical after the patch. An unexpected move of an
// authoritative artifact rejects the patch.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256Text } from '../../services/hashing.js';

export interface ArtifactSnapshot {
  artifactId: string;
  relativePath: string;
  sha256: string;
}

export interface BlastRadiusResult {
  expectedChangedArtifacts: string[];
  observedChangedArtifacts: string[];
  expectedUnchangedArtifacts: string[];
  unexpectedlyChangedArtifacts: string[];
  verdict: 'PASS' | 'FAIL';
}

export function computeBlastRadius(input: {
  expectedChangedArtifacts: string[];
  expectedUnchangedArtifacts: string[];
  before: ArtifactSnapshot[];
  after: ArtifactSnapshot[];
}): BlastRadiusResult {
  const beforeByPath = new Map(input.before.map(snapshot => [snapshot.relativePath, snapshot.sha256]));
  const afterByPath = new Map(input.after.map(snapshot => [snapshot.relativePath, snapshot.sha256]));
  const changed: string[] = [];
  for (const [path, afterDigest] of afterByPath) {
    const beforeDigest = beforeByPath.get(path);
    if (beforeDigest !== afterDigest) changed.push(path);
  }
  for (const [path] of beforeByPath) {
    if (!afterByPath.has(path)) changed.push(path);
  }
  const changedSet = new Set(changed);
  const observedChanged = [...changed].sort((left, right) => left.localeCompare(right));
  const unexpectedlyChanged = input.expectedUnchangedArtifacts.filter(path => changedSet.has(path));
  const expectedUnchanged = input.expectedUnchangedArtifacts.filter(path => !changedSet.has(path));
  const verdict = unexpectedlyChanged.length === 0 ? 'PASS' : 'FAIL';
  return {
    expectedChangedArtifacts: input.expectedChangedArtifacts,
    observedChangedArtifacts: observedChanged,
    expectedUnchangedArtifacts: expectedUnchanged,
    unexpectedlyChangedArtifacts: unexpectedlyChanged,
    verdict,
  };
}

export function snapshotFiles(input: {
  root: string;
  paths: string[];
}): ArtifactSnapshot[] {
  return input.paths.map(relativePath => {
    const absolute = resolve(input.root, relativePath);
    if (!existsSync(absolute)) throw new Error(`snapshot path does not exist: ${relativePath}`);
    return {
      artifactId: relativePath,
      relativePath,
      sha256: sha256Text(readFileSync(absolute, 'utf-8')),
    };
  });
}
