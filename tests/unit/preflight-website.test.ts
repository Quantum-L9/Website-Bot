// L9_META: layer=test, role=website_preflight, status=active, version=1.0.0
//
// Check-table logic for the `make website` front door, with fakes only: no
// filesystem beyond in-memory maps, no network, no secrets.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse, stringify } from "yaml";
import {
  SeoBotPreflightError,
  type SeoBotPreflightResult,
  type SeoBuildIntelligencePort,
} from "../../src/intelligence/SeoBuildIntelligencePort.js";
import {
  formatPreflightTable,
  parseWebsiteArgs,
  runWebsitePreflight,
} from "../../src/preflight/run.js";
import type {
  PreflightCheckResult,
  PreflightDeps,
  PreflightOptions,
  PreflightReport,
} from "../../src/preflight/types.js";

const SPEC_PATH = "specs/pilot.yaml";
const SEAM = { urlVar: "SEO_BOT_URL", keyVar: "SEO_BOT_API_KEY" } as const;

// The repository's own CI fixture is the valid baseline; each test mutates a copy.
const BASE_SPEC = parse(readFileSync("fixtures/ci-test-spec.yaml", "utf8")) as Record<
  string,
  unknown
>;

function specYaml(
  extra: {
    intent?: string;
    generation?: boolean;
    deploy?: Record<string, string>;
    images?: boolean;
  } = {},
) {
  const spec: Record<string, unknown> = structuredClone(BASE_SPEC);
  delete spec.deploy;
  delete spec.provision;
  delete spec.assets;
  if (extra.intent) spec.build_intent = extra.intent;
  if (extra.images || extra.generation !== undefined) {
    const assets: Record<string, unknown> = {};
    if (extra.images) assets.providedImages = [{ id: "logo", path: "assets/logo.jpg" }];
    if (extra.generation !== undefined) assets.generation = { enabled: extra.generation };
    spec.assets = assets;
  }
  if (extra.deploy) spec.deploy = extra.deploy;
  return stringify(spec);
}

const READY: SeoBotPreflightResult = {
  status: "ready",
  service: "seo-bot",
  version: "1.0.0",
  bot_interop_version: "1.0.0",
  llm_router_version: "2.0.0",
  capabilities: {
    competitive_landscape: true,
    seo_content_blueprint: true,
    structured_content: true,
  },
  configuration: { dataforseo_configured: true, llm_provider_configured: true },
};

function fakePort(
  behavior: SeoBotPreflightResult | SeoBotPreflightError,
): SeoBuildIntelligencePort {
  const unused = async () => {
    throw new Error("not used by preflight");
  };
  return {
    createCompetitiveLandscape: unused,
    createSEOContentBlueprint: unused,
    createStructuredContent: unused,
    preflight: async () => {
      if (behavior instanceof Error) throw behavior;
      return behavior;
    },
  };
}

interface FakeWorld {
  files?: Record<string, string>;
  unwritable?: string[];
  seo?: SeoBotPreflightResult | SeoBotPreflightError;
  seoCalls?: { url: string; key: string; timeoutMs: number }[];
}

