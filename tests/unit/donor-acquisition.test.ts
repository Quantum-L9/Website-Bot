// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Campaign 7 test matrix C (+ parts of B): the hard ten-donor invariant,
// bounded replacement, exclusion policy, and the minimum evidence policy.

import assert from "node:assert/strict";
import test from "node:test";
import type {
  AcceptedDonorEvidence,
  DonorIngestionRequest,
  DonorIngestor,
} from "../../src/intelligence/DonorIngestion.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  acquireAcceptedDonors,
  donorCandidateUrls,
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
  const accepted = await acquireAcceptedDonors(landscape, new FakeIngestor(() => true), "/tmp/none");
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

void test("donor candidate URLs come from ranked SERP observations plus the site root", () => {
  const landscape = makeLandscape();
  const pool = qualifiedDonorCandidates(landscape);
  const urls = donorCandidateUrls(landscape, pool[0]);
  assert.ok(urls.includes("https://donor-0.example.com/service"));
  assert.ok(urls.includes("https://donor-0.example.com/"));
});
