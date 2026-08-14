// L9_META: layer=pipeline, role=build_intent, status=active, version=1.0.0
/**
 * Build intent is orthogonal to execution mode.
 *
 * ExecutionMode answers:
 *   "How far may this run go?"
 *
 * BuildIntent answers:
 *   "What kind of website transformation are we performing?"
 */
export const BUILD_INTENTS = [
  'COPY',
  'REDESIGN_IMPROVE',
] as const;
export type BuildIntent = (typeof BUILD_INTENTS)[number];

export const DEFAULT_LEGACY_BUILD_INTENT: BuildIntent = 'COPY';

/**
 * Backward compatibility:
 * Existing DomainSpecs without build_intent retain COPY semantics.
 *
 * New REDESIGN_IMPROVE runs MUST declare the intent explicitly.
 */
export function parseBuildIntent(value: unknown): BuildIntent {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_LEGACY_BUILD_INTENT;
  }
  if (value === 'COPY' || value === 'REDESIGN_IMPROVE') {
    return value;
  }
  throw new Error(
    `INVALID_BUILD_INTENT: expected COPY or REDESIGN_IMPROVE; received ${JSON.stringify(value)}`,
  );
}

export function isCopyIntent(intent: BuildIntent): intent is 'COPY' {
  return intent === 'COPY';
}

export function isImproveIntent(
  intent: BuildIntent,
): intent is 'REDESIGN_IMPROVE' {
  return intent === 'REDESIGN_IMPROVE';
}
