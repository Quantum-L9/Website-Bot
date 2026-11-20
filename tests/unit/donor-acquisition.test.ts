// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Campaign 7 test matrix C (+ parts of B): the hard ten-donor invariant,
// bounded replacement, exclusion policy, and the minimum evidence policy.

import assert from "node:assert/strict";
import { promises as dnsPromises } from "node:dns";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PlaywrightScreenshotCapturer,
  type ScreenshotCapturer,
} from "../../src/ingestion/ScreenshotCapturer.js";
import {
  type AcceptedDonorEvidence,
  type DonorIngestionRequest,
  type DonorIngestor,
  HttpDonorIngestor,
} from "../../src/intelligence/DonorIngestion.js";
import { websiteImproveTask } from "../../src/intelligence/improve-llm-policy.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { createWebsiteFactoryLLM } from "../../src/services/llm.js";
import {
  acquireAcceptedDonors,
  donorCandidateUrls,
  donorNuggetRequest,
  nuggetCopiesPageExcerpt,
  qualifiedDonorCandidates,
  REQUIRED_DONOR_COUNT,
} from "../../src/stages/CompetitiveIntelligenceStage.js";
import { makeDonorEvidence, makeLandscape } from "./redesign-fixtures.js";

class FakeIngestor implements DonorIngestor {
  readonly attempted: string[] = [];
  constructor(private readonly usable: (domain: string) => boolean) {}
  async ingest(request: DonorIngestionRequest): Promise<AcceptedDonorEvidence | null> {
    this.attempted.push(request.domain);
    return this.usable(request.domain) ? makeDonorEvidence(request.domain) : null;
  }
  async close(): Promise<void> {}
}

void test("the production donor invariant is exactly ten", () => {
  assert.equal(REQUIRED_DONOR_COUNT, 10);
});

void test("3 usable donors fail closed with COMPETITIVE_EVIDENCE_INCOMPLETE", async () => {
  const landscape = makeLandscape({
    donorDomains: Array.from({ length: 3 }, (_, i) => `only-${i}.example.com`),
  });
  await assert.rejects(
    () => acquireAcceptedDonors(landscape, new FakeIngestor(() => true), "/tmp/none"),
    (error: unknown) =>
      error instanceof BuildError && error.code === "COMPETITIVE_EVIDENCE_INCOMPLETE",
  );
});

void test("9 usable donors fail closed even when a tenth candidate exists but is unusable", async () => {
  const landscape = makeLandscape();
  const ingestor = new FakeIngestor((domain) => domain !== "donor-9.example.com");
  await assert.rejects(
    () => acquireAcceptedDonors(landscape, ingestor, "/tmp/none"),
    (error: unknown) =>
      error instanceof BuildError && error.code === "COMPETITIVE_EVIDENCE_INCOMPLETE",
  );
});

void test("10 usable donors pass with full evidence and DONOR_REFERENCE_ONLY disposition", async () => {
  const landscape = makeLandscape();
  const accepted = await acquireAcceptedDonors(
    landscape,
    new FakeIngestor(() => true),
    "/tmp/none",
  );
  assert.equal(accepted.length, 10);
  for (const donor of accepted) {
    assert.ok(donor.pages.length >= 1, `${donor.domain} must carry crawl evidence`);
    assert.ok(donor.screenshot_paths.length >= 1, `${donor.domain} must carry screenshot evidence`);
    assert.equal(donor.disposition, "DONOR_REFERENCE_ONLY");
    assert.ok(donor.evidence_digest.length === 64);
  }
});

void test("an unusable candidate is replaced from the ranked pool (bounded replacement)", async () => {
  const landscape = makeLandscape({
    extraDomains: ["replacement-a.example.com", "replacement-b.example.com"],
  });
  const ingestor = new FakeIngestor(
    (domain) => domain !== "donor-2.example.com" && domain !== "donor-5.example.com",
  );
  const accepted = await acquireAcceptedDonors(landscape, ingestor, "/tmp/none");
  assert.equal(accepted.length, 10);
  const domains = accepted.map((donor) => donor.domain);
  assert.ok(!domains.includes("donor-2.example.com"));
  assert.ok(!domains.includes("donor-5.example.com"));
  assert.ok(domains.includes("replacement-a.example.com"));
  assert.ok(domains.includes("replacement-b.example.com"));
});

