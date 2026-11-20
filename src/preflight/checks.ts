// L9_META: layer=preflight, role=website_preflight_checks, status=active, version=1.0.0
//
// Individual preflight checks. Each is a small function over injected deps so
// the whole table is unit-testable with fakes and no live network. A check
// reports facts and a remediation; it never prints a secret value.

import { dirname } from "node:path";
import { parse } from "yaml";
import { SeoBotPreflightError } from "../intelligence/SeoBuildIntelligencePort.js";
import type { DomainSpec } from "../pipeline/BuildContext.js";
import { parseBuildIntent } from "../pipeline/BuildIntent.js";
import { validateDomainSpec } from "../pipeline/validateDomainSpec.js";
import type {
  PreflightCheckResult,
  PreflightDeps,
  PreflightEnv,
  PreflightOptions,
  SpendLedgerFile,
} from "./types.js";

/** Placeholder values the launch-env contract treats as absent. */
const INVALID_MARKERS = new Set([
  "",
  "UNKNOWN",
  "Unknown",
  "unknown",
  "UNKNOWN_REQUIRED_BEFORE_LAUNCH",
  "UNKNOWN_REQUIRED_FOR_DEPLOY",
  "UNKNOWN_REQUIRED_FOR_FORM_DELIVERY",
  "UNKNOWN_SECRET_DO_NOT_COMMIT",
]);

export function isMissing(value: string | undefined): boolean {
  return value === undefined || INVALID_MARKERS.has(value.trim());
}

const pass = (name: string, detail: string): PreflightCheckResult => ({
  name,
  status: "PASS",
  detail,
});
const skip = (name: string, detail: string): PreflightCheckResult => ({
  name,
  status: "SKIP",
  detail,
});
const fail = (name: string, detail: string, remediation: string): PreflightCheckResult => ({
  name,
  status: "FAIL",
  detail,
  remediation,
});

const SECRET_REMEDIATION = (name: string) =>
  `Add ${name} to the Infisical project Website-Bot hydrates from (INFISICAL_* bootstrap), or to .env.local for a local run; then re-run make website.`;

export function checkSecretSource(source: PreflightOptions["secretSource"]): PreflightCheckResult {
  const name = "secrets.source";
  if (!source) return skip(name, "secret hydration not reported");
  if (source.bootstrapPresent && source.sourceMode === "infisical_unavailable")
    return fail(
      name,
      "INFISICAL_* bootstrap is set but Infisical hydration failed",
      "Check INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET / INFISICAL_PROJECT_ID (machine identity) and network reach to Infisical.",
    );
  return pass(name, `source_mode=${source.sourceMode}`);
}

/** Loads and validates the spec exactly as run-pipeline does. */
export function checkSpec(
  specPath: string,
  deps: PreflightDeps,
): { result: PreflightCheckResult; spec?: DomainSpec } {
  const name = "spec.load";
  if (!deps.exists(specPath))
    return {
      result: fail(
        name,
        `spec not found: ${specPath}`,
        "Pass SPEC=<path to an existing DomainSpec YAML>.",
      ),
    };
  try {
    const spec = validateDomainSpec(parse(deps.readText(specPath)), specPath);
    return {
      result: pass(
        name,
        `client_id=${spec.client_id} build_intent=${parseBuildIntent(spec.build_intent)}`,
      ),
      spec,
    };
  } catch (error) {
    return {
      result: fail(
        name,
        error instanceof Error ? error.message : String(error),
        "Fix the DomainSpec errors listed (npm run normalize-spec for rich source specs).",
      ),
    };
  }
}

