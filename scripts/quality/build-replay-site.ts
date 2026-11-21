// L9_META: layer=script, role=site_quality_replay_build, status=active, version=1.0.0
//
// Builds a site through the REAL pipeline — content generation, structured
// content projection, section assembly and the Astro production build — from
// the committed replay fixtures (fixtures/replay), with no provider secret.
// It is the same boundary tests/e2e-replay/pipeline-replay.test.ts proves:
// SEO-Bot is a loopback replay server and DeepSeek / Gemini / donor pages are
// answered by tests/e2e-replay/replay-preload.mjs; every other host is refused.
//
// Unlike that test it KEEPS the built site so the rendered-site quality
// checker (scripts/quality/check-site.ts) can judge real generated copy.
//
// --overlay <dir> replaces individual fixture files (same relative path) with
// a richer recorded response — scripts/quality uses tests/quality/replay-overlay
// so the page carries production-volume copy while every other response stays
// the committed e2e-replay fixture.
//
// Usage: npx tsx scripts/quality/build-replay-site.ts --out <dir> [--overlay <dir>]
// Writes <dir>/site/dist (the built site) and <dir>/replay-build.json.
// Exit 0 on a converged build, 1 otherwise. A request outside the fixtures is
// a failure, never a skip.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixtureTree } from "../../tests/e2e-replay/replay-fixture-tree.js";
import { startSeoBotReplayServer } from "../../tests/e2e-replay/seo-bot-replay-server.js";

const REPO = resolve(import.meta.dirname, "..", "..");
const FIXTURES = join(REPO, "fixtures", "replay");
export const REPLAY_SPEC = join(FIXTURES, "replay-spec.yaml");
const PRELOAD = join(REPO, "tests", "e2e-replay", "replay-preload.mjs");
const CLIENT_ID = "replay-plumbing";
const BUILD_ID = "replay-build";
const API_KEY = "replay-machine-key";

/** Runner environment passed through; nothing credential-bearing. */
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

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(
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
    const sink = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      output += text;
      process.stderr.write(text);
    };
    child.stdout.on("data", sink);
    child.stderr.on("data", sink);
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, output }));
  });
}

interface ReplayEntry {
  kind: string;
  host: string;
  path: string;
}

async function main(): Promise<number> {
  const out = resolve(argValue("out") ?? join("build", "site-quality", "replay"));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const outputDir = join(out, "site");
  const evidenceDir = join(out, "evidence");
  const log = join(out, "replay.jsonl");
  // build/assets/<client>/ is cwd-relative pipeline state; start from none.
  rmSync(join(REPO, "build", "assets", CLIENT_ID), { recursive: true, force: true });

  const overlayArg = argValue("overlay");
  const fixtures = fixtureTree(out, overlayArg ? resolve(overlayArg) : undefined);

  const seoBot = await startSeoBotReplayServer(join(fixtures.dir, "seo-bot"), API_KEY);
  try {
    // Fixed key set: the allow-listed runner variables, then the replay settings.
    const passthrough = PASSTHROUGH.flatMap((name) => {
      const value = process.env[name];
      return value ? [[name, value] as const] : [];
    });
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(passthrough),
      REPLAY_FIXTURES_DIR: fixtures.dir,
      REPLAY_LOG: log,
      SEO_BOT_URL: seoBot.url,
      SEO_BOT_API_KEY: API_KEY,
      DEEPSEEK_API_KEY: "replay-not-a-key",
      GEMINI_API_KEY: "replay-not-a-key",
      L9_MEMORY_MODE: "disabled",
      INFISICAL_CLIENT_ID: "",
      INFISICAL_CLIENT_SECRET: "",
      INFISICAL_PROJECT_ID: "",
    };
    const { code } = await run(env, [
      "--mode=local-proof",
      "--redesign",
      `--spec=${REPLAY_SPEC}`,
      `--build-id=${BUILD_ID}`,
      `--evidence-dir=${evidenceDir}`,
      `--output-dir=${outputDir}`,
    ]);
    const entries: ReplayEntry[] = existsSync(log)
      ? readFileSync(log, "utf-8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ReplayEntry)
      : [];
    const refused = entries.filter((entry) => entry.kind !== "replayed");
    const distDir = join(outputDir, "dist");
    const converged = code === 0 && refused.length === 0 && existsSync(join(distDir, "index.html"));
    const result = {
      schema: "website-bot.site-quality-replay-build/v1",
      status: converged ? "built" : "failed",
      spec: REPLAY_SPEC,
      fixtures: fixtures.dir,
      overlaid_fixtures: fixtures.overlaid,
      client_id: CLIENT_ID,
      build_id: BUILD_ID,
      pipeline_exit_code: code,
      refused_requests: refused,
      dist_dir: distDir,
    };
    writeFileSync(join(out, "replay-build.json"), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    console.log(JSON.stringify(result, null, 2));
    return converged ? 0 : 1;
  } finally {
    await seoBot.close();
  }
}

process.exitCode = await main();
