// L9_META: layer=script, role=campaign_cli, status=active, version=1.0.0
/**
 * npm run campaign -- --source=<url> --until=reviewable [--watch]
 * npm run campaign -- --campaign=<id> --until=reviewable
 *
 * The runner converges on REVIEWABLE, EXHAUSTED, BLOCKED, NO_PROGRESS, or FATAL.
 * --watch prints progress events only and never changes runtime semantics.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runCampaign } from '../src/campaigns/runner.js';
import {
  atomicWriteManifest,
  buildCampaignManifest,
  campaignRootOf,
  loadCampaignManifest,
} from '../src/campaigns/campaign-manifest.js';
import { buildQualityDeltaIndex } from '../src/campaigns/quality-delta-index.js';
import type { CampaignDeps, CandidateMutationPlan, QualityDimensionResult } from '../src/campaigns/types.js';
import { buildCandidateMutationPlan } from '../src/campaigns/mutation-plan.js';
import { loadLearningEvents, appendLearningEvent } from '../src/campaigns/campaign-files.js';
import { retrieveRelevantLearnings } from '../src/campaigns/learning-registry.js';
import { buildLearningEvent } from '../src/campaigns/learning-event.js';
import { parseCampaignArgs, requiredValue, optionalInt, siteSlugOf, defaultCampaignId } from './campaign-cli-args.js';

const CONTEXT_SIGNATURE_DEFAULT = {
  vertical: 'local-service',
  market_model: 'local_service',
  conversion_model: 'lead_generation',
  consideration_level: 'high',
  service_complexity: 'medium',
  location_strategy: 'multi_location',
  trust_dependency: 'high',
  page_archetypes: ['homepage', 'service', 'location', 'contact'],
  brand_maturity: 'medium',
  baseline_quality: 'low',
};

async function main(): Promise<void> {
  const args = parseCampaignArgs(process.argv.slice(2));
  const until = args.values['until'] ?? 'reviewable';
  if (until !== 'reviewable') throw new Error('only --until=reviewable is supported');
  const watch = args.flags.has('watch');
  const emit = (event: string) => {
    const stamp = new Date().toTimeString().slice(0, 8);
    console.log(`[${stamp}] ${event}`);
  };

  const baseRoot = args.values['campaign-root'] ?? join(process.cwd(), '.l9', 'campaigns');
  const maxCandidates = optionalInt(args, 'max-candidates');
  const maxNoProgressRounds = optionalInt(args, 'max-no-progress');

  const sourceUrl = args.values['source'];
  const campaignId = args.values['campaign'];
  if (sourceUrl && campaignId) throw new Error('pass either --source or --campaign, not both');
  const resolvedCampaignId = campaignId ?? defaultCampaignId(sourceUrl ?? requiredValue(args, 'source'));
  const resolvedSite = campaignId
    ? findSiteForCampaign(baseRoot, campaignId)
    : siteSlugOf(sourceUrl ?? requiredValue(args, 'source'));
  const resolvedSourceUrl = sourceUrl ?? loadCampaignManifest(campaignRootOf(baseRoot, resolvedSite, resolvedCampaignId)).source_url;

  const campaignRoot = campaignRootOf(baseRoot, resolvedSite, resolvedCampaignId);
  mkdirSync(campaignRoot, { recursive: true });

  if (!existsSync(join(campaignRoot, 'campaign-manifest.json'))) {
    if (!sourceUrl) throw new Error(`campaign ${resolvedCampaignId} not found under ${baseRoot}`);
    const manifest = buildCampaignManifest({
      campaign_id: resolvedCampaignId,
      source_url: resolvedSourceUrl,
      site_slug: resolvedSite,
      context_signature: CONTEXT_SIGNATURE_DEFAULT,
    });
    atomicWriteManifest(campaignRoot, manifest);
    if (watch) emit(`BASELINE created ${resolvedCampaignId}`);
  }

  const deps: CampaignDeps = fileBasedDeps(campaignRoot);
  const outcome = await runCampaign({
    campaignRoot,
    deps: { ...deps, watch: watch ? emit : undefined },
    until: 'reviewable',
    maxCandidates,
    maxNoProgressRounds,
  });
  console.log(`CAMPAIGN ${resolvedCampaignId} -> ${outcome.terminal}`);
  if (outcome.escalation) {
    console.log(JSON.stringify(outcome.escalation, null, 2));
  }
}

function findSiteForCampaign(baseRoot: string, campaignId: string): string {
  if (!existsSync(baseRoot)) throw new Error(`no campaign root at ${baseRoot}`);
  for (const site of readdirSync(baseRoot)) {
    if (existsSync(join(baseRoot, site, campaignId, 'campaign-manifest.json'))) return site;
  }
  throw new Error(`campaign ${campaignId} not found under ${baseRoot}`);
}

function fileBasedDeps(campaignRoot: string): CampaignDeps {
  const manifestPath = join(campaignRoot, 'campaign-manifest.json');
  const campaignId = () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { campaign_id: string };
    return manifest.campaign_id;
  };
  return {
    async evaluateCandidate(candidateId) {
      const path = join(campaignRoot, 'candidates', candidateId, 'quality-delta.json');
      if (!existsSync(path)) {
        throw new Error(`no quality-delta.json for candidate ${candidateId} at ${path}`);
      }
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        campaign_id: string;
        candidate_id: string;
        results: QualityDimensionResult[];
      };
      return buildQualityDeltaIndex({
        campaign_id: parsed.campaign_id,
        candidate_id: parsed.candidate_id,
        results: parsed.results,
      });
    },
    async retrieveLearnings(query) {
      const events = loadLearningEvents(campaignRoot);
      const result = retrieveRelevantLearnings(events, {
        layer: query.layer,
        dimension: query.fingerprint.primary_dimension,
        vertical: query.context.vertical,
        archetype: query.fingerprint.location.page_archetype,
        component: query.fingerprint.location.component,
        fingerprint: query.fingerprint,
        context: query.context,
      });
      return [...result.confirmed.map(item => item.event), ...result.anti_patterns.map(item => item.event)];
    },
    async proposeMutation({ campaign, failure }) {
      const plans = loadHypothesisPlans(campaignRoot);
      const candidates = plans
        .filter(plan => plan.mutation.layer === failure.suspected_layer)
        .sort((a, b) => b.confidence_before - a.confidence_before);
      if (candidates.length === 0) {
        throw new Error(
          `no hypothesis for layer ${failure.suspected_layer} in ${campaignRoot}/hypotheses; ` +
          'author a CandidateMutationPlan record and retry (campaign is BLOCKED otherwise)',
        );
      }
      const plan = candidates[0];
      const nextNumber = campaign.attempts.total_candidates + 1;
      return buildCandidateMutationPlan({
        candidate_id: `C${nextNumber}`,
        parent_candidate_id: campaign.champion?.candidate_id ?? null,
        layer: plan.mutation.layer,
        target_paths: plan.mutation.target_paths,
        forbidden_paths: plan.mutation.forbidden_paths,
        unchanged_contract: plan.mutation.unchanged_contract,
        primary_dimension: plan.hypothesis.primary_dimension,
        guardrail_dimensions: plan.hypothesis.guardrail_dimensions,
        expected_causal_path: plan.expected_causal_path,
        expected_effects: plan.expected_effects as Record<string, string>,
        confidence_before: plan.confidence_before,
        inherited_artifacts: plan.inherited_artifacts,
        experimental_control: plan.experimental_control,
        mutation_signature: plan.mutation_signature,
      });
    },
    async buildIncrementally(plan) {
      const dir = join(campaignRoot, 'candidates', plan.candidate_id);
      mkdirSync(join(dir, 'artifacts'), { recursive: true });
      writeFileSync(join(dir, 'mutation-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
      const buildRef = {
        artifact_type: 'CandidateBuild',
        artifact_id: `CandidateBuild:${plan.candidate_id}`,
        payload_digest: plan.integrity.payload_digest,
      } as const;
      return { buildRef };
    },
    async runCheapestAdequateTests(plan) {
      const path = join(campaignRoot, 'candidates', plan.candidate_id, 'quality-delta.json');
      if (!existsSync(path)) {
        const event = buildLearningEvent({
          learning_id: `LE-${plan.candidate_id}-probe`,
          campaign_id: campaignId(),
          candidate_id: plan.candidate_id,
          parent_candidate_id: plan.parent_candidate_id,
          context: {
            vertical: 'unknown',
            page_archetype: 'homepage',
            component: plan.mutation_signature.component,
            viewport: 'mobile',
            quality_dimension: plan.hypothesis.primary_dimension,
          },
          hypothesis: `mutation ${plan.mutation_signature.operation_class} on ${plan.hypothesis.primary_dimension}`,
          mutation_ref: null,
          before: { quality_result: null },
          after: { quality_result: null },
          side_effects: {},
          outcome: 'INCONCLUSIVE',
          scope_recommendation: 'RUN_LOCAL',
        });
        appendLearningEvent(campaignRoot, event);
        return { viable: false };
      }
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { results: QualityDimensionResult[] };
      const viable = parsed.results.some(
        result => result.status === 'PASS' && result.verdict_vs_baseline === 'IMPROVED',
      );
      return { viable };
    },
  };
}

/** CandidateMutationPlan records authored under hypotheses/ (planning-time inputs). */
function loadHypothesisPlans(campaignRoot: string): CandidateMutationPlan[] {
  const dir = join(campaignRoot, 'hypotheses');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as CandidateMutationPlan)
    .filter(plan => plan?.schema === 'website-bot.candidate-mutation-plan/v1');
}

await main().catch(error => {
  console.error(`CAMPAIGN ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
