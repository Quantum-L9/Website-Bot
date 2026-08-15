// L9_META: layer=script, role=campaign_review_cli, status=active, version=1.0.0
/**
 * npm run campaign:review -- --campaign=<id> --decision=APPROVED|REJECTED|APPROVE_WITH_NOTES
 *   [--candidate=<id>] [--positive=<text>...] [--negative=<text>...] [--tag=<tag>...]
 *
 * Captures the operator's decision as a HumanReviewReceipt (design contract §4.6)
 * and persists it to human-review.json in the campaign root.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCampaignManifest } from '../src/campaigns/campaign-manifest.js';
import { buildHumanReviewReceipt, type HumanReviewDecision, HUMAN_REVIEW_TAGS, type HumanReviewTag } from '../src/campaigns/human-review.js';
import { parseCampaignArgs, requiredValue } from './campaign-cli-args.js';

function main(): void {
  const args = parseCampaignArgs(process.argv.slice(2));
  const campaignId = requiredValue(args, 'campaign');
  const decision = requiredValue(args, 'decision') as HumanReviewDecision;
  const baseRoot = args.values['campaign-root'] ?? join(process.cwd(), '.l9', 'campaigns');
  const site = findSiteForCampaign(baseRoot, campaignId);
  const campaignRoot = join(baseRoot, site, campaignId);
  const manifest = loadCampaignManifest(campaignRoot);
  if (manifest.status !== 'REVIEWABLE') {
    throw new Error(
      `campaign ${campaignId} is ${manifest.status}; only REVIEWABLE campaigns accept human review`,
    );
  }
  const candidateId = args.values['candidate'] ?? manifest.champion?.candidate_id;
  if (!candidateId) throw new Error('no champion candidate to review');
  const tags = (args.flags.has('tag') ? [] : collectRepeated(args.values, 'tag'));
  for (const tag of tags) {
    if (!(HUMAN_REVIEW_TAGS as readonly string[]).includes(tag as HumanReviewTag)) {
      throw new Error(`unknown --tag: ${tag} (allowed: ${HUMAN_REVIEW_TAGS.join(', ')})`);
    }
  }
  const receipt = buildHumanReviewReceipt({
    receipt_id: `${campaignId}-review-${Date.now()}`,
    campaign_id: campaignId,
    candidate_id: candidateId,
    decision,
    positives: collectRepeated(args.values, 'positive'),
    negatives: collectRepeated(args.values, 'negative'),
    blocking_negatives: collectRepeated(args.values, 'blocking'),
    preference_signals: collectRepeated(args.values, 'signal'),
    tags: tags as HumanReviewTag[],
    unmeasured_signal_candidate: args.values['unmeasured-signal'] ?? null,
  });
  mkdirSync(campaignRoot, { recursive: true });
  writeFileSync(join(campaignRoot, 'human-review.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    receipt_id: receipt.receipt_id,
    campaign_id: receipt.campaign_id,
    candidate_id: receipt.candidate_id,
    decision: receipt.decision,
    human_machine_gap: receipt.human_machine_gap,
  }, null, 2));
}

function collectRepeated(values: Record<string, string>, name: string): string[] {
  const collected: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === name) collected.push(value);
    if (key.startsWith(`${name}.`)) collected.push(value);
  }
  return collected;
}

function findSiteForCampaign(baseRoot: string, campaignId: string): string {
  if (!existsSync(baseRoot)) throw new Error(`no campaign root at ${baseRoot}`);
  for (const site of readdirSync(baseRoot)) {
    if (existsSync(join(baseRoot, site, campaignId, 'campaign-manifest.json'))) return site;
  }
  throw new Error(`campaign ${campaignId} not found under ${baseRoot}`);
}

main();
