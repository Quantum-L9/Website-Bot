// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  collectWebsiteBotConfigErrors,
  resolveProfileRun,
  UNIMPLEMENTED_SITE_PROFILES,
  WEBSITE_BOT_VALIDATION_PROFILES,
} from "../../scripts/lib/validation-profiles.mjs";

const PACKAGE_VERIFY_PROFILE_SCRIPTS = [
  "verify:preflight",
  "verify:source",
  "verify:build",
  "verify:smoke",
  "verify:form",
  "verify:analytics",
  "verify:crm",
  "verify:seo",
  "verify:rollback",
] as const;

void test("package.json verify:* profiles are in the Website-Bot SSOT allowlist", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const scriptName of PACKAGE_VERIFY_PROFILE_SCRIPTS) {
    assert.ok(pkg.scripts?.[scriptName], `missing package script ${scriptName}`);
    const profile = scriptName.replace(/^verify:/, "");
    assert.ok(
      WEBSITE_BOT_VALIDATION_PROFILES.includes(profile),
      `${profile} from ${scriptName} must be in WEBSITE_BOT_VALIDATION_PROFILES`,
    );
    const errors = collectWebsiteBotConfigErrors({ profile, timeout: "300000" });
    assert.equal(errors.length, 0, `config boundary must accept ${profile}: ${errors.join("; ")}`);
  }
});

void test("resolveProfileRun returns RUN for implemented profiles and default", () => {
  for (const profile of ["default", "preflight", "source", "build", "smoke"]) {
    const result = resolveProfileRun(profile);
    assert.equal(result.status, "RUN");
    assert.equal(result.exitCode, 0);
    assert.equal(result.nonEvidence, false);
  }
});

void test("resolveProfileRun returns INCOMPLETE non-evidence for unimplemented site profiles", () => {
  for (const profile of UNIMPLEMENTED_SITE_PROFILES) {
    const result = resolveProfileRun(profile);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.exitCode, 2);
    assert.equal(result.nonEvidence, true);
    assert.equal(result.reason, "site_level_validation_unimplemented");
  }
});

void test("resolveProfileRun rejects unknown profiles", () => {
  const result = resolveProfileRun("ci");
  assert.equal(result.status, "INVALID_PROFILE");
  assert.equal(result.exitCode, 1);
  assert.equal(result.nonEvidence, true);
});

void test("collectWebsiteBotConfigErrors rejects env-named profile values", () => {
  for (const profile of ["ci", "development", "staging", "production", "test", "factory", "site"]) {
    const errors = collectWebsiteBotConfigErrors({ profile, timeout: "300000" });
    assert.ok(
      errors.some((e: string) => e.includes("Unknown Website-Bot profile")),
      profile,
    );
  }
});

void test("spawned unimplemented profiles exit 2 with INCOMPLETE non_evidence markers", () => {
  for (const profile of UNIMPLEMENTED_SITE_PROFILES) {
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/validation-executor.ts", "run", "--profile", profile],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: { ...process.env, npm_config_yes: "true" },
      },
    );
    assert.equal(result.status, 2, `${profile} exit code; stderr=${result.stderr}`);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /INCOMPLETE/);
    assert.match(out, /non_evidence/);
    assert.doesNotMatch(out, /Verdict: PASS/);
  }
});
