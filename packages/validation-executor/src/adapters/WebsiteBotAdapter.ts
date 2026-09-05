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
 * Website-Bot specific adapter for the validation executor
 * Integrates with the existing factory pipeline and evidence infrastructure
 */
export class WebsiteBotAdapter implements RepositoryAdapter {
  private readonly logger = createLogger("WebsiteBotAdapter");

  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    this.logger.info("Resolving Website-Bot execution context");

    const targetRoots = [process.cwd()];
    const sourceRevision = await this.getGitRevision();
    const packageJson = this.getPackageJson();

    return {
      target_roots: targetRoots,
      source_revision: sourceRevision,
      running_revision: null,
      target_environment: config.environment || this.detectEnvironment(),
      environment_type: this.classifyEnvironment(config.environment || this.detectEnvironment()),
      active_identity: await this.getGitUserEmail(),
      preflight_commands: config.preflight_commands || (await this.discoverPreflightCommands()),
      e2e_commands: config.e2e_commands || (await this.discoverE2ECommands()),
      test_runner: "node:test",
      test_runner_version: process.version,
      configuration_sources: this.getConfigurationSources(),
      required_services: this.getRequiredServices(packageJson),
      target_endpoints: this.getTargetEndpoints(),
      required_dependencies: Object.keys({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }),
      required_credentials: this.getRequiredCredentials(),
      evidence_root: config.evidence_root || this.getEvidenceRoot(),
    };
  }

  /**
   * Profile tiers control how much of the merge-gate suite is discovered:
   *   - 'development' → FAST subset: quick static checks only (typecheck, spec
   *     normalization, evidence schemas, launch-env), skipping the heavier
   *     build/pipeline gates for a fast local smoke check.
   *   - 'form' | 'analytics' | 'crm' | 'seo' | 'rollback' → site-template
   *     structural checks under `astro_template/` only.
   *   - 'default' | 'ci' | 'staging' | 'production' | 'test' → FULL set: every
   *     preflight check, including the four blocking gates that mirror
   *     build-and-validate.yml, so the verdict tracks mergeability.
   */
  private isFastProfile(profile?: string): boolean {
    return profile === "development";
  }

  private isSiteTemplateProfile(profile?: string): boolean {
    return ["form", "analytics", "crm", "seo", "rollback"].includes(profile ?? "");
  }

  async discoverPreflightChecks(profile?: string): Promise<PreflightCheckDefinition[]> {
    const checks: PreflightCheckDefinition[] = [];
    const packageJson = this.getPackageJson();
    const cwd = process.cwd();
    const fast = this.isFastProfile(profile);
    const hasScript = (name: string): boolean => Boolean(packageJson.scripts?.[name]);

    if (this.isSiteTemplateProfile(profile)) {
      checks.push({
        check_id: "astro-template-present",
        check_name: "Astro template package present",
        blocking: true,
        command: "node -e \"require('node:fs').accessSync('astro_template/package.json')\"",
        working_directory: cwd,
      });
      return checks;
    }

    // Core TypeScript compilation check (always required for Website-Bot)
    checks.push({
      check_id: "typecheck",
      check_name: "TypeScript Type Check",
      blocking: true,
      command: "npm run typecheck",
      working_directory: cwd,
    });

    // Fast static checks — run in every profile (only if the script exists)
    if (hasScript("normalize-spec:check")) {
      checks.push({
        check_id: "normalize-spec-check",
        check_name: "Domain Spec Normalization Check",
        blocking: true,
        command: "npm run normalize-spec:check",
        working_directory: cwd,
      });
    }

    if (hasScript("evidence:schemas")) {
      checks.push({
        check_id: "evidence-schemas",
        check_name: "Evidence Schema Validation",
        blocking: true,
        command: "npm run evidence:schemas",
        working_directory: cwd,
      });
    }

    // Heavier blocking gates mirroring .github/workflows/build-and-validate.yml.
    // These gate merge, so they are blocking; skipped only in the fast profile.
    if (!fast) {
      const buildGates: Array<{ script: string; check_id: string; check_name: string }> = [
        {
          script: "evidence:contract-parity",
          check_id: "evidence-contract-parity",
          check_name: "Cross-Repository Contract Lock",
        },
        {
          script: "site:test:local",
          check_id: "site-test-local",
          check_name: "Site-Factory Deterministic Local Tests",
        },
        {
          script: "provision:test",
          check_id: "provision-test",
          check_name: "Provisioning Transaction Tests",
        },
        {
          script: "pipeline:plan",
          check_id: "pipeline-plan",
          check_name: "Plan-Mode Pipeline Proof",
        },
      ];
      for (const gate of buildGates) {
        if (hasScript(gate.script)) {
          checks.push({
            check_id: gate.check_id,
            check_name: gate.check_name,
            blocking: true,
            command: `npm run ${gate.script}`,
            working_directory: cwd,
          });
        }
      }
    }

    // Validation check is non-blocking and only added if script exists
    if (hasScript("validate")) {
      checks.push({
        check_id: "launch-env-validation",
        check_name: "Launch Environment Validation",
        blocking: false,
        command: "npm run validate",
        working_directory: cwd,
      });
    }

    return checks;
  }

  async discoverE2ETests(profile?: string): Promise<E2ETestDefinition[]> {
    const tests: E2ETestDefinition[] = [];
    const packageJson = this.getPackageJson();
    const fast = this.isFastProfile(profile);

    if (this.isSiteTemplateProfile(profile) && profile) {
      tests.push({
        suite_id: "site-template",
        suite_name: "Astro Template Site Validation",
        test_id: `verify-${profile}`,
        test_name: `${profile} site-template validation`,
        attempt: 1,
        command_or_invocation: `npm --prefix astro_template run verify:${profile}`,
      });
      return tests;
    }

    // Core E2E tests - only add if scripts actually exist.
    // The fast (development) profile keeps only the essential site smoke test;
    // full profiles run the entire E2E suite.
    const coreTests = [
      {
        script: "site:validate",
        id: "site-validate",
        name: "Site Factory Validation",
        suite: "factory-validation",
        fast: true,
      },
      {
        script: "evidence:test",
        id: "evidence-test",
        name: "Evidence System Tests",
        suite: "factory-validation",
        fast: false,
      },
      {
        script: "test:integration",
        id: "integration-test",
        name: "Integration Tests",
        suite: "integration",
        fast: false,
      },
      { script: "test", id: "unit-test", name: "Unit Tests", suite: "unit", fast: false },
    ];

    for (const testConfig of coreTests) {
      if (fast && !testConfig.fast) {
        continue;
      }
      if (packageJson.scripts?.[testConfig.script]) {
        tests.push({
          suite_id: testConfig.suite,
          suite_name: this.getSuiteName(testConfig.suite),
          test_id: testConfig.id,
          test_name: testConfig.name,
          attempt: 1,
          command_or_invocation: `npm run ${testConfig.script}`,
        });
      }
    }

    // Extension point: Allow custom E2E test discovery
    // Future implementations can override this method to add repository-specific tests

    return tests;
  }

  async executeCommand(command: string, workingDir: string) {
    return executeAdapterCommand(command, workingDir, 300_000, this.logger, "Website-Bot");
  }

  async storeEvidence(evidenceId: string, data: any): Promise<string> {
    // Use Website-Bot's evidence infrastructure
    const evidenceRoot = this.getEvidenceRoot();
    const evidencePath = join(evidenceRoot, `${evidenceId}.json`);

    // Ensure the evidence directory exists
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");

    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(data, null, 2), "utf8");

    return evidencePath;
  }

  private async getGitRevision(): Promise<string> {
    try {
      const result = spawnSync(resolveTrustedExecutable("git"), ["rev-parse", "HEAD"], {
        encoding: "utf8",
        cwd: process.cwd(),
      });

      return result.status === 0 ? result.stdout.trim() : "Unknown";
    } catch {
      return "Unknown";
    }
  }

  private async getGitUserEmail(): Promise<string> {
    try {
      const result = spawnSync(resolveTrustedExecutable("git"), ["config", "user.email"], {
        encoding: "utf8",
        cwd: process.cwd(),
      });

      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      // Ignore errors
    }

    return process.env.USER || process.env.USERNAME || "Unknown";
  }

  private getPackageJson(): any {
    try {
      const packagePath = join(process.cwd(), "package.json");
      const content = readFileSync(packagePath, "utf8");
      return JSON.parse(content);
    } catch {
      return { dependencies: {}, devDependencies: {}, scripts: {} };
    }
  }

  private detectEnvironment(): string {
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      return "ci";
    }
    if (process.env.VERCEL_ENV) {
      return process.env.VERCEL_ENV;
    }
    return process.env.NODE_ENV || "local";
  }

  private classifyEnvironment(env: string): string {
    if (["production", "prod"].includes(env.toLowerCase())) {
      return "production";
    }
    if (["staging", "stage", "preview"].includes(env.toLowerCase())) {
      return "staging";
    }
    if (["test", "testing", "ci"].includes(env.toLowerCase())) {
      return "isolated_test";
    }
    return "local";
  }

  private async discoverPreflightCommands(): Promise<string[]> {
    const packageJson = this.getPackageJson();
    const commands: string[] = [];

    // Only include commands that actually exist in package.json
    const potentialCommands = ["typecheck", "normalize-spec:check", "evidence:schemas", "validate"];

    for (const cmd of potentialCommands) {
      if (packageJson.scripts?.[cmd]) {
        commands.push(`npm run ${cmd}`);
      }
    }

    return commands.length > 0 ? commands : ['echo "No preflight commands configured"'];
  }

  private async discoverE2ECommands(): Promise<string[]> {
    const packageJson = this.getPackageJson();
    const commands: string[] = [];

    // Only include commands that actually exist in package.json
    const potentialCommands = ["site:validate", "evidence:test", "test:integration", "test"];

    for (const cmd of potentialCommands) {
      if (packageJson.scripts?.[cmd]) {
        commands.push(`npm run ${cmd}`);
      }
    }

    return commands.length > 0 ? commands : ['echo "No E2E tests configured"'];
  }

  private getConfigurationSources(): string[] {
    const sources: string[] = [];

    // Core configuration files that are always relevant
    const coreFiles = ["package.json", "tsconfig.json"];

    for (const file of coreFiles) {
      if (existsSync(file)) {
        sources.push(file);
      }
    }

    // Extension point: Additional config files can be added by subclasses
    // or detected dynamically based on project needs

    return sources;
  }

  private getRequiredServices(packageJson: any): string[] {
    const services: string[] = [];
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Only detect critical services that are commonly used
    if (deps["better-sqlite3"]) {
      services.push("sqlite");
    }

    // Extension point: Additional service detection can be added as needed

    return services;
  }

  private getTargetEndpoints(): string[] {
    const endpoints = [];

    if (process.env.VERCEL_URL) {
      endpoints.push(`https://${process.env.VERCEL_URL}`);
    }

    // Default local development endpoints
    endpoints.push(
      "http://localhost:4321", // Astro default
      "http://localhost:3000", // Common dev server
    );

    return endpoints;
  }

  private getRequiredCredentials(): string[] {
    const credentials = [];

    // Check .env.example for required environment variables
    if (existsSync(".env.example")) {
      try {
        const envExample = readFileSync(".env.example", "utf8");
        const envVars = envExample
          .split("\n")
          .filter((line) => line.includes("=") && !line.startsWith("#"))
          .map((line) => line.split("=")[0].trim());
        credentials.push(...envVars);
      } catch {
        // Ignore parsing errors
      }
    }

    return credentials;
  }

  private getEvidenceRoot(): string {
    // Use Website-Bot's standard evidence directory
    if (existsSync("build/evidence")) {
      return "build/evidence";
    }

    return "validation";
  }

  private getSuiteName(suiteId: string): string {
    const suiteNames: Record<string, string> = {
      "factory-validation": "Factory Validation Suite",
      integration: "Integration Test Suite",
      unit: "Unit Test Suite",
      e2e: "End-to-End Test Suite",
    };
    return suiteNames[suiteId] || `${suiteId} Suite`;
  }
}
