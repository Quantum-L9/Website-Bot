#!/usr/bin/env tsx

/**
 * Website-Bot Validation Executor
 *
 * Evidence-driven validation execution using the @quantum-l9/validation-executor package
 * with Website-Bot specific adapter
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WebsiteBotAdapter } from "../packages/validation-executor/src/adapters/WebsiteBotAdapter.js";
import { AuditReporter } from "../packages/validation-executor/src/core/AuditReporter.js";
import { ValidationExecutor } from "../packages/validation-executor/src/core/ValidationExecutor.js";
import type { ValidationConfig } from "../packages/validation-executor/src/types/index.js";
import { buildValidationCliOptions } from "../packages/validation-executor/src/utils/cliOptions.js";
import { createLogger } from "../packages/validation-executor/src/utils/logger.js";
import {
  collectWebsiteBotConfigErrors,
  resolveProfileRun,
  WEBSITE_BOT_VALIDATION_PROFILES,
} from "./lib/validation-profiles.mjs";

const logger = createLogger("WebsiteBotValidation");

async function assertEvidenceRootWritable(evidenceRoot: string): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const evidencePath = path.resolve(evidenceRoot);
    await fs.mkdir(evidencePath, { recursive: true });
    const testFile = path.join(evidencePath, ".write-test");
    await fs.writeFile(testFile, "test", "utf8");
    await fs.unlink(testFile);
    return null;
  } catch (error) {
    return `Evidence root '${evidenceRoot}' is not writable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function validateWebsiteBotConfiguration(options: any): Promise<void> {
  const errors = collectWebsiteBotConfigErrors(options);

  if (options["evidence-root"]) {
    const writeError = await assertEvidenceRootWritable(options["evidence-root"]);
    if (writeError) errors.push(writeError);
  }

  if (errors.length > 0) {
    console.error("\nWebsite-Bot Configuration Validation Errors:");
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error("\nRun with --help to see valid options.\n");
    process.exit(1);
  }
}

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: buildValidationCliOptions({
        evidenceRoot: "build/evidence",
        output: "validation/validation_report.yaml",
      }),
    });

    if (values.help) {
      printHelp();
      process.exit(0);
    }

    const command = positionals[0] || "run";

    if (values.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    logger.info(
      {
        command,
        profile: values.profile,
        environment: values.environment,
      },
      "Starting Website-Bot validation execution",
    );

    switch (command) {
      case "run":
        await runValidation(values);
        break;
      case "clean":
        await cleanEvidence(values);
        break;
      default:
        logger.error({ command }, "Unknown command");
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.error({ error }, "Validation execution failed");
    process.exit(1);
  }
}

async function runValidation(options: any) {
  await validateWebsiteBotConfiguration(options);

  const profileDecision = resolveProfileRun(options.profile);
  if (profileDecision.status === "INVALID_PROFILE" || profileDecision.status === "INCOMPLETE") {
    const payload = {
      status: profileDecision.status,
      non_evidence: profileDecision.nonEvidence,
      reason: profileDecision.reason,
      profile: options.profile,
    };
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\n=== VALIDATION SUMMARY ===`);
    console.log(`Verdict: ${profileDecision.status}`);
    console.log(`non_evidence: ${profileDecision.nonEvidence}`);
    console.log(`Reason: ${profileDecision.reason}`);
    process.exit(profileDecision.exitCode);
  }

  const config: ValidationConfig = {
    environment: options.environment,
    profile: options.profile,
    evidence_root: options["evidence-root"],
    timeout: Number.parseInt(options.timeout, 10),
    fail_fast: options["fail-fast"],
    preflight_commands: getProfilePreflightCommands(options.profile),
    e2e_commands: getProfileE2ECommands(options.profile),
  };

  const adapter = new WebsiteBotAdapter();
  const executor = new ValidationExecutor(adapter, config);

  logger.info({ profile: options.profile }, "Executing validation with Website-Bot adapter");

  const report = await executor.execute();

  const reporter = new AuditReporter();
  await reporter.writeReport(report, options.output as string);

  logger.info(
    {
      verdict: report.final_verdict.status,
      output: options.output,
      duration: report.run_metadata.duration,
      preflightChecks: report.preflight_results.length,
      e2eTests: report.e2e_results.length,
    },
    "Website-Bot validation completed",
  );

  console.log("\n=== VALIDATION SUMMARY ===");
  console.log(`Verdict: ${report.final_verdict.status}`);
  console.log(
    `Preflight: ${report.preflight_summary.passed}/${report.preflight_summary.discovered} passed`,
  );
  console.log(
    `E2E Tests: ${report.e2e_summary.passed}/${report.e2e_summary.discovered_required_tests} passed`,
  );
  console.log(`Duration: ${Math.round(report.run_metadata.duration / 1000)}s`);
  console.log(`Report: ${options.output}`);

  if (report.final_verdict.status !== "PASS") {
    console.log(`\nNext Action: ${report.minimum_safe_next_action.action}`);
    console.log(`Reason: ${report.minimum_safe_next_action.blocker_or_failure}`);
  }

  if (report.final_verdict.status === "FAIL") {
    process.exit(1);
  } else if (report.final_verdict.status === "INCOMPLETE") {
    process.exit(2);
  }
  // Explicit exit on PASS — pino / open handles otherwise keep the event loop alive.
  process.exit(0);
}

function getProfilePreflightCommands(profile: string): string[] {
  const baseCommands = ["npm run typecheck", "npm run normalize-spec:check"];

  switch (profile) {
    case "preflight":
    case "source":
    case "build":
    case "smoke":
      return baseCommands;
    case "form":
    case "analytics":
    case "crm":
    case "seo":
    case "rollback":
      return ["node -e \"require('node:fs').accessSync('astro_template/package.json')\""];
    default:
      return [...baseCommands, "npm run evidence:schemas", "npm run validate"];
  }
}

function getProfileE2ECommands(profile: string): string[] {
  switch (profile) {
    case "preflight":
      return [];
    case "source":
      return ["npm run site:validate"];
    case "build":
      return ["npm run site:validate", "npm run evidence:test"];
    case "smoke":
      return ["npm run site:test:local"];
    case "form":
    case "analytics":
    case "crm":
    case "seo":
    case "rollback":
      return [`npm --prefix astro_template run verify:${profile}`];
    default:
      return [
        "npm run site:validate",
        "npm run evidence:test",
        "npm run site:test:local",
        "npm run provision:test",
        "npm run pipeline:plan",
        "npm run alignment:boundaries",
      ];
  }
}

async function cleanEvidence(options: any) {
  const evidenceDir = options["evidence-root"];

  try {
    const { rm } = await import("node:fs/promises");
    await rm(evidenceDir, { recursive: true, force: true });
    logger.info({ evidenceDir }, "Evidence directory cleaned");
  } catch (error) {
    logger.warn({ error, evidenceDir }, "Could not clean evidence directory");
  }
}

function printHelp() {
  console.log(`
Website-Bot Validation Executor

USAGE:
  tsx scripts/validation-executor.ts [COMMAND] [OPTIONS]

COMMANDS:
  run     Execute validation suite (default)
  clean   Clean evidence directory

OPTIONS:
  -p, --profile <profile>      Validation profile (${WEBSITE_BOT_VALIDATION_PROFILES.join("|")})
  -e, --environment <env>      Target environment (development|staging|production|test|ci)
  --evidence-root <path>       Evidence storage directory (default: build/evidence)
  -o, --output <file>          Report output file (default: validation/validation_report.yaml)
  --timeout <ms>               Command timeout in milliseconds (default: 300000)
  --fail-fast                  Stop on first failure
  -v, --verbose                Enable verbose logging
  -h, --help                   Show this help

PROFILES:
  default     Full validation suite (preflight + E2E)
  preflight   Only preflight checks
  source      Source validation
  build       Build validation
  smoke       Smoke tests
  form        Form validation (astro_template structural checks)
  analytics   Analytics validation (astro_template structural checks)
  crm         CRM validation (astro_template structural checks)
  seo         SEO validation (astro_template structural checks)
  rollback    Rollback validation (astro_template structural checks)

EXAMPLES:
  tsx scripts/validation-executor.ts run --profile preflight
  tsx scripts/validation-executor.ts run --environment ci --output ci_report.yaml
  tsx scripts/validation-executor.ts clean
`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await main();
}
