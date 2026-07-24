#!/usr/bin/env tsx

/**
 * Website-Bot Validation Executor
 * 
 * Evidence-driven validation execution using the @quantum-l9/validation-executor package
 * with Website-Bot specific adapter
 */

import { parseArgs } from 'node:util';
import { ValidationExecutor } from '../packages/validation-executor/src/core/ValidationExecutor.js';
import { AuditReporter } from '../packages/validation-executor/src/core/AuditReporter.js';
import { WebsiteBotAdapter } from '../packages/validation-executor/src/adapters/WebsiteBotAdapter.js';
import { createLogger } from '../packages/validation-executor/src/utils/logger.js';
import type { ValidationConfig } from '../packages/validation-executor/src/types/index.js';

const logger = createLogger('WebsiteBotValidation');

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
          default: 'build/evidence'
        },
        output: {
          type: 'string',
          short: 'o',
          default: 'validation/validation_report.yaml'
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

    logger.info({ 
      command, 
      profile: values.profile,
      environment: values.environment 
    }, 'Starting Website-Bot validation execution');

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
    logger.error({ error }, 'Validation execution failed');
    process.exit(1);
  }
}

async function runValidation(options: any) {
  const config: ValidationConfig = {
    environment: options.environment,
    profile: options.profile,
    evidence_root: options['evidence-root'],
    timeout: parseInt(options.timeout, 10),
    fail_fast: options['fail-fast'],
    // Profile-specific configuration
    preflight_commands: getProfilePreflightCommands(options.profile),
    e2e_commands: getProfileE2ECommands(options.profile)
  };

  const adapter = new WebsiteBotAdapter();
  const executor = new ValidationExecutor(adapter, config);
  
  logger.info({ profile: options.profile }, 'Executing validation with Website-Bot adapter');
  
  const report = await executor.execute();

  // Write YAML report
  const reporter = new AuditReporter();
  await reporter.writeReport(report, options.output as string);

  logger.info({ 
    verdict: report.final_verdict.status,
    output: options.output,
    duration: report.run_metadata.duration,
    preflightChecks: report.preflight_results.length,
    e2eTests: report.e2e_results.length
  }, 'Website-Bot validation completed');

  // Print summary
  console.log('\n=== VALIDATION SUMMARY ===');
  console.log(`Verdict: ${report.final_verdict.status}`);
  console.log(`Preflight: ${report.preflight_summary.passed}/${report.preflight_summary.discovered} passed`);
  console.log(`E2E Tests: ${report.e2e_summary.passed}/${report.e2e_summary.discovered_required_tests} passed`);
  console.log(`Duration: ${Math.round(report.run_metadata.duration / 1000)}s`);
  console.log(`Report: ${options.output}`);

  if (report.final_verdict.status !== 'PASS') {
    console.log(`\nNext Action: ${report.minimum_safe_next_action.action}`);
    console.log(`Reason: ${report.minimum_safe_next_action.blocker_or_failure}`);
  }

  // Exit with appropriate code
  if (report.final_verdict.status === 'FAIL') {
    process.exit(1);
  } else if (report.final_verdict.status === 'INCOMPLETE') {
    process.exit(2);
  }
}

function getProfilePreflightCommands(profile: string): string[] {
  const baseCommands = [
    'npm run typecheck',
    'npm run normalize-spec:check'
  ];

  switch (profile) {
    case 'preflight':
      return baseCommands;
    case 'source':
    case 'build': 
    case 'smoke':
    case 'form':
    case 'analytics':
    case 'crm':
    case 'seo':
    case 'rollback':
      return baseCommands;
    default:
      return [
        ...baseCommands,
        'npm run evidence:schemas',
        'npm run validate'
      ];
  }
}

function getProfileE2ECommands(profile: string): string[] {
  switch (profile) {
    case 'preflight':
      return []; // Preflight only, no E2E
    case 'source':
      return ['npm run site:validate'];
    case 'build':
      return ['npm run site:validate', 'npm run evidence:test'];
    case 'smoke':
      return ['npm run site:test:local'];
    case 'form':
    case 'analytics': 
    case 'crm':
    case 'seo':
    case 'rollback':
      // These would be implemented as site-level validations
      return [`echo 'Profile ${profile} validation requires site-level implementation'`];
    default:
      // Full validation suite
      return [
        'npm run site:validate',
        'npm run evidence:test', 
        'npm run site:test:local',
        'npm run provision:test',
        'npm run pipeline:plan',
        'npm run alignment:boundaries'
      ];
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
Website-Bot Validation Executor

USAGE:
  tsx scripts/validation-executor.ts [COMMAND] [OPTIONS]

COMMANDS:
  run     Execute validation suite (default)
  clean   Clean evidence directory

OPTIONS:
  -p, --profile <profile>      Validation profile (default|preflight|source|build|smoke|form|analytics|crm|seo|rollback)
  -e, --environment <env>      Target environment  
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
  form        Form validation
  analytics   Analytics validation
  crm         CRM validation
  seo         SEO validation
  rollback    Rollback validation

EXAMPLES:
  tsx scripts/validation-executor.ts run --profile preflight
  tsx scripts/validation-executor.ts run --environment ci --output ci_report.yaml
  tsx scripts/validation-executor.ts clean
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}