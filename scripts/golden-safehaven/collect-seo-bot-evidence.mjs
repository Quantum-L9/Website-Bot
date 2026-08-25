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
import { createHash } from "node:crypto";
import pg from "pg";

/** Endpoint name -> SEO-Bot store artifact_type. */
const ARTIFACT_TYPE_BY_NAME = {
  "competitive-landscape": "competitive_landscape",
  "seo-content-blueprint": "seo_content_blueprint",
  "structured-content": "structured_content_package",
};

/**
 * Read a sealed build-intelligence artifact from the SEO-Bot store. The
 * artifacts persist per build_id; re-POSTing an endpoint would RE-RUN the
 * generation (SERP queries, LLM spend), so the store is the honest
 * evidence source when no request file exists. Returns an API-envelope
 * shaped object, or null when the store is not configured/unreachable.
 */
async function readArtifactFromStore(name, buildIdValue) {
  const url = process.env.SEO_BOT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return null;
  const artifactType = ARTIFACT_TYPE_BY_NAME[name];
  if (!artifactType) return null;
  let pool;
  try {
    pool = new pg.Pool({ connectionString: url });
    const result = await pool.query(
      `SELECT artifact_id, artifact_type, client_id, build_id, produced_at, payload
       FROM build_intelligence_artifacts
       WHERE build_id = $1 AND artifact_type = $2
       ORDER BY created_at DESC LIMIT 1`,
      [buildIdValue, artifactType],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      artifact_id: row.artifact_id,
      artifact_type: row.artifact_type,
      client_id: row.client_id,
      build_id: row.build_id,
      produced_at:
        row.produced_at instanceof Date ? row.produced_at.toISOString() : String(row.produced_at),
      payload: row.payload,
    };
  } catch (err) {
    console.warn(`seo-bot store read failed for ${name}: ${String(err?.message ?? err)}`);
    return null;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

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

// Deterministic code-unit comparator: keeps digest inputs byte-ordered and
// locale-independent (default Array#sort order, made explicit).
function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------- identity snapshot (Website-Bot checkout identity) ----------
// PATH is pinned to fixed system directories so the subprocess cannot be
// hijacked through a writable PATH entry.
const FIXED_PATH = "/usr/local/bin:/usr/bin:/bin";
function gitOutput(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PATH: FIXED_PATH },
    }).trim();
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
  // null, never defaulting a state. A dirty checkout is recorded as the
  // ORACLE-003 object form {status, deterministic_identity} — the
  // deterministic identity is the digest of the porcelain status itself.
  const seoBotPorcelain = seoBotCheckout ? gitOutput(["status", "--porcelain"], seoBotCheckout) : null;
  const routerDir = path.join(root, "node_modules/@quantum-l9/llm-router");
  // git walks UP from the router dir into the Website-Bot worktree, so a
  // bare rev-parse there reports the WRONG identity (golden run #61:
  // llm_router.sha equaled the Website-Bot HEAD). Only a real git checkout
  // (its own .git, not the parent's) qualifies as a checkout identity.
  const routerIsOwnCheckout =
    fs.existsSync(path.join(routerDir, ".git")) && gitOutput(["rev-parse", "--show-toplevel"], routerDir) === routerDir;
  const routerPorcelain = routerIsOwnCheckout ? gitOutput(["status", "--porcelain"], routerDir) : null;
  const routerHead = routerIsOwnCheckout ? gitOutput(["rev-parse", "HEAD"], routerDir) : null;
  const worktreeState = (p) =>
    p === null
      ? null
      : p === ""
        ? "CLEAN"
        : { status: "DIRTY", deterministic_identity: createHash("sha256").update(p).digest("hex") };
  // Deterministic identity of a registry-installed package: version plus a
  // digest over every installed file — real evidence of the exact bytes
  // that ran, for packages that carry no git metadata.
  function installedPackageDigest(dir) {
    const files = [];
    const walk = (d, rel) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, entry.name);
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(abs, r);
        else if (entry.isFile()) files.push(r);
      }
    };
    walk(dir, "");
    files.sort(compareCodeUnits);
    const h = createHash("sha256");
    for (const f of files) {
      h.update(f)
        .update("\0")
        .update(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"))
        .update("\n");
    }
    return h.digest("hex");
  }
  const routerInstalledDigest = routerPkg ? installedPackageDigest(routerDir) : null;
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
      sha: routerIsOwnCheckout
        ? routerHead
        : routerInstalledDigest
          ? `installed:${routerPkg.version}:${routerInstalledDigest}`
          : null,
      worktree_state: routerIsOwnCheckout
        ? worktreeState(routerPorcelain)
        : routerInstalledDigest
          ? { status: "DIRTY", deterministic_identity: routerInstalledDigest }
          : null,
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
    for (const name of [
      "preflight",
      "competitive-landscape",
      "seo-content-blueprint",
      "structured-content",
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
      // No request file: prefer the SEO-Bot artifact store — the sealed
      // artifacts already persist there per build. Re-POSTing the endpoint
      // would RE-RUN the generation (DataForSEO queries, LLM spend), which
      // is not evidence collection. Only when the store is unreachable is
      // the endpoint recorded SKIPPED.
      const fromStore = await readArtifactFromStore(name, buildId);
      if (fromStore) {
        fetchMeta[name] = { endpoint: urlPath, attempted: false, source: "store", artifact_id: fromStore.artifact_id };
        const status = await saveResponse(name, `${name}.json`, { ...fromStore, ok: true });
        record(name, `${name}.json`, status, null, `persisted artifact ${fromStore.artifact_id} read from the SEO-Bot store`);
        continue;
      }
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
