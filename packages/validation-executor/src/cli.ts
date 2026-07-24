#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { ValidationExecutor } from './core/ValidationExecutor.js';
import { AuditReporter } from './core/AuditReporter.js';

async function loadRepositoryAdapter(): Promise<RepositoryAdapter> {
  const fs = await import('node:fs');
  
  // Detect project type based on file patterns
  if (fs.existsSync('package.json')) {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // Check for specific project patterns
    if (packageJson.name?.includes('website-bot') || fs.existsSync('astro_template')) {
      // Try to load WebsiteBotAdapter if available
      try {
        const { WebsiteBotAdapter } = await import('./adapters/WebsiteBotAdapter.js');
        return new WebsiteBotAdapter();
      } catch (error) {
        console.warn('WebsiteBotAdapter not available, using default adapter');
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
    const { executeCommandSecurely } = await import('./utils/secureExecution.js');
    
    return executeCommandSecurely(command, {
      cwd: workingDir,
      encoding: 'utf8'
    });
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

async function runValidation(options: any) {
  const config: ValidationConfig = {
    environment: options.environment,
    profile: options.profile,
    evidence_root: options['evidence-root'],
    timeout: parseInt(options.timeout, 10),
    fail_fast: options['fail-fast']
  };

  // Load repository-specific adapter based on detected project type
  const adapter = await loadRepositoryAdapter();
  
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
  -v, --verbose                Enable verbose logging
  -h, --help                   Show this help

EXAMPLES:
  validation-executor run --profile ci
  validation-executor run --environment staging --output ci_report.yaml
  validation-executor clean
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as cli };