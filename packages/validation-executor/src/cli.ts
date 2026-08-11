#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { ValidationExecutor } from './core/ValidationExecutor.js';
import { AuditReporter } from './core/AuditReporter.js';

async function loadRepositoryAdapter(repositoryType: string = 'auto'): Promise<RepositoryAdapter> {
  const fs = await import('node:fs');
  
  // Handle explicit repository type override
  if (repositoryType !== 'auto') {
    switch (repositoryType.toLowerCase()) {
      case 'website-bot':
        try {
          const { WebsiteBotAdapter } = await import('./adapters/WebsiteBotAdapter.js');
          return new WebsiteBotAdapter();
        } catch (error) {
          console.warn('WebsiteBotAdapter not available, falling back to default adapter', error);
          break;
        }
      case 'seo-bot':
        try {
          const { SeoBotAdapter } = await import('./adapters/SeoBotAdapter.js');
          return new SeoBotAdapter();
        } catch (error) {
          console.warn('SeoBotAdapter not available, falling back to default adapter', error);
          break;
        }
      case 'default':
        return new DefaultRepositoryAdapter();
      default:
        console.warn(`Unknown repository type '${repositoryType}', using auto-detection`);
    }
  }
  
  // Auto-detect project type based on file patterns
  if (fs.existsSync('package.json')) {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // Check for SEO-Bot patterns
    if (packageJson.name?.includes('seo-bot') || 
        packageJson.name?.includes('SEO-Bot') ||
        packageJson.keywords?.includes('seo') ||
        packageJson.scripts?.['test:seo'] ||
        packageJson.scripts?.['test:crawl'] ||
        fs.existsSync('seo.config.js') ||
        fs.existsSync('seo.config.json')) {
      try {
        const { SeoBotAdapter } = await import('./adapters/SeoBotAdapter.js');
        return new SeoBotAdapter();
      } catch (error) {
        console.warn('SeoBotAdapter not available, using default adapter', error);
      }
    }
    
    // Check for Website-Bot patterns
    if (packageJson.name?.includes('website-bot') || 
        packageJson.name?.includes('Website-Bot') ||
        fs.existsSync('astro_template') ||
        packageJson.dependencies?.['astro'] ||
        packageJson.devDependencies?.['astro']) {
      try {
        const { WebsiteBotAdapter } = await import('./adapters/WebsiteBotAdapter.js');
        return new WebsiteBotAdapter();
      } catch (error) {
        console.warn('WebsiteBotAdapter not available, using default adapter', error);
      }
    }
  }
  
  // Fallback to default adapter
  return new DefaultRepositoryAdapter();
}
import { createLogger } from './utils/logger.js';
import type { ValidationConfig, RepositoryAdapter, ExecutionContext } from './types/index.js';

const logger = createLogger('ValidationExecutorCLI');

// Default adapter implementation for CLI usage
class DefaultRepositoryAdapter implements RepositoryAdapter {
  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    // This would be implemented by specific repository adapters
    throw new Error('Repository adapter not implemented - use a specific adapter for your repository type');
  }

  async discoverPreflightChecks() {
    return [];
  }

  async discoverE2ETests() {
    return [];
  }

  async executeCommand(command: string, workingDir: string) {
    const { executeAdapterCommand } = await import('./utils/secureExecution.js');
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
      options: {
        profile: {
          type: 'string',
          short: 'p',
          default: 'default'
        },
        environment: {
          type: 'string',
          short: 'e'
        },
        'evidence-root': {
          type: 'string',
          default: 'validation'
        },
        output: {
          type: 'string',
          short: 'o',
          default: 'validation_report.yaml'
        },
        timeout: {
          type: 'string',
          default: '300000' // 5 minutes
        },
        'fail-fast': {
          type: 'boolean',
          default: false
        },
        verbose: {
          type: 'boolean',
          short: 'v',
          default: false
        },
        help: {
          type: 'boolean',
          short: 'h',
          default: false
        },
        'repository-type': {
          type: 'string',
          default: 'auto',
          description: 'Repository type (auto, website-bot, seo-bot, default)'
        }
      }
    });

    if (values.help) {
      printHelp();
      process.exit(0);
    }

    const command = positionals[0] || 'run';

    if (values.verbose) {
      process.env.LOG_LEVEL = 'debug';
    }

    logger.info({ command, profile: values.profile }, 'Starting validation executor');

    switch (command) {
      case 'run':
        await runValidation(values);
        break;
      case 'clean':
        await cleanEvidence(values);
        break;
      default:
        logger.error({ command }, 'Unknown command');
        printHelp();
        process.exit(1);
    }

  } catch (error) {
    logger.error({ error }, 'CLI execution failed');
    process.exit(1);
  }
}

