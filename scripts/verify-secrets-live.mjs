#!/usr/bin/env node
// L9_META: layer=configuration, role=secret_live_resolution_doctor, status=active, version=1.0.0
//
// Live org-secret resolution doctor. Confirms that each secret/var the pipeline
// relies on (a) RESOLVES in this repo's Actions context (i.e. the org secret is
// granted to this repo and non-empty) and, where a cheap provider endpoint
// exists, (b) AUTHENTICATES against that provider.
//
// SAFETY CONTRACT (do not weaken):
//   - Never prints a secret VALUE. Only name, present(bool), length, and verdict.
//     (GitHub also auto-masks registered secrets in logs; this is defense in depth.)
//   - Never invokes side-effecting endpoints that mutate infra. The Vercel deploy
//     hook is presence/format-only — calling it would trigger a real deployment.
//   - Postgres is a TCP reachability probe only; no query is run.
//   - All network calls are bounded by a timeout.
//   - Informational by default (exit 0). Pass --strict to exit 1 when a REQUIRED
//     secret is missing or authenticates as invalid.

import net from "node:net";

const STRICT = process.argv.includes("--strict");
const TIMEOUT_MS = 12_000;

const INVALID = new Set(["", "UNKNOWN", "unknown", "UNKNOWN_SECRET_DO_NOT_COMMIT"]);
const val = (k) => process.env[k];
const present = (k) => {
  const v = val(k);
  return v !== undefined && !INVALID.has(String(v).trim());
};
const masked = (k) => {
  const v = val(k);
  return present(k) ? `set(len=${String(v).length})` : "MISSING";
};

async function http(url, { method = "GET", headers = {}, body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    let scopes;
    if (res.headers.has("x-oauth-scopes")) scopes = res.headers.get("x-oauth-scopes");
    return { status: res.status, ok: res.ok, scopes };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      err: e.name === "AbortError" ? "timeout" : String(e.message || e),
    };
  } finally {
    clearTimeout(t);
  }
}

function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (r) => {
      try {
        sock.destroy();
      } catch {
        /* noop */
      }
      resolve(r);
    };
    sock.setTimeout(TIMEOUT_MS);
    sock.once("connect", () => done({ ok: true }));
    sock.once("timeout", () => done({ ok: false, err: "timeout" }));
    sock.once("error", (e) => done({ ok: false, err: String(e.code || e.message) }));
    sock.connect(port, host);
  });
}

const results = [];
const required = new Set([
  "OPENROUTER_API_KEY",
  "GITHUB_SITE_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
]);
function record(name, kind, verdict, detail) {
  results.push({
    name,
    kind,
    present: present(name),
    value: masked(name),
    verdict,
    detail: detail || "",
  });
}

// --- GitHub tokens: /user proves auth; x-oauth-scopes shows granted scopes ---
function httpErrSuffix(r) {
  return r.err ? ":" + r.err : "";
}

function authVerdict(r, invalidCodes = [401]) {
  if (r.status === 200) return "valid";
  if (invalidCodes.includes(r.status)) return `invalid(${r.status})`;
  return `http(${r.status})${httpErrSuffix(r)}`;
}

function perplexityVerdict(r) {
  if (r.status === 200) return "valid";
  if (r.status === 401 || r.status === 403) return `invalid(${r.status})`;
  if (r.status === 400) return "auth-ok(400 bad-req)";
  return `http(${r.status})${httpErrSuffix(r)}`;
}

function reachabilityVerdict(r) {
  if (r.status === 200) return "reachable+ok";
  if (r.status) return `reachable(http ${r.status})`;
  return `unreachable:${r.err}`;
}

function inngestVerdict(r) {
  if (r.status === 200) return "valid(event accepted)";
  if (r.status) return `http(${r.status})`;
  return `err:${r.err}`;
}

async function githubToken(name) {
  if (!present(name)) return record(name, "github", "missing");
  const r = await http("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${val(name)}`,
      "User-Agent": "l9-secret-doctor",
      Accept: "application/vnd.github+json",
    },
  });
  const verdict = authVerdict(r);
  record(name, "github", verdict, r.scopes !== undefined ? `scopes=[${r.scopes}]` : "");
}

// --- OpenRouter: key metadata endpoint (no completion cost) ---
async function openrouter() {
  const name = "OPENROUTER_API_KEY";
  if (!present(name)) return record(name, "llm", "missing");
  const r = await http("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${val(name)}` },
  });
  record(name, "llm", authVerdict(r));
}

// --- Perplexity: minimal 1-token completion (tiny cost) to distinguish 401 vs ok ---
async function perplexity() {
  const name = "PERPLEXITY_API_KEY";
  if (!present(name)) return record(name, "llm", "missing");
  const r = await http("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${val(name)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
  });
  const verdict = perplexityVerdict(r);
  record(name, "llm", verdict);
}

// --- Vercel: /v2/user proves token; optional project+team resolution ---
async function vercelProjectProbe(name) {
  // Project identity resolution (uses team scoping when present)
  const proj = val("VERCEL_PROJECT_ID");
  if (!present("VERCEL_TOKEN") || !proj) return;
  const team = val("VERCEL_TEAM_ID");
  const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(proj)}${team ? `?teamId=${encodeURIComponent(team)}` : ""}`;
  const pr = await http(url, { headers: { Authorization: `Bearer ${val(name)}` } });
  record(
    "VERCEL_PROJECT_ID",
    "vercel",
    pr.status === 200 ? "resolves" : `http(${pr.status})`,
    team ? "scoped-by-team" : "no-team-scope",
  );
}

async function vercel() {
  const name = "VERCEL_TOKEN";
  if (!present(name)) return record(name, "vercel", "missing");
  const r = await http("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${val(name)}` },
  });
  record(name, "vercel", authVerdict(r, [401, 403]));
  await vercelProjectProbe(name);
}

