// L9_META: layer=test, role=visual_qa_gate, status=active, version=1.0.0
//
// scripts/verify-visual-qa.mjs: a "major" evaluator defect FAILS the run, and
// an authentication wall (Vercel login/SSO) instead of the site FAILS the run
// — neither is ever PASS. Runs in-process with an injected browser and
// evaluator; every site here is synthetic.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

interface Viewport {
  name: string;
  width: number;
  height: number;
}
interface Report {
  status: string;
  reasons: string[];
  coverage: { required: number; captured: number; approved: number };
  captures: Array<{ status: string }>;
  evaluations: Array<{ verdict: string }>;
}
interface QaModule {
  VIEWPORTS: Viewport[];
  isAuthWall(finalUrl: unknown, pageText: unknown): boolean;
  verdictFor(analysis: unknown): string;
  runVisualQa(invocation: object, deps: object): Promise<Report>;
}
const qa = (await import(
  new URL("../../scripts/verify-visual-qa.mjs", import.meta.url).href
)) as QaModule;

const URL_BASE = "https://preview.example.com";
const PASS = JSON.stringify({ verdict: "pass", defects: [], summary: "clean" });
const PASS_WITH_MAJOR = JSON.stringify({
  verdict: "pass",
  defects: [
    { severity: "major", description: "The same filler sentence repeats in four sections." },
  ],
  summary: "Layout fine, copy repeated.",
});

interface Fake {
  fetch?: () => Promise<{
    ok: boolean;
    status: number;
    url?: string;
    text?: () => Promise<string>;
  }>;
  landed?: (url: string) => string;
  text?: string;
  evaluator?: () => Promise<string>;
}

function deps(fake: Fake = {}) {
  return {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetch: fake.fetch ?? (async () => ({ ok: true, status: 200 })),
    launchBrowser: async () => ({
      version: "fake-chromium",
      async open() {
        return {
          goto: async (url: string) => ({ status: 200, url: fake.landed?.(url) ?? url }),
          text: async () => fake.text ?? "Plumbing repairs done right",
          screenshot: async (path: string) => writeFileSync(path, `png:${path}`),
          close: async () => {},
        };
      },
      close: async () => {},
    }),
    loadEvaluator: async () => ({ validateLayout: fake.evaluator ?? (async () => PASS) }),
    now: () => new Date("2026-11-20T00:00:00.000Z"),
  };
}

async function runWith(fake: Fake): Promise<Report> {
  const dir = mkdtempSync(join(tmpdir(), "visual-qa-gate-"));
  try {
    return await qa.runVisualQa(
      {
        url: URL_BASE,
        pages: ["/", "/contact"],
        viewports: qa.VIEWPORTS.slice(0, 2),
        runId: "gate-run",
        reportPath: join(dir, "gate-run", "report.json"),
        clientId: "gate-fixture",
      },
      deps(fake),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("control: a clean site with a clean verdict PASSES", async () => {
  const report = await runWith({});
  assert.equal(report.status, "PASS", report.reasons.join(","));
  assert.equal(report.coverage.approved, report.coverage.required);
});

test("a 'pass' verdict naming a major defect FAILS the run", async () => {
  assert.equal(qa.verdictFor(PASS_WITH_MAJOR), "major");
  const report = await runWith({ evaluator: async () => PASS_WITH_MAJOR });
  assert.equal(report.status, "FAIL");
  assert.ok(report.reasons.includes("MAJOR_FINDING"));
  assert.equal(report.coverage.approved, 0);
});

test("auth walls are recognised by URL and by the rendered text", () => {
  assert.equal(qa.isAuthWall("https://vercel.com/login?next=%2Fsso-api", ""), true);
  assert.equal(qa.isAuthWall("https://vercel.com/sso/example", ""), true);
  assert.equal(qa.isAuthWall("https://site-abc.vercel.app/sso-api?url=x", ""), true);
  assert.equal(
    qa.isAuthWall("https://site-abc.vercel.app/", "Log in to Vercel\nContinue with Email"),
    true,
  );
  assert.equal(qa.isAuthWall("https://site-abc.vercel.app/", "Plumbing repairs done right"), false);
  assert.equal(qa.isAuthWall("https://site-abc.vercel.app/login-tips", "How to log in"), false);
});

test("a redirect to Vercel login FAILS as AUTH_WALL, not PASS", async () => {
  const report = await runWith({ landed: () => "https://vercel.com/login?next=%2Fsso-api" });
  assert.equal(report.status, "FAIL");
  assert.ok(report.reasons.includes("AUTH_WALL"));
  assert.ok(report.captures.every((capture) => capture.status === "auth_wall"));
  assert.equal(report.coverage.captured, 0);
});

test("a 'Log in to Vercel' page served at the requested URL FAILS as AUTH_WALL", async () => {
  const report = await runWith({ text: "Log in to Vercel  Continue with GitHub" });
  assert.equal(report.status, "FAIL");
  assert.ok(report.reasons.includes("AUTH_WALL"));
});

test("deployment protection answering 401 at the probe FAILS as AUTH_WALL", async () => {
  const report = await runWith({ fetch: async () => ({ ok: false, status: 401 }) });
  assert.equal(report.status, "FAIL");
  assert.ok(report.reasons.includes("AUTH_WALL"));
  assert.ok(!report.reasons.includes("TARGET_UNREACHABLE"));
});