export function checkProvidedImages(
  spec: DomainSpec | undefined,
  deps: PreflightDeps,
): PreflightCheckResult {
  const name = "spec.provided_images";
  if (!spec) return skip(name, "spec did not load");
  const images = spec.assets?.providedImages ?? [];
  if (images.length === 0) return skip(name, "spec declares no provided images");
  const missing = images.filter((image) => !deps.exists(deps.resolvePath(image.path)));
  if (missing.length > 0)
    return fail(
      name,
      `missing: ${missing.map((image) => `${image.id} -> ${image.path}`).join(", ")}`,
      "Place the files at the declared paths (relative to the repository root) or fix assets.providedImages[].path.",
    );
  return pass(name, `${images.length} provided image(s) present`);
}

export function checkDeepSeek(options: PreflightOptions): PreflightCheckResult[] {
  const { env } = options;
  const results: PreflightCheckResult[] = [];
  results.push(
    isMissing(env.DEEPSEEK_API_KEY)
      ? fail("secret.DEEPSEEK_API_KEY", "not set", SECRET_REMEDIATION("DEEPSEEK_API_KEY"))
      : pass("secret.DEEPSEEK_API_KEY", "present"),
  );
  const model = env.DEEPSEEK_MODEL?.trim() || options.defaultDeepSeekModel;
  results.push(
    options.knownDeepSeekModels.includes(model)
      ? pass("llm.deepseek_model", `model=${model}`)
      : fail(
          "llm.deepseek_model",
          `DEEPSEEK_MODEL=${model} is not a supported/priced model (retired or unknown)`,
          `Unset DEEPSEEK_MODEL or set one of: ${options.knownDeepSeekModels.join(", ")}.`,
        ),
  );
  return results;
}

export function checkGemini(spec: DomainSpec | undefined, env: PreflightEnv): PreflightCheckResult {
  const name = "secret.GEMINI_API_KEY";
  if (!spec) return skip(name, "spec did not load");
  if (spec.assets?.generation?.enabled !== true)
    return skip(name, "assets.generation.enabled is not true");
  if (isMissing(env.GEMINI_API_KEY) && isMissing(env.GOOGLE_API_KEY))
    return fail(
      name,
      "image generation enabled but no key set",
      SECRET_REMEDIATION("GEMINI_API_KEY"),
    );
  return pass(name, "present");
}

/**
 * Per-build budget. The in-process LLM allowance must not exceed the build
 * cap, and when a shared spend ledger is configured it must be writable and
 * hold at least one build's worth of remaining budget.
 */
export function checkBudget(
  options: PreflightOptions,
  deps: PreflightDeps,
): PreflightCheckResult[] {
  const { env, buildCapUsd } = options;
  const results: PreflightCheckResult[] = [];
  const rawBudget = env.LLM_BUILD_BUDGET_USD?.trim();
  const llmBudget = rawBudget ? Number(rawBudget) : 10;
  if (!Number.isFinite(llmBudget) || llmBudget <= 0)
    results.push(
      fail(
        "budget.llm_build_budget",
        `LLM_BUILD_BUDGET_USD=${rawBudget} is not a positive number`,
        "Set LLM_BUILD_BUDGET_USD to a positive USD amount (default 10).",
      ),
    );
  else if (llmBudget > buildCapUsd)
    results.push(
      fail(
        "budget.llm_build_budget",
        `LLM_BUILD_BUDGET_USD=${llmBudget} exceeds the per-build cap $${buildCapUsd}`,
        `Lower LLM_BUILD_BUDGET_USD to <= ${buildCapUsd}, or raise the cap with --build-cap-usd / WEBSITE_BUILD_CAP_USD.`,
      ),
    );
  else
    results.push(
      pass("budget.llm_build_budget", `LLM allowance $${llmBudget} <= build cap $${buildCapUsd}`),
    );

  results.push(checkSpendLedger(env, buildCapUsd, deps));
  return results;
}

