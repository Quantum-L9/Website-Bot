#!/usr/bin/env node
/**
 * §SEO-BOT SEAM COLLECTOR — persists SEO-Bot's in-memory build-intelligence
 * evidence into the run evidence store so the receipt adapter can project it.
 *
 * The Website-Bot runtime seals bot-interop artifacts but persists only
 * artifact_id + payload_digest in the redesign-integrity-receipt; the sealed
 * payloads live in SEO-Bot memory. This collector is the run wrapper's seam:
 *
 *   node scripts/golden-safehaven/collect-seo-bot-evidence.mjs \
 *     --client-id safehaven \
 *     --build-id <buildId> \
 *     --evidence-dir build/evidence/<client>/<buildId> \
 *     --case tests/golden/safehaven/case.json \
 *     --landscape-request /path/competitive-landscape.request.json \
 *     [--blueprint-request ...] [--structured-request ...] [--out <dir>]
 *
 * Env:  SEO_BOT_URL       base URL of the SEO-Bot service
 *       SEO_BOT_API_KEY   bearer token for /api/build-intelligence/*
 *       SEOBOT_CHECKOUT_DIR  (optional) SEO-Bot git checkout for its SHA
 *
 * Behavior:
 *  - GET  /health                       (reachability only)
 *  - GET  /api/build-intelligence/preflight
 *  - POST /api/build-intelligence/competitive-landscape  (when request file
 *        given) — the wrapper forwards the exact request bodies the runtime
 *        used; without a request file the endpoint is recorded SKIPPED.
 *  - POST /api/build-intelligence/seo-content-blueprint  (request file)
 *  - POST /api/build-intelligence/structured-content     (request file)
 *  - Records an identity snapshot (Website-Bot git HEAD, package versions,
 *    worktree state) — the runtime itself never persists its own SHA.
 *
 * Missing SEO_BOT_URL / SEO_BOT_API_KEY is NOT an error: the collector
 * writes missing.json + a sequence marked SKIPPED so the adapter can emit
 * explicit adapter.missing_producer: SEO_BOT_* entries. Nothing is
 * fabricated; no HTTP call is attempted without both env vars.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1];
}

const clientId = arg("client-id");
const buildId = arg("build-id");
const evidenceDir = arg("evidence-dir");
const casePath = arg("case");
const outArg = arg("out");
const requests = {
  landscape: arg("landscape-request"),
  blueprint: arg("blueprint-request"),
  structured: arg("structured-request"),
};
const seoBotCheckout = arg("seo-bot-checkout") ?? process.env.SEOBOT_CHECKOUT_DIR ?? null;

if (!clientId || !buildId || !evidenceDir || !casePath) {
  console.error(
    "usage: node scripts/golden-safehaven/collect-seo-bot-evidence.mjs --client-id <id> --build-id <id> --evidence-dir <dir> --case <case.json> [--landscape-request <json>] [--blueprint-request <json>] [--structured-request <json>] [--out <dir>] [--seo-bot-checkout <dir>]",
  );
  process.exit(2);
}

const outDir = outArg ? path.resolve(outArg) : path.resolve(evidenceDir, "seo-bot");
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = process.env.SEO_BOT_URL ?? null;
const apiKey = process.env.SEO_BOT_API_KEY ?? null;

// ---------- identity snapshot (Website-Bot checkout identity) ----------
function gitOutput(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
function readJsonOrNull(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function identitySnapshot() {
  const root = path.resolve(".");
  const head = gitOutput(["rev-parse", "HEAD"], root);
  const porcelain = gitOutput(["status", "--porcelain"], root);
  const pkg = readJsonOrNull(path.join(root, "package.json"));
  const routerPkg = readJsonOrNull(path.join(root, "node_modules/@quantum-l9/llm-router/package.json"));
  const interopPkg = readJsonOrNull(path.join(root, "node_modules/@quantum-l9/bot-interop/package.json"));
  const seoBotHead = seoBotCheckout ? gitOutput(["rev-parse", "HEAD"], seoBotCheckout) : null;
  // worktree_state per repository: null when the dir is not a git checkout
  // (installed npm packages usually are not) — the adapter fails closed on
  // null, never defaulting a state.
  const seoBotPorcelain = seoBotCheckout ? gitOutput(["status", "--porcelain"], seoBotCheckout) : null;
  const routerDir = path.join(root, "node_modules/@quantum-l9/llm-router");
  const routerPorcelain = gitOutput(["status", "--porcelain"], routerDir);
  const routerHead = gitOutput(["rev-parse", "HEAD"], routerDir);
  const worktreeState = (p) => (p === null ? null : p === "" ? "CLEAN" : `DIRTY:${p.split("\n").length} paths`);
  const snapshot = {
    schema: "website-bot.golden-identity-snapshot/v1",
    captured_at: new Date().toISOString(),
    website_bot: {
      sha: head ?? null,
      worktree_state: worktreeState(porcelain),
      package_version: pkg?.version ?? null,
    },
    llm_router: {
      package_version: routerPkg?.version ?? null,
      sha: routerHead ?? null,
      worktree_state: worktreeState(routerPorcelain),
    },
    bot_interop: { website_bot_version: interopPkg?.version ?? null },
    seo_bot: {
      sha: seoBotHead ?? null,
      checkout_dir: seoBotCheckout,
      worktree_state: worktreeState(seoBotPorcelain),
    },
  };
  return snapshot;
}

// ---------- collection ----------
const sequence = {
  schema: "website-bot.golden-seo-bot-collection/v1",
  client_id: clientId,
  build_id: buildId,
  collected_at: new Date().toISOString(),
  entries: [],
  missing_producers: [],
};

function record(endpoint, file, status, httpStatus = null, note = null) {
  const entry = { endpoint, file, status };
  if (httpStatus !== null) entry.http_status = httpStatus;
  if (note) entry.note = note;
  sequence.entries.push(entry);
}

function missingEnv(name) {
  return { field_group: "SEO_BOT", producer: name, reason: `${name} is not set in the environment` };
}

async function httpJson(method, urlPath, body) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { http_status: res.status, ok: res.ok, payload };
}

async function saveResponse(endpoint, file, response) {
  fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(response.payload ?? {}, null, 2)}\n`);
  return response.ok ? "PASS" : "FAIL";
}

const fetchMeta = {};

async function run() {
  fs.writeFileSync(path.join(outDir, "identity-snapshot.json"), `${JSON.stringify(identitySnapshot(), null, 2)}\n`);
  sequence.entries.push({
    endpoint: "identity-snapshot",
    file: "identity-snapshot.json",
    status: "PASS",
    note: "local Website-Bot checkout identity captured",
  });

  if (!baseUrl || !apiKey) {
    if (!baseUrl) sequence.missing_producers.push(missingEnv("SEO_BOT_URL"));
    if (!apiKey) sequence.missing_producers.push(missingEnv("SEO_BOT_API_KEY"));
    for (const [name, p] of [
      ["preflight", "/api/build-intelligence/preflight"],
      ["competitive-landscape", "/api/build-intelligence/competitive-landscape"],
      ["seo-content-blueprint", "/api/build-intelligence/seo-content-blueprint"],
      ["structured-content", "/api/build-intelligence/structured-content"],
    ]) {
      record(name, `${name}.json`, "SKIPPED", null, "SEO_BOT_URL/SEO_BOT_API_KEY missing");
    }
    fs.writeFileSync(
      path.join(outDir, "missing.json"),
      `${JSON.stringify(
        {
          schema: "website-bot.golden-seo-bot-missing/v1",
          entries: sequence.missing_producers,
        },
        null,
        2,
      )}\n`,
    );
    writeSequence();
    console.warn(`collect-seo-bot-evidence: SEO_BOT_URL/SEO_BOT_API_KEY missing; recorded ${sequence.missing_producers.length} missing producers`);
    return;
  }

  // health
  try {
    const h = await httpJson("GET", "/health");
    fetchMeta.health = { endpoint: "/health", http_status: h.http_status, ok: h.ok, reached: true };
    record("health", "health.json", h.ok ? "PASS" : "FAIL", h.http_status);
    fs.writeFileSync(path.join(outDir, "health.json"), `${JSON.stringify(h.payload ?? {}, null, 2)}\n`);
  } catch (err) {
    fetchMeta.health = { endpoint: "/health", reached: false, error: String(err?.cause ?? err) };
    record("health", "health.json", "FAIL", null, "unreachable");
  }

  // preflight (mandatory when env present)
  try {
    const p = await httpJson("GET", "/api/build-intelligence/preflight");
    fetchMeta.preflight = { endpoint: "/api/build-intelligence/preflight", http_status: p.http_status, ok: p.ok, reached: true };
    const status = await saveResponse("preflight", "preflight.json", p);
    record("preflight", "preflight.json", status, p.http_status);
  } catch (err) {
    fetchMeta.preflight = { endpoint: "/api/build-intelligence/preflight", reached: false, error: String(err?.cause ?? err) };
    record("preflight", "preflight.json", "FAIL", null, "unreachable");
  }

  // the three build-intelligence endpoints (request files from the run wrapper)
  const endpointDefs = [
    ["competitive-landscape", "/api/build-intelligence/competitive-landscape", requests.landscape],
    ["seo-content-blueprint", "/api/build-intelligence/seo-content-blueprint", requests.blueprint],
    ["structured-content", "/api/build-intelligence/structured-content", requests.structured],
  ];
  for (const [name, urlPath, reqFile] of endpointDefs) {
    if (!reqFile) {
      fetchMeta[name] = { endpoint: urlPath, attempted: false };
      record(name, `${name}.json`, "SKIPPED", null, `no --${name.replace("-", "-")}-request file supplied`);
      continue;
    }
    let body;
    try {
      body = JSON.parse(fs.readFileSync(path.resolve(reqFile), "utf8"));
    } catch (err) {
      record(name, `${name}.json`, "FAIL", null, `unreadable request file: ${err.message}`);
      continue;
    }
    try {
      const r = await httpJson("POST", urlPath, body);
      fetchMeta[name] = { endpoint: urlPath, http_status: r.http_status, ok: r.ok, reached: true };
      const status = await saveResponse(name, `${name}.json`, r);
      record(name, `${name}.json`, status, r.http_status);
    } catch (err) {
      fetchMeta[name] = { endpoint: urlPath, reached: false, error: String(err?.cause ?? err) };
      record(name, `${name}.json`, "FAIL", null, "unreachable");
    }
  }

  fs.writeFileSync(path.join(outDir, "fetch-meta.json"), `${JSON.stringify(fetchMeta, null, 2)}\n`);
  writeSequence();
  const pass = sequence.entries.filter((e) => e.status === "PASS").length;
  const failed = sequence.entries.filter((e) => e.status === "FAIL").length;
  const skipped = sequence.entries.filter((e) => e.status === "SKIPPED").length;
  console.log(`collect-seo-bot-evidence: ${pass} PASS / ${failed} FAIL / ${skipped} SKIPPED -> ${outDir}`);
}

function writeSequence() {
  fs.writeFileSync(path.join(outDir, "sequence.json"), `${JSON.stringify(sequence, null, 2)}\n`);
}

run().catch((err) => {
  console.error(`collect-seo-bot-evidence failed: ${err.message}`);
  process.exit(1);
});
