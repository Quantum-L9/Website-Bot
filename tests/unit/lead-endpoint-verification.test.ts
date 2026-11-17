// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import {
  LEAD_TEST_MARKER,
  LeadEndpointVerificationStage,
  leadCaptureDigest,
  verifiedLeadFormAction,
} from "../../src/stages/LeadEndpointVerificationStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const ACTION = "https://forms.example.com/f/abc123";
const NOW = () => new Date("2026-07-20T00:00:05.000Z");

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  };
  return { impl, calls };
}

function contextWithAction(action: string | undefined): BuildContext {
  const ctx = fixtureContext();
  ctx.domainSpec.seo_contract = {
    ...(ctx.domainSpec.seo_contract ?? {}),
    ...(action ? { lead_form_action: action } : {}),
  };
  return ctx;
}

void test("a 2xx test submission verifies the exact configured action", async () => {
  const ctx = contextWithAction(ACTION);
  const fetch = fakeFetch(() => new Response("{}", { status: 200 }));
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    const verification = ctx.leadCaptureVerification;
    assert.equal(verification?.status, "verified");
    assert.equal(verification?.method, "test_submission");
    assert.equal(verification?.endpointOrigin, "https://forms.example.com");
    assert.equal(verification?.httpStatus, 200);
    const { digest, ...body } = verification ?? ({} as never);
    assert.equal(digest, leadCaptureDigest(body));
    // The submission is marked as a test and goes only to the configured action.
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0]?.url, ACTION);
    assert.equal(fetch.calls[0]?.init?.method, "POST");
    const headers = fetch.calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers["X-Website-Bot-Test"], "true");
    const form = new URLSearchParams(String(fetch.calls[0]?.init?.body));
    assert.equal(form.get("website_bot_test"), "true");
    assert.match(form.get("message") ?? "", new RegExp(LEAD_TEST_MARKER));
    // Evidence is persisted beside the evidence store, not into published source.
    const evidencePath = join(ctx.evidenceStore.rootDir, "lead-capture-verification.json");
    assert.ok(existsSync(evidencePath));
    assert.equal(JSON.parse(readFileSync(evidencePath, "utf-8")).digest, digest);
    assert.equal(existsSync(join(ctx.outputDir, ".l9/lead-capture-verification.json")), false);
    // CTA shown with passing verification.
    assert.equal(verifiedLeadFormAction(ctx, ACTION), ACTION);
  } finally {
    cleanupContext(ctx);
  }
});

void test("a redirect to a thank-you page counts as acceptance", async () => {
  const ctx = contextWithAction(ACTION);
  const fetch = fakeFetch(
    () => new Response(null, { status: 303, headers: { location: "https://example.com/thanks" } }),
  );
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "verified");
    assert.equal(fetch.calls[0]?.init?.redirect, "manual");
  } finally {
    cleanupContext(ctx);
  }
});

void test("a rejected test submission fails closed and hides the CTA", async () => {
  const ctx = contextWithAction(ACTION);
  const fetch = fakeFetch(() => new Response("nope", { status: 422 }));
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "failed");
    assert.equal(ctx.leadCaptureVerification?.httpStatus, 422);
    assert.equal(verifiedLeadFormAction(ctx, ACTION), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("an unreachable endpoint fails closed", async () => {
  const ctx = contextWithAction(ACTION);
  const fetch = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "failed");
    assert.match(ctx.leadCaptureVerification?.reason ?? "", /unreachable/);
    assert.equal(verifiedLeadFormAction(ctx, ACTION), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("a hung endpoint times out instead of blocking the build", async () => {
  const ctx = contextWithAction(ACTION);
  const fetch = fakeFetch(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        call.init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW, 5).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "failed");
    assert.match(ctx.leadCaptureVerification?.reason ?? "", /did not answer/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("a non-HTTPS action is never contacted and never rendered", async () => {
  const action = "http://forms.example.com/f/abc123";
  const ctx = contextWithAction(action);
  const fetch = fakeFetch(() => new Response("{}", { status: 200 }));
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "failed");
    assert.equal(fetch.calls.length, 0);
    assert.equal(verifiedLeadFormAction(ctx, action), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("no configured action records not_configured without network", async () => {
  const ctx = contextWithAction(undefined);
  const fetch = fakeFetch(() => new Response("{}", { status: 200 }));
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "not_configured");
    assert.equal(fetch.calls.length, 0);
    assert.equal(verifiedLeadFormAction(ctx, undefined), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("plan and dry-run send nothing and verify nothing", async () => {
  const ctx = contextWithAction(ACTION);
  ctx.dryRun = true;
  const fetch = fakeFetch(() => new Response("{}", { status: 200 }));
  try {
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(ctx.leadCaptureVerification?.status, "skipped");
    assert.equal(fetch.calls.length, 0);
    assert.equal(verifiedLeadFormAction(ctx, ACTION), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("CTA hidden without any verification, or for a different action", async () => {
  const ctx = contextWithAction(ACTION);
  const fetch = fakeFetch(() => new Response("{}", { status: 200 }));
  try {
    assert.equal(verifiedLeadFormAction(ctx, ACTION), undefined);
    await new LeadEndpointVerificationStage(fetch.impl, NOW).run(ctx);
    assert.equal(verifiedLeadFormAction(ctx, "https://forms.example.com/f/other"), undefined);
  } finally {
    cleanupContext(ctx);
  }
});
