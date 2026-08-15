// L9_META: layer=campaign, role=campaign_manifest, status=active, version=1.0.0
/**
 * CampaignManifest with atomic persistence (design contract §3, §4.1).
 * Every iteration writes the manifest atomically (temp file + rename) so the
 * process can die at any point and resume safely. A torn manifest is never
 * loadable as valid state.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex } from './semantic-digest.js';
import type { ArtifactRef } from '@quantum-l9/bot-interop';
import type { CampaignBudget, CampaignManifest, CampaignStatus, ContextSignature } from './types.js';
import { CAMPAIGN_STATUSES, DEFAULT_CAMPAIGN_BUDGET } from './types.js';

export interface NewCampaignInput {
  campaign_id: string;
  source_url: string;
  site_slug: string;
  context_signature: ContextSignature;
  budget?: Partial<CampaignBudget>;
  baseline_ref?: ArtifactRef | null;
  now?: string;
}

export function buildCampaignManifest(input: NewCampaignInput): CampaignManifest {
  if (!input.campaign_id) throw new Error('campaign_id required');
  if (!input.source_url) throw new Error('source_url required');
  const now = input.now ?? new Date().toISOString();
  const budget: CampaignBudget = { ...DEFAULT_CAMPAIGN_BUDGET, ...(input.budget ?? {}) };
  const payload: Omit<CampaignManifest, 'integrity'> = {
    schema: 'website-bot.campaign-manifest/v1',
    schema_version: '1.0.0',
    campaign_id: input.campaign_id,
    source_url: input.source_url,
    site_slug: input.site_slug,
    status: 'RUNNING',
    convergence_target: 'REVIEWABLE',
    context_signature: input.context_signature,
    baseline_ref: input.baseline_ref ?? null,
    champion: null,
    attempts: {
      total_candidates: 0,
      no_progress_rounds: 0,
      blueprint_replans: 0,
      content_regenerations: 0,
      repairs_by_candidate: {},
    },
    budget,
    reviewable: false,
    persistent_blocking_dimension: null,
    persistent_responsible_layer: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  const digest = sha256Hex(JSON.stringify(payload));
  return { ...payload, integrity: { algorithm: 'sha256', payload_digest: digest } };
}

export function validateCampaignManifest(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['not an object'];
  const manifest = value as Partial<CampaignManifest>;
  const errors: string[] = [];
  if (manifest.schema !== 'website-bot.campaign-manifest/v1') errors.push('schema must be website-bot.campaign-manifest/v1');
  if (!manifest.campaign_id) errors.push('campaign_id required');
  if (!manifest.source_url) errors.push('source_url required');
  if (manifest.status && !(CAMPAIGN_STATUSES as readonly string[]).includes(manifest.status)) {
    errors.push(`status must be one of ${CAMPAIGN_STATUSES.join('|')}`);
  }
  if (manifest.budget) {
    for (const key of ['max_candidate_builds', 'max_targeted_repairs_per_candidate', 'max_blueprint_replans', 'max_content_regenerations', 'stop_after_no_improvement_rounds'] as const) {
      const budgetValue = manifest.budget[key];
      if (typeof budgetValue !== 'number' || !Number.isInteger(budgetValue) || budgetValue < 0) {
        errors.push(`budget.${key} must be a non-negative integer`);
      }
    }
  }
  return errors;
}

/** Recomputes and verifies the manifest integrity digest; throws on mismatch. */
export function assertCampaignManifestIntegrity(manifest: CampaignManifest): void {
  const { integrity, ...payload } = manifest;
  const digest = sha256Hex(JSON.stringify(payload));
  if (integrity.algorithm !== 'sha256' || integrity.payload_digest !== digest) {
    throw new Error('campaign manifest integrity mismatch');
  }
}

export function manifestPathOf(campaignRoot: string): string {
  return join(campaignRoot, 'campaign-manifest.json');
}

export function atomicWriteManifest(campaignRoot: string, manifest: CampaignManifest): void {
  assertCampaignManifestIntegrity(manifest);
  mkdirSync(campaignRoot, { recursive: true });
  const target = manifestPathOf(campaignRoot);
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
}

export function loadCampaignManifest(campaignRoot: string): CampaignManifest {
  const target = manifestPathOf(campaignRoot);
  if (!existsSync(target)) throw new Error(`No campaign manifest at ${target}`);
  let raw: string;
  try {
    raw = readFileSync(target, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read campaign manifest at ${target}: ${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Campaign manifest at ${target} is not valid JSON: ${String(error)}`);
  }
  const errors = validateCampaignManifest(parsed);
  if (errors.length > 0) throw new Error(`Invalid campaign manifest at ${target}: ${errors.join('; ')}`);
  assertCampaignManifestIntegrity(parsed as CampaignManifest);
  return parsed as CampaignManifest;
}

export function updateCampaignManifest(
  manifest: CampaignManifest,
  changes: Partial<Omit<CampaignManifest, 'integrity' | 'schema' | 'schema_version' | 'campaign_id' | 'created_at'>>,
  now?: string,
): CampaignManifest {
  const { integrity: _previousIntegrity, ...rest } = manifest;
  const payload: Omit<CampaignManifest, 'integrity'> = {
    ...rest,
    ...changes,
    updated_at: now ?? new Date().toISOString(),
  };
  const digest = sha256Hex(JSON.stringify(payload));
  return { ...payload, integrity: { algorithm: 'sha256', payload_digest: digest } };
}

export function transitionCampaignStatus(manifest: CampaignManifest, status: CampaignStatus, now?: string): CampaignManifest {
  return updateCampaignManifest(manifest, { status }, now);
}

/** Resolve the campaign root for a source URL or an explicit campaign id (§3). */
export function campaignRootOf(baseRoot: string, siteSlug: string, campaignId: string): string {
  return join(baseRoot, siteSlug, campaignId);
}

/** Clean up only the temp files this module may leave behind after a crash. */
export function cleanStaleTempFiles(campaignRoot: string): void {
  if (!existsSync(campaignRoot)) return;
  for (const entry of readdirSync(campaignRoot)) {
    if (entry.startsWith('campaign-manifest.json.tmp-')) {
      rmSync(join(campaignRoot, entry), { force: true });
    }
  }
}

export function touchManifestDir(campaignRoot: string): string {
  mkdirSync(dirname(campaignRoot), { recursive: true });
  return campaignRoot;
}
