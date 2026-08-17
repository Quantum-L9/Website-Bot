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
import { BuildError } from "./BuildError.js";

export const BUILD_INTENTS = ["COPY", "REDESIGN_IMPROVE"] as const;
export type BuildIntent = (typeof BUILD_INTENTS)[number];

export const DEFAULT_LEGACY_BUILD_INTENT: BuildIntent = "COPY";

/**
 * Backward compatibility:
 * Existing DomainSpecs without build_intent retain COPY semantics.
 *
 * New REDESIGN_IMPROVE runs MUST declare the intent explicitly.
 */
export function parseBuildIntent(value: unknown): BuildIntent {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_LEGACY_BUILD_INTENT;
  }
  if (value === "COPY" || value === "REDESIGN_IMPROVE") {
    return value;
  }
  throw new Error(
    `INVALID_BUILD_INTENT: expected COPY or REDESIGN_IMPROVE; received ${JSON.stringify(value)}`,
  );
}

/**
 * Fail-closed parser for redesign product surfaces (Campaign 7, R2).
 *
 * On these surfaces an absent intent MUST NOT silently resolve to COPY.
 * Only the explicitly separate legacy compatibility path may use
 * parseBuildIntent's COPY default.
 */
export function requireBuildIntent(value: unknown, surface: string): BuildIntent {
  if (value === undefined || value === null || value === "") {
    throw new BuildError(
      "BUILD_INTENT_REQUIRED",
      `${surface} requires an explicit build_intent; the legacy COPY default is not available on redesign surfaces`,
    );
  }
  return parseBuildIntent(value);
}

/**
 * Surfaces that semantically ARE redesign (recursive:improve, the redesign
 * execution plan) must carry REDESIGN_IMPROVE — an explicit COPY is as
 * illegal there as a missing intent.
 */
export function requireRedesignIntent(value: unknown, surface: string): "REDESIGN_IMPROVE" {
  const intent = requireBuildIntent(value, surface);
  if (intent !== "REDESIGN_IMPROVE") {
    throw new BuildError(
      "BUILD_INTENT_REQUIRED",
      `${surface} is a redesign surface; build_intent must be REDESIGN_IMPROVE (received ${intent})`,
    );
  }
  return intent;
}

export function isCopyIntent(intent: BuildIntent): intent is "COPY" {
  return intent === "COPY";
}

export function isImproveIntent(intent: BuildIntent): intent is "REDESIGN_IMPROVE" {
  return intent === "REDESIGN_IMPROVE";
}
