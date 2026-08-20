#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const ROOT = process.cwd();
const casePath =
  process.argv[2] ??
  "tests/golden/safehaven/case.json";
const positiveReceiptPath =
  process.argv[3] ??
  process.env.GOLDEN_POSITIVE_RECEIPT;
const oraclePath =
  process.argv[4] ??
  "tests/golden/safehaven/oracle.json";
const verifierPath =
  process.argv[5] ??
  "scripts/verify-safehaven-golden.mjs";
if (!positiveReceiptPath) {
  console.error(
    "usage: node scripts/verify-safehaven-negative-controls.mjs " +
      "<case.json> <positive-receipt.json> [oracle.json] [verifier]"
  );
  process.exit(2);
}
function readJson(p) {
  return JSON.parse(
    fs.readFileSync(path.resolve(ROOT, p), "utf8")
  );
}
function clone(value) {
  return structuredClone(value);
}
function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}
function first(array, label) {
  ensureArray(array, label);
  if (array.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return array[0];
}
function normalizeRoute(value) {
  if (value === "/") return "/";
  return String(value).replace(/\/+$/, "") || "/";
}
function parseVerifierOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function runVerifier(receiptPath) {
  const execution = spawnSync(
    process.execPath,
    [
      path.resolve(ROOT, verifierPath),
      path.resolve(ROOT, casePath),
      receiptPath,
      path.resolve(ROOT, oraclePath)
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        GOLDEN_CALIBRATION_MODE: "1"
      }
    }
  );
  return {
    exit_code:
      execution.status === null
        ? 255
        : execution.status,
    signal: execution.signal ?? null,
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? "",
    result:
      parseVerifierOutput(execution.stdout)
  };
}
function removeVolatile(result) {
  if (!result) return null;
  const copy = clone(result);
  delete copy.evaluated_at;
  return copy;
}
function setPairVotes(pair, candidateVotes) {
  const trials = ensureArray(
    pair.trials,
    "visual pair trials"
  );
  if (trials.length < 3) {
    throw new Error(
      "negative-control setup requires 3 trials/pair"
    );
  }
  for (let i = 0; i < trials.length; i++) {
    trials[i].normalized_preference =
      i < candidateVotes
        ? "CANDIDATE"
        : "BASELINE";
  }
}
const CONTROLS = [
  {
    id: "NC-01",
    reason: "exact-10 donor invariant",
    mutate(r) {
      ensureArray(
        r.competitive_landscape?.selected_donors,
        "selected donors"
      ).pop();
    }
  },
  {
    id: "NC-02",
    reason: "10 rows are not 10 companies",
    mutate(r) {
      const donors = ensureArray(
        r.competitive_landscape?.selected_donors,
        "selected donors"
      );
      if (donors.length < 2) {
        throw new Error("NC-02 requires >=2 donors");
      }
      donors[1].normalized_domain =
        donors[0].normalized_domain;
    }
  },
  {
    id: "NC-03",
    reason: "excluded domain cannot occupy donor position",
    mutate(r) {
      first(
        r.competitive_landscape?.selected_donors,
        "selected donors"
      ).class = "directory";
    }
  },
  {
    id: "NC-04",
    reason: "donor visual evidence is required",
    mutate(r) {
      first(
        r.donor_evidence,
        "donor evidence"
      ).screenshots = 0;
    }
  },
  {
    id: "NC-05",
    reason: "preflight must precede first SEO build-intelligence call",
    mutate(r) {
      const old =
        ensureArray(r.events, "events");
      const retained =
        old.filter((e) => {
          const name =
            typeof e === "string"
              ? e
              : e?.name;
          return (
            name !==
              "seo-build-intelligence-preflight:PASS" &&
            name !==
              "seo:createCompetitiveLandscape"
          );
        });
      r.events = [
        { name: "seo:createCompetitiveLandscape" },
        {
          name:
            "seo-build-intelligence-preflight:PASS"
        },
        ...retained
      ];
    }
  },
  {
    id: "NC-06",
    reason: "partial SEO blueprint cannot seal",
    mutate(r) {
      ensureArray(
        r.seo_content_blueprint?.routes,
        "SEO routes"
      ).pop();
    }
  },
  {
    id: "NC-07",
    reason: "unknown route violates route authority",
    mutate(r) {
      const routes =
        ensureArray(
          r.seo_content_blueprint?.routes,
          "SEO routes"
        );
      routes[routes.length - 1] =
        "/__oracle_unknown_route__/";
    }
  },
  {
    id: "NC-08",
    reason: "WBB and SCB landscape lineage must match",
    mutate(r) {
      r.seo_content_blueprint
        .competitive_landscape_ref +=
        "-nc08-mismatch";
    }
  },
  {
    id: "NC-09",
    reason: "PCC must be deterministic and zero-LLM",
    mutate(r) {
      r.page_content_contract.llm_calls = 1;
    }
  },
  {
    id: "NC-10",
    reason: "SCP must reference exact PCC",
    mutate(r) {
      r.structured_content
        .page_content_contract_ref +=
        "-nc10";
    }
  },
  {
    id: "NC-11",
    reason: "section.content without blocks must not normalize silently",
    mutate(r) {
      const route =
        first(
          r.structured_content?.route_results,
          "StructuredContent route results"
        );
      route.section_alias_fields = ["content"];
      route.prose_without_blocks = 1;
    }
  },
  {
    id: "NC-12",
    reason: "one-repair budget",
    mutate(r) {
      first(
        r.structured_content?.route_results,
        "StructuredContent route results"
      ).repair_attempts = 2;
    }
  },
  {
    id: "NC-13",
    reason: "legacy content authority forbidden",
    mutate(r) {
      r.legacy.content_generation_calls = 1;
    }
  },
  {
    id: "NC-14",
    reason: "redesign schema must remain deterministic",
    mutate(r) {
      r.legacy.redesign_schema_llm_calls = 1;
    }
  },
  {
    id: "NC-15",
    reason: "authorized required source photos cannot disappear",
    mutate(r) {
      r.assets.eligible_source_project_proof_count = 1;
      r.assets.selected_source_project_proof_count = 0;
      r.website_build_blueprint
        .project_proof_required = true;
    }
  },
  {
    id: "NC-16",
    reason: "competitor assets are evidence only",
    mutate(r) {
      r.assets.donor_asset_hash_matches = 1;
    }
  },
  {
    id: "NC-17",
    reason: "Router policy plane must be version aligned",
    mutate(r) {
      r.identity.seo_bot.llm_router_version =
        `${r.identity.seo_bot.llm_router_version}-drift`;
    }
  },
  {
    id: "NC-18",
    reason: "CONTENT_VALIDATION must not use fresh-search authority",
    mutate(r) {
      first(
        r.llm_audit?.operations
          ?.CONTENT_VALIDATION,
        "CONTENT_VALIDATION audits"
      ).searchRequired = true;
    }
  },
  {
    id: "NC-19",
    reason: "visual QA cannot be skipped",
    mutate(r) {
      r.visual.pairs = [];
    }
  },
  {
    id: "NC-20",
    reason: "candidate must win >=7 visual pair majorities",
    mutate(r) {
      const pairs =
        ensureArray(
          r.visual?.pairs,
          "visual pairs"
        );
      if (pairs.length !== 10) {
        throw new Error(
          "NC-20 requires exactly 10 visual pairs"
        );
      }
      pairs.forEach((pair, index) => {
        setPairVotes(
          pair,
          index < 6 ? 2 : 1
        );
      });
    }
  },
  {
    id: "NC-21",
    reason: "homepage mobile is a protected critical pair",
    mutate(r) {
      const pair =
        ensureArray(
          r.visual?.pairs,
          "visual pairs"
        ).find(
          (p) =>
            normalizeRoute(p.route) === "/" &&
            p.viewport === "mobile"
        );
      if (!pair) {
        throw new Error(
          "NC-21 requires /::mobile pair"
        );
      }
      setPairVotes(pair, 1);
    }
  },
  {
    id: "NC-22",
    reason: "visual hierarchy may not regress",
    mutate(r) {
      const pairs =
        ensureArray(
          r.visual?.pairs,
          "visual pairs"
        );
      for (const pair of pairs) {
        for (const trial of ensureArray(
          pair.trials,
          "visual trials"
        )) {
          trial.normalized_candidate_delta ??= {};
          trial.normalized_candidate_delta
            .visual_hierarchy = -1;
        }
      }
    }
  },
  {
    id: "NC-23",
    reason: "unsupported/prohibited business claim",
    mutate(r) {
      r.business_truth.prohibition_violations = 1;
      r.business_truth.unsupported_claim_count = 1;
    }
  },
  {
    id: "NC-24",
    reason: "all 29 output routes must be reachable",
    mutate(r) {
      r.site.reachable_routes = 28;
    }
  },
  {
    id: "NC-25",
    reason: "command success cannot override a failed oracle property",
    mutate(r) {
      r.run.pipeline_exit_code = 0;
      r.business_truth.unsupported_claim_count = 1;
    }
  }
];
if (CONTROLS.length !== 25) {
  throw new Error(
    `negative-control inventory corrupt: ${CONTROLS.length}`
  );
}
const oracle = readJson(oraclePath);
const positive = readJson(positiveReceiptPath);
const tempDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "safehaven-golden-negative-"
    )
  );
