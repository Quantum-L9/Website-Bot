/**
 * Test setup and utilities for validation executor tests
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  E2ETestDefinition,
  ExecutionContext,
  PreflightCheckDefinition,
  ValidationConfig,
} from "../src/types/index.js";

/**
 * Unique, unpredictable default evidence root for mock config/context factories.
 * Avoids a fixed, shared path under a publicly writable directory (CWE-379).
 */
function defaultMockEvidenceRoot(): string {
  return join(tmpdir(), `test-evidence-${randomUUID()}`);
}

export interface TestEnvironment {
  tempDir: string;
  evidenceDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Create isolated test environment with temporary directories
 */
export async function createTestEnvironment(): Promise<TestEnvironment> {
  const tempDir = join("/tmp", `validation-test-${randomUUID()}`);
  const evidenceDir = join(tempDir, "evidence");

  await mkdir(tempDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  return {
    tempDir,
    evidenceDir,
    cleanup: async () => {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors in tests
      }
    },
  };
}

/**
 * Create mock validation configuration for testing
 */
export function createMockConfig(overrides: Partial<ValidationConfig> = {}): ValidationConfig {
  return {
    target: "test-target",
    environment: "test",
    profile: "test",
    preflight_commands: ['echo "preflight test"'],
    e2e_commands: ['echo "e2e test"'],
    evidence_root: defaultMockEvidenceRoot(),
    timeout: 5000,
    fail_fast: false,
    skip_patterns: [],
    ...overrides,
  };
}

/**
 * Create mock execution context for testing
 */
export function createMockExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    target_roots: ["/test/root"],
    source_revision: "test-commit-123",
    running_revision: null,
    target_environment: "test",
    environment_type: "isolated_test",
    active_identity: "test@example.com",
    preflight_commands: ["npm run typecheck"],
    e2e_commands: ["npm run test:e2e"],
    test_runner: "node:test",
    test_runner_version: "v20.0.0",
    configuration_sources: ["package.json", "tsconfig.json"],
    required_services: ["test-service"],
    target_endpoints: ["http://localhost:3000"],
    required_dependencies: ["typescript", "node"],
    required_credentials: [],
    evidence_root: defaultMockEvidenceRoot(),
    ...overrides,
  };
}

/**
 * Create mock preflight check definitions for testing
 */
export function createMockPreflightChecks(): PreflightCheckDefinition[] {
  return [
    {
      check_id: "typecheck",
      check_name: "TypeScript Type Check",
      blocking: true,
      command: "npm run typecheck",
      working_directory: "/test/root",
    },
    {
      check_id: "lint",
      check_name: "ESLint Check",
      blocking: false,
      command: "npm run lint",
      working_directory: "/test/root",
    },
  ];
}

/**
 * Create mock E2E test definitions for testing
 */
export function createMockE2ETests(): E2ETestDefinition[] {
  return [
    {
      suite_id: "integration-tests",
      suite_name: "Integration Test Suite",
      test_id: "api-test",
      test_name: "API Integration Test",
      attempt: 1,
      command_or_invocation: "npm run test:api",
    },
    {
      suite_id: "e2e-tests",
      suite_name: "End-to-End Test Suite",
      test_id: "user-flow",
      test_name: "User Flow Test",
      attempt: 1,
      command_or_invocation: "npm run test:e2e",
    },
  ];
}

/**
 * Mock repository adapter for testing
 */
export class MockRepositoryAdapter {
  private readonly mockPreflightChecks: PreflightCheckDefinition[];
  private readonly mockE2ETests: E2ETestDefinition[];
  private readonly mockExecutionResults: Map<
    string,
    { exitCode: number; stdout: string; stderr: string; duration: number }
  >;

  constructor(preflightChecks = createMockPreflightChecks(), e2eTests = createMockE2ETests()) {
    this.mockPreflightChecks = preflightChecks;
    this.mockE2ETests = e2eTests;
    this.mockExecutionResults = new Map();
  }

  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    return createMockExecutionContext({
      evidence_root: config.evidence_root,
      target_environment: config.environment || "test",
    });
  }

  async discoverPreflightChecks(): Promise<PreflightCheckDefinition[]> {
    return this.mockPreflightChecks;
  }

  async discoverE2ETests(): Promise<E2ETestDefinition[]> {
    return this.mockE2ETests;
  }

  async executeCommand(
    command: string,
    workingDir: string,
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
  }> {
    const key = `${command}:${workingDir}`;
    const result = this.mockExecutionResults.get(key);

    if (result) {
      return result;
    }

    // Default success response for unknown commands
    return {
      exitCode: 0,
      stdout: `Mock execution of: ${command}`,
      stderr: "",
      duration: 100,
    };
  }

  async storeEvidence(evidenceId: string, _data: any): Promise<string> {
    return `mock-evidence-${evidenceId}`;
  }

  /**
   * Configure mock command execution results for testing
   */
  setCommandResult(
    command: string,
    workingDir: string,
    result: {
      exitCode: number;
      stdout: string;
      stderr: string;
      duration: number;
    },
  ): void {
    const key = `${command}:${workingDir}`;
    this.mockExecutionResults.set(key, result);
  }
}

/**
 * Assert helpers for validation testing
 */
export const assertions = {
  /**
   * Assert that a validation gate has the expected status
   */
  gateStatus(gate: { status: string }, expectedStatus: string, message?: string): void {
    if (gate.status !== expectedStatus) {
      throw new Error(message || `Expected gate status ${expectedStatus}, got ${gate.status}`);
    }
  },

  /**
   * Assert that evidence references are properly formatted
   */
  evidenceReferences(references: string[], minCount = 1): void {
    if (references.length < minCount) {
      throw new Error(
        `Expected at least ${minCount} evidence references, got ${references.length}`,
      );
    }

    for (const ref of references) {
      if (typeof ref !== "string" || ref.length === 0) {
        throw new Error(`Invalid evidence reference: ${ref}`);
      }
    }
  },
};