function fakeDeps(world: FakeWorld): PreflightDeps {
  const files = world.files ?? {};
  return {
    readText: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    exists: (path) =>
      path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`)),
    writableError: (path) => (world.unwritable?.includes(path) ? "EACCES" : undefined),
    resolvePath: (path) => path,
    seoBotPort: (url, key, timeoutMs) => {
      world.seoCalls?.push({ url, key, timeoutMs });
      return fakePort(world.seo ?? READY);
    },
  };
}

function options(
  overrides: Partial<PreflightOptions> & { env?: PreflightOptions["env"] } = {},
): PreflightOptions {
  return {
    mode: "local-proof",
    specPath: SPEC_PATH,
    buildCapUsd: 10,
    timeoutMs: 1_000,
    knownDeepSeekModels: ["deepseek-flash", "deepseek-pro"],
    defaultDeepSeekModel: "deepseek-flash",
    secretSource: { bootstrapPresent: false, sourceMode: "process_env_only" },
    seoBot: SEAM,
    ...overrides,
    env: { DEEPSEEK_API_KEY: "sk-test", ...overrides.env },
  };
}

function find(report: PreflightReport, name: string): PreflightCheckResult {
  const check = report.checks.find((candidate) => candidate.name === name);
  assert.ok(check, `check ${name} present`);
  return check;
}

test("a COPY local-proof spec with keys passes and skips inapplicable checks", async () => {
  const report = await runWebsitePreflight(
    options(),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() } }),
  );
  assert.equal(report.ok, true, formatPreflightTable(report));
  assert.equal(find(report, "spec.load").status, "PASS");
  assert.equal(find(report, "seo_bot.preflight").status, "SKIP");
  assert.equal(find(report, "secret.GEMINI_API_KEY").status, "SKIP");
  assert.equal(find(report, "budget.spend_ledger").status, "SKIP");
  assert.equal(find(report, "publish.target").status, "SKIP");
});

test("every FAIL carries a remediation and the table says nothing was spent", async () => {
  const report = await runWebsitePreflight(
    options({ env: { DEEPSEEK_API_KEY: undefined } }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() } }),
  );
  assert.equal(report.ok, false);
  const failed = report.checks.filter((check) => check.status === "FAIL");
  assert.deepEqual(
    failed.map((check) => check.name),
    ["secret.DEEPSEEK_API_KEY"],
  );
  for (const check of failed) assert.ok(check.remediation && check.remediation.length > 0);
  const table = formatPreflightTable(report);
  assert.match(table, /FIX: Add DEEPSEEK_API_KEY to the Infisical project/);
  assert.match(table, /pipeline NOT started, nothing spent/);
});

test("secret values are never rendered in the table", async () => {
  const secret = "sk-super-secret-value";
  const report = await runWebsitePreflight(
    options({
      mode: "end-to-end",
      seoBot: { ...SEAM, url: "http://127.0.0.1:3100", apiKey: secret },
      env: {
        DEEPSEEK_API_KEY: secret,
        GITHUB_SITE_TOKEN: secret,
        VERCEL_TOKEN: secret,
      },
    }),
    fakeDeps({
      files: {
        [SPEC_PATH]: specYaml({
          intent: "REDESIGN_IMPROVE",
          deploy: { github_repo: "example/site", vercel_project_id: "prj_1" },
        }),
      },
    }),
  );
  assert.equal(report.ok, true, formatPreflightTable(report));
  assert.equal(formatPreflightTable(report).includes(secret), false);
});

test("an invalid or missing spec fails at spec.load and dependent checks skip", async () => {
  const missing = await runWebsitePreflight(options(), fakeDeps({ files: {} }));
  assert.equal(find(missing, "spec.load").status, "FAIL");
  assert.equal(find(missing, "spec.provided_images").status, "SKIP");

  const invalid = await runWebsitePreflight(
    options(),
    fakeDeps({ files: { [SPEC_PATH]: "client_id: x\n" } }),
  );
  assert.equal(find(invalid, "spec.load").status, "FAIL");
  assert.equal(invalid.ok, false);
});

test("provided image paths must exist", async () => {
  const absent = await runWebsitePreflight(
    options(),
    fakeDeps({ files: { [SPEC_PATH]: specYaml({ images: true }) } }),
  );
  const check = find(absent, "spec.provided_images");
  assert.equal(check.status, "FAIL");
  assert.match(check.detail, /logo -> assets\/logo\.jpg/);

  const present = await runWebsitePreflight(
    options(),
    fakeDeps({ files: { [SPEC_PATH]: specYaml({ images: true }), "assets/logo.jpg": "jpg" } }),
  );
  assert.equal(find(present, "spec.provided_images").status, "PASS");
});

test("a retired DeepSeek model fails before dispatch", async () => {
  const report = await runWebsitePreflight(
    options({ env: { DEEPSEEK_MODEL: "deepseek-chat-v1" } }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() } }),
  );
  const check = find(report, "llm.deepseek_model");
  assert.equal(check.status, "FAIL");
  assert.match(check.remediation ?? "", /deepseek-flash/);
});

test("Gemini key is required only when image generation is enabled", async () => {
  const enabled = await runWebsitePreflight(
    options(),
    fakeDeps({ files: { [SPEC_PATH]: specYaml({ generation: true }) } }),
  );
  assert.equal(find(enabled, "secret.GEMINI_API_KEY").status, "FAIL");

  const keyed = await runWebsitePreflight(
    options({ env: { GEMINI_API_KEY: "g" } }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml({ generation: true }) } }),
  );
  assert.equal(find(keyed, "secret.GEMINI_API_KEY").status, "PASS");

  const disabled = await runWebsitePreflight(
    options(),
    fakeDeps({ files: { [SPEC_PATH]: specYaml({ generation: false }) } }),
  );
  assert.equal(find(disabled, "secret.GEMINI_API_KEY").status, "SKIP");
});

test("REDESIGN maps each SEO-Bot failure code to its remediation", async () => {
  const seoBot = { ...SEAM, url: "http://127.0.0.1:3100", apiKey: "k" };
  const files = { [SPEC_PATH]: specYaml({ intent: "REDESIGN_IMPROVE" }) };

  const calls: FakeWorld["seoCalls"] = [];
  const ok = await runWebsitePreflight(
    options({ seoBot, timeoutMs: 1234 }),
    fakeDeps({ files, seoCalls: calls }),
  );
  assert.equal(find(ok, "seo_bot.preflight").status, "PASS");
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:3100", key: "k", timeoutMs: 1234 }]);

  const cases: [SeoBotPreflightError["code"], RegExp][] = [
    ["SEO_BOT_AUTH_FAILED", /Seam key is stale/],
    ["SEO_BOT_UNREACHABLE", /Start SEO-Bot/],
    ["SEO_BOT_CAPABILITY_MISMATCH", /DataForSEO/],
    ["SEO_BOT_ROUTER_VERSION_MISMATCH", /LLM router/],
  ];
  for (const [code, remediation] of cases) {
    const report = await runWebsitePreflight(
      options({ seoBot }),
      fakeDeps({ files, seo: new SeoBotPreflightError(code, `simulated ${code}`) }),
    );
    const check = find(report, "seo_bot.preflight");
    assert.equal(check.status, "FAIL");
    assert.match(check.detail, new RegExp(code));
    assert.match(check.remediation ?? "", remediation);
  }

  const unconfigured = await runWebsitePreflight(options(), fakeDeps({ files }));
  assert.match(find(unconfigured, "seo_bot.preflight").detail, /SEO_BOT_URL not set/);
});

test("LLM build allowance above the per-build cap fails", async () => {
  const files = { [SPEC_PATH]: specYaml() };
  const over = await runWebsitePreflight(
    options({ env: { LLM_BUILD_BUDGET_USD: "25" } }),
    fakeDeps({ files }),
  );
  assert.equal(find(over, "budget.llm_build_budget").status, "FAIL");
  const raised = await runWebsitePreflight(
    options({ buildCapUsd: 30, env: { LLM_BUILD_BUDGET_USD: "25" } }),
    fakeDeps({ files }),
  );
  assert.equal(find(raised, "budget.llm_build_budget").status, "PASS");
  const junk = await runWebsitePreflight(
    options({ env: { LLM_BUILD_BUDGET_USD: "abc" } }),
    fakeDeps({ files }),
  );
  assert.equal(find(junk, "budget.llm_build_budget").status, "FAIL");
});

test("spend ledger: unwritable directory, exhausted cap, and healthy remaining budget", async () => {
  const ledger = "/opt/qap/spend-ledger.json";
  const env = { SPEND_LEDGER_PATH: ledger };

  const eacces = await runWebsitePreflight(
    options({ env }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() }, unwritable: ["/opt/qap"] }),
  );
  const denied = find(eacces, "budget.spend_ledger");
  assert.equal(denied.status, "FAIL");
  assert.match(denied.detail, /EACCES/);
  assert.match(denied.remediation ?? "", /\/opt\/qap/);

  const exhausted = await runWebsitePreflight(
    options({ env }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml(), [ledger]: '{"cap_usd": 50, "spent_usd": 45}' } }),
  );
  assert.equal(find(exhausted, "budget.spend_ledger").status, "FAIL");
  assert.match(find(exhausted, "budget.spend_ledger").detail, /remaining budget \$5\.00/);

  const healthy = await runWebsitePreflight(
    options({ env }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml(), [ledger]: '{"cap_usd": 50, "spent_usd": 10}' } }),
  );
  assert.equal(find(healthy, "budget.spend_ledger").status, "PASS");

  const corrupt = await runWebsitePreflight(
    options({ env }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml(), [ledger]: "{" } }),
  );
  assert.equal(find(corrupt, "budget.spend_ledger").status, "FAIL");

  const capOnly = await runWebsitePreflight(
    options({ env: { ...env, SPEND_CAP_USD: "5" } }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() } }),
  );
  assert.equal(find(capOnly, "budget.spend_ledger").status, "FAIL");
});

test("publish modes require a target, the publish token and (end-to-end) Vercel", async () => {
  const deploy = {
    github_repo: "example/site",
    publish_credential_ref: "env://CLIENT_GH_TOKEN",
  };
  const files = { [SPEC_PATH]: specYaml({ deploy }) };

  const publishNoToken = await runWebsitePreflight(
    options({ mode: "publish-proof" }),
    fakeDeps({ files }),
  );
  const token = find(publishNoToken, "secret.github_publish_token");
  assert.equal(token.status, "FAIL");
  assert.match(token.detail, /CLIENT_GH_TOKEN not set/);
  assert.equal(
    publishNoToken.checks.some((check) => check.name === "secret.VERCEL_TOKEN"),
    false,
  );

  const publishOk = await runWebsitePreflight(
    options({ mode: "publish-proof", env: { CLIENT_GH_TOKEN: "t" } }),
    fakeDeps({ files }),
  );
  assert.equal(publishOk.ok, true, formatPreflightTable(publishOk));

  const e2e = await runWebsitePreflight(
    options({ mode: "end-to-end", env: { CLIENT_GH_TOKEN: "t" } }),
    fakeDeps({ files }),
  );
  assert.equal(find(e2e, "secret.VERCEL_TOKEN").status, "FAIL");
  assert.equal(find(e2e, "vercel.project").status, "FAIL");

  const noTarget = await runWebsitePreflight(
    options({ mode: "publish-proof", env: { GITHUB_SITE_TOKEN: "t" } }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() } }),
  );
  assert.equal(find(noTarget, "publish.target").status, "FAIL");
});

test("Infisical bootstrap that failed to hydrate is reported", async () => {
  const report = await runWebsitePreflight(
    options({ secretSource: { bootstrapPresent: true, sourceMode: "infisical_unavailable" } }),
    fakeDeps({ files: { [SPEC_PATH]: specYaml() } }),
  );
  assert.equal(find(report, "secrets.source").status, "FAIL");
});

test("argument parsing: defaults, validation, passthrough", () => {
  const parsed = parseWebsiteArgs(["--spec=a.yaml", "--build-id=b1", "--preflight-only"], {});
  assert.equal(parsed.mode, "local-proof");
  assert.equal(parsed.buildCapUsd, 10);
  assert.equal(parsed.timeoutMs, 5_000);
  assert.equal(parsed.preflightOnly, true);
  assert.deepEqual(parsed.passthrough, ["--build-id=b1"]);

  assert.equal(
    parseWebsiteArgs(["--spec=a", "--mode=end-to-end"], { WEBSITE_BUILD_CAP_USD: "4" }).buildCapUsd,
    4,
  );
  assert.throws(() => parseWebsiteArgs([], {}), /--spec=<path> is required/);
  assert.throws(() => parseWebsiteArgs(["--spec=a", "--mode=plan"], {}), /--mode must be one of/);
  assert.throws(() => parseWebsiteArgs(["--spec=a", "--build-cap-usd=0"], {}), /positive/);
});
