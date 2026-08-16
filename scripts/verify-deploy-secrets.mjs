#!/usr/bin/env node
// L9_META: layer=configuration, role=deploy_secret_preflight, status=active, version=1.1.0
//
// Deploy-execution preflight. Complements verify-launch-env.mjs (launch/legal
// contract) by checking the credentials the build+deploy pipeline actually READS
// at runtime, so a triggered deploy fails fast with a readable message instead of
// deep inside the pipeline.
//
// Grounded in the runtime env reads on main:
//   - OPENROUTER_API_KEY / PERPLEXITY_API_KEY  src/services/llm.ts (both required())
//   - VERCEL_TOKEN / VERCEL_TEAM_ID            src/stages/VercelDeployStage.ts
//   - GITHUB_SITE_TOKEN                        src/stages/ClientSourcePublishStage.ts
//                                              (env://GITHUB_SITE_TOKEN)
//   - project identity                         CLIENT_VERCEL_PROJECT_ID or
//                                              CLIENT_VERCEL_DEPLOY_HOOK (or DomainSpec.deploy.*)
import fs from "node:fs";
import { hydrateSecretsIfConfigured } from "./lib/hydrate-secrets.mjs";

// Warn-only only when callers pass `--ci`. Do NOT treat `process.env.CI` as
// warn-only: GitHub Actions always sets CI=true, and deploy workflows invoke
// this script without `--ci` so missing credentials must fail closed.
const isCI = process.argv.includes("--ci");

const hydrateMeta = await hydrateSecretsIfConfigured();

// llm.ts requires BOTH keys via required(); treat both as blocking secrets.
const requiredSecrets = [
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "VERCEL_TOKEN",
  "GITHUB_SITE_TOKEN",
];
const requiredIdentifiers = ["VERCEL_TEAM_ID"];
// Project identity: at least one of these (or spec-embedded deploy.vercel_project_id).
const projectIdentityAnyOf = ["CLIENT_VERCEL_PROJECT_ID", "CLIENT_VERCEL_DEPLOY_HOOK"];
const optional = [
  "PUBLIC_POSTHOG_KEY",
  "POSTHOG_KEY",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "SEO_BOT_URL",
  "SEO_BOT_API_KEY",
];

const invalidMarkers = new Set([
  "",
  "UNKNOWN",
  "Unknown",
  "unknown",
  "UNKNOWN_REQUIRED_BEFORE_LAUNCH",
  "UNKNOWN_REQUIRED_FOR_DEPLOY",
  "UNKNOWN_REQUIRED_FOR_FORM_DELIVERY",
  "UNKNOWN_SECRET_DO_NOT_COMMIT",
]);
const isMissing = (v) => v === undefined || invalidMarkers.has(String(v).trim());

const missingSecrets = requiredSecrets.filter((k) => isMissing(process.env[k]));
const missingIdentifiers = requiredIdentifiers.filter((k) => isMissing(process.env[k]));
const missingProjectIdentity = projectIdentityAnyOf.every((k) => isMissing(process.env[k]))
  ? [`one of ${projectIdentityAnyOf.join(" / ")} (or DomainSpec.deploy.vercel_project_id)`]
  : [];
const missingOptional = optional.filter((k) => isMissing(process.env[k]));

const blocking = [...missingSecrets, ...missingIdentifiers];
const warnings = [];
if (isCI) {
  if (blocking.length)
    warnings.push(`Missing deploy credentials (CI warning): ${blocking.join(", ")}`);
  if (missingProjectIdentity.length)
    warnings.push(`Missing project identity (CI warning): ${missingProjectIdentity.join(", ")}`);
}

let status;
if (isCI) {
  status = warnings.length ? "WARN" : "PASS";
} else if (blocking.length === 0) {
  status = "PASS";
} else {
  status = "FAIL_CLOSED";
}

const report = {
  validation_scope: "deploy_execution_secrets",
  mode: isCI ? "ci" : "production",
  timestamp_utc: new Date().toISOString(),
  missing_secrets: missingSecrets,
  missing_identifiers: missingIdentifiers,
  missing_project_identity: missingProjectIdentity,
  missing_optional: missingOptional,
  warnings,
  status,
  bootstrap_present: hydrateMeta.bootstrap_present,
  source_mode: hydrateMeta.source_mode,
  note: "Presence check only; does not validate that credentials are accepted by the provider.",
};

fs.mkdirSync("validation", { recursive: true });
fs.writeFileSync("validation/deploy_secrets_report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// CI: informational (exit 0). Production: fail closed on missing required credentials.
process.exit(status === "FAIL_CLOSED" ? 1 : 0);
