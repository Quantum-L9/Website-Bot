// L9_META: layer=cli, role=pipeline_entry, status=active, version=4.0.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  type BuildContext,
  type ExecutionMode,
  makeBuildId,
} from "../src/pipeline/BuildContext.js";
import { parseBuildIntent } from "../src/pipeline/BuildIntent.js";
import { FileEvidenceStore } from "../src/pipeline/evidence/FileEvidenceStore.js";
import { MemoryEvidenceStore } from "../src/pipeline/evidence/MemoryEvidenceStore.js";
import {
  buildFactoryExecutionPlan,
  executeFactoryPlan,
} from "../src/pipeline/FactoryExecutionPlan.js";
import { validateDomainSpec } from "../src/pipeline/validateDomainSpec.js";
import { createWebsiteFactoryLLM } from "../src/services/llm.js";
import { hydrateSecretsIfConfigured } from "./lib/hydrate-secrets.mjs";

// Hydrate process.env from Infisical when INFISICAL_* bootstrap is present.
// Fail-soft locally; CI supplies INFISICAL_CLIENT_ID/_SECRET/_PROJECT_ID.
await hydrateSecretsIfConfigured();

const arguments_ = process.argv.slice(2);
const argValue = (name: string): string | undefined =>
  arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const explicitMode = argValue("mode");
const dryRunFlag = arguments_.includes("--dry-run");
const validModes: ExecutionMode[] = ["plan", "local-proof", "publish-proof", "end-to-end"];
if (explicitMode && !validModes.includes(explicitMode as ExecutionMode))
  throw new Error(`--mode must be one of ${validModes.join(", ")}`);
if (dryRunFlag && explicitMode && explicitMode !== "plan")
  throw new Error("--dry-run cannot be combined with a non-plan --mode");
const mode: ExecutionMode = dryRunFlag
  ? "plan"
  : ((explicitMode as ExecutionMode | undefined) ?? "end-to-end");
const dryRun = mode === "plan";
const resume = arguments_.includes("--resume");
if (resume && dryRun) throw new Error("--resume cannot be used in plan mode");
const explicitBuildId = argValue("build-id");
if (resume && !explicitBuildId) throw new Error("--resume requires --build-id=<existing-build-id>");
const autoRegisterSeoBot = arguments_.includes("--auto-register-seo-bot");
const explicitSpec = argValue("spec");
const specPath = explicitSpec ?? "examples/supplemental-insurance-pros/domain_spec.normalized.yaml";
const skipArg = argValue("skip");
const skipStages = skipArg
  ? skipArg
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : [];
const requestedOutputDir = argValue("output-dir") ?? process.env.SITE_OUTPUT_DIR ?? "";
const evidenceDir = argValue("evidence-dir");
const provisionRequested = arguments_.includes("--provision");
const noPersistProvision = arguments_.includes("--no-persist-provision");
const noRollbackProvision = arguments_.includes("--no-rollback-provision");

const bootstrapSpec = validateDomainSpec(parse(readFileSync(specPath, "utf-8")), specPath);
if (process.env.CLIENT_ID && process.env.CLIENT_ID !== bootstrapSpec.client_id) {
  throw new Error(
    `CLIENT_ID (${process.env.CLIENT_ID}) does not match spec client_id (${bootstrapSpec.client_id})`,
  );
}
const clientId = bootstrapSpec.client_id;
const buildId = explicitBuildId ?? makeBuildId(clientId);
const evidenceStore = dryRun
  ? new MemoryEvidenceStore(clientId, buildId, mode)
  : new FileEvidenceStore({
      clientId,
      buildId,
      mode,
      rootDir: evidenceDir ? resolve(evidenceDir) : undefined,
    });
const evidenceIndex = await evidenceStore.initialize();

if (!explicitSpec) console.warn(`[spec] no --spec provided; defaulting to ${specPath}`);
if (dryRun)
  console.log(
    "[PLAN MODE] No generated files, runtime evidence files, or external mutations will be performed",
  );
if (resume) console.log(`[RESUME MODE] Reusing verified evidence for build ${buildId}`);

const ctx: BuildContext = {
  buildId,
  clientId,
  domainSpec: bootstrapSpec,
  dryRun,
  mode,
  autoRegisterSeoBot,
  buildIntent: parseBuildIntent(bootstrapSpec.build_intent),
  llm: createWebsiteFactoryLLM(clientId),
  outputDir: requestedOutputDir,
  evidenceStore,
  evidenceIndex,
  resume,
  qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
  generatedContent: new Map(),
  generatedSchemas: new Map(),
  visualQaPassed: false,
  stageResults: new Map(),
  startedAt: new Date(),
};

if (bootstrapSpec.deploy?.github_repo) {
  ctx.deployTarget = {
    githubRepo: bootstrapSpec.deploy.github_repo,
    githubRepoId: bootstrapSpec.deploy.github_repo_id,
    sourceBranch: bootstrapSpec.deploy.source_branch ?? "main",
    publishCredentialRef: bootstrapSpec.deploy.publish_credential_ref ?? "env://GITHUB_SITE_TOKEN",
    vercelProjectId: bootstrapSpec.deploy.vercel_project_id,
    vercelDeployHook: bootstrapSpec.deploy.vercel_deploy_hook,
    seoBotGithubCredentialRef:
      bootstrapSpec.deploy.seo_bot_github_credential_ref ?? "env://SEO_BOT_SITE_GITHUB_TOKEN",
    seoBotVercelDeployHookRef: bootstrapSpec.deploy.seo_bot_vercel_deploy_hook_ref,
  };
}

const shouldProvision =
  provisionRequested ||
  ((mode === "publish-proof" || mode === "end-to-end") &&
    !bootstrapSpec.deploy &&
    bootstrapSpec.provision?.enabled !== false &&
    bootstrapSpec.provision !== undefined);
const plan = buildFactoryExecutionPlan({
  mode,
  specPath,
  skipStages,
  buildIntent: ctx.buildIntent,
  provision: shouldProvision,
  persistDeployBlock: !noPersistProvision,
  rollbackCreatedResources: !noRollbackProvision,
});

try {
  await executeFactoryPlan(ctx, plan);
  console.log(`Pipeline complete. Build: ${ctx.buildId}. Mode: ${mode}`);
  if (ctx.outputDir) console.log(`Generated source: ${ctx.outputDir}`);
  if (!dryRun) console.log(`Evidence root: ${ctx.evidenceStore.rootDir}`);
  const buildProof = await ctx.evidenceStore.readBuild();
  const publication = await ctx.evidenceStore.readPublication();
  const deployment = await ctx.evidenceStore.readDeployment();
  const receipt = await ctx.evidenceStore.readReleaseReceipt();
  if (buildProof) console.log(`Local proof: ${buildProof.value.sourceDigest}`);
  if (publication) console.log(`Published commit: ${publication.value.commitSha}`);
  if (deployment) console.log(`Deployment: ${deployment.value.deploymentUrl}`);
  if (receipt) console.log(`Receipt: ${receipt.value.receipt_id} (${receipt.value.status})`);
} catch (error) {
  console.error(`Pipeline FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