// --- DataForSEO: Basic auth account endpoint returns balance ---
async function dataforseo() {
  const l = "DATAFORSEO_LOGIN",
    p = "DATAFORSEO_PASSWORD";
  if (!present(l) || !present(p))
    return record(`${l}+${p}`, "seo", present(l) || present(p) ? "partial" : "missing");
  const basic = Buffer.from(`${val(l)}:${val(p)}`).toString("base64");
  const r = await http("https://api.dataforseo.com/v3/appendix/user_data", {
    headers: { Authorization: `Basic ${basic}` },
  });
  record(`${l}+${p}`, "seo", authVerdict(r));
}

// --- SEO bot service: best-effort auth probe against its URL ---
async function seoBot() {
  const u = "SEO_BOT_URL",
    k = "SEO_BOT_API_KEY";
  if (!present(u)) return record(`${u}+${k}`, "seo", "missing");
  const base = String(val(u)).replace(/\/+$/, "");
  const r = await http(`${base}/health`, {
    headers: present(k) ? { Authorization: `Bearer ${val(k)}`, "x-api-key": val(k) } : {},
  });
  const verdict = reachabilityVerdict(r);
  record(`${u}+${k}`, "seo", verdict, present(k) ? "api-key sent" : "no api-key");
}

// --- Postgres: TCP reachability only (NO query) ---
async function postgres() {
  const name = "POSTGRES_URL";
  if (!present(name)) return record(name, "db", "missing");
  try {
    const u = new URL(val(name));
    const port = u.port ? Number(u.port) : 5432;
    const r = await tcpProbe(u.hostname, port);
    record(
      name,
      "db",
      r.ok ? "tcp-reachable" : `tcp-fail:${r.err}`,
      `host=${u.hostname}:${port} (no query run)`,
    );
  } catch {
    record(name, "db", "malformed-url");
  }
}

// --- Inngest event key: a single labeled test event validates ingestion ---
async function inngest() {
  const name = "INNGEST_EVENT_KEY";
  if (present(name)) {
    const r = await http(`https://inn.gs/e/${encodeURIComponent(val(name))}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "l9/secret.doctor.probe",
        data: { source: "ci-secret-doctor" },
      }),
    });
    record(
      name,
      "inngest",
      inngestVerdict(r),
      "emitted 1 labeled test event",
    );
  } else record(name, "inngest", "missing");
  record(
    "INNGEST_SIGNING_KEY",
    "inngest",
    present("INNGEST_SIGNING_KEY") ? "present(not live-tested)" : "missing",
  );
}

function probeDeployHook() {
  // presence-only records (sync)
  const hook = "SEO_BOT_SITE_VERCEL_DEPLOY_HOOK";
  let hookDetail = "deploy hook — NOT called (would trigger a deploy)";
  if (present(hook)) {
    try {
      hookDetail = `host=${new URL(val(hook)).host} — NOT called`;
    } catch {
      hookDetail = "malformed-url — NOT called";
    }
  }
  record(hook, "vercel", present(hook) ? "present(not called)" : "missing", hookDetail);
}

function probePresence() {
  for (const n of ["POSTHOG_KEY", "PUBLIC_POSTHOG_KEY"])
    record(n, "analytics", present(n) ? "present(not auth-validatable)" : "missing");
  record("SDK_TOKEN", "other", present("SDK_TOKEN") ? "present(no known probe)" : "missing");
  // Vars (resolution/presence)
  for (const v of ["CLIENT_ID", "VERCEL_PROJECT_ID", "VERCEL_TEAM_ID"])
    record(v, "var", present(v) ? "resolves" : "MISSING");
}

async function probePublicSiteUrl() {
  const pub = "CLIENT_PUBLIC_SITE_URL";
  if (present(pub)) {
    const r = await http(String(val(pub)));
    record(pub, "var", r.status ? `http(${r.status})` : `unreachable:${r.err}`);
  } else record(pub, "var", "MISSING");
}

async function main() {
  await Promise.all([
    githubToken("GITHUB_SITE_TOKEN"),
    githubToken("GITHUB_PROVISION_TOKEN"),
    githubToken("SEO_BOT_SITE_GITHUB_TOKEN"),
    openrouter(),
    perplexity(),
    vercel(),
    dataforseo(),
    seoBot(),
    postgres(),
    inngest(),
  ]);
  probeDeployHook();
  probePresence();
  await probePublicSiteUrl();

  const summary = {
    scope: "live_secret_resolution",
    total: results.length,
    missing: results.filter((r) => !r.present).map((r) => r.name),
    invalid: results
      .filter((r) => /invalid|tcp-fail|unreachable/.test(String(r.verdict)))
      .map((r) => r.name),
    required_failures: results
      .filter((r) => required.has(r.name) && (!r.present || /invalid/.test(String(r.verdict))))
      .map((r) => r.name),
  };

  // Human table
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n=== Live secret resolution report ===");
  console.log(
    pad("SECRET/VAR", 34),
    pad("PRESENT", 8),
    pad("VALUE", 12),
    pad("VERDICT", 26),
    "DETAIL",
  );
  for (const r of results)
    console.log(
      pad(r.name, 34),
      pad(r.present ? "yes" : "NO", 8),
      pad(r.value, 12),
      pad(r.verdict, 26),
      r.detail,
    );
  console.log("\n" + JSON.stringify(summary, null, 2));

  if (STRICT && summary.required_failures.length) {
    console.error(`\nSTRICT: required secret failures: ${summary.required_failures.join(", ")}`);
    process.exit(1);
  }
  process.exit(0);
}

await main();