function checkSpendLedger(
  env: PreflightEnv,
  buildCapUsd: number,
  deps: PreflightDeps,
): PreflightCheckResult {
  const name = "budget.spend_ledger";
  const ledgerPath = env.SPEND_LEDGER_PATH?.trim();
  if (!ledgerPath)
    return skip(name, "SPEND_LEDGER_PATH unset; in-process LLM_BUILD_BUDGET_USD bounds this build");
  const ownership = `Make ${dirname(ledgerPath)} writable by this user (e.g. chown/chmod), or point SPEND_LEDGER_PATH at a writable location.`;
  const dirError = deps.writableError(dirname(ledgerPath));
  if (dirError)
    return fail(
      name,
      `ledger directory not writable (${dirError}); lock file cannot be created`,
      ownership,
    );
  let ledger: SpendLedgerFile | undefined;
  if (deps.exists(ledgerPath)) {
    const fileError = deps.writableError(ledgerPath);
    if (fileError) return fail(name, `ledger file not writable (${fileError})`, ownership);
    try {
      const parsed = JSON.parse(deps.readText(ledgerPath)) as Partial<SpendLedgerFile>;
      if (typeof parsed.cap_usd !== "number" || typeof parsed.spent_usd !== "number")
        throw new Error("expected numeric cap_usd and spent_usd");
      ledger = { cap_usd: parsed.cap_usd, spent_usd: parsed.spent_usd };
    } catch (error) {
      return fail(
        name,
        `ledger unreadable: ${error instanceof Error ? error.message : String(error)}`,
        `Repair ${ledgerPath} to {"cap_usd": <n>, "spent_usd": <n>}.`,
      );
    }
  }
  const envCap = env.SPEND_CAP_USD?.trim() ? Number(env.SPEND_CAP_USD) : undefined;
  const cap = ledger?.cap_usd ?? envCap;
  const spent = ledger?.spent_usd ?? 0;
  if (cap === undefined)
    return pass(name, "ledger writable; no spend recorded yet and no SPEND_CAP_USD set");
  if (!Number.isFinite(cap))
    return fail(name, "SPEND_CAP_USD is not a number", "Set SPEND_CAP_USD to a USD amount.");
  const remaining = cap - spent;
  if (remaining < buildCapUsd)
    return fail(
      name,
      `remaining budget $${remaining.toFixed(2)} (cap $${cap}, spent $${spent}) < per-build cap $${buildCapUsd}`,
      "Spend cap exhausted: raise cap_usd (operator decision) or wait for the next budget period before building.",
    );
  return pass(name, `remaining $${remaining.toFixed(2)} >= per-build cap $${buildCapUsd}`);
}

function seoBotRemediation(
  code: SeoBotPreflightError["code"],
  seam: PreflightOptions["seoBot"],
): string {
  switch (code) {
    case "SEO_BOT_UNREACHABLE":
      return `Start SEO-Bot (operator Mac, e.g. http://127.0.0.1:3100) and set ${seam.urlVar} to its base URL.`;
    case "SEO_BOT_AUTH_FAILED":
      return `Seam key is stale: set ${seam.keyVar} to SEO-Bot's current build-intelligence machine key (rotate both sides together).`;
    case "SEO_BOT_CAPABILITY_MISMATCH":
      return "Fix SEO-Bot's own readiness (DataForSEO credentials, LLM provider keys) — run its preflight and clear every non-PASS check.";
  }
}

/**
 * REDESIGN_IMPROVE requires SEO-Bot research before any paid stage. The seam
 * configuration is resolved by the CLI and injected (`options.seoBot`), so this
 * module holds no platform endpoint configuration of its own; the probe runs
 * through the same machine-authenticated client the pipeline uses.
 */
