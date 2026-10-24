// L9_META: layer=script, role=site_factory_structural_validator, status=active, version=1.1.0
import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { type BuildContext, clientAssetRoot } from "../src/pipeline/BuildContext.js";
import { parseBuildIntent } from "../src/pipeline/BuildIntent.js";
import { FileEvidenceStore } from "../src/pipeline/evidence/FileEvidenceStore.js";
import { validateDomainSpec } from "../src/pipeline/validateDomainSpec.js";
import { RenderedSiteValidationStage } from "../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../src/stages/SiteBuildStage.js";
import { validateGeneratedSite } from "../src/validation/validate-generated-site.js";

const specPath =
  process.argv.find((argument) => argument.startsWith("--spec="))?.slice("--spec=".length) ??
  "fixtures/ci-test-spec.yaml";
// --build: after structural validation, run the REAL production build
// (npm install + astro check + astro build) and render every route in a real
// browser — the LLM-free proof that generated source → production build →
// rendered site works end to end for the given spec.
const realBuild = process.argv.includes("--build");
// --result=<path>: also write the result JSON to a file (stdout carries logs too),
// for callers such as scripts/site-preview.mjs that bind a receipt to it.
const resultPath = process.argv
  .find((argument) => argument.startsWith("--result="))
  ?.slice("--result=".length);
const parsed = parse(readFileSync(specPath, "utf-8")) as unknown;
const spec = validateDomainSpec(parsed, specPath);
const buildId = `structural-${Date.now()}`;
const outputDir = resolve("build", "validation", spec.client_id);
const generatedContent = new Map<string, string>();
for (const route of spec.routes) {
  for (const component of route.components) {
    generatedContent.set(
      `${route.slug}:${component}`,
      `Validated fixture content for ${route.title} ${component}. This content is deterministic and exists only for the structural validation command.`,
    );
  }
}
const evidenceStore = new FileEvidenceStore({
  rootDir: resolve("build", "validation-evidence", spec.client_id, buildId),
  clientId: spec.client_id,
  buildId,
  mode: "local-proof",
});
const evidenceIndex = await evidenceStore.initialize();
const ctx: BuildContext = {
  buildId,
  clientId: spec.client_id,
  domainSpec: spec,
  dryRun: false,
  mode: "local-proof",
  autoRegisterSeoBot: false,
  buildIntent: parseBuildIntent(spec.build_intent),
  llm: { flushUsage: () => [] } as unknown as BuildContext["llm"],
  outputDir,
  evidenceStore,
  evidenceIndex,
  resume: false,
  designTokens: {
    primary: "#1a365d",
    secondary: "#2b6cb0",
    accent: "#1677ff",
    background: "#ffffff",
    text: "#17212b",
    font_heading: "Inter",
    font_body: "Inter",
  },
  qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
  generatedContent,
  generatedSchemas: new Map([
    [
      "Organization",
      { "@context": "https://schema.org", "@type": "Organization", name: spec.business_name },
    ],
  ]),
  visualQaPassed: false,
  stageResults: new Map(),
  startedAt: new Date(),
};
try {
  await new SiteAssemblerStage().run(ctx);
  validateGeneratedSite(ctx.outputDir, spec.routes);
  if (!ctx.assemblyManifest?.sourceDigest)
    throw new Error("Assembly manifest source digest was not produced");
  if (realBuild) {
    await new SiteBuildStage().run(ctx);
    await new RenderedSiteValidationStage().run(ctx);
  }
  const result = {
    status: "passed",
    buildId,
    clientId: spec.client_id,
    spec: resolve(specPath),
    outputDir: ctx.outputDir,
    routes: spec.routes.length,
    routeSlugs: spec.routes.map((route) => route.slug),
    sourceDigest: ctx.assemblyManifest.sourceDigest,
    evidenceDir: evidenceStore.rootDir,
    ...(realBuild
      ? {
          build: "passed",
          distDir: ctx.distDir,
          distDigest: ctx.buildProof?.distDigest,
          buildProof: {
            proofId: ctx.buildProof?.proofId,
            sourceDigest: ctx.buildProof?.sourceDigest,
            distDigest: ctx.buildProof?.distDigest,
            checks: ctx.buildProof?.checks,
            builtRoutes: ctx.buildProof?.builtRoutes,
          },
          renderedSiteValidation: ctx.renderedSiteValidationPath,
          screenshotDir: resolve(clientAssetRoot(ctx), "renders"),
        }
      : {}),
  };
  console.log(JSON.stringify(result, null, 2));
  if (resultPath) {
    mkdirSync(dirname(resolve(resultPath)), { recursive: true });
    writeFileSync(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  }
} finally {
  // Remove only this run's output, evidence and renders, never other clients' or
  // other runs'. KEEP_SITE_FACTORY_VALIDATION_OUTPUT=true retains all three,
  // including the browser report and screenshots, for inspection.
  if (process.env.KEEP_SITE_FACTORY_VALIDATION_OUTPUT !== "true") {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(evidenceStore.rootDir, { recursive: true, force: true });
    rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
    // The per-client parents go too, but only once no other run is left in them.
    for (const parent of [dirname(evidenceStore.rootDir), dirname(clientAssetRoot(ctx))]) {
      try {
        rmdirSync(parent);
      } catch {
        // not empty (another run or client) or already gone: leave it
      }
    }
  }
}
