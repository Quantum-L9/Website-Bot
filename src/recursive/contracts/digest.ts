// L9_META: layer=recursive, role=recursive_artifact_digests, status=active, version=1.0.0
import { canonicalJson, sha256Text } from "../../services/hashing.js";

/**
 * Deterministic digest for a recursive artifact. Order-independent canonical
 * JSON plus a typed prefix keeps digests distinguishable from raw payload
 * hashes while remaining byte-stable across machines.
 */
export function digestArtifact(kind: string, value: unknown): string {
  return sha256Text(`${kind}:${canonicalJson(value)}`);
}

export function refForArtifact(
  kind: string,
  value: unknown,
): {
  refKind: string;
  refId: string;
  digest: string;
} {
  const digest = digestArtifact(kind, value);
  return { refKind: kind, refId: `${kind}:${digest}`, digest };
}
