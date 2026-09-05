// L9_META: layer=benchmark, role=evidence_capture_driver, status=active, version=1.0.0
//
// Quantum AI Partners clean capability test — benchmark driver.
//
// Runs the PRODUCTION pipeline in-process through the same public API that
// scripts/run-pipeline.ts uses (same spec validation, same BuildContext
// bootstrap, same FactoryExecutionPlan stages, same evidence store). It does
// NOT modify production code and does NOT change pipeline semantics.
//
// Why it exists: under REDESIGN_IMPROVE the CLI leaves several sealed
// intelligence artifacts in process memory only (CompetitiveLandscape,
// SEOContentBlueprint, StructuredContentPackage, ClientVision,
// DesignReferenceSet, DesignReferenceIntelligence). The benchmark evidence
// bundle must contain the actual artifacts, so this driver serializes them
// to JSON after a successful run — the same in-process export the repo's
// golden-runtime-evidence path performs for Safe Haven.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { hydrateSecretsIfConfigured } from "../../../../../scripts/lib/hydrate-secrets.mjs";
import {
  type BuildContext,
  type ExecutionMode,
  makeBuildId,
} from "../../../../../src/pipeline/BuildContext.js";
import {
  parseBuildIntent,
  requireRedesignIntent,
} from "../../../../../src/pipeline/BuildIntent.js";
import { FileEvidenceStore } from "../../../../../src/pipeline/evidence/FileEvidenceStore.js";
import { MemoryEvidenceStore } from "../../../../../src/pipeline/evidence/MemoryEvidenceStore.js";
import {
  buildFactoryExecutionPlan,
  executeFactoryPlan,
} from "../../../../../src/pipeline/FactoryExecutionPlan.js";
import { validateDomainSpec } from "../../../../../src/pipeline/validateDomainSpec.js";
import { createWebsiteFactoryLLM } from "../../../../../src/services/llm.js";

// Same .env.local bootstrap as scripts/run-pipeline.ts: real environment
// variables win; values are never logged. Absent file is a no-op.
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // optional
}
await hydrateSecretsIfConfigured();

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined =>
  args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode: ExecutionMode = (argValue("mode") as ExecutionMode | undefined) ?? "local-proof";
const specPath = argValue("spec");
if (!specPath) {
  console.error("driver requires --spec=<flat-domain-spec.yaml>");
  process.exit(2);
}
const redesignSurface = args.includes("--redesign");
const outDir = argValue("artifacts-out");

const bootstrapSpec = validateDomainSpec(parse(readFileSync(specPath, "utf-8")), specPath);
const clientId = bootstrapSpec.client_id;
const buildId = makeBuildId(clientId);
const dryRun = mode === "plan";
const evidenceStore = dryRun
  ? new MemoryEvidenceStore(clientId, buildId, mode)
  : new FileEvidenceStore({ clientId, buildId, mode });
const evidenceIndex = await evidenceStore.initialize();

const ctx: BuildContext = {
  buildId,
  clientId,
  domainSpec: bootstrapSpec,
  dryRun,
  mode,
  autoRegisterSeoBot: false,
  buildIntent: redesignSurface
    ? requireRedesignIntent(bootstrapSpec.build_intent, "benchmark driver --redesign")
    : parseBuildIntent(bootstrapSpec.build_intent),
  llm: createWebsiteFactoryLLM(clientId),
  outputDir: "",
  evidenceStore,
  evidenceIndex,
  resume: false,
  qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
  generatedContent: new Map(),
  generatedSchemas: new Map(),
  visualQaPassed: false,
  stageResults: new Map(),
  startedAt: new Date(),
};

const plan = buildFactoryExecutionPlan({ mode, specPath, buildIntent: ctx.buildIntent });

let headSha = "unknown";
try {
  headSha = execSync("git rev-parse HEAD", { encoding: "utf8", cwd: process.cwd() }).trim();
} catch {
  // read-only nicety
}

try {
  await executeFactoryPlan(ctx, plan);
  console.log(`Pipeline complete. Build: ${ctx.buildId}. Mode: ${mode}`);
  if (ctx.outputDir) console.log(`Generated source: ${ctx.outputDir}`);
  console.log(`Evidence root: ${ctx.evidenceStore.rootDir}`);

  // ---- Evidence capture (benchmark requirement) -----------------------
  const artifactRoot = resolve(
    outDir ?? resolve(process.cwd(), "build", "benchmarks", "quantum-ai-partners"),
    "artifacts",
  );
  mkdirSync(artifactRoot, { recursive: true });
  const write = (name: string, value: unknown): void => {
    writeFileSync(resolve(artifactRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    console.log(`[benchmark] captured ${name}`);
  };
  const stageResults = Object.fromEntries(
    [...ctx.stageResults.entries()].map(([name, result]) => [name, result]),
  );
  write("run-metadata.json", {
    repository_head: headSha,
    client_id: clientId,
    build_id: buildId,
    mode,
    build_intent: ctx.buildIntent,
    started_at: ctx.startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    output_dir: ctx.outputDir,
    evidence_root: ctx.evidenceStore.rootDir,
    stage_results: stageResults,
  });
  if (ctx.clientVision) write("client-vision.json", ctx.clientVision);
  if (ctx.designReferenceSet) write("design-reference-set.json", ctx.designReferenceSet);
  if (ctx.designReferenceIntelligence)
    write("design-reference-intelligence.json", ctx.designReferenceIntelligence);
  if (ctx.competitiveLandscape) write("competitive-landscape.json", ctx.competitiveLandscape);
  if (ctx.websiteBlueprint) write("website-build-blueprint-v2.json", ctx.websiteBlueprint);
  if (ctx.seoContentBlueprint) write("seo-content-blueprint.json", ctx.seoContentBlueprint);
  if (ctx.pageContentContract) write("page-content-contract.json", ctx.pageContentContract);
  if (ctx.structuredContentPackage)
    write("structured-content-package.json", ctx.structuredContentPackage);
  if (ctx.acceptedDonors) write("accepted-donors.json", ctx.acceptedDonors);
  if (ctx.pccDeterminism) write("pcc-determinism.json", ctx.pccDeterminism);
  if (ctx.seoBotOrdering) write("seo-bot-ordering.json", ctx.seoBotOrdering);
  if (ctx.redesignCounters) write("redesign-counters.json", ctx.redesignCounters);
  if (ctx.designTokens) write("resolved-design-tokens.json", ctx.designTokens);
  console.log(`[benchmark] artifacts written to ${artifactRoot}`);
} catch (error) {
  console.error(`Pipeline FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
