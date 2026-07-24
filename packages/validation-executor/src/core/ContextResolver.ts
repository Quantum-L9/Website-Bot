import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import type { ExecutionContext, ValidationConfig, RepositoryAdapter } from '../types/index.js';

/**
 * ContextResolver implements Step 1 of the validation specification:
 * "Resolve Execution Context" - bind target, environment, commands
 * 
 * MUST resolve the exact target workspace, artifact set, source revision, 
 * environment, and execution boundary before running commands.
 */
export class ContextResolver {
  private readonly logger = createLogger('ContextResolver');

  constructor(private readonly adapter: RepositoryAdapter) {}

  async resolve(config: ValidationConfig): Promise<ExecutionContext> {
    this.logger.info('Resolving execution context');

    const targetRoots = await this.resolveTargetRoots(config);
    const sourceRevision = await this.resolveSourceRevision();
    const runningRevision = await this.resolveRunningRevision();
    const { targetEnvironment, environmentType } = await this.resolveEnvironment(config);
    const activeIdentity = await this.resolveActiveIdentity();
    const { testRunner, testRunnerVersion } = await this.resolveTestRunner();
    const preflightCommands = await this.resolvePreflightCommands(config);
    const e2eCommands = await this.resolveE2ECommands(config);
    const configurationSources = await this.resolveConfigurationSources();
    const requiredServices = await this.resolveRequiredServices(config);
    const targetEndpoints = await this.resolveTargetEndpoints(config);
    const requiredDependencies = await this.resolveRequiredDependencies();
    const requiredCredentials = await this.resolveRequiredCredentials(config);
    const evidenceRoot = this.resolveEvidenceRoot(config);

    const context: ExecutionContext = {
      target_roots: targetRoots,
      source_revision: sourceRevision,
      running_revision: runningRevision,
      target_environment: targetEnvironment,
      environment_type: environmentType,
      active_identity: activeIdentity,
      preflight_commands: preflightCommands,
      e2e_commands: e2eCommands,
      test_runner: testRunner,
      test_runner_version: testRunnerVersion,
      configuration_sources: configurationSources,
      required_services: requiredServices,
      target_endpoints: targetEndpoints,
      required_dependencies: requiredDependencies,
      required_credentials: requiredCredentials,
      evidence_root: evidenceRoot
    };

    await this.validateExecutionContext(context);
    
    this.logger.info({ context }, 'Execution context resolved');
    return context;
  }

  private async resolveTargetRoots(config: ValidationConfig): Promise<string[]> {
    const cwd = process.cwd();
    
    // Check if we're in a monorepo or single-root workspace
    if (existsSync('packages') || existsSync('apps')) {
      // Monorepo: find all package roots
      const roots = [cwd];
      if (existsSync('packages')) {
        // Add package directories that contain package.json
        const packageDirs = await this.findPackageDirectories('packages');
        roots.push(...packageDirs);
      }
      return roots;
    }
    
    return [cwd];
  }

  private async resolveSourceRevision(): Promise<string> {
    try {
      // Get current Git revision
      const result = spawnSync('git', ['rev-parse', 'HEAD'], { 
        encoding: 'utf8',
        cwd: process.cwd()
      });
      
      if (result.status === 0) {
        return result.stdout.trim();
      }
      
      this.logger.warn('Could not resolve Git revision');
      return 'Unknown';
    } catch (error) {
      this.logger.warn({ error }, 'Failed to resolve source revision');
      return 'Unknown';
    }
  }

  private async resolveRunningRevision(): Promise<string | null> {
    // For build artifacts, check if there's a deployed version identifier
    // This would be implementation-specific based on deployment mechanism
    return null;
  }

  private async resolveEnvironment(config: ValidationConfig): Promise<{ targetEnvironment: string; environmentType: string }> {
    if (config.environment) {
      return {
        targetEnvironment: config.environment,
        environmentType: this.classifyEnvironmentType(config.environment)
      };
    }

    // Detect environment from various sources
    const envIndicators = {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      CI: process.env.CI,
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS
    };

    if (envIndicators.CI || envIndicators.GITHUB_ACTIONS) {
      return { targetEnvironment: 'ci', environmentType: 'isolated_test' };
    }

    if (envIndicators.VERCEL_ENV) {
      return { 
        targetEnvironment: envIndicators.VERCEL_ENV,
        environmentType: envIndicators.VERCEL_ENV === 'production' ? 'production' : 'staging'
      };
    }

    return { 
      targetEnvironment: envIndicators.NODE_ENV || 'local',
      environmentType: 'local'
    };
  }

