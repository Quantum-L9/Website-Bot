#!/usr/bin/env node

import { parseArgs } from "node:util";
import { AuditReporter } from "./core/AuditReporter.js";
import { ValidationExecutor } from "./core/ValidationExecutor.js";
import { buildValidationCliOptions } from "./utils/cliOptions.js";

async function tryLoadAdapter(
  modulePath: string,
  className: string,
  warnLabel: string,
): Promise<RepositoryAdapter | undefined> {
  try {
    const adapterModule = await import(modulePath);
    const AdapterClass = adapterModule[className];
    return new AdapterClass();
  } catch (error) {
    console.warn(`${warnLabel} not available, falling back to default adapter`, error);
    return undefined;
  }
}

function looksLikeSeoBot(packageJson: any, fs: typeof import("node:fs")): boolean {
  return (
    packageJson.name?.includes("seo-bot") ||
    packageJson.name?.includes("SEO-Bot") ||
    packageJson.keywords?.includes("seo") ||
    packageJson.scripts?.["test:seo"] ||
    packageJson.scripts?.["test:crawl"] ||
    fs.existsSync("seo.config.js") ||
    fs.existsSync("seo.config.json")
  );
}

function looksLikeWebsiteBot(packageJson: any, fs: typeof import("node:fs")): boolean {
  return (
    packageJson.name?.includes("website-bot") ||
    packageJson.name?.includes("Website-Bot") ||
    fs.existsSync("astro_template") ||
    packageJson.dependencies?.["astro"] ||
    packageJson.devDependencies?.["astro"]
  );
}

async function loadExplicitAdapter(repositoryType: string): Promise<RepositoryAdapter | null> {
  // Handle explicit repository type override
  switch (repositoryType.toLowerCase()) {
    case "website-bot":
      return await tryLoadAdapter(
        "./adapters/WebsiteBotAdapter.js",
        "WebsiteBotAdapter",
        "WebsiteBotAdapter",
      );
    case "seo-bot":
      return await tryLoadAdapter(
        "./adapters/SeoBotAdapter.js",
        "SeoBotAdapter",
        "SeoBotAdapter",
      );
    case "default":
      return new DefaultRepositoryAdapter();
    default:
      console.warn(`Unknown repository type '${repositoryType}', using auto-detection`);
      return null;
  }
}

async function autoDetectAdapter(
  fs: typeof import("node:fs"),
  packageJson: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): Promise<RepositoryAdapter | null> {
  // Check for SEO-Bot patterns
  if (looksLikeSeoBot(packageJson, fs)) {
    const adapter = await tryLoadAdapter(
      "./adapters/SeoBotAdapter.js",
      "SeoBotAdapter",
      "SeoBotAdapter",
    );
    if (adapter) return adapter;
  }

  // Check for Website-Bot patterns
  if (looksLikeWebsiteBot(packageJson, fs)) {
    const adapter = await tryLoadAdapter(
      "./adapters/WebsiteBotAdapter.js",
      "WebsiteBotAdapter",
      "WebsiteBotAdapter",
    );
    if (adapter) return adapter;
  }
  return null;
}

async function loadRepositoryAdapter(repositoryType: string = "auto"): Promise<RepositoryAdapter> {
  const fs = await import("node:fs");

  if (repositoryType !== "auto") {
    const explicit = await loadExplicitAdapter(repositoryType);
    if (explicit) return explicit;
  }

  // Auto-detect project type based on file patterns
  if (fs.existsSync("package.json")) {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const detected = await autoDetectAdapter(fs, packageJson);
    if (detected) return detected;
  }

  // Fallback to default adapter
  return new DefaultRepositoryAdapter();
}

import type { ExecutionContext, RepositoryAdapter, ValidationConfig } from "./types/index.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("ValidationExecutorCLI");

// Default adapter implementation for CLI usage
class DefaultRepositoryAdapter implements RepositoryAdapter {
  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    // This would be implemented by specific repository adapters
    throw new Error(
      "Repository adapter not implemented - use a specific adapter for your repository type",
    );
  }

  async discoverPreflightChecks() {
    return [];
  }

  async discoverE2ETests() {
    return [];
  }

  async executeCommand(command: string, workingDir: string) {
    const { executeAdapterCommand } = await import("./utils/secureExecution.js");
    return executeAdapterCommand(command, workingDir);
  }

  async storeEvidence(evidenceId: string, data: any) {
    // Default evidence storage - would be customized by specific adapters
    return `evidence/${evidenceId}.json`;
  }
}

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: buildValidationCliOptions({
        evidenceRoot: "validation",
        output: "validation_report.yaml",
        repositoryType: "auto",
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

    logger.info({ command, profile: values.profile }, "Starting validation executor");

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
    logger.error({ error }, "CLI execution failed");
    process.exit(1);
  }
}

