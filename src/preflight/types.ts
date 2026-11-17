// L9_META: layer=preflight, role=website_preflight_types, status=active, version=1.0.0
//
// Shared types for the `make website` front door. The preflight answers one
// question in seconds and before any paid call: can this spec/mode run to
// completion in this environment? Every check carries a named remediation so a
// FAIL is actionable without reading pipeline source.

import type { SeoBuildIntelligencePort } from "../intelligence/SeoBuildIntelligencePort.js";

/** Pipeline modes the front door can launch. `plan` needs no preflight. */
export const WEBSITE_MODES = ["local-proof", "publish-proof", "end-to-end"] as const;
export type WebsiteMode = (typeof WEBSITE_MODES)[number];

/** SKIP means the check does not apply to this spec/mode; it never blocks. */
export type PreflightCheckStatus = "PASS" | "FAIL" | "SKIP";

export interface PreflightCheckResult {
  name: string;
  status: PreflightCheckStatus;
  /** Facts only. Never a secret value. */
  detail: string;
  /** Present on every FAIL: the concrete operator action that clears it. */
  remediation?: string;
}

export interface PreflightReport {
  mode: WebsiteMode;
  specPath: string;
  ok: boolean;
  checks: PreflightCheckResult[];
}

/** Environment view. Secrets are only tested for presence, never echoed. */
export type PreflightEnv = Readonly<Record<string, string | undefined>>;

/** Spend-ledger file shape read by the budget check. */
export interface SpendLedgerFile {
  cap_usd: number;
  spent_usd: number;
}

/** Everything that touches the world, injectable so tests use fakes. */
export interface PreflightDeps {
  readText(path: string): string;
  exists(path: string): boolean;
  /** Returns undefined when writable, otherwise the error code/message. */
  writableError(path: string): string | undefined;
  /** Builds the SEO-Bot client the pipeline itself uses, with a short timeout. */
  seoBotPort(baseUrl: string, apiKey: string, timeoutMs: number): SeoBuildIntelligencePort;
  /** Resolves a spec-relative or cwd-relative path the way the pipeline does. */
  resolvePath(path: string): string;
}

export interface PreflightOptions {
  mode: WebsiteMode;
  specPath: string;
  env: PreflightEnv;
  /** Per-build spend cap in USD (default 10). */
  buildCapUsd: number;
  /** Network timeout for SEO-Bot probes. */
  timeoutMs: number;
  /** Known DeepSeek model ids (priced); a model outside this set is retired/unknown. */
  knownDeepSeekModels: readonly string[];
  defaultDeepSeekModel: string;
  /**
   * SEO-Bot seam configuration, resolved by the CLI. `urlVar` / `keyVar` name
   * the settings so remediations can point at them; values are never printed.
   */
  seoBot: { url?: string; apiKey?: string; urlVar: string; keyVar: string };
  /** Provenance of secret hydration (Infisical / process env), names only. */
  secretSource?: { bootstrapPresent: boolean; sourceMode: string };
}
