// L9_META: layer=test, role=unit, status=active, version=1.0.0
// Pins the operator-authored Quantum AI Partners run input (repositioned:
// CRM Transformation + AI RevOps). The normalized IR is committed verbatim as
// the operator supplied it; this test proves the factory's own loader accepts
// it and that the locked logo it names is present and byte-identical.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { validateDomainSpec } from "../../src/pipeline/validateDomainSpec.js";

const SPEC_PATH = "inputs/quantum_ai_partners/domain_spec.normalized.yaml";
const LOCKED_LOGO_SHA256 = "0da4b5b16334950e2fc9bd955ca695b43644c15068761f76bb4e9baa51f89b02";

test("the QAP run input passes the domain-spec loader's validation", () => {
  const spec = validateDomainSpec(parse(readFileSync(SPEC_PATH, "utf-8")), SPEC_PATH);
  assert.equal(spec.client_id, "quantumaipartners_com");
  assert.equal(spec.build_intent, "REDESIGN_IMPROVE");
  assert.deepEqual(
    spec.routes.map((route) => route.slug),
    ["/", "/crm-transformation", "/revops", "/how-it-works", "/contact"],
  );
  assert.equal(spec.assets?.generation?.enabled, false);
});

test("the QAP locked logo is present and byte-identical to the operator master", () => {
  const spec = validateDomainSpec(parse(readFileSync(SPEC_PATH, "utf-8")), SPEC_PATH);
  const logo = spec.assets?.providedImages?.find(
    (image) => image.intendedPlacement === "global:logo",
  );
  assert.ok(logo, "a provided image is placed at global:logo");
  const digest = createHash("sha256").update(readFileSync(logo.path)).digest("hex");
  assert.equal(digest, LOCKED_LOGO_SHA256);
});
