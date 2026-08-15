// L9_META: layer=campaign, role=invalidation_frontier, status=active, version=1.0.0
/**
 * Invalidation frontier per mutation layer (design contract §8).
 * A DESIGN mutation must not trigger donor crawl, DataForSEO, pattern synthesis,
 * or content generation. A BLUEPRINT mutation invalidates content and design downstream.
 */
import type { MutationLayer } from './types.js';

/** Logical pipeline stage names (observed corpus stage vocabulary + design-source stages). */
export const PIPELINE_STAGES = [
  'donor-intelligence',
  'dataforseo',
  'pattern-synthesis',
  'competitive-landscape',
  'baseline-market-gap',
  'website-blueprint',
  'seo-content-blueprint',
  'page-content-contract',
  'structured-content',
  'design-artifact',
  'asset-planning',
  'assembly',
  'build',
  'screenshots',
  'quality',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface Frontier {
  layer: MutationLayer;
  reuse: PipelineStage[];
  invalidate: PipelineStage[];
}

const ALL: readonly PipelineStage[] = PIPELINE_STAGES;

const INTELLIGENCE_STAGES: readonly PipelineStage[] = [
  'donor-intelligence',
  'dataforseo',
  'pattern-synthesis',
  'competitive-landscape',
  'baseline-market-gap',
];

const BLUEPRINT_STAGES: readonly PipelineStage[] = [
  'website-blueprint',
  'seo-content-blueprint',
];

const CONTENT_STAGES: readonly PipelineStage[] = [
  'page-content-contract',
  'structured-content',
];

const FRONTIERS: Record<MutationLayer, Frontier> = {
  INITIAL: { layer: 'INITIAL', reuse: [], invalidate: [...ALL] },
  INTELLIGENCE: {
    layer: 'INTELLIGENCE',
    reuse: [],
    invalidate: [...ALL],
  },
  BLUEPRINT: {
    layer: 'BLUEPRINT',
    reuse: [...INTELLIGENCE_STAGES],
    invalidate: [...BLUEPRINT_STAGES, ...CONTENT_STAGES, 'design-artifact', 'assembly', 'build', 'screenshots', 'quality'],
  },
  CONTENT: {
    layer: 'CONTENT',
    reuse: [...INTELLIGENCE_STAGES, ...BLUEPRINT_STAGES],
    invalidate: [...CONTENT_STAGES, 'design-artifact', 'assembly', 'build', 'screenshots', 'quality'],
  },
  DESIGN: {
    layer: 'DESIGN',
    reuse: [...INTELLIGENCE_STAGES, ...BLUEPRINT_STAGES, ...CONTENT_STAGES],
    invalidate: ['design-artifact', 'assembly', 'build', 'screenshots', 'quality'],
  },
  ASSET: {
    layer: 'ASSET',
    reuse: [...INTELLIGENCE_STAGES, ...BLUEPRINT_STAGES, ...CONTENT_STAGES, 'design-artifact'],
    invalidate: ['asset-planning', 'assembly', 'build', 'screenshots', 'quality'],
  },
  ASSEMBLY: {
    layer: 'ASSEMBLY',
    reuse: [...INTELLIGENCE_STAGES, ...BLUEPRINT_STAGES, ...CONTENT_STAGES, 'design-artifact', 'asset-planning'],
    invalidate: ['assembly', 'build', 'screenshots', 'quality'],
  },
  REPAIR: {
    layer: 'REPAIR',
    reuse: [...INTELLIGENCE_STAGES, ...BLUEPRINT_STAGES, ...CONTENT_STAGES, 'design-artifact', 'asset-planning', 'assembly', 'build'],
    invalidate: ['screenshots', 'quality'],
  },
};

/** Stages a mutation of the given layer is FORBIDDEN from recomputing (the reuse set). */
export function frontierFor(layer: MutationLayer): Frontier {
  const frontier = FRONTIERS[layer];
  return { layer, reuse: [...frontier.reuse], invalidate: [...frontier.invalidate] };
}

export interface AttemptedStage {
  stage: PipelineStage;
  reason: string;
}

/**
 * Enforce the frontier: every attempted stage must be in the invalidate set
 * (or outside the reuse set because the mutation actually changed its inputs).
 * Returns the offending stages; empty array means the frontier holds.
 */
export function assertFrontier(layer: MutationLayer, attempted: AttemptedStage[]): AttemptedStage[] {
  const { reuse } = frontierFor(layer);
  return attempted.filter(({ stage }) => (reuse as readonly string[]).includes(stage));
}

/** The stages a DESIGN mutation must never trigger (conformance gate GATE-005). */
export const DESIGN_FORBIDDEN_STAGES: readonly PipelineStage[] = [
  'donor-intelligence',
  'dataforseo',
  'pattern-synthesis',
  'competitive-landscape',
  'baseline-market-gap',
  'website-blueprint',
  'seo-content-blueprint',
  'page-content-contract',
  'structured-content',
];

/** BLUEPRINT-layer input-change reclassification rule (§8). */
export function reclassifyLayerIfIntelligenceInputsChanged(
  layer: MutationLayer,
  changedIntelligenceInputs: boolean,
): MutationLayer {
  if (layer === 'BLUEPRINT' && changedIntelligenceInputs) return 'INTELLIGENCE';
  return layer;
}

export function isDesignForbiddenStage(stage: PipelineStage): boolean {
  return (DESIGN_FORBIDDEN_STAGES as readonly string[]).includes(stage);
}
