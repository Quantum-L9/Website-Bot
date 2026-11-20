// L9_META: layer=test, role=readiness_ladder_contract, status=active, version=1.0.0
//
// Readiness ladder contract (L9-ASSURANCE-001, L9-EVIDENCE-001): six distinct
// levels, each judged on its own evidence. A level nothing observed is
// NOT_RUN with a reason, never PASS, and no level is inferred from another.
// The release receipt carries the ladder; its JSON Schema and the TypeScript
// validator agree on the levels and states.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildReadinessLadder,
  READINESS_LEVELS,
  type ReadinessLadder,
  readinessState,
  validateReadinessLadder,
} from "../../src/pipeline/evidence/ReadinessLadder.js";
import {
  type ReleaseReceipt,
  validateReleaseReceipt,
} from "../../src/pipeline/evidence/ReleaseReceipt.js";

test("the ladder records all six levels in order, unobserved ones NOT_RUN with a reason", () => {
  const ladder = buildReadinessLadder();
  assert.deepEqual(
    ladder.levels.map((entry) => entry.level),
    [
      "structural_ci",
      "replay_quality_gate",
      "live_provider_canary",
      "client_build_quality_check",
      "blind_judge_vs_baseline",
      "operator_deploy_approval",
    ],
  );
  for (const entry of ladder.levels) {
    assert.equal(entry.state, "NOT_RUN", entry.level);
    assert.equal(entry.evidence_ref, null);
    assert.ok(entry.reason?.trim(), `${entry.level} names why it did not run`);
  }
  validateReadinessLadder(ladder);
});

test("a higher level is never inferred from a lower one", () => {
  const ladder = buildReadinessLadder({
    structural_ci: { state: "PASS", evidence_ref: "https://ci.example/run/1" },
    replay_quality_gate: { state: "PASS", evidence_ref: "site-quality-report.json" },
    client_build_quality_check: { state: "PASS", evidence_ref: "quality/report.json" },
  });
  assert.equal(readinessState(ladder, "client_build_quality_check"), "PASS");
  for (const level of [
    "live_provider_canary",
    "blind_judge_vs_baseline",
    "operator_deploy_approval",
  ] as const)
    assert.equal(readinessState(ladder, level), "NOT_RUN", level);
  validateReadinessLadder(ladder);
});

test("each state keeps its own evidence rule", () => {
  const withLevel = (index: number, patch: Record<string, unknown>): ReadinessLadder => {
    const ladder = buildReadinessLadder();
    ladder.levels[index] = { ...ladder.levels[index], ...patch } as ReadinessLadder["levels"][0];
    return ladder;
  };
  assert.throws(
    () =>
      validateReadinessLadder(
        withLevel(4, { state: "PASS", evidence_ref: null, reason: undefined }),
      ),
    /blind_judge_vs_baseline is PASS without an evidence reference/,
  );
  assert.throws(
    () => validateReadinessLadder(withLevel(0, { state: "FAIL", evidence_ref: "  " })),
    /structural_ci evidence_ref must be a non-empty string or null/,
  );
  assert.throws(
    () => validateReadinessLadder(withLevel(5, { state: "BLOCKED", reason: undefined })),
    /operator_deploy_approval is BLOCKED without a reason/,
  );
  assert.throws(
    () => validateReadinessLadder(withLevel(2, { state: "READY" })),
    /live_provider_canary state "READY" is invalid/,
  );
  assert.doesNotThrow(() =>
    validateReadinessLadder(
      withLevel(4, { state: "FAIL", evidence_ref: "quality-judge/report.json", reason: undefined }),
    ),
  );
});

test("levels cannot be dropped, duplicated, reordered or collapsed", () => {
  const ladder = buildReadinessLadder();
  assert.throws(
    () => validateReadinessLadder({ ...ladder, levels: ladder.levels.slice(1) }),
    /must record all 6 levels/,
  );
  const swapped = [...ladder.levels];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]] as [
    (typeof swapped)[number],
    (typeof swapped)[number],
  ];
  assert.throws(
    () => validateReadinessLadder({ ...ladder, levels: swapped }),
    /level 3 must be client_build_quality_check/,
  );
  assert.throws(
    () => validateReadinessLadder({ ...ladder, schema: "website-bot.readiness-ladder/v0" }),
    /identity is invalid/,
  );
});

function receipt(readiness?: unknown): ReleaseReceipt {
  const reference = (kind: "assembly" | "build", character: string) => ({
    kind,
    schema: `website-bot.${kind}/v1`,
    logical_id: `${kind}-1`,
    relative_path: `${kind}.json`,
    sha256: character.repeat(64),
  });
  return {
    schema: "website-bot.release-receipt/v2",
    receipt_id: "receipt_1234567890abcdef",
    build_id: "build-1",
    client_id: "client-1",
    mode: "local-proof",
    status: "partial",
    missing_gates: ["github_publication", "vercel_deployment"],
    evidence: { assembly: reference("assembly", "a"), build: reference("build", "b") },
    correlation: { source_digest: "1".repeat(64), all_required_identities_match: true },
    qa: { seo_baseline: "skipped", visual_qa: "skipped" },
    ...(readiness === undefined ? {} : { readiness: readiness as ReleaseReceipt["readiness"] }),
    created_at: "2026-11-20T00:00:00.000Z",
  };
}

test("the release receipt carries a valid ladder and rejects a malformed one", () => {
  assert.doesNotThrow(() => validateReleaseReceipt(receipt(buildReadinessLadder())));
  // Receipts persisted before the ladder existed still load.
  assert.doesNotThrow(() => validateReleaseReceipt(receipt()));
  const forged = buildReadinessLadder();
  forged.levels[4] = { level: "blind_judge_vs_baseline", state: "PASS", evidence_ref: null };
  assert.throws(
    () => validateReleaseReceipt(receipt(forged)),
    /release receipt readiness blind_judge_vs_baseline is PASS without an evidence reference/,
  );
});

test("the receipt JSON Schema declares the same levels and states", () => {
  interface LadderSchema {
    properties: {
      schema: { const: string };
      levels: {
        items: unknown;
        prefixItems: Array<{ allOf: Array<{ properties?: { level?: { const: string } } }> }>;
      };
    };
  }
  interface EntrySchema {
    properties: { state: { enum: string[] }; level: { enum: string[] } };
  }
  const schema = JSON.parse(readFileSync("schemas/release-receipt.schema.json", "utf-8")) as {
    properties: Record<string, unknown>;
    $defs: { readiness_ladder: LadderSchema; readiness_entry: EntrySchema };
  };
  assert.deepEqual(schema.properties.readiness, { $ref: "#/$defs/readiness_ladder" });
  const ladder = schema.$defs.readiness_ladder;
  assert.equal(ladder.properties.schema.const, "website-bot.readiness-ladder/v1");
  assert.deepEqual(
    ladder.properties.levels.prefixItems.map((item) => item.allOf[1]?.properties?.level?.const),
    [...READINESS_LEVELS],
  );
  assert.equal(ladder.properties.levels.items, false);
  const entry = schema.$defs.readiness_entry;
  assert.deepEqual(entry.properties.state.enum, ["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);
  assert.deepEqual(entry.properties.level.enum, [...READINESS_LEVELS]);
});
