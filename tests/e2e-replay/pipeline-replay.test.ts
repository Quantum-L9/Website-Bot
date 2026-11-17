// L9_META: layer=test, role=e2e_replay_pipeline, status=active, version=1.0.0
//
// CI replay end-to-end: the real CLI (scripts/run-pipeline.ts) runs a
// REDESIGN_IMPROVE build in local-proof mode from the committed spec
// fixtures/replay/replay-spec.yaml to a built, browser-validated site and a
// release receipt — with no access to any API provider:
//
//   SEO-Bot build intelligence  -> loopback server (seo-bot-replay-server.ts)
//                                  over the real undici transports
//   DeepSeek text LLM           -> fixtures/replay/deepseek via replay-preload.mjs
//   Gemini images               -> fixtures/replay/gemini via replay-preload.mjs
//   competitor ("donor") pages  -> fixtures/replay/web via replay-preload.mjs
//
// Every other host is refused, and a refused or unmatched request fails the
// test. Not replayed: the generated site's own `npm install` (package
// registry) and the Playwright Chromium binary, exactly as in the other local
// build tests (CI installs both).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { FileEvidenceStore } from "../../src/pipeline/evidence/FileEvidenceStore.js";
import { startSeoBotReplayServer } from "./seo-bot-replay-server.js";

const REPO = resolve(import.meta.dirname, "..", "..");
const FIXTURES = join(REPO, "fixtures", "replay");
const SPEC = join(FIXTURES, "replay-spec.yaml");
const PRELOAD = join(REPO, "tests", "e2e-replay", "replay-preload.mjs");
const CLIENT_ID = "replay-plumbing";
const BUILD_ID = "replay-build";
const API_KEY = "replay-machine-key";

interface PreloadEntry {
  kind: "replayed" | "unmatched" | "denied";
  host: string;
  path: string;
  fixture?: string;
  via?: string;
}

/** Environment variables passed through from the runner; nothing credential-bearing. */
const PASSTHROUGH = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "PLAYWRIGHT_BROWSERS_PATH",
  "npm_config_cache",
  "NPM_CONFIG_CACHE",
  "npm_config_registry",
  "NPM_CONFIG_REGISTRY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];

function runPipeline(
  env: NodeJS.ProcessEnv,
  args: string[],
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--import", PRELOAD, "scripts/run-pipeline.ts", ...args],
      { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, output }));
  });
}

void test("REDESIGN local-proof replays end-to-end to a built site and a release receipt", {
  timeout: 600_000,
}, async () => {
  const work = mkdtempSync(join(tmpdir(), "wb-e2e-replay-"));
  const evidenceDir = join(work, "evidence");
  const outputDir = join(work, "site");
  const log = join(work, "replay.jsonl");
  // build/assets/<client>/ is cwd-relative pipeline state (incl. the client
  // cache that survives builds); start from none so the run is hermetic.
  const clientAssets = join(REPO, "build", "assets", CLIENT_ID);
  rmSync(clientAssets, { recursive: true, force: true });

  const seoBot = await startSeoBotReplayServer(join(FIXTURES, "seo-bot"), API_KEY);
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const name of PASSTHROUGH) if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, {
      REPLAY_FIXTURES_DIR: FIXTURES,
      REPLAY_LOG: log,
      SEO_BOT_URL: seoBot.url,
      SEO_BOT_API_KEY: API_KEY,
      DEEPSEEK_API_KEY: "replay-not-a-key",
      GEMINI_API_KEY: "replay-not-a-key",
      L9_MEMORY_MODE: "disabled",
      // Defined-but-empty: a developer's .env.local can never switch on live
      // Infisical hydration inside this run.
      INFISICAL_CLIENT_ID: "",
      INFISICAL_CLIENT_SECRET: "",
      INFISICAL_PROJECT_ID: "",
    });

    const { code, output } = await runPipeline(env, [
      "--mode=local-proof",
      "--redesign",
      `--spec=${SPEC}`,
      `--build-id=${BUILD_ID}`,
      `--evidence-dir=${evidenceDir}`,
      `--output-dir=${outputDir}`,
    ]);
    const tail = output.split("\n").slice(-60).join("\n");

    // 1. Nothing left the boundary that a fixture does not answer.
    const entries: PreloadEntry[] = existsSync(log)
      ? readFileSync(log, "utf-8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as PreloadEntry)
      : [];
    const refused = entries.filter((entry) => entry.kind !== "replayed");
    assert.deepEqual(refused, [], `requests outside the replay fixtures:\n${tail}`);

    // 2. The pipeline converged.
    assert.equal(code, 0, `pipeline exited ${String(code)}:\n${tail}`);
    assert.match(output, /Pipeline complete\. Build: replay-build\. Mode: local-proof/);
    const receipt = output.match(/Receipt: (\S+) \((\w+)\)/);
    assert.ok(receipt, `no release receipt reported:\n${tail}`);
    assert.match(output, /Local proof: [0-9a-f]{64}/);

    // 3. SEO-Bot was called once per build-intelligence step, authenticated.
    assert.deepEqual(
      seoBot.requests.map((request) => `${request.method} ${request.path}`),
      [
        // seo-build-intelligence-preflight stage
        "GET /health",
        "GET /api/build-intelligence/preflight",
        // competitive-intelligence re-proves readiness to stamp ordering evidence
        "GET /health",
        "GET /api/build-intelligence/preflight",
        "POST /api/build-intelligence/competitive-landscape",
        "POST /api/build-intelligence/seo-content-blueprint",
        "POST /api/build-intelligence/structured-content",
      ],
    );
    assert.ok(
      seoBot.requests.filter((request) => request.path !== "/health").every((r) => r.authorized),
      "every build-intelligence call carries the machine bearer",
    );

    // 4. Every provider fixture was exercised.
    const used = new Set(entries.map((entry) => entry.fixture));
    for (const kind of ["deepseek", "gemini"]) {
      for (const name of readdirJson(join(FIXTURES, kind))) {
        assert.ok(used.has(name), `${kind} fixture ${name} was never replayed`);
      }
    }

    // 5. The persisted evidence chain is complete and internally consistent.
    const store = new FileEvidenceStore({
      clientId: CLIENT_ID,
      buildId: BUILD_ID,
      mode: "local-proof",
      rootDir: evidenceDir,
    });
    const index = await store.initialize();
    assert.equal(index.chain_status, "released", "the run converged to a released chain");
    const chain = await store.validateChain("local-proof");
    assert.deepEqual(chain.errors, [], "release evidence chain validates");
    assert.equal(chain.valid, true);
    const stored = await store.readReleaseReceipt();
    assert.ok(stored, "release receipt persisted");
    assert.equal(stored.value.receipt_id, receipt[1]);
    assert.equal(stored.value.mode, "local-proof");
    assert.equal(stored.value.client_id, CLIENT_ID);
    assert.equal(stored.value.correlation.all_required_identities_match, true);
    assert.ok(stored.value.evidence.build, "receipt references build evidence");

    // 6. The built site carries the replayed structured content.
    const home = readFileSync(join(outputDir, "dist", "index.html"), "utf-8");
    assert.match(home, /<h1[^>]*>Same-Day Plumbing in Raleigh<\/h1>/);
    assert.ok(existsSync(join(outputDir, "dist", "contact", "index.html")), "contact route built");
  } finally {
    await seoBot.close();
    rmSync(work, { recursive: true, force: true });
  }
});

function readdirJson(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}
