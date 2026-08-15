// L9_META: layer=campaign, role=content_addressing, status=active, version=1.0.0
/**
 * Content addressing for the learning plane (design contract §2, §6).
 *
 * Mirrors the bot-interop conventions observed in
 * packages/bot-interop/src/website-intelligence.ts and handoff.ts:
 *   - artifact_id = `${artifact_type}:${payload_digest}`
 *   - payload_digest = sha256 over canonical JSON of the semantic body
 *   - input refs normalized by sorting on `artifact_type:artifact_id:payload_digest`
 * Canonical JSON recursively sorts keys (localeCompare) and drops undefined values
 * (the bot-interop stableValue semantics; DEC-002).
 */
import { createHash } from 'node:crypto';
import type { ArtifactRef } from '@quantum-l9/bot-interop';
import type { ArtifactRefLike } from './types.js';

export function canonicalJsonStable(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function stableValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    const entry = stableValue(record[key]);
    if (entry !== undefined) result[key] = entry;
  }
  return result;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function refKey(ref: { artifact_type: string; artifact_id: string; payload_digest: string }): string {
  return `${ref.artifact_type}:${ref.artifact_id}:${ref.payload_digest}`;
}

/** Normalized (sorted) artifact refs — the input_refs convention. */
export function normalizeArtifactRefs<T extends { artifact_type: string; artifact_id: string; payload_digest: string }>(refs: T[]): T[] {
  return [...refs].sort((a, b) => refKey(a).localeCompare(refKey(b)));
}

export interface SemanticBodyInput {
  protocol: string;
  protocol_version: string;
  artifact_type: string;
  client_id?: string;
  input_refs: Array<{ artifact_type: string; artifact_id: string; payload_digest: string }>;
  payload: unknown;
}

/** Digest over the semantic body (time-independent: no produced_at/build_id). */
export function payloadDigestOf(body: SemanticBodyInput): string {
  const semantic = {
    protocol: body.protocol,
    protocol_version: body.protocol_version,
    artifact_type: body.artifact_type,
    client_id: body.client_id ?? undefined,
    input_refs: normalizeArtifactRefs(body.input_refs).map(ref => ({
      artifact_type: ref.artifact_type,
      artifact_id: ref.artifact_id,
      payload_digest: ref.payload_digest,
    })),
    payload: body.payload,
  };
  return sha256Hex(canonicalJsonStable(semantic));
}

export function artifactIdOf(artifactType: string, payloadDigest: string): string {
  return `${artifactType}:${payloadDigest}`;
}

export interface SemanticInputDigestInput {
  stage_version: string;
  relevant_input_artifact_refs: Array<{ artifact_type: string; artifact_id: string; payload_digest: string }>;
  relevant_configuration: unknown;
}

/**
 * semantic_input_digest = hash(stage_version + relevant input artifact refs + relevant configuration).
 * Same digest reuses the exact artifact; different digest recomputes (design contract §6).
 */
export function semanticInputDigest(input: SemanticInputDigestInput): string {
  return sha256Hex(
    canonicalJsonStable({
      stage_version: input.stage_version,
      relevant_input_artifact_refs: normalizeArtifactRefs(input.relevant_input_artifact_refs),
      relevant_configuration: input.relevant_configuration,
    }),
  );
}

export interface ExperimentalControl {
  inherited_exact: ArtifactRefLike[];
  changed: string[];
}

/** Records the reuse decision as an experimental control (design contract §6). */
export function buildExperimentalControl(
  inheritedExact: ArtifactRefLike[],
  changed: string[],
): ExperimentalControl {
  return { inherited_exact: normalizeArtifactRefs(inheritedExact), changed: [...changed].sort() };
}
