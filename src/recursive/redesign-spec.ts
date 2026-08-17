// L9_META: layer=recursive, role=redesign_run_spec, status=active, version=1.0.0
//
// Builds the sealed run spec for recursive:improve. This surface IS the
// redesign product path (Campaign 7 R1/R2): the REDESIGN_IMPROVE intent is
// bound here explicitly, before any execution-plan construction, and the
// result is re-validated fail-closed so a fixture or merge regression can
// never silently downgrade the run to the legacy COPY default.

import { parse } from "yaml";
import { requireRedesignIntent } from "../pipeline/BuildIntent.js";

export interface RedesignDeployTarget {
  githubRepo: string;
  githubRepoId: string;
  vercelProjectId: string;
  sourceBranch: string;
}

export interface RedesignRunSpecOptions {
  fixtureYaml: string;
  sourceUrl: string;
  clientId: string;
  /** Preview-tier deploy target for end-to-end seam runs (rendered visual QA). */
  deploy?: RedesignDeployTarget;
}

/**
 * Resolve the seam deploy target from REDESIGN_DEPLOY_* env vars.
 * All-or-nothing: a partial binding is a configuration error, not a silent
 * downgrade to a deploy-less run (fail-closed, Campaign 7 R13).
 */
export function redesignDeployTargetFromEnv(
  env: Record<string, string | undefined>,
): RedesignDeployTarget | undefined {
  const githubRepo = env.REDESIGN_DEPLOY_GITHUB_REPO?.trim();
  const githubRepoId = env.REDESIGN_DEPLOY_GITHUB_REPO_ID?.trim();
  const vercelProjectId = env.REDESIGN_DEPLOY_VERCEL_PROJECT_ID?.trim();
  const sourceBranch = env.REDESIGN_DEPLOY_SOURCE_BRANCH?.trim();
  const present = [githubRepo, githubRepoId, vercelProjectId].filter(Boolean).length;
  if (present === 0) return undefined;
  if (!githubRepo || !githubRepoId || !vercelProjectId) {
    throw new Error(
      "REDESIGN_DEPLOY_GITHUB_REPO, REDESIGN_DEPLOY_GITHUB_REPO_ID, and REDESIGN_DEPLOY_VERCEL_PROJECT_ID must all be set together",
    );
  }
  return {
    githubRepo,
    githubRepoId,
    vercelProjectId,
    sourceBranch: sourceBranch || `redesign-seam-${Date.now()}`,
  };
}

export function buildRedesignRunSpec(options: RedesignRunSpecOptions): Record<string, unknown> {
  const spec = parse(options.fixtureYaml) as Record<string, unknown>;
  const assets = (spec.assets ?? {}) as Record<string, unknown>;
  const sourceSite = (assets.sourceSite ?? {}) as Record<string, unknown>;
  spec.client_id = options.clientId;
  spec.build_intent = "REDESIGN_IMPROVE";
  spec.seo_contract = {
    ...(spec.seo_contract as Record<string, unknown>),
    site_url: new URL(options.sourceUrl).hostname,
  };
  assets.sourceSite = {
    ...sourceSite,
    url: options.sourceUrl,
    enabled: true,
    maxPages: 3,
    maxDepth: 1,
  };
  spec.assets = assets;
  if (options.deploy) {
    spec.deploy = {
      github_repo: options.deploy.githubRepo,
      github_repo_id: options.deploy.githubRepoId,
      source_branch: options.deploy.sourceBranch,
      vercel_project_id: options.deploy.vercelProjectId,
    };
  }
  requireRedesignIntent(spec.build_intent, "recursive:improve run spec");
  return spec;
}
