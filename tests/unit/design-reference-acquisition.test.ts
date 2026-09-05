// L9_META: layer=test, role=design_reference_acquisition, status=active, version=1.0.0
//
// GAP-1 regression suite (Quantum AI Partners run 2026-09-01): client-supplied
// design reference URLs are executable inputs. Acquisition is real (a local
// HTTP fixture stands in for the internet), observation is deterministic,
// analysis output is guarded against raw-expression and copy transfer, and
// the derived principles reach the sealed design direction.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { extractPage } from "../../src/ingestion/PageExtractor.js";
import { NoopScreenshotCapturer } from "../../src/ingestion/ScreenshotCapturer.js";
import {
  acquireAndAnalyzeDesignReferences,
  acquireDesignReference,
  applyAcquisitionToReferenceSet,
  assertNoReferenceCopyTransfer,
  type DesignReferenceEvidence,
  observeDesignCharacteristics,
  parseDesignReferenceAnalysis,
} from "../../src/intelligence/DesignReferenceAcquisition.js";
import {
  deriveDesignReferenceIntelligence,
  resolveClientVision,
  resolveDesignDirection,
  resolveDesignReferenceSet,
} from "../../src/intelligence/design-authority.js";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { clientAssetRoot } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import type { WebsiteFactoryLLM } from "../../src/services/llm.js";
import { resolveDesignAuthorities } from "../../src/stages/CompetitiveIntelligenceStage.js";
import { DesignReferenceAcquisitionStage } from "../../src/stages/DesignReferenceAcquisitionStage.js";

/* ---------------- fixture site ----------------------------------- */

const PAGE = `<!doctype html><html><head><title>Northwind Systems — Serious AI Infrastructure</title>
<meta name="description" content="fixture"><link rel="stylesheet" href="/style.css"></head>
<body><header><nav><a href="/platform">Platform</a><a href="/customers">Customers</a><a href="/pricing">Pricing</a></nav></header>
<main><h1>Build production systems that actually ship</h1>
<a class="btn btn-primary" href="/contact">Talk to an engineer</a>
<section><h2>Infrastructure you can reason about</h2><p>${"Systems prose. ".repeat(60)}</p><img src="/a.png" alt="a"></section>
<section><h2>Calm by design</h2><p>${"More prose here. ".repeat(40)}</p><img src="/b.png" alt="b"></section>
</main><footer>fixture</footer></body></html>`;
const CSS = `body{font-family:Inter,sans-serif;color:#111111;background:#fafafa}h1{font-family:'Space Grotesk';color:#0b5fff}.btn{transition:opacity .2s}@keyframes fade{from{opacity:0}to{opacity:1}}`;

let server: Server;
let base = "";

before(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (
      url === "/good" ||
      url === "/good2" ||
      url === "/good3" ||
      url === "/good4" ||
      url === "/good5"
    ) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGE);
    } else if (url === "/style.css") {
      response.writeHead(200, { "content-type": "text/css" });
      response.end(CSS);
    } else if (url === "/redirect") {
      response.writeHead(302, { location: "/good" });
      response.end();
    } else if (url === "/error") {
      response.writeHead(500, { "content-type": "text/html" });
      response.end("<html>boom</html>");
    } else if (url === "/pdf") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end("%PDF-1.4");
    } else {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("nope");
    }
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
});

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "design-ref-"));
}

function acquireOptions(dir: string) {
  return { outputDir: dir, allowPrivateHosts: true, screenshots: new NoopScreenshotCapturer() };
}

/** Deterministic stand-in for the governed LLM; returns abstract principles. */
function fakeLlm(responder?: (user: string, call: number) => string): WebsiteFactoryLLM {
  let calls = 0;
  const analysis = {
    client_relationship: "positive_inspiration",
    observed_design_characteristics: ["single dominant headline", "restrained motion"],
    positive_patterns: ["one primary action above the fold"],
    negative_patterns: ["dense competing panels"],
    layout: ["generous section spacing"],
    hierarchy: ["single dominant headline per page"],
    interaction: ["restrained purposeful motion"],
    density: ["moderate prose density"],
    typography: ["editorial display typography"],
    imagery: ["systems diagrams over stock photography"],
    conversion: ["single primary action above the fold"],
    portable_principles: ["technical seriousness without interface density"],
    prohibited_transfers: ["reference copy", "reference palette"],
    differentiation_implications: ["calmer than the reference's demo-heavy sections"],
  };
  return {
    async strategize(_task: unknown, _system: string, user: string) {
      calls += 1;
      return responder ? responder(user, calls) : JSON.stringify(analysis);
    },
    flushUsage: () => [],
  } as unknown as WebsiteFactoryLLM;
}

