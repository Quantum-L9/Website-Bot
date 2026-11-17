// L9_META: layer=preflight, role=website_preflight_runner, status=active, version=1.0.0
//
// Runs the full check table and renders it. Pure over injected deps: the CLI
// (scripts/preflight-website.ts) supplies the real filesystem, environment and
// SEO-Bot client; tests supply fakes.

import {
  checkBudget,
  checkDeepSeek,
  checkGemini,
  checkProvidedImages,
  checkPublish,
  checkSecretSource,
  checkSeoBot,
  checkSpec,
} from "./checks.js";
import {
  type PreflightCheckResult,
  type PreflightDeps,
  type PreflightOptions,
  type PreflightReport,
  WEBSITE_MODES,
  type WebsiteMode,
} from "./types.js";

export async function runWebsitePreflight(
  options: PreflightOptions,
  deps: PreflightDeps,
): Promise<PreflightReport> {
  const checks: PreflightCheckResult[] = [checkSecretSource(options.secretSource)];
  const { result: specResult, spec } = checkSpec(options.specPath, deps);
  checks.push(specResult, checkProvidedImages(spec, deps));
  checks.push(...checkDeepSeek(options), checkGemini(spec, options.env));
  checks.push(...checkBudget(options, deps));
  checks.push(await checkSeoBot(spec, options, deps));
  checks.push(...checkPublish(spec, options));
  return {
    mode: options.mode,
    specPath: options.specPath,
    ok: checks.every((check) => check.status !== "FAIL"),
    checks,
  };
}

export function formatPreflightTable(report: PreflightReport): string {
  const nameWidth = Math.max(5, ...report.checks.map((check) => check.name.length));
  const lines = [
    `Website preflight — spec=${report.specPath} mode=${report.mode}`,
    `${"CHECK".padEnd(nameWidth)}  STATUS  DETAIL`,
  ];
  for (const check of report.checks) {
    lines.push(`${check.name.padEnd(nameWidth)}  ${check.status.padEnd(6)}  ${check.detail}`);
    if (check.status === "FAIL" && check.remediation)
      lines.push(`${"".padEnd(nameWidth)}  ${"".padEnd(6)}  -> FIX: ${check.remediation}`);
  }
  const failed = report.checks.filter((check) => check.status === "FAIL").length;
  lines.push(
    report.ok
      ? "PREFLIGHT PASS — no paid call has been made."
      : `PREFLIGHT FAIL — ${failed} check(s) failed; pipeline NOT started, nothing spent.`,
  );
  return lines.join("\n");
}

export interface WebsiteCliArgs {
  specPath: string;
  mode: WebsiteMode;
  preflightOnly: boolean;
  buildCapUsd: number;
  timeoutMs: number;
  /** Arguments forwarded verbatim to run-pipeline (e.g. --build-id=..). */
  passthrough: string[];
}

/** Parses the front-door arguments. Throws on an invalid value. */
export function parseWebsiteArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): WebsiteCliArgs {
  const value = (name: string) =>
    argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const own = new Set(["spec", "mode", "build-cap-usd", "timeout-ms"]);
  const specPath = value("spec")?.trim();
  if (!specPath) throw new Error("--spec=<path> is required (make website SPEC=<path>)");
  const mode = (value("mode")?.trim() || "local-proof") as WebsiteMode;
  if (!WEBSITE_MODES.includes(mode))
    throw new Error(`--mode must be one of ${WEBSITE_MODES.join(", ")} (got ${mode})`);
  const positive = (raw: string | undefined, fallback: number, label: string) => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
      throw new Error(`${label} must be a positive number`);
    return parsed;
  };
  const passthrough = argv.filter((argument) => {
    if (argument === "--preflight-only") return false;
    const match = /^--([^=]+)=/.exec(argument);
    return !(match && own.has(match[1] as string));
  });
  return {
    specPath,
    mode,
    preflightOnly: argv.includes("--preflight-only"),
    buildCapUsd: positive(
      value("build-cap-usd") ?? env.WEBSITE_BUILD_CAP_USD,
      10,
      "--build-cap-usd / WEBSITE_BUILD_CAP_USD",
    ),
    timeoutMs: positive(value("timeout-ms"), 5_000, "--timeout-ms"),
    passthrough,
  };
}
