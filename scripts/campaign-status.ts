// L9_META: layer=script, role=campaign_status_cli, status=active, version=1.0.0
/**
 * npm run campaign:status -- --campaign=<id> [--campaign-root=<dir>]
 * Inspect a campaign's persisted state.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadCampaignManifest } from "../src/campaigns/campaign-manifest.js";
import { parseCampaignArgs, requiredValue } from "./campaign-cli-args.js";

function main(): void {
  const args = parseCampaignArgs(process.argv.slice(2));
  const campaignId = requiredValue(args, "campaign");
  const baseRoot = args.values["campaign-root"] ?? join(process.cwd(), ".l9", "campaigns");
  const site = findSiteForCampaign(baseRoot, campaignId);
  const manifest = loadCampaignManifest(join(baseRoot, site, campaignId));
  console.log(
    JSON.stringify(
      {
        campaign_id: manifest.campaign_id,
        site_slug: manifest.site_slug,
        source_url: manifest.source_url,
        status: manifest.status,
        convergence_target: manifest.convergence_target,
        champion: manifest.champion?.candidate_id ?? null,
        attempts: manifest.attempts,
        budget: manifest.budget,
        reviewable: manifest.reviewable,
        persistent_blocking_dimension: manifest.persistent_blocking_dimension,
        persistent_responsible_layer: manifest.persistent_responsible_layer,
        updated_at: manifest.updated_at,
      },
      null,
      2,
    ),
  );
}

function findSiteForCampaign(baseRoot: string, campaignId: string): string {
  if (!existsSync(baseRoot)) throw new Error(`no campaign root at ${baseRoot}`);
  for (const site of readdirSync(baseRoot)) {
    if (existsSync(join(baseRoot, site, campaignId, "campaign-manifest.json"))) return site;
  }
  throw new Error(`campaign ${campaignId} not found under ${baseRoot}`);
}

main();