export async function checkSeoBot(
  spec: DomainSpec | undefined,
  options: PreflightOptions,
  deps: PreflightDeps,
): Promise<PreflightCheckResult> {
  const name = "seo_bot.preflight";
  const seam = options.seoBot;
  if (!spec) return skip(name, "spec did not load");
  if (parseBuildIntent(spec.build_intent) !== "REDESIGN_IMPROVE")
    return skip(name, "build_intent is not REDESIGN_IMPROVE");
  const url = seam.url?.trim();
  const key = seam.apiKey?.trim();
  if (isMissing(url))
    return fail(name, `${seam.urlVar} not set`, seoBotRemediation("SEO_BOT_UNREACHABLE", seam));
  if (isMissing(key)) return fail(name, `${seam.keyVar} not set`, SECRET_REMEDIATION(seam.keyVar));
  try {
    const result = await deps
      .seoBotPort(url as string, key as string, options.timeoutMs)
      .preflight();
    return pass(
      name,
      `${url} status=${result.status} version=${result.version} router=${result.llm_router_version}`,
    );
  } catch (error) {
    if (error instanceof SeoBotPreflightError)
      return fail(name, `${error.code}: ${error.message}`, seoBotRemediation(error.code, seam));
    return fail(
      name,
      `unexpected: ${error instanceof Error ? error.message : String(error)}`,
      seoBotRemediation("SEO_BOT_UNREACHABLE", seam),
    );
  }
}

const ENV_REF = /^env:\/\/([A-Z][A-Z0-9_]*)$/;

/** Publish/deploy credentials, resolved the way the publish stages resolve them. */
export function checkPublish(
  spec: DomainSpec | undefined,
  options: PreflightOptions,
): PreflightCheckResult[] {
  const { mode, env } = options;
  if (mode === "local-proof") return [skip("publish.target", "local-proof does not publish")];
  if (!spec) return [skip("publish.target", "spec did not load")];
  const results: PreflightCheckResult[] = [];
  const provisions =
    !spec.deploy && spec.provision !== undefined && spec.provision.enabled !== false;
  if (!spec.deploy && !provisions)
    results.push(
      fail(
        "publish.target",
        "spec has neither a deploy block nor provision config",
        "Add deploy.github_repo (and Vercel ids) to the spec, or a provision block, or run MODE=local-proof.",
      ),
    );
  else
    results.push(
      pass(
        "publish.target",
        spec.deploy ? `deploy.github_repo=${spec.deploy.github_repo}` : "provisioning enabled",
      ),
    );

  const ref = spec.deploy?.publish_credential_ref ?? "env://GITHUB_SITE_TOKEN";
  const match = ENV_REF.exec(ref);
  if (!match)
    results.push(
      fail(
        "secret.github_publish_token",
        `publish_credential_ref ${ref} is not env://NAME`,
        "Set deploy.publish_credential_ref to env://NAME.",
      ),
    );
  else
    results.push(
      isMissing(env[match[1] as string])
        ? fail(
            "secret.github_publish_token",
            `${match[1]} not set`,
            SECRET_REMEDIATION(match[1] as string),
          )
        : pass("secret.github_publish_token", `${match[1]} present`),
    );

  if (mode === "end-to-end") {
    results.push(
      isMissing(env.VERCEL_TOKEN)
        ? fail(
            "secret.VERCEL_TOKEN",
            "not set (required to deploy and observe deployment state)",
            SECRET_REMEDIATION("VERCEL_TOKEN"),
          )
        : pass("secret.VERCEL_TOKEN", "present"),
    );
    const hasProject =
      Boolean(spec.deploy?.vercel_project_id) ||
      Boolean(spec.deploy?.vercel_deploy_hook) ||
      !isMissing(env.CLIENT_VERCEL_PROJECT_ID) ||
      !isMissing(env.CLIENT_VERCEL_DEPLOY_HOOK) ||
      provisions;
    results.push(
      hasProject
        ? pass("vercel.project", "project id, deploy hook or provisioning available")
        : fail(
            "vercel.project",
            "no Vercel project id or deploy hook",
            "Set deploy.vercel_project_id (or deploy.vercel_deploy_hook) in the spec, or CLIENT_VERCEL_PROJECT_ID / CLIENT_VERCEL_DEPLOY_HOOK.",
          ),
    );
  }
  return results;
}