async function validateConfiguration(options: any): Promise<void> {
  const errors: string[] = [];

  // Validate timeout range (min: 1000ms, max: 1800000ms = 30 minutes)
  const timeout = Number.parseInt(options.timeout, 10);
  if (Number.isNaN(timeout)) {
    errors.push(`Invalid timeout value '${options.timeout}': must be a number`);
  } else if (timeout < 1000) {
    errors.push(`Timeout ${timeout}ms is too low: minimum is 1000ms (1 second)`);
  } else if (timeout > 1800000) {
    errors.push(`Timeout ${timeout}ms is too high: maximum is 1800000ms (30 minutes)`);
  }

  // Validate profile name against whitelist
  const validProfiles = ['default', 'ci', 'development', 'staging', 'production', 'test'];
  if (options.profile && !validProfiles.includes(options.profile)) {
    errors.push(`Unknown profile '${options.profile}': valid profiles are ${validProfiles.join(', ')}`);
  }

  // Validate environment type constraints
  const validEnvironments = ['development', 'staging', 'production', 'test', 'ci'];
  if (options.environment && !validEnvironments.includes(options.environment)) {
    errors.push(`Unknown environment '${options.environment}': valid environments are ${validEnvironments.join(', ')}`);
  }

  // Validate repository type
  const validRepositoryTypes = ['auto', 'website-bot', 'seo-bot', 'default'];
  if (options['repository-type'] && !validRepositoryTypes.includes(options['repository-type'])) {
    errors.push(`Unknown repository type '${options['repository-type']}': valid types are ${validRepositoryTypes.join(', ')}`);
  }

  // Validate evidence root path writeability
  if (options['evidence-root']) {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      
      const evidencePath = path.resolve(options['evidence-root']);
      
      // Try to create the directory if it doesn't exist
      await fs.mkdir(evidencePath, { recursive: true });
      
      // Test writeability by creating a temporary file
      const testFile = path.join(evidencePath, '.write-test');
      await fs.writeFile(testFile, 'test', 'utf8');
      await fs.unlink(testFile);
      
    } catch (error) {
      errors.push(`Evidence root '${options['evidence-root']}' is not writable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Validate output file path writeability
  if (options.output) {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      
      const outputPath = path.resolve(options.output);
      const outputDir = path.dirname(outputPath);
      
      // Try to create the output directory if it doesn't exist
      await fs.mkdir(outputDir, { recursive: true });
      
      // Test writeability by creating a temporary file
      const testFile = path.join(outputDir, '.write-test');
      await fs.writeFile(testFile, 'test', 'utf8');
      await fs.unlink(testFile);
      
    } catch (error) {
      errors.push(`Output path '${options.output}' directory is not writable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // If there are validation errors, report them and exit
  if (errors.length > 0) {
    console.error('\nConfiguration Validation Errors:');
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error('\nRun with --help to see valid options.\n');
    process.exit(1);
  }
}

async function runValidation(options: any) {
  // Validate CLI configuration parameters
  await validateConfiguration(options);

  const config: ValidationConfig = {
    environment: options.environment,
    profile: options.profile,
    evidence_root: options['evidence-root'],
    timeout: Number.parseInt(options.timeout, 10),
    fail_fast: options['fail-fast']
  };

  // Load repository-specific adapter based on detected project type
  const adapter = await loadRepositoryAdapter(options['repository-type'] as string);
  
  const executor = new ValidationExecutor(adapter, config);
  const report = await executor.execute();

  // Write YAML report  
  const reporter = new AuditReporter();
  await reporter.writeReport(report, options.output as string);

  logger.info({ 
    verdict: report.final_verdict.status,
    output: options.output,
    duration: report.run_metadata.duration
  }, 'Validation completed');

  // Exit with appropriate code
  if (report.final_verdict.status === 'FAIL') {
    process.exit(1);
  } else if (report.final_verdict.status === 'INCOMPLETE') {
    process.exit(2);
  }
}

async function cleanEvidence(options: any) {
  const evidenceDir = options['evidence-root'];
  
  try {
    const { rm } = await import('node:fs/promises');
    await rm(evidenceDir, { recursive: true, force: true });
    logger.info({ evidenceDir }, 'Evidence directory cleaned');
  } catch (error) {
    logger.warn({ error, evidenceDir }, 'Could not clean evidence directory');
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