function validateTimeoutOption(options: any, errors: string[]): void {
  // Validate timeout range (min: 1000ms, max: 1800000ms = 30 minutes)
  const timeout = Number.parseInt(options.timeout, 10);
  if (Number.isNaN(timeout)) {
    errors.push(`Invalid timeout value '${options.timeout}': must be a number`);
  } else if (timeout < 1000) {
    errors.push(`Timeout ${timeout}ms is too low: minimum is 1000ms (1 second)`);
  } else if (timeout > 1800000) {
    errors.push(`Timeout ${timeout}ms is too high: maximum is 1800000ms (30 minutes)`);
  }
}

function stringifyOptionValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "unstringifiable option value";
}

function validateWhitelistOption(
  value: unknown,
  allowed: string[],
  optionLabel: string,
  pluralLabel: string,
  errors: string[],
): void {
  if (!value) return;
  const stringValue = stringifyOptionValue(value);
  if (!allowed.includes(stringValue)) {
    errors.push(
      `Unknown ${optionLabel} '${stringValue}': valid ${pluralLabel} are ${allowed.join(", ")}`,
    );
  }
}

/**
 * Verify a directory is writable by creating and removing a probe file.
 * Returns an error description, or undefined when the directory is writable.
 */
async function verifyWritableDirectory(
  targetDirectory: string,
  errorLabel: string,
): Promise<string | undefined> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const resolvedDir = path.resolve(targetDirectory);

    // Try to create the directory if it doesn't exist
    await fs.mkdir(resolvedDir, { recursive: true });

    // Test writeability by creating a temporary file
    const testFile = path.join(resolvedDir, ".write-test");
    await fs.writeFile(testFile, "test", "utf8");
    await fs.unlink(testFile);
    return undefined;
  } catch (error) {
    return `${errorLabel} is not writable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function validateConfiguration(options: any): Promise<void> {
  const errors: string[] = [];

  validateTimeoutOption(options, errors);

  // Validate profile name against whitelist
  validateWhitelistOption(
    options.profile,
    ["default", "ci", "development", "staging", "production", "test"],
    "profile",
    "profiles",
    errors,
  );

  // Validate environment type constraints
  validateWhitelistOption(
    options.environment,
    ["development", "staging", "production", "test", "ci"],
    "environment",
    "environments",
    errors,
  );

  // Validate repository type
  validateWhitelistOption(
    options["repository-type"],
    ["auto", "website-bot", "seo-bot", "default"],
    "repository type",
    "types",
    errors,
  );

  // Validate evidence root path writeability
  if (options["evidence-root"]) {
    const problem = await verifyWritableDirectory(
      options["evidence-root"],
      `Evidence root '${options["evidence-root"]}'`,
    );
    if (problem) errors.push(problem);
  }

  // Validate output file path writeability
  if (options.output) {
    const path = await import("node:path");
    const problem = await verifyWritableDirectory(
      path.dirname(path.resolve(options.output)),
      `Output path '${options.output}' directory`,
    );
    if (problem) errors.push(problem);
  }

  // If there are validation errors, report them and exit
  if (errors.length > 0) {
    console.error("\nConfiguration Validation Errors:");
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error("\nRun with --help to see valid options.\n");
    process.exit(1);
  }
}

async function runValidation(options: any) {
  // Validate CLI configuration parameters
  await validateConfiguration(options);

  const config: ValidationConfig = {
    environment: options.environment,
    profile: options.profile,
    evidence_root: options["evidence-root"],
    timeout: Number.parseInt(options.timeout, 10),
    fail_fast: options["fail-fast"],
  };

  // Load repository-specific adapter based on detected project type
  const adapter = await loadRepositoryAdapter(options["repository-type"] as string);

  const executor = new ValidationExecutor(adapter, config);
  const report = await executor.execute();

  // Write YAML report
  const reporter = new AuditReporter();
  await reporter.writeReport(report, options.output as string);

  logger.info(
    {
      verdict: report.final_verdict.status,
      output: options.output,
      duration: report.run_metadata.duration,
    },
    "Validation completed",
  );

  // Exit with appropriate code
  if (report.final_verdict.status === "FAIL") {
    process.exit(1);
  } else if (report.final_verdict.status === "INCOMPLETE") {
    process.exit(2);
  }
  // Explicit exit on PASS — open logger handles otherwise keep the event loop alive.
  process.exit(0);
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
Quantum L9 Validation Executor

USAGE:
  validation-executor [COMMAND] [OPTIONS]

COMMANDS:
  run     Execute validation suite (default)
  clean   Clean evidence directory

OPTIONS:
  -p, --profile <profile>      Validation profile to use (default: default)
  -e, --environment <env>      Target environment  
  --evidence-root <path>       Evidence storage directory (default: validation)
  -o, --output <file>          Report output file (default: validation_report.yaml)
  --timeout <ms>               Command timeout in milliseconds (default: 300000)
  --fail-fast                  Stop on first failure
  --repository-type <type>     Repository type (auto, website-bot, seo-bot, default)
  -v, --verbose                Enable verbose logging
  -h, --help                   Show this help

EXAMPLES:
  validation-executor run --profile ci
  validation-executor run --environment staging --output ci_report.yaml
  validation-executor clean
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { main as cli };
