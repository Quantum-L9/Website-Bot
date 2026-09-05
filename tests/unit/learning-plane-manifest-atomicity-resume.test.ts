// L9_META: layer=test, role=manifest_atomicity_resume, status=active, version=1.0.0
// Determinism contracts 3 and 4:
//   - manifest writes are atomic
//   - campaign resumes from persisted state after process death

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  atomicWriteManifest,
  buildCampaignManifest,
  cleanStaleTempFiles,
  loadCampaignManifest,
  updateCampaignManifest,
} from "../../src/campaigns/campaign-manifest.js";

function tempCampaignRoot(): string {
  return mkdtempSync(join(tmpdir(), "lp-manifest-"));
}

const CONTEXT = {
  vertical: "roofing",
  market_model: "local_service",
  conversion_model: "lead_generation",
  consideration_level: "high",
  service_complexity: "medium",
  location_strategy: "multi_location",
  trust_dependency: "high",
  page_archetypes: ["homepage"],
  brand_maturity: "medium",
  baseline_quality: "low",
};

test("manifest writes are atomic and loadable", () => {
  const root = tempCampaignRoot();
  const manifest = buildCampaignManifest({
    campaign_id: "fixture-001",
    source_url: "https://www.safehavenrr.com",
    site_slug: "safehavenrr",
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  assert.equal(readdirSync(root).filter((name) => name.includes(".tmp-")).length, 0);
  const loaded = loadCampaignManifest(root);
  assert.equal(loaded.campaign_id, "fixture-001");
  assert.equal(loaded.integrity.payload_digest, manifest.integrity.payload_digest);
});

test("a torn manifest is never loadable as valid state", () => {
  const root = tempCampaignRoot();
  writeFileSync(
    join(root, "campaign-manifest.json"),
    '{"schema":"website-bot.campaign-manifest/v1","truncated":',
    "utf8",
  );
  assert.throws(() => loadCampaignManifest(root), /not valid JSON/);
});

test("a tampered manifest fails integrity assertion", () => {
  const root = tempCampaignRoot();
  const manifest = buildCampaignManifest({
    campaign_id: "fixture-001",
    source_url: "https://www.safehavenrr.com",
    site_slug: "safehavenrr",
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  const tampered = { ...manifest, attempts: { ...manifest.attempts, total_candidates: 99 } };
  assert.throws(() => atomicWriteManifest(root, tampered as typeof manifest), /integrity mismatch/);
});

test("campaign resumes from persisted state after process death", () => {
  const root = tempCampaignRoot();
  let manifest = buildCampaignManifest({
    campaign_id: "fixture-001",
    source_url: "https://www.safehavenrr.com",
    site_slug: "safehavenrr",
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  // "process death": the in-memory object is gone; only disk state remains.
  manifest = updateCampaignManifest(loadCampaignManifest(root), {
    champion: {
      candidate_id: "C2",
      build_ref: {
        artifact_type: "CandidateBuild",
        artifact_id: "CandidateBuild:C2",
        payload_digest: "d",
      },
      evaluation_ref: {
        artifact_type: "CandidateEvaluation",
        artifact_id: "CandidateEvaluation:C2",
        payload_digest: "d",
      },
    },
    attempts: {
      total_candidates: 3,
      no_progress_rounds: 0,
      blueprint_replans: 0,
      content_regenerations: 0,
      repairs_by_candidate: {},
    },
  });
  atomicWriteManifest(root, manifest);
  const resumed = loadCampaignManifest(root);
  assert.equal(resumed.champion?.candidate_id, "C2");
  assert.equal(resumed.attempts.total_candidates, 3);
});

test("stale temp files are cleaned on startup", () => {
  const root = tempCampaignRoot();
  writeFileSync(join(root, "campaign-manifest.json.tmp-123-456"), "{", "utf8");
  cleanStaleTempFiles(root);
  assert.equal(existsSync(join(root, "campaign-manifest.json.tmp-123-456")), false);
});
