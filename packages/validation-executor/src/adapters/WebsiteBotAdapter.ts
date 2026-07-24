import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../utils/logger.js';
import type { 
  RepositoryAdapter, 
  ValidationConfig, 
  ExecutionContext, 
  PreflightCheck, 
  E2ETestResult 
} from '../types/index.js';

/**
 * Website-Bot specific adapter for the validation executor
 * Integrates with the existing factory pipeline and evidence infrastructure
 */
export class WebsiteBotAdapter implements RepositoryAdapter {
  private readonly logger = createLogger('WebsiteBotAdapter');

  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    this.logger.info('Resolving Website-Bot execution context');

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
      preflight_commands: config.preflight_commands || await this.discoverPreflightCommands(),
      e2e_commands: config.e2e_commands || await this.discoverE2ECommands(),
      test_runner: 'node:test',
      test_runner_version: process.version,
      configuration_sources: this.getConfigurationSources(),
      required_services: this.getRequiredServices(packageJson),
      target_endpoints: this.getTargetEndpoints(),
      required_dependencies: Object.keys({
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      }),
      required_credentials: this.getRequiredCredentials(),
      evidence_root: config.evidence_root || this.getEvidenceRoot()
    };
  }

  async discoverPreflightChecks(): Promise<PreflightCheck[]> {
    const checks: PreflightCheck[] = [];

    // Standard Website-Bot preflight checks
    checks.push({
      check_id: 'typecheck',
      check_name: 'TypeScript Type Check', 
      blocking: true,
      command: 'npm run typecheck',
      working_directory: process.cwd(),
      status: 'NotExecuted',
      exit_code: null,
      termination_signal: null,
      started_at: '',
      ended_at: '',
      duration: 0,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    checks.push({
      check_id: 'normalize-spec-check',
      check_name: 'Domain Spec Normalization Check',
      blocking: true,
      command: 'npm run normalize-spec:check',
      working_directory: process.cwd(),
      status: 'NotExecuted',
      exit_code: null,
      termination_signal: null,
      started_at: '',
      ended_at: '',
      duration: 0,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    checks.push({
      check_id: 'evidence-schemas',
      check_name: 'Evidence Schema Validation',
      blocking: true,
      command: 'npm run evidence:schemas',
      working_directory: process.cwd(),
      status: 'NotExecuted',
      exit_code: null,
      termination_signal: null,
      started_at: '',
      ended_at: '',
      duration: 0,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    checks.push({
      check_id: 'launch-env-validation',
      check_name: 'Launch Environment Validation',
      blocking: false, // Non-blocking to allow testing in different environments
      command: 'npm run validate',
      working_directory: process.cwd(),
      status: 'NotExecuted',
      exit_code: null,
      termination_signal: null,
      started_at: '',
      ended_at: '',
      duration: 0,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    return checks;
  }

  async discoverE2ETests(): Promise<E2ETestResult[]> {
    const tests: E2ETestResult[] = [];

    // Factory validation tests
    tests.push({
      suite_id: 'factory-validation',
      suite_name: 'Factory Validation Suite',
      test_id: 'site-validate',
      test_name: 'Site Factory Validation',
      attempt: 1,
      command_or_invocation: 'npm run site:validate',
      status: 'NotExecuted',
      started_at: '',
      ended_at: '',
      duration: 0,
      assertion_or_error: null,
      exit_code_or_runner_result: null,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    tests.push({
      suite_id: 'factory-validation',
      suite_name: 'Factory Validation Suite',
      test_id: 'evidence-test',
      test_name: 'Evidence System Tests',
      attempt: 1,
      command_or_invocation: 'npm run evidence:test',
      status: 'NotExecuted',
      started_at: '',
      ended_at: '',
      duration: 0,
      assertion_or_error: null,
      exit_code_or_runner_result: null,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    tests.push({
      suite_id: 'factory-validation',
      suite_name: 'Factory Validation Suite',
      test_id: 'site-test-local',
      test_name: 'Local Site Factory Tests',
      attempt: 1,
      command_or_invocation: 'npm run site:test:local',
      status: 'NotExecuted',
      started_at: '',
      ended_at: '',
      duration: 0,
      assertion_or_error: null,
      exit_code_or_runner_result: null,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    tests.push({
      suite_id: 'pipeline-validation',
      suite_name: 'Pipeline Validation Suite',
      test_id: 'pipeline-plan',
      test_name: 'Pipeline Planning Test',
      attempt: 1,
      command_or_invocation: 'npm run pipeline:plan',
      status: 'NotExecuted',
      started_at: '',
      ended_at: '',
      duration: 0,
      assertion_or_error: null,
      exit_code_or_runner_result: null,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    });

    // Site-level validation tests (if example exists)
    if (existsSync('examples/supplemental-insurance-pros/astro_site')) {
      const siteTests = await this.discoverSiteValidationTests();
      tests.push(...siteTests);
    }

    return tests;
  }

  async executeCommand(command: string, workingDir: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
  }> {
    this.logger.debug({ command, workingDir }, 'Executing command');
    
    const startTime = Date.now();
    
    const result = spawnSync('sh', ['-c', command], {
      cwd: workingDir,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: 300000 // 5 minute timeout
    });

    const duration = Date.now() - startTime;
    const exitCode = result.status || 0;

    this.logger.debug({ 
      command, 
      exitCode, 
      duration, 
      stdoutLength: result.stdout?.length || 0,
      stderrLength: result.stderr?.length || 0
    }, 'Command execution completed');

    return {
      exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      duration
    };
  }

  async storeEvidence(evidenceId: string, data: any): Promise<string> {
    // Use Website-Bot's evidence infrastructure
    const evidenceRoot = this.getEvidenceRoot();
    const evidencePath = join(evidenceRoot, `${evidenceId}.json`);
    
    // Ensure the evidence directory exists
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(data, null, 2), 'utf8');
    
    return evidencePath;
  }

  private async getGitRevision(): Promise<string> {
    try {
      const result = spawnSync('git', ['rev-parse', 'HEAD'], { 
        encoding: 'utf8',
        cwd: process.cwd()
      });
      
      return result.status === 0 ? result.stdout.trim() : 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  private async getGitUserEmail(): Promise<string> {
    try {
      const result = spawnSync('git', ['config', 'user.email'], {
        encoding: 'utf8',
        cwd: process.cwd()
      });
      
      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      // Ignore errors
    }
    
    return process.env.USER || process.env.USERNAME || 'Unknown';
  }

  private getPackageJson(): any {
    try {
      const packagePath = join(process.cwd(), 'package.json');
      const content = readFileSync(packagePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return { dependencies: {}, devDependencies: {}, scripts: {} };
    }
  }

  private detectEnvironment(): string {
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      return 'ci';
    }
    if (process.env.VERCEL_ENV) {
      return process.env.VERCEL_ENV;
    }
    return process.env.NODE_ENV || 'local';
  }

  private classifyEnvironment(env: string): string {
    if (['production', 'prod'].includes(env.toLowerCase())) {
      return 'production';
    }
    if (['staging', 'stage', 'preview'].includes(env.toLowerCase())) {
      return 'staging';
    }
    if (['test', 'testing', 'ci'].includes(env.toLowerCase())) {
      return 'isolated_test';
    }
    return 'local';
  }

  private async discoverPreflightCommands(): Promise<string[]> {
    // Use Website-Bot's standard preflight commands from package.json
    return [
      'npm run typecheck',
      'npm run normalize-spec:check', 
      'npm run evidence:schemas',
      'npm run validate'
    ];
  }

  private async discoverE2ECommands(): Promise<string[]> {
    // Use Website-Bot's verify:all pattern
    return [
      'npm run site:validate',
      'npm run evidence:test',
      'npm run site:test:local',
      'npm run pipeline:plan'
    ];
  }

  private getConfigurationSources(): string[] {
    const sources = [];
    const configFiles = [
      'package.json',
      'tsconfig.json',
      'config/launch-env.required.yaml',
      '.env.example',
      '.github/workflows/ci.yml',
      'Makefile',
      'justfile'
    ];

    for (const file of configFiles) {
      if (existsSync(file)) {
        sources.push(file);
      }
    }

    return sources;
  }

  private getRequiredServices(packageJson: any): string[] {
    const services = [];
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (deps['better-sqlite3']) services.push('sqlite');
    if (deps.pg || deps.postgres) services.push('postgresql');
    if (deps.redis) services.push('redis');
    
    return services;
  }

  private getTargetEndpoints(): string[] {
    const endpoints = [];
    
    if (process.env.VERCEL_URL) {
      endpoints.push(`https://${process.env.VERCEL_URL}`);
    }
    
    // Default local development endpoints
    endpoints.push('http://localhost:4321'); // Astro default
    endpoints.push('http://localhost:3000'); // Common dev server
    
    return endpoints;
  }

  private getRequiredCredentials(): string[] {
    const credentials = [];
    
    // Check .env.example for required environment variables
    if (existsSync('.env.example')) {
      try {
        const envExample = readFileSync('.env.example', 'utf8');
        const envVars = envExample
          .split('\n')
          .filter(line => line.includes('=') && !line.startsWith('#'))
          .map(line => line.split('=')[0].trim());
        credentials.push(...envVars);
      } catch {
        // Ignore parsing errors
      }
    }

    return credentials;
  }

  private getEvidenceRoot(): string {
    // Use Website-Bot's standard evidence directory
    if (existsSync('build/evidence')) {
      return 'build/evidence';
    }
    
    return 'validation';
  }

  private async discoverSiteValidationTests(): Promise<E2ETestResult[]> {
    const tests: E2ETestResult[] = [];
    const siteDir = 'examples/supplemental-insurance-pros/astro_site';

    // Site-specific validation commands based on verify-all.mjs pattern
    const siteCommands = [
      { id: 'site-preflight', name: 'Site Preflight Check', cmd: 'node scripts/preflight.mjs' },
      { id: 'site-verify-source', name: 'Site Source Verification', cmd: 'node scripts/verify-source.mjs' },
      { id: 'site-verify-build', name: 'Site Build Verification', cmd: 'node scripts/verify-build.mjs' },
      { id: 'site-verify-smoke', name: 'Site Smoke Tests', cmd: 'node scripts/verify-smoke.mjs' },
      { id: 'site-verify-form', name: 'Site Form Verification', cmd: 'node scripts/verify-form.mjs' },
      { id: 'site-verify-analytics', name: 'Site Analytics Verification', cmd: 'node scripts/verify-analytics.mjs' },
      { id: 'site-verify-crm', name: 'Site CRM Verification', cmd: 'node scripts/verify-crm.mjs' },
      { id: 'site-verify-seo', name: 'Site SEO Verification', cmd: 'node scripts/verify-seo.mjs' }
    ];

    for (const siteCmd of siteCommands) {
      if (existsSync(join(siteDir, siteCmd.cmd.split(' ')[1]))) {
        tests.push({
          suite_id: 'site-validation',
          suite_name: 'Site Validation Suite',
          test_id: siteCmd.id,
          test_name: siteCmd.name,
          attempt: 1,
          command_or_invocation: `cd ${siteDir} && ${siteCmd.cmd}`,
          status: 'NotExecuted',
          started_at: '',
          ended_at: '',
          duration: 0,
          assertion_or_error: null,
          exit_code_or_runner_result: null,
          primary_failure_classification: null,
          contributing_causes: [],
          root_cause_group: null,
          evidence_references: []
        });
      }
    }

    return tests;
  }
}