function spec(
  references: DomainSpec["design_references"],
  vision?: DomainSpec["client_vision"],
): DomainSpec {
  return {
    client_id: "ref-client",
    business_name: "Ref Co",
    vertical: "ai_systems_consulting",
    geography: { states: ["US"], primary_state: "US" },
    design: { status: "pending" },
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    build_intent: "REDESIGN_IMPROVE",
    ...(vision ? { client_vision: vision } : {}),
    design_references: references,
  };
}

function makeCtx(domainSpec: DomainSpec, overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    buildId: `ref-build-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    clientId: domainSpec.client_id,
    domainSpec,
    dryRun: false,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    resume: false,
    llm: fakeLlm(),
    stageResults: new Map(),
    ...overrides,
  } as unknown as BuildContext;
}

/* ---------------- acquisition ------------------------------------ */

void test("one valid client reference is acquired with real evidence and provenance", async () => {
  const dir = outDir();
  const evidence = await acquireDesignReference(
    { reference_id: "northwind", url: `${base}/good` },
    acquireOptions(dir),
  );
  assert.equal(evidence.status, "acquired");
  assert.equal(evidence.http_status, 200);
  assert.match(evidence.content_digest ?? "", /^[0-9a-f]{64}$/);
  assert.ok(evidence.page_path && existsSync(evidence.page_path), "raw page stored as evidence");
  assert.ok(evidence.extracted_path && existsSync(evidence.extracted_path));
  assert.equal(evidence.observed?.hierarchy, "single-h1");
  assert.equal(evidence.observed?.nav_item_count, 3);
  assert.equal(evidence.observed?.conversion_prominence, "single-primary");
  assert.ok(
    evidence.observed?.distinct_font_family_count &&
      evidence.observed.distinct_font_family_count >= 2,
  );
  assert.ok(evidence.copy_guard_terms.some((term) => term.includes("northwind systems")));
  // Observed palette survives only as abstract characteristics — never a color.
  for (const characteristic of evidence.observed?.palette_characteristics ?? []) {
    assert.ok(!/#[0-9a-f]{3,8}/i.test(characteristic));
  }
  rmSync(dir, { recursive: true, force: true });
});

void test("observation is deterministic over identical evidence", () => {
  const extracted = extractPage(PAGE, `${base}/good`);
  const first = observeDesignCharacteristics(PAGE, extracted, CSS);
  const second = observeDesignCharacteristics(PAGE, extractPage(PAGE, `${base}/good`), CSS);
  assert.deepEqual(first, second);
  assert.ok(["static", "restrained-motion", "motion-heavy"].includes(first.motion));
});

void test("a redirecting reference is acquired at its final URL", async () => {
  const dir = outDir();
  const evidence = await acquireDesignReference(
    { reference_id: "redirect", url: `${base}/redirect` },
    acquireOptions(dir),
  );
  assert.equal(evidence.status, "acquired");
  assert.equal(evidence.final_url, `${base}/good`);
  rmSync(dir, { recursive: true, force: true });
});

void test("unreachable, erroring, non-HTML, invalid and forbidden references are typed failures", async () => {
  const dir = outDir();
  const refused = await acquireDesignReference(
    { reference_id: "refused", url: "http://127.0.0.1:9/" },
    acquireOptions(dir),
  );
  assert.equal(refused.status, "unreachable");
  assert.ok(refused.failure_reason);

  const erroring = await acquireDesignReference(
    { reference_id: "error", url: `${base}/error` },
    acquireOptions(dir),
  );
  assert.equal(erroring.status, "unreachable");
  assert.equal(erroring.http_status, 500);

  const pdf = await acquireDesignReference(
    { reference_id: "pdf", url: `${base}/pdf` },
    acquireOptions(dir),
  );
  assert.equal(pdf.status, "not_html");

  const invalid = await acquireDesignReference(
    { reference_id: "invalid", url: "not a url" },
    { outputDir: dir, screenshots: new NoopScreenshotCapturer() },
  );
  assert.equal(invalid.status, "invalid_url");

  // Production policy (no allowPrivateHosts): loopback is an SSRF target.
  const forbidden = await acquireDesignReference(
    { reference_id: "loopback", url: `${base}/good` },
    { outputDir: dir, screenshots: new NoopScreenshotCapturer() },
  );
  assert.equal(forbidden.status, "forbidden_host");

  const noUrl = await acquireDesignReference({ reference_id: "bare" }, acquireOptions(dir));
  assert.equal(noUrl.status, "no_url");
  rmSync(dir, { recursive: true, force: true });
});

/* ---------------- analysis guards -------------------------------- */

function acquiredEvidence(): DesignReferenceEvidence {
  return {
    reference_id: "northwind",
    url: `${base}/good`,
    status: "acquired",
    fetched_at: "2026-09-03T00:00:00.000Z",
    content_digest: "a".repeat(64),
    copy_guard_terms: [
      "northwind systems — serious ai infrastructure",
      "build production systems that actually ship",
    ],
    observed: observeDesignCharacteristics(PAGE, extractPage(PAGE, `${base}/good`), CSS),
  };
}

void test("copy-transfer guard rejects a principle that reproduces reference copy", () => {
  assert.throws(
    () =>
      assertNoReferenceCopyTransfer(
        ["Build production systems that actually ship — as a hero headline"],
        acquiredEvidence().copy_guard_terms,
        "layout",
      ),
    /DESIGN_REFERENCE_ANALYSIS_INVALID.*reproduces reference copy/s,
  );
  assert.doesNotThrow(() =>
    assertNoReferenceCopyTransfer(
      ["single dominant headline per page"],
      acquiredEvidence().copy_guard_terms,
      "layout",
    ),
  );
});

void test("analysis parser rejects raw expression and empty analyses", () => {
  const evidence = acquiredEvidence();
  assert.throws(
    () =>
      parseDesignReferenceAnalysis(
        { client_relationship: "quality_benchmark", typography: ["font-family: Inter"] },
        evidence,
      ),
    /DESIGN_REFERENCE_RAW_TRANSFER/,
  );
  assert.throws(
    () =>
      parseDesignReferenceAnalysis(
        { client_relationship: "quality_benchmark", layout: ["#0b5fff accents"] },
        evidence,
      ),
    /DESIGN_REFERENCE_RAW_TRANSFER/,
  );
  assert.throws(
    () => parseDesignReferenceAnalysis({ client_relationship: "quality_benchmark" }, evidence),
    /derived no principles/,
  );
  assert.throws(
    () => parseDesignReferenceAnalysis({ client_relationship: "fan", layout: ["x"] }, evidence),
    /client_relationship/,
  );
  const parsed = parseDesignReferenceAnalysis(
    {
      client_relationship: "quality_benchmark",
      layout: ["generous spacing"],
      typography: ["editorial"],
    },
    evidence,
  );
  assert.equal(parsed.source, "system_derived");
  assert.match(parsed.analysis_digest, /^[0-9a-f]{64}$/);
  assert.equal(parsed.evidence_digest, "a".repeat(64));
});

/* ---------------- orchestration + merge -------------------------- */

void test("five valid references are all acquired and analyzed; derived principles merge with operator ones", async () => {
  const dir = outDir();
  const declared = resolveDesignReferenceSet(
    spec([
      {
        reference_id: "r1",
        url: `${base}/good`,
        selection_reason: "I like the calm",
        principles: { layout: ["operator layout note"] },
      },
      { reference_id: "r2", url: `${base}/good2`, selection_reason: "polish" },
      { reference_id: "r3", url: `${base}/good3`, selection_reason: "depth" },
      { reference_id: "r4", url: `${base}/good4`, selection_reason: "restraint" },
      { reference_id: "r5", url: `${base}/good5`, selection_reason: "media" },
    ]),
  );
  const manifest = await acquireAndAnalyzeDesignReferences(declared, {
    ...acquireOptions(dir),
    llm: fakeLlm(),
    clientId: "ref-client",
    buildId: "b-five",
    clientContext: { brand_attributes: [], change: [], explicit_constraints: [] },
  });
  assert.deepEqual(manifest.summary, {
    declared: 5,
    with_url: 5,
    acquired: 5,
    failed: 0,
    analyzed: 5,
  });
  assert.ok(existsSync(resolve(dir, "design-reference-acquisition.json")));

  const applied = applyAcquisitionToReferenceSet(declared, manifest);
  assert.equal(applied.provenance.source, "domain_spec+acquisition");
  const r1 = applied.accepted_references.find((reference) => reference.reference_id === "r1")!;
  assert.equal(r1.principle_source, "operator_and_system");
  assert.deepEqual(r1.principles.layout, ["generous section spacing", "operator layout note"]);
  assert.ok(r1.evidence_refs.some((ref) => ref.startsWith("design-reference-evidence:r1:sha256:")));
  // The client's words stay a preference: preserved verbatim, never rewritten into principles.
  assert.equal(r1.selection_reason, "I like the calm");
  assert.ok(!Object.values(r1.principles).flat().includes("I like the calm"));
  const r2 = applied.accepted_references.find((reference) => reference.reference_id === "r2")!;
  assert.equal(r2.principle_source, "system_derived");
  assert.equal(r2.analysis?.client_relationship, "positive_inspiration");

  const intelligence = deriveDesignReferenceIntelligence(applied);
  assert.equal(intelligence.declared, true);
  assert.ok(intelligence.layout_principles.includes("generous section spacing"));
  assert.ok(intelligence.negative_patterns.includes("dense competing panels"));
  rmSync(dir, { recursive: true, force: true });
});

void test("mixed reachable and unreachable references: partial evidence is honest, not fatal", async () => {
  const dir = outDir();
  const declared = resolveDesignReferenceSet(
    spec([
      { reference_id: "ok", url: `${base}/good`, selection_reason: "yes" },
      {
        reference_id: "down",
        url: "http://127.0.0.1:9/",
        selection_reason: "also",
        principles: { positive: ["operator positive"] },
      },
      { reference_id: "words-only", selection_reason: "no url at all" },
    ]),
  );
  const manifest = await acquireAndAnalyzeDesignReferences(declared, {
    ...acquireOptions(dir),
    llm: fakeLlm(),
    clientId: "ref-client",
    buildId: "b-mixed",
    clientContext: { brand_attributes: [], change: [], explicit_constraints: [] },
  });
  assert.deepEqual(manifest.summary, {
    declared: 3,
    with_url: 2,
    acquired: 1,
    failed: 1,
    analyzed: 1,
  });
  const applied = applyAcquisitionToReferenceSet(declared, manifest);
  const down = applied.accepted_references.find((reference) => reference.reference_id === "down")!;
  assert.equal(down.acquisition?.status, "unreachable");
  assert.equal(down.principle_source, "operator_authored");
  assert.deepEqual(down.principles.positive, ["operator positive"]);
  const wordsOnly = applied.accepted_references.find(
    (reference) => reference.reference_id === "words-only",
  )!;
  assert.equal(wordsOnly.acquisition?.status, "no_url");
  assert.equal(wordsOnly.principle_source, "none");
  rmSync(dir, { recursive: true, force: true });
});

void test("a copy-transferring analysis is repaired once, then fails closed", async () => {
  const dir = outDir();
  const declared = resolveDesignReferenceSet(
    spec([{ reference_id: "r", url: `${base}/good`, selection_reason: "x" }]),
  );
  const copying = JSON.stringify({
    client_relationship: "quality_benchmark",
    layout: ["Build production systems that actually ship"],
  });
  let seenRepair = false;
  const repaired = await acquireAndAnalyzeDesignReferences(declared, {
    ...acquireOptions(dir),
    llm: fakeLlm((user, call) => {
      if (call === 1) return copying;
      seenRepair = user.includes("previous response was rejected");
      return JSON.stringify({
        client_relationship: "quality_benchmark",
        layout: ["single dominant headline"],
      });
    }),
    clientId: "ref-client",
    buildId: "b-repair",
    clientContext: { brand_attributes: [], change: [], explicit_constraints: [] },
  });
  assert.equal(seenRepair, true);
  assert.equal(repaired.analyses.length, 1);

  await assert.rejects(
    () =>
      acquireAndAnalyzeDesignReferences(declared, {
        ...acquireOptions(dir),
        llm: fakeLlm(() => copying),
        clientId: "ref-client",
        buildId: "b-repair-2",
        clientContext: { brand_attributes: [], change: [], explicit_constraints: [] },
      }),
    /DESIGN_REFERENCE_ANALYSIS_INVALID/,
  );
  rmSync(dir, { recursive: true, force: true });
});

/* ---------------- stage + downstream consumption ----------------- */

void test("stage: derived reference intelligence reaches the design direction and honors client rejections", async () => {
  const domainSpec = spec(
    [{ reference_id: "north", url: `${base}/good`, selection_reason: "calm and serious" }],
    // The client explicitly rejects one thing the reference exhibits.
    { brand_attributes: ["serious"], change: ["editorial display typography"] },
  );
  const ctx = makeCtx(domainSpec);
  const stage = new DesignReferenceAcquisitionStage({
    allowPrivateHosts: true,
    screenshots: () => new NoopScreenshotCapturer(),
  });
  await stage.run(ctx);
  assert.equal(ctx.clientVision?.declared, true);
  assert.equal(ctx.designReferenceAcquisition?.summary.acquired, 1);
  assert.equal(ctx.designReferenceSet?.accepted_references[0]?.principle_source, "system_derived");
  assert.ok(
    ctx.designReferenceIntelligence?.typography_characteristics.includes(
      "editorial display typography",
    ),
  );

  const direction = resolveDesignDirection({
    clientVision: ctx.clientVision!,
    designReferenceIntelligence: ctx.designReferenceIntelligence!,
    paletteAuthority: { source: "none", tokens: {}, observed_characteristics: [] },
  });
  assert.ok(direction.principles.includes("generous section spacing"));
  assert.ok(direction.desired_attributes.includes("one primary action above the fold"));
  // Rejected by the client → never reintroduced by the reference (WBV2-019).
  assert.ok(!direction.desired_attributes.includes("editorial display typography"));
  assert.ok(direction.rejected_attributes.includes("editorial display typography"));

  // Persistence: the acquisition ledger and the resolved authorities are on disk for this build.
  const dir = resolve(clientAssetRoot(ctx), "redesign-intelligence");
  for (const name of [
    "client-vision",
    "design-reference-acquisition",
    "design-reference-set",
    "design-reference-intelligence",
  ]) {
    assert.ok(existsSync(resolve(dir, `${name}.json`)), `${name}.json persisted`);
  }
  const index = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf-8")) as {
    build_id: string;
  };
  assert.equal(index.build_id, ctx.buildId);
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
});

void test("stage: every URL-bearing reference unreachable fails closed with DESIGN_REFERENCE_UNACQUIRED", async () => {
  const ctx = makeCtx(
    spec([{ reference_id: "down", url: "http://127.0.0.1:9/", selection_reason: "x" }]),
  );
  await assert.rejects(
    () =>
      new DesignReferenceAcquisitionStage({
        allowPrivateHosts: true,
        screenshots: () => new NoopScreenshotCapturer(),
      }).run(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "DESIGN_REFERENCE_UNACQUIRED",
  );
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
});

void test("stage: COPY builds and dry runs never fetch", async () => {
  const copy = makeCtx(
    spec([{ reference_id: "r", url: "http://127.0.0.1:9/", selection_reason: "x" }]),
    { buildIntent: "COPY" },
  );
  await new DesignReferenceAcquisitionStage().run(copy);
  assert.equal(copy.designReferenceSet, undefined);

  const dry = makeCtx(
    spec([{ reference_id: "r", url: "http://127.0.0.1:9/", selection_reason: "x" }]),
    { dryRun: true },
  );
  await new DesignReferenceAcquisitionStage().run(dry);
  assert.equal(dry.designReferenceSet?.provenance.source, "domain_spec");
  assert.equal(dry.designReferenceAcquisition, undefined);
});

void test("competitive intelligence refuses to compile on declared-but-unacquired reference URLs", () => {
  const ctx = makeCtx(
    spec([{ reference_id: "r", url: "https://example.com/", selection_reason: "x" }]),
  );
  assert.throws(
    () => resolveDesignAuthorities(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "DESIGN_REFERENCE_UNACQUIRED",
  );
  // References with no URL need no acquisition: the spec-resolved path stands.
  const wordsOnly = makeCtx(
    spec([
      {
        reference_id: "r",
        selection_reason: "x",
        principles: { layout: ["proof above the fold"] },
      },
    ]),
  );
  const resolved = resolveDesignAuthorities(wordsOnly);
  assert.deepEqual(resolved.designReferenceIntelligence.layout_principles, [
    "proof above the fold",
  ]);
  assert.equal(resolveClientVision(wordsOnly.domainSpec).declared, false);
});