void test("excluded classes never occupy candidate positions", () => {
  const landscape = makeLandscape({
    excludedDomains: ["yelp.example.com", "facebook.example.com"],
  });
  const pool = qualifiedDonorCandidates(landscape);
  const domains = pool.map((candidate) => candidate.domain);
  assert.ok(!domains.includes("yelp.example.com"));
  assert.ok(!domains.includes("facebook.example.com"));
});

void test("acquisition stops at ten and does not over-crawl the pool", async () => {
  const landscape = makeLandscape({ extraDomains: ["never-reached.example.com"] });
  const ingestor = new FakeIngestor(() => true);
  await acquireAcceptedDonors(landscape, ingestor, "/tmp/none");
  assert.equal(ingestor.attempted.length, 10);
  assert.ok(!ingestor.attempted.includes("never-reached.example.com"));
});

class RecordingCapturer implements ScreenshotCapturer {
  readonly urls: string[] = [];
  async capture(request: { url: string; outputPath: string }): Promise<string> {
    this.urls.push(request.url);
    return request.outputPath;
  }
  async close(): Promise<void> {}
}

function donorRequest(urls: string[]): DonorIngestionRequest {
  return {
    domain: "donor.example",
    candidate_urls: urls,
    serp_observation_ids: ["obs-1"],
    output_dir: mkdtempSync(join(tmpdir(), "donor-guard-")),
    max_pages: 3,
  };
}

void test("donor fetch rejects loopback and a link-local redirect before the body is stored", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://donor.example/")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest" },
      });
    }
    return new Response("<html><body>should not be stored</body></html>", { status: 200 });
  };
  const ingestor = new HttpDonorIngestor(new RecordingCapturer(), {
    fetchImpl,
    resolveHost: async (hostname) =>
      hostname === "donor.example" ? ["93.184.216.34"] : ["127.0.0.1"],
  });
  const redirected = await ingestor.ingest(donorRequest(["https://donor.example/"]));
  assert.equal(redirected, null);
  assert.deepEqual(calls, ["https://donor.example/"]);

  calls.length = 0;
  const loopback = await ingestor.ingest(donorRequest(["http://127.0.0.1/"]));
  assert.equal(loopback, null);
  assert.deepEqual(calls, []);
  await ingestor.close();
});

void test("omitted resolveHost follows DNS and still rejects a loopback answer", async () => {
  const original = dnsPromises.lookup;
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(
      "<html><body>Visible public page text for the donor excerpt.</body></html>",
      {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    );
  };
  const asLookup = (address: string) =>
    (async () => [{ address, family: 4 }]) as unknown as typeof dnsPromises.lookup;
  try {
    dnsPromises.lookup = asLookup("127.0.0.1");
    const blocked = new HttpDonorIngestor(new RecordingCapturer(), { fetchImpl });
    assert.equal(await blocked.ingest(donorRequest(["https://donor.example/"])), null);
    assert.deepEqual(calls, []);
    await blocked.close();

    calls.length = 0;
    dnsPromises.lookup = asLookup("93.184.216.34");
    const allowed = new HttpDonorIngestor(new RecordingCapturer(), { fetchImpl });
    const evidence = await allowed.ingest(donorRequest(["https://donor.example/"]));
    assert.ok(evidence);
    assert.deepEqual(calls, ["https://donor.example/"]);
    await allowed.close();
  } finally {
    dnsPromises.lookup = original;
  }
});

void test("a public https donor keeps a bounded excerpt and screenshots that URL", async () => {
  const capturer = new RecordingCapturer();
  const fetchImpl: typeof fetch = async () =>
    new Response("<html><body><h1>Hero headline for the layout</h1></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  const ingestor = new HttpDonorIngestor(capturer, {
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
  });
  const evidence = await ingestor.ingest(donorRequest(["https://donor.example/service"]));
  assert.ok(evidence);
  assert.match(evidence.pages[0]?.content_excerpt ?? "", /Hero headline for the layout/);
  assert.match(evidence.pages[0]?.content_digest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(capturer.urls[0], "https://donor.example/service");
  await ingestor.close();
});