try {
  const base1 = runVerifier(
    path.resolve(ROOT, positiveReceiptPath)
  );
  if (
    base1.exit_code !== 0 ||
    base1.result?.verdict !==
      oracle.final_verdict.pass_name
  ) {
    console.error(
      JSON.stringify(
        {
          schema:
            "l9.golden-negative-control-report/v1",
          verdict:
            "NEGATIVE_CONTROL_CALIBRATION_BLOCKED",
          reason:
            "BASE_RECEIPT_NOT_GOLDEN_PASS",
          base_verification: base1
        },
        null,
        2
      )
    );
    process.exit(1);
  }
  const base2 = runVerifier(
    path.resolve(ROOT, positiveReceiptPath)
  );
  const deterministicReplayPass =
    JSON.stringify(removeVolatile(base1.result)) ===
    JSON.stringify(removeVolatile(base2.result));
  const controls = [];
  for (const control of CONTROLS) {
    const mutated = clone(positive);
    let setupError = null;
    try {
      control.mutate(mutated);
    } catch (error) {
      setupError =
        error instanceof Error
          ? error.message
          : String(error);
    }
    if (setupError) {
      controls.push({
        id: control.id,
        expected: "FAIL",
        rejected: false,
        harness_error: setupError,
        reason: control.reason
      });
      continue;
    }
    const receiptPath =
      path.join(
        tempDir,
        `${control.id}.json`
      );
    fs.writeFileSync(
      receiptPath,
      JSON.stringify(mutated, null, 2) + "\n"
    );
    const execution =
      runVerifier(receiptPath);
    const semanticReject =
      execution.exit_code === 1 &&
      execution.result &&
      execution.result.verdict !==
        oracle.final_verdict.pass_name;
    controls.push({
      id: control.id,
      expected: "FAIL",
      rejected: semanticReject,
      reason: control.reason,
      verifier_exit_code:
        execution.exit_code,
      verifier_verdict:
        execution.result?.verdict ?? null,
      failure_codes:
        [
          ...(
            execution.result
              ?.hard_gate_failures ?? []
          ),
          ...(
            execution.result
              ?.blocking_inconclusive_states ??
            []
          )
        ].map((f) => f.code),
      harness_error:
        execution.result
          ? null
          : (
              execution.stderr.trim() ||
              "verifier emitted no parseable result"
            )
    });
  }
  const rejected =
    controls.filter((c) => c.rejected).length;
  const falseAcceptanceCount =
    controls.filter(
      (c) =>
        c.verifier_exit_code === 0 ||
        c.verifier_verdict ===
          oracle.final_verdict.pass_name
    ).length;
  const harnessErrors =
    controls.filter(
      (c) => c.harness_error
    ).length;
  const pass =
    rejected === 25 &&
    falseAcceptanceCount === 0 &&
    harnessErrors === 0 &&
    deterministicReplayPass;
  const report = {
    schema:
      "l9.golden-negative-control-report/v1",
    oracle_id: oracle.oracle_id,
    positive_control: {
      expected:
        oracle.final_verdict.pass_name,
      actual:
        base1.result.verdict,
      pass: true
    },
    negative_controls_total: 25,
    negative_controls_rejected:
      rejected,
    false_acceptance_count:
      falseAcceptanceCount,
    harness_error_count:
      harnessErrors,
    deterministic_replay_pass:
      deterministicReplayPass,
    controls,
    verdict:
      pass
        ? "GOLDEN_ORACLE_CALIBRATION_PASS"
        : "GOLDEN_ORACLE_CALIBRATION_FAIL"
  };
  console.log(
    JSON.stringify(report, null, 2)
  );
  process.exit(pass ? 0 : 1);
} finally {
  fs.rmSync(
    tempDir,
    {
      recursive: true,
      force: true
    }
  );
}