  private classifyEnvironmentType(env: string): string {
    const productionPatterns = ['prod', 'production', 'live'];
    const stagingPatterns = ['staging', 'stage', 'preview'];
    const testPatterns = ['test', 'testing', 'ci'];

    if (productionPatterns.some(p => env.toLowerCase().includes(p))) {
      return 'production';
    }
    if (stagingPatterns.some(p => env.toLowerCase().includes(p))) {
      return 'staging';
    }
    if (testPatterns.some(p => env.toLowerCase().includes(p))) {
      return 'isolated_test';
    }
    
    return 'local';
  }

  private async resolveActiveIdentity(): Promise<string> {
    try {
      // Try to get Git user identity
      const result = spawnSync('git', ['config', 'user.email'], {
        encoding: 'utf8',
        cwd: process.cwd()
      });
      
      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }

      // Fall back to system user
      return process.env.USER || process.env.USERNAME || 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  private async resolveTestRunner(): Promise<{ testRunner: string; testRunnerVersion: string }> {
    // Check for various test runners in package.json
    if (existsSync('package.json')) {
      try {
        const packageJson = await import(process.cwd() + '/package.json', { with: { type: 'json' } });
        const deps = { ...packageJson.default.dependencies, ...packageJson.default.devDependencies };
        
        if (deps.vitest) return { testRunner: 'vitest', testRunnerVersion: deps.vitest };
        if (deps.jest) return { testRunner: 'jest', testRunnerVersion: deps.jest };
        if (deps.mocha) return { testRunner: 'mocha', testRunnerVersion: deps.mocha };
        
        // Check for Node.js built-in test runner
        const nodeVersion = process.version;
        if (nodeVersion >= 'v18.0.0') {
          return { testRunner: 'node:test', testRunnerVersion: nodeVersion };
        }
      } catch (error) {
        this.logger.warn({ error }, 'Could not parse package.json for test runner detection');
      }
    }

    return { testRunner: 'Unknown', testRunnerVersion: 'Unknown' };
  }

  private async resolvePreflightCommands(config: ValidationConfig): Promise<string[]> {
    if (config.preflight_commands) {
      return config.preflight_commands;
    }

    const commands = [];
    
    // Standard preflight checks based on project type
    if (existsSync('package.json')) {
      commands.push('npm run typecheck || tsc --noEmit');
      commands.push('npm run lint || echo "No lint script found"');
    }

    // Check for specific validation commands
    if (existsSync('scripts/preflight.js') || existsSync('scripts/preflight.mjs')) {
      commands.push('node scripts/preflight.mjs');
    }

    return commands.length > 0 ? commands : ['echo "No preflight commands configured"'];
  }

  private async resolveE2ECommands(config: ValidationConfig): Promise<string[]> {
    if (config.e2e_commands) {
      return config.e2e_commands;
    }

    const commands = [];

    if (existsSync('package.json')) {
      try {
        const packageJson = await import(process.cwd() + '/package.json', { with: { type: 'json' } });
        const scripts = packageJson.default.scripts || {};
        
        // Look for common test script patterns
        if (scripts.test) commands.push('npm test');
        if (scripts['test:e2e']) commands.push('npm run test:e2e');
        if (scripts['test:integration']) commands.push('npm run test:integration');
        
        // Look for verification scripts
        const verifyScripts = Object.keys(scripts).filter(s => s.startsWith('verify:'));
        commands.push(...verifyScripts.map(s => `npm run ${s}`));
      } catch (error) {
        this.logger.warn({ error }, 'Could not parse package.json for e2e commands');
      }
    }

    return commands.length > 0 ? commands : ['echo "No E2E commands configured"'];
  }

  private async resolveConfigurationSources(): Promise<string[]> {
    const sources = [];
    
    const configFiles = [
      'package.json',
      'tsconfig.json', 
      '.env.example',
      'config/runtime-verification.config.json',
      'config/launch-env.required.yaml',
      '.github/workflows/ci.yml',
      'docker-compose.yml',
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

  private async resolveRequiredServices(config: ValidationConfig): Promise<string[]> {
    const services = [];
    
    // Check docker-compose files for services
    if (existsSync('docker-compose.yml')) {
      services.push('docker-compose-services');
    }

    // Check for database requirements
    if (existsSync('package.json')) {
      try {
        const packageJson = await import(process.cwd() + '/package.json', { with: { type: 'json' } });
        const deps = { ...packageJson.default.dependencies, ...packageJson.default.devDependencies };
        
        if (deps.pg || deps.postgres) services.push('postgresql');
        if (deps['better-sqlite3'] || deps.sqlite3) services.push('sqlite');
        if (deps.redis) services.push('redis');
      } catch (error) {
        // Ignore parsing errors
      }
    }

    return services;
  }

  private async resolveTargetEndpoints(config: ValidationConfig): Promise<string[]> {
    const endpoints = [];
    
    // Check for common endpoint patterns
    if (process.env.VERCEL_URL) {
      endpoints.push(`https://${process.env.VERCEL_URL}`);
    }
    
    if (process.env.DEPLOY_URL) {
      endpoints.push(process.env.DEPLOY_URL);
    }

    // Default local endpoints for development
    endpoints.push('http://localhost:4321'); // Astro default
    endpoints.push('http://localhost:3000'); // Common dev server

    return endpoints;
  }

  private async resolveRequiredDependencies(): Promise<string[]> {
    const dependencies = [];
    
    if (existsSync('package.json')) {
      try {
        const packageJson = await import(process.cwd() + '/package.json', { with: { type: 'json' } });
        const deps = Object.keys({
          ...packageJson.default.dependencies,
          ...packageJson.default.devDependencies
        });
        dependencies.push(...deps);
      } catch (error) {
        this.logger.warn({ error }, 'Could not parse package.json for dependencies');
      }
    }

    return dependencies;
  }

  private async resolveRequiredCredentials(config: ValidationConfig): Promise<string[]> {
    const credentials = [];
    
    // Check .env.example for required environment variables
    if (existsSync('.env.example')) {
      try {
        const { readFileSync } = await import('node:fs');
        const envExample = readFileSync('.env.example', 'utf8');
        const envVars = envExample
          .split('\n')
          .filter(line => line.includes('=') && !line.startsWith('#'))
          .map(line => line.split('=')[0].trim());
        credentials.push(...envVars);
      } catch (error) {
        this.logger.warn({ error }, 'Could not parse .env.example');
      }
    }

    return credentials;
  }

  private resolveEvidenceRoot(config: ValidationConfig): string {
    if (config.evidence_root) {
      return config.evidence_root;
    }

    // Use standard evidence directories
    if (existsSync('build/evidence')) {
      return 'build/evidence';
    }
    
    if (existsSync('validation')) {
      return 'validation';
    }

    return 'evidence';
  }

  private async validateExecutionContext(context: ExecutionContext): Promise<void> {
    const errors = [];

    if (context.target_roots.length === 0) {
      errors.push('No target roots resolved');
    }

    if (context.source_revision === 'Unknown') {
      errors.push('Source revision could not be determined');
    }

    if (context.target_environment === 'Unknown') {
      errors.push('Target environment could not be determined');
    }

    if (context.preflight_commands.length === 0) {
      errors.push('No preflight commands configured');
    }

    if (context.e2e_commands.length === 0) {
      errors.push('No E2E commands configured');
    }

    if (errors.length > 0) {
      this.logger.warn({ errors }, 'Execution context validation warnings');
    }
  }

  private async findPackageDirectories(baseDir: string): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    
    try {
      const entries = await readdir(baseDir, { withFileTypes: true });
      const packageDirs = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const packageJsonPath = join(baseDir, entry.name, 'package.json');
          if (existsSync(packageJsonPath)) {
            packageDirs.push(join(baseDir, entry.name));
          }
        }
      }
      
      return packageDirs;
    } catch (error) {
      this.logger.warn({ error, baseDir }, 'Could not scan package directories');
      return [];
    }
  }
}