void test("donor excerpt drops script text when the end tag contains a space", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      "<html><body><script>secretToken</script >Visible offer for the donor page</body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  const ingestor = new HttpDonorIngestor(new RecordingCapturer(), {
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
  });
  const evidence = await ingestor.ingest(donorRequest(["https://donor.example/service"]));
  assert.ok(evidence);
  const excerpt = evidence.pages[0]?.content_excerpt ?? "";
  assert.equal(excerpt.includes("secretToken"), false);
  assert.match(excerpt, /Visible offer for the donor page/);
  await ingestor.close();
});

void test("a pdf response is not donor page evidence", async () => {
  const calls: string[] = [];
  const capturer = new RecordingCapturer();
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response("%PDF-1.7", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  };
  const ingestor = new HttpDonorIngestor(capturer, {
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
  });
  const evidence = await ingestor.ingest(donorRequest(["https://donor.example/file"]));
  assert.equal(evidence, null);
  assert.deepEqual(capturer.urls, []);
  await ingestor.close();
});

void test("a screenshot that leaves the donor host is not recorded", async () => {
  const capturer = new PlaywrightScreenshotCapturer(async () => ({
    async goto() {},
    url: () => "https://evil.example/phish",
    async screenshot() {
      throw new Error("screenshot must not be written off-host");
    },
    async close() {},
  }));
  const recorded = await capturer.capture({
    url: "https://donor.example/service",
    outputPath: join(tmpdir(), "off-host.png"),
  });
  assert.equal(recorded, undefined);
  await capturer.close();
});

void test("nugget extraction sends the page excerpt and screenshot, and rejects a verbatim copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nugget-evidence-"));
  const shot = join(dir, "home.png");
  writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const excerpt =
    "Visible homepage excerpt that must stay out of the sealed nugget evidence field.";
  const donor = makeDonorEvidence("donor-0.example.com");
  donor.pages[0] = { ...donor.pages[0], content_excerpt: excerpt };
  donor.screenshot_paths = [shot];
  const request = donorNuggetRequest(donor);
  assert.match(request.prompt, /Visible homepage excerpt/);
  assert.equal(request.prompt.includes("digests only"), false);
  assert.deepEqual(request.images, [shot]);
  assert.equal(nuggetCopiesPageExcerpt(excerpt, donor.pages), true);
  assert.equal(
    nuggetCopiesPageExcerpt("A reusable hero slot sits above the primary action.", donor.pages),
    false,
  );
  const tail = excerpt.slice(-48);
  assert.equal(nuggetCopiesPageExcerpt(tail, donor.pages), true);
  assert.equal(
    nuggetCopiesPageExcerpt(
      {
        evidence: "An abstract slot above the primary action.",
        invariant: tail,
      },
      donor.pages,
    ),
    true,
  );

  let body = "";
  const previousMemory = process.env.L9_MEMORY_MODE;
  process.env.L9_MEMORY_MODE = "disabled";
  const llm = createWebsiteFactoryLLM("client-a", {
    env: { DEEPSEEK_API_KEY: "test-key", L9_MEMORY_MODE: "disabled" },
    transport: async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: '{"nuggets":[]}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await llm.strategize(
    websiteImproveTask("DONOR_NUGGET_EXTRACTION", "client-a", "nugget evidence"),
    "Return abstract invariants.",
    request.prompt,
    request.images,
  );
  assert.match(body, /image_url/);
  assert.match(body, /Visible homepage excerpt/);
  if (previousMemory === undefined) delete process.env.L9_MEMORY_MODE;
  else process.env.L9_MEMORY_MODE = previousMemory;
});

void test("donor candidate URLs put the site root ahead of deeper ranked observations", () => {
  const landscape = makeLandscape();
  const pool = qualifiedDonorCandidates(landscape);
  const urls = donorCandidateUrls(landscape, pool[0]);
  assert.equal(urls[0], "https://donor-0.example.com/");
  const deeper = urls.indexOf("https://donor-0.example.com/service");
  assert.ok(deeper > 0);
});
