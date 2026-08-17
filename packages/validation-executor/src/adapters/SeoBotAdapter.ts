import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  E2ETestDefinition,
  ExecutionContext,
  PreflightCheckDefinition,
  RepositoryAdapter,
  ValidationConfig,
} from "../types/index.js";
import { createLogger } from "../utils/logger.js";
import { executeAdapterCommand, resolveTrustedExecutable } from "../utils/secureExecution.js";

/**
 * SEO-Bot specific adapter for the validation executor
 * Integrates with SEO-Bot specific patterns and tooling
 */
export class SeoBotAdapter implements RepositoryAdapter {
  private readonly logger = createLogger("SeoBotAdapter");

  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    this.logger.info("Resolving SEO-Bot execution context");

    const targetRoots = [process.cwd()];
    const sourceRevision = await this.getGitRevision();
    const packageJson = this.getPackageJson();

    return {
      target_roots: targetRoots,
      source_revision: sourceRevision || "unknown",
      running_revision: null,
      target_environment: config.environment || "development",
      environment_type: "development",
      active_identity: this.getActiveIdentity(),
      preflight_commands: this.getPreflightCommands(),
      e2e_commands: this.getE2ECommands(),
      test_runner: "node:test",
      test_runner_version: process.version,
      configuration_sources: this.getConfigurationSources(),
      required_services: ["seo-analysis-service"],
      target_endpoints: ["https://localhost:3000"],
      required_dependencies: this.getRequiredDependencies(packageJson),
      required_credentials: [],
      evidence_root: config.evidence_root || "evidence",
    };
  }

  async discoverPreflightChecks(): Promise<PreflightCheckDefinition[]> {
    this.logger.info("Discovering SEO-Bot preflight checks");

    const checks: PreflightCheckDefinition[] = [];

    // SEO-Bot specific checks
    if (existsSync("package.json")) {
      checks.push({
        check_id: "seo-dependencies",
        check_name: "SEO Dependencies Check",
        blocking: true,
        command: "npm list --depth=0",
        working_directory: process.cwd(),
      });
    }

    // TypeScript compilation check
    if (existsSync("tsconfig.json")) {
      checks.push({
        check_id: "typecheck",
        check_name: "TypeScript Type Check",
        blocking: true,
        command: "npm run typecheck",
        working_directory: process.cwd(),
      });
    }

    // Lint check
    if (
      existsSync(".eslintrc.js") ||
      existsSync(".eslintrc.json") ||
      existsSync("eslint.config.js")
    ) {
      checks.push({
        check_id: "lint",
        check_name: "ESLint Check",
        blocking: false,
        command: "npm run lint",
        working_directory: process.cwd(),
      });
    }

    // SEO configuration validation
    if (existsSync("seo.config.js") || existsSync("seo.config.json")) {
      checks.push({
        check_id: "seo-config",
        check_name: "SEO Configuration Validation",
        blocking: true,
        command: "npm run validate:seo-config",
        working_directory: process.cwd(),
      });
    }

    this.logger.info({ count: checks.length }, "Preflight checks discovered");
    return checks;
  }

  async discoverE2ETests(): Promise<E2ETestDefinition[]> {
    this.logger.info("Discovering SEO-Bot E2E tests");

    const tests: E2ETestDefinition[] = [];

    // SEO analysis tests
    if (existsSync("package.json")) {
      const packageJson = this.getPackageJson();

      if (packageJson.scripts?.["test:seo"]) {
        tests.push({
          suite_id: "seo-analysis",
          suite_name: "SEO Analysis Suite",
          test_id: "seo-analysis-test",
          test_name: "SEO Analysis Tests",
          attempt: 1,
          command_or_invocation: "npm run test:seo",
        });
      }

      if (packageJson.scripts?.["test:crawl"]) {
        tests.push({
          suite_id: "crawling",
          suite_name: "Web Crawling Suite",
          test_id: "crawl-test",
          test_name: "Web Crawling Tests",
          attempt: 1,
          command_or_invocation: "npm run test:crawl",
        });
      }

      if (packageJson.scripts?.["test:integration"]) {
        tests.push({
          suite_id: "integration",
          suite_name: "Integration Test Suite",
          test_id: "integration-test",
          test_name: "Integration Tests",
          attempt: 1,
          command_or_invocation: "npm run test:integration",
        });
      }

      // Default test command if available
      if (packageJson.scripts?.test && tests.length === 0) {
        tests.push({
          suite_id: "general",
          suite_name: "General Test Suite",
          test_id: "general-test",
          test_name: "General Tests",
          attempt: 1,
          command_or_invocation: "npm test",
        });
      }
    }

    this.logger.info({ count: tests.length }, "E2E tests discovered");
    return tests;
  }

  executeCommand(command: string, workingDir: string) {
    return Promise.resolve(
      executeAdapterCommand(command, workingDir, 300_000, this.logger, "SEO-Bot"),
    );
  }

  async storeEvidence(evidenceId: string, data: any): Promise<string> {
    // Store evidence in SEO-Bot compatible format
    const evidenceRoot = process.env.EVIDENCE_ROOT || "evidence";
    const evidencePath = join(evidenceRoot, `${evidenceId}.json`);

    // Ensure the evidence directory exists
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");

    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(data, null, 2), "utf8");

    this.logger.debug({ evidenceId, evidencePath }, "Evidence stored");
    return evidencePath;
  }

  private async getGitRevision(): Promise<string | null> {
    try {
      const result = spawnSync(resolveTrustedExecutable("git"), ["rev-parse", "HEAD"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5000,
      });

      if (result.status === 0 && result.stdout) {
        return result.stdout.trim();
      }
    } catch (error) {
      this.logger.debug({ error }, "Git revision not available");
    }

    return null;
  }

  private getPackageJson(): any {
    try {
      if (existsSync("package.json")) {
        return JSON.parse(readFileSync("package.json", "utf8"));
      }
    } catch (error) {
      this.logger.warn("Could not read package.json");
    }
    return {};
  }

  private getActiveIdentity(): string {
    try {
      const result = spawnSync(resolveTrustedExecutable("git"), ["config", "user.email"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5000,
      });

      if (result.status === 0 && result.stdout) {
        return result.stdout.trim();
      }
    } catch (error) {
      this.logger.debug({ error }, "Git user.email not available");
    }

    return "unknown@seobot.com";
  }

  private getPreflightCommands(): string[] {
    const packageJson = this.getPackageJson();
    const commands: string[] = [];

    if (packageJson.scripts?.typecheck) {
      commands.push("npm run typecheck");
    }
    if (packageJson.scripts?.lint) {
      commands.push("npm run lint");
    }
    if (packageJson.scripts?.["validate:seo-config"]) {
      commands.push("npm run validate:seo-config");
    }

    return commands.length > 0 ? commands : ['echo "No preflight commands configured"'];
  }

  private getE2ECommands(): string[] {
    const packageJson = this.getPackageJson();
    const commands: string[] = [];

    if (packageJson.scripts?.["test:seo"]) {
      commands.push("npm run test:seo");
    }
    if (packageJson.scripts?.["test:crawl"]) {
      commands.push("npm run test:crawl");
    }
    if (packageJson.scripts?.["test:integration"]) {
      commands.push("npm run test:integration");
    }
    if (packageJson.scripts?.test && commands.length === 0) {
      commands.push("npm test");
    }

    return commands.length > 0 ? commands : ['echo "No E2E tests configured"'];
  }

  private getConfigurationSources(): string[] {
    const sources: string[] = ["package.json"];

    if (existsSync("tsconfig.json")) sources.push("tsconfig.json");
    if (existsSync(".eslintrc.js")) sources.push(".eslintrc.js");
    if (existsSync(".eslintrc.json")) sources.push(".eslintrc.json");
    if (existsSync("eslint.config.js")) sources.push("eslint.config.js");
    if (existsSync("seo.config.js")) sources.push("seo.config.js");
    if (existsSync("seo.config.json")) sources.push("seo.config.json");

    return sources;
  }

  private getRequiredDependencies(packageJson: any): string[] {
    const dependencies: string[] = [];

    if (packageJson.dependencies) {
      dependencies.push(...Object.keys(packageJson.dependencies));
    }
    if (packageJson.devDependencies) {
      dependencies.push(...Object.keys(packageJson.devDependencies));
    }

    return dependencies;
  }
}
