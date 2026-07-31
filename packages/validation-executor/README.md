# @quantum-l9/validation-executor

> Evidence-driven validation execution system for complex software projects

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/@quantum-l9/validation-executor.svg)](https://badge.fury.io/js/@quantum-l9/validation-executor)
[![Node.js CI](https://github.com/Quantum-L9/validation-executor/workflows/Node.js%20CI/badge.svg)](https://github.com/Quantum-L9/validation-executor/actions)

## Overview

The Validation Executor is a robust, evidence-driven validation system designed for complex software projects. It provides comprehensive preflight checks, end-to-end testing, and detailed audit reporting with full evidence collection and integrity validation.

### Key Features

- **Evidence-Driven Validation**: Collects comprehensive evidence throughout the validation process
- **Gate-Based Authorization**: Uses validation gates to control execution flow and prevent unsafe deployments
- **Repository Adapters**: Supports multiple project types (Website-Bot, SEO-Bot) with extensible adapter architecture
- **Secure Command Execution**: Direct process spawning with injection protection
- **Comprehensive Reporting**: YAML-formatted audit reports with detailed failure analysis
- **Cross-Repository Support**: Reusable across different project structures and toolchains

### Architecture

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Repository        │    │   Validation        │    │   Evidence          │
│   Adapter           │    │   Executor          │    │   Collector         │
│                     │    │                     │    │                     │
│ • WebsiteBotAdapter │────│ • PreflightEngine   │────│ • Evidence Storage  │
│ • SeoBotAdapter     │    │ • E2EEngine         │    │ • Integrity Check   │
│ • DefaultAdapter    │    │ • ContextResolver   │    │ • Manifest Gen      │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
                                      │
                           ┌─────────────────────┐
                           │   Audit             │
                           │   Reporter          │
                           │                     │
                           │ • YAML Reports      │
                           │ • Gate Analysis     │
                           │ • Verdict Logic     │
                           └─────────────────────┘
```

## Installation

### As a Package Dependency

```bash
npm install @quantum-l9/validation-executor
```

### For CLI Usage

```bash
npm install -g @quantum-l9/validation-executor
```

## Quick Start

### CLI Usage

```bash
# Auto-detect repository type and run validation
validation-executor run

# Specify repository type explicitly
validation-executor run --repository-type website-bot

# Custom configuration
validation-executor run \
  --profile production \
  --environment staging \
  --timeout 600000 \
  --evidence-root ./evidence \
  --output validation-report.yaml
```

### Programmatic Usage

```typescript
import { ValidationExecutor } from '@quantum-l9/validation-executor';
import { WebsiteBotAdapter } from '@quantum-l9/validation-executor/adapters';

// Create adapter and configuration
const adapter = new WebsiteBotAdapter();
const config = {
  environment: 'production',
  profile: 'ci',
  evidence_root: './evidence',
  timeout: 300000,
  fail_fast: false
};

// Execute validation
const executor = new ValidationExecutor(adapter, config);
const report = await executor.execute();

console.log(`Validation ${report.final_verdict.status}`);
```

## Configuration

### CLI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--profile` | string | `default` | Validation profile (default, ci, development, staging, production, test) |
| `--environment` | string | - | Target environment (development, staging, production, test, ci) |
| `--evidence-root` | string | `validation` | Evidence storage directory |
| `--output` | string | `validation_report.yaml` | Report output file |
| `--timeout` | number | `300000` | Command timeout in milliseconds (1000-1800000) |
| `--fail-fast` | boolean | `false` | Stop on first failure |
| `--repository-type` | string | `auto` | Repository type (auto, website-bot, seo-bot, default) |
| `--verbose` | boolean | `false` | Enable verbose logging |

### Validation Config

```typescript
interface ValidationConfig {
  target?: string;
  target_roots?: string[];
  environment?: string;
  profile?: string;
  preflight_commands?: string[];
  e2e_commands?: string[];
  evidence_root?: string;
  timeout?: number;
  fail_fast?: boolean;
  skip_patterns?: string[];
}
```

## Repository Adapters

### Built-in Adapters

#### WebsiteBotAdapter
- **Detection**: `website-bot` in package name, `astro_template` directory, Astro dependencies
- **Preflight Checks**: TypeScript compilation, ESLint, build validation, factory tests
- **E2E Tests**: Site validation tests, API integration tests, pipeline tests

#### SeoBotAdapter  
- **Detection**: `seo-bot` in package name, SEO keywords, `test:seo`/`test:crawl` scripts, SEO config files
- **Preflight Checks**: Dependencies check, TypeScript compilation, ESLint, SEO config validation
- **E2E Tests**: SEO analysis tests, web crawling tests, integration tests

#### DefaultAdapter
- **Detection**: Fallback for unrecognized repositories
- **Preflight Checks**: Basic TypeScript and linting if available
- **E2E Tests**: Generic npm test commands

### Custom Adapter

```typescript
import { RepositoryAdapter } from '@quantum-l9/validation-executor';

export class CustomAdapter implements RepositoryAdapter {
  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    // Implement context resolution logic
  }

  async discoverPreflightChecks(): Promise<PreflightCheckDefinition[]> {
    // Return preflight check definitions
  }

  async discoverE2ETests(): Promise<E2ETestDefinition[]> {
    // Return E2E test definitions  
  }

  async executeCommand(command: string, workingDir: string): Promise<CommandResult> {
    // Implement secure command execution
  }

  async storeEvidence(evidenceId: string, data: any): Promise<string> {
    // Implement evidence storage
  }
}
```

## Validation Gates

The system uses validation gates to control execution flow:

### Gate Types

- **Execution Context Resolved**: Ensures environment is properly configured
- **Preflight Passed**: All blocking preflight checks must pass
- **E2E Tests Passed**: End-to-end validation must succeed
- **Evidence Complete**: All evidence must be collected and verified
- **Coverage Reconciled**: Test coverage requirements met

### Gate Logic

```typescript
// E2E tests are only executed if preflight gate passes
if (preflightGate.status === 'Passed') {
  e2eResults = await e2eEngine.executeAll(e2eTests);
} else {
  // Mark E2E tests as blocked
  e2eResults = markAsBlockedByPreflightGate(e2eTests);
}
```

## Evidence Collection

### Evidence Types

- **Execution Traces**: Command executions with full context
- **Test Results**: Detailed test outcomes and assertions
- **System State**: Environment and dependency information
- **Configuration Data**: Settings and parameters used
- **General Evidence**: Any additional validation artifacts

### Evidence Integrity

- **Checksums**: SHA-256 hashes for tamper detection
- **Timestamps**: ISO-8601 creation and modification times
- **Redaction**: Automatic sanitization of sensitive data (passwords, tokens, keys)
- **Validation**: Integrity verification during report generation

### Example Evidence

```json
{
  "evidence_id": "preflight_typecheck_attempt_1",
  "type": "execution_trace",
  "created_at": "2026-07-24T19:00:00.000Z",
  "checksum": "a1b2c3d4e5f6...",
  "data": {
    "command": "npm run typecheck",
    "exit_code": 0,
    "duration": 2500,
    "stdout": "✓ Type checking completed successfully",
    "stderr": "",
    "working_directory": "/project/root"
  }
}
```

## Validation Report

### Report Structure

The validation report is a comprehensive YAML document containing:

- **Run Metadata**: Execution details, duration, verdict
- **Execution Context**: Environment, dependencies, configuration
- **Preflight Results**: All preflight check outcomes
- **E2E Results**: All end-to-end test results
- **Validation Gates**: Gate status and authorization decisions
- **Evidence Manifest**: Complete evidence inventory with integrity data
- **Failure Analysis**: Root cause groups, defects, regressions
- **Final Verdict**: PASS, FAIL, or INCOMPLETE with detailed reasoning

### Verdict Logic

```yaml
final_verdict:
  status: FAIL
  preflight_status: Failed  
  e2e_status: Blocked
  evidence_status: Complete
  coverage_status: Complete
  required_failure_count: 1
  blocking_defect_ids: ["typescript-compilation-error"]
  unknown_count: 0
  verdict_reason: "1 test failure(s) detected"
```

## Security Features

### Secure Command Execution

- **Direct Process Spawning**: Avoids shell injection vulnerabilities
- **Command Sanitization**: Blocks dangerous command patterns
- **Injection Protection**: Regex-based filtering of malicious inputs
- **Timeout Controls**: Prevents runaway processes

### Dangerous Pattern Detection

```typescript
// Blocked patterns include:
const dangerousPatterns = [
  /rm\s+-rf\s+\//, // rm -rf /
  /curl.*\|.*sh/, // curl | sh
  /wget.*\|.*sh/, // wget | sh  
  /\$\([^)]*rm/, // $(rm ...)
  // ... additional patterns
];
```

### Evidence Redaction

Automatic sanitization of sensitive information:

```typescript
const sensitivePatterns = [
  /--password[=\s]+[^\s]+/gi,
  /--api-key[=\s]+[^\s]+/gi,
  /--token[=\s]+[^\s]+/gi,
  /-p\s+[^\s]+/gi, // -p password
  // ... additional patterns
];
```

## API Reference

### Core Classes

#### ValidationExecutor

Main orchestrator for validation execution.

```typescript
class ValidationExecutor {
  constructor(adapter: RepositoryAdapter, config: ValidationConfig)
  
  async execute(): Promise<ValidationExecutionReport>
  
  private async resolveExecutionContext(): Promise<ExecutionContext>
  private determineFinalVerdict(): FinalVerdict
}
```

#### PreflightEngine

Executes preflight checks and evaluates gates.

```typescript
class PreflightEngine {
  async executeAll(checks: PreflightCheckDefinition[]): Promise<PreflightCheck[]>
  
  evaluateGate(results: PreflightCheck[]): PreflightGate
  
  generateSummary(results: PreflightCheck[]): PreflightSummary
}
```

#### E2EEngine

Executes end-to-end tests with blocking logic.

```typescript
class E2EEngine {
  async executeAll(tests: E2ETestDefinition[]): Promise<E2ETestResult[]>
  
  evaluateResults(results: E2ETestResult[]): E2EGate
  
  generateSummary(results: E2ETestResult[]): E2ESummary
}
```

#### EvidenceCollector

Manages evidence storage and integrity validation.

```typescript
class EvidenceCollector {
  async storeEvidence(evidenceId: string, data: any): Promise<string>
  
  async storeExecutionTrace(traceId: string, trace: ExecutionTrace): Promise<string>
  
  async generateManifest(): Promise<EvidenceManifest>
}
```

#### AuditReporter

Generates comprehensive validation reports.

```typescript
class AuditReporter {
  generateReport(data: ValidationData): ValidationExecutionReport
  
  async writeReport(report: ValidationExecutionReport, outputPath: string): Promise<void>
}
```

### Interfaces

Key TypeScript interfaces for validation system:

- `RepositoryAdapter`: Adapter interface for repository-specific logic
- `ValidationConfig`: Configuration object for validation execution
- `ExecutionContext`: Resolved environment and dependency context
- `ValidationExecutionReport`: Complete validation report structure
- `PreflightCheckDefinition`: Definition of a preflight check
- `E2ETestDefinition`: Definition of an end-to-end test

## Testing

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only  
npm run test:integration

# Test coverage
npm run test:coverage
```

### Test Coverage

The validation executor maintains >90% test coverage across all core components:

- **ValidationExecutor**: Orchestration and gate sequencing
- **PreflightEngine**: Gate evaluation and check execution
- **E2EEngine**: Test execution and blocking logic
- **EvidenceCollector**: Integrity validation and redaction
- **AuditReporter**: Report generation and schema compliance

### Test Structure

```
test/
├── setup.ts              # Test utilities and mock adapters
├── unit/                  # Unit tests
│   ├── ValidationExecutor.test.ts
│   ├── PreflightEngine.test.ts
│   ├── E2EEngine.test.ts
│   ├── EvidenceCollector.test.ts
│   ├── AuditReporter.test.ts
│   ├── secureExecution.test.ts
│   └── ValidationGateLogic.test.ts
└── integration/           # Integration tests
    └── ValidationWorkflow.test.ts
```

## Contributing

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Quantum-L9/validation-executor.git
cd validation-executor

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Start development mode
npm run dev
```

### Code Quality

- **TypeScript**: Strict type checking with `--noEmit`
- **ESLint**: Code linting with recommended rules
- **Testing**: Comprehensive unit and integration tests
- **Coverage**: Minimum 90% test coverage required
- **Security**: Secure command execution patterns

### Commit Guidelines

Follow conventional commits:

```bash
feat: add SEO-Bot adapter support
fix: resolve E2E test blocking logic
docs: update README with API examples
test: add comprehensive gate logic tests
refactor: simplify repository discovery logic
```

### Pull Request Process

1. Create feature branch: `git checkout -b feature/your-feature-name`
2. Implement changes with tests
3. Ensure all tests pass: `npm test`
4. Verify coverage: `npm run test:coverage`
5. Update documentation if needed
6. Submit pull request with clear description

## Troubleshooting

### Common Issues

#### Validation Fails with "Context Resolution Failed"

**Cause**: Missing required dependencies or invalid project structure.

**Solution**: 
```bash
# Check project dependencies
npm install

# Verify repository adapter detection
validation-executor run --repository-type auto --verbose
```

#### E2E Tests Not Executing

**Cause**: Preflight gate failure blocking E2E execution.

**Solution**:
```bash
# Check preflight results
validation-executor run --verbose

# Fix blocking preflight failures first
npm run typecheck  # or relevant preflight command
```

#### Evidence Directory Not Writable

**Cause**: Insufficient permissions on evidence root directory.

**Solution**:
```bash
# Set proper permissions
chmod 755 ./evidence

# Or use different directory
validation-executor run --evidence-root /tmp/validation-evidence
```

#### Command Timeout Errors

**Cause**: Commands taking longer than configured timeout.

**Solution**:
```bash
# Increase timeout (in milliseconds)
validation-executor run --timeout 600000  # 10 minutes

# Or optimize slow commands
```

### Debug Logging

Enable verbose logging for detailed execution information:

```bash
validation-executor run --verbose
```

Log levels:
- `ERROR`: Critical failures
- `WARN`: Non-blocking issues  
- `INFO`: General execution flow
- `DEBUG`: Detailed execution traces

## License

MIT License. See [LICENSE](LICENSE) for details.

## Maintainers

- **Quantum L9 Team** - Primary development and maintenance
- **GitHub**: [Quantum-L9/validation-executor](https://github.com/Quantum-L9/validation-executor)
- **Issues**: [Report bugs and feature requests](https://github.com/Quantum-L9/validation-executor/issues)

## Related Projects

- **@quantum-l9/llm-router**: LLM routing and provider abstraction
- **Website-Bot**: Astro-based website generation pipeline
- **SEO-Bot**: Search engine optimization and analysis tools

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

**Note**: This package is part of the Quantum L9 ecosystem for automated software validation and quality assurance. For questions, support, or contributions, please refer to the project's GitHub repository.