import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepositoryAdapter } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

/**
 * Options for {@link EvidenceCollector.storeExecutionTrace} (S107: options
 * object instead of 8 positional parameters).
 */
export interface ExecutionTraceOptions {
  command: string;
  workingDirectory: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  startedAt: string;
  endedAt: string;
}

export class EvidenceCollectorError extends Error {
  constructor(
    message: string,
    public readonly evidenceId?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EvidenceCollectorError";
  }
}

/**
 * EvidenceCollector implements evidence collection with integrity validation
 * according to the specification's evidence policy.
 *
 * MUST preserve execution evidence with checksums, timestamps, and redaction.
 */
export class EvidenceCollector {
  private readonly logger = createLogger("EvidenceCollector");
  private readonly evidenceStore = new Map<string, any>();

  private constructor(
    private readonly adapter: RepositoryAdapter,
    private readonly evidenceRoot: string,
  ) {
    // S7059: constructors must not perform asynchronous work. Creation goes
    // through the static async factory below, which initializes the evidence
    // directory synchronously in the caller's control flow.
    this.logger.info({ evidenceRoot }, "Evidence collector initialized");
  }

  /**
   * Create an EvidenceCollector with its evidence directory ensured.
   * Replaces the former async fire-and-forget in the constructor (S7059).
   */
  static async create(
    adapter: RepositoryAdapter,
    evidenceRoot: string,
  ): Promise<EvidenceCollector> {
    const instance = new EvidenceCollector(adapter, evidenceRoot);
    await instance.initializeAsync();
    return instance;
  }

  private async initializeAsync(): Promise<void> {
    await this.ensureEvidenceDirectory();
  }

  /**
   * Store evidence with integrity validation
   */
  async storeEvidence(evidenceId: string, data: any): Promise<string> {
    try {
      // Ensure evidence directory exists
      await this.ensureEvidenceDirectory();

      // Redact sensitive data
      const redactedData = this.redactSensitiveData(data);

      // Generate evidence record
      const evidenceRecord = {
        evidence_id: evidenceId,
        timestamp: new Date().toISOString(),
        data: redactedData,
        original_size: JSON.stringify(data).length,
        redacted_size: JSON.stringify(redactedData).length,
        redaction_applied: JSON.stringify(data) !== JSON.stringify(redactedData),
      };

      // Calculate checksum
      const checksum = this.calculateChecksum(evidenceRecord);
      (evidenceRecord as any).checksum = checksum;

      // Store in memory for quick access
      this.evidenceStore.set(evidenceId, evidenceRecord);

      // Write to disk for persistence
      const evidencePath = join(this.evidenceRoot, `${evidenceId}.json`);
      await this.writeEvidenceFile(evidencePath, evidenceRecord);

      this.logger.debug(
        {
          evidenceId,
          path: evidencePath,
          checksum,
          redacted: evidenceRecord.redaction_applied,
        },
        "Evidence stored",
      );

      return evidencePath;
    } catch (error) {
      this.logger.error({ error, evidenceId }, "Failed to store evidence");
      throw new EvidenceCollectorError(
        `Evidence storage failed for ${evidenceId}`,
        evidenceId,
        error,
      );
    }
  }

  /**
   * Store execution trace evidence
   */
  async storeExecutionTrace(options: ExecutionTraceOptions): Promise<string> {
    const { command, workingDirectory, exitCode, stdout, stderr, duration, startedAt, endedAt } =
      options;
    const traceId = `execution_trace_${randomUUID()}`;

    const trace = {
      command,
      working_directory: workingDirectory,
      exit_code: exitCode,
      stdout: this.truncateOutput(stdout, 10000), // Limit output size
      stderr: this.truncateOutput(stderr, 10000),
      duration_ms: duration,
      started_at: startedAt,
      ended_at: endedAt,
      environment_variables: this.getRelevantEnvVars(),
      process_id: process.pid,
      node_version: process.version,
    };

    await this.storeEvidence(traceId, trace);
    return traceId;
  }

  /**
   * Store command output separately for large outputs
   */
  async storeCommandOutput(
    commandId: string,
    stdout: string,
    stderr: string,
  ): Promise<{ stdoutPath: string; stderrPath: string }> {
    const stdoutId = `${commandId}_stdout`;
    const stderrId = `${commandId}_stderr`;

    const stdoutPath = await this.storeEvidence(stdoutId, {
      type: "stdout",
      command_id: commandId,
      content: stdout,
      length: stdout.length,
    });

    const stderrPath = await this.storeEvidence(stderrId, {
      type: "stderr",
      command_id: commandId,
      content: stderr,
      length: stderr.length,
    });

    return { stdoutPath, stderrPath };
  }

  /**
   * Generate evidence manifest for all collected evidence
   */
  async generateManifest(): Promise<
    Array<{
      evidence_id: string;
      evidence_type: string;
      file_path: string;
      checksum: string | null;
      file_size: number;
      created_at: string;
      integrity_validated: boolean;
    }>
  > {
    this.logger.info("Generating evidence manifest");

    const manifest = [];

    for (const [evidenceId, record] of this.evidenceStore.entries()) {
      try {
        const evidencePath = join(this.evidenceRoot, `${evidenceId}.json`);

        // Verify file exists and is accessible
        const fileStats = await stat(evidencePath);

        manifest.push({
          evidence_id: evidenceId,
          evidence_type: this.classifyEvidenceType(evidenceId, record.data),
          file_path: `${evidenceId}.json`,
          checksum: record.checksum || null,
          file_size: fileStats.size,
          created_at: record.timestamp,
          integrity_validated: true,
        });
      } catch (error) {
        this.logger.warn({ error, evidenceId }, "Evidence file not accessible");

        manifest.push({
          evidence_id: evidenceId,
          evidence_type: "unknown",
          file_path: `${evidenceId}.json`,
          checksum: null,
          file_size: 0,
          created_at: new Date().toISOString(),
          integrity_validated: false,
        });
      }
    }

    this.logger.info({ totalEvidence: manifest.length }, "Evidence manifest generated");
    return manifest;
  }

  /**
   * Validate evidence integrity
   */
  async validateEvidenceIntegrity(): Promise<{
    valid: boolean;
    issues: string[];
    totalEvidence: number;
    validEvidence: number;
  }> {
    const issues: string[] = [];
    let validEvidence = 0;

    for (const [evidenceId] of this.evidenceStore.entries()) {
      try {
        const evidencePath = join(this.evidenceRoot, `${evidenceId}.json`);

        // Verify file exists
        const fileContent = await readFile(evidencePath, "utf8");
        const storedRecord = JSON.parse(fileContent);

        // Verify checksum matches
        const currentChecksum = this.calculateChecksum({
          ...storedRecord,
          checksum: undefined, // Exclude checksum from checksum calculation
        });

        if (currentChecksum !== storedRecord.checksum) {
          issues.push(`Checksum mismatch for evidence ${evidenceId}`);
        } else {
          validEvidence++;
        }
      } catch (error) {
        issues.push(`Cannot verify evidence ${evidenceId}: ${error}`);
      }
    }

    const valid = issues.length === 0;

    this.logger.info(
      {
        valid,
        issues: issues.length,
        totalEvidence: this.evidenceStore.size,
        validEvidence,
      },
      "Evidence integrity validation completed",
    );

    return {
      valid,
      issues,
      totalEvidence: this.evidenceStore.size,
      validEvidence,
    };
  }

  /**
   * Retrieve stored evidence
   */
  async getEvidence(evidenceId: string): Promise<any> {
    const record = this.evidenceStore.get(evidenceId);
    if (record) {
      return record.data;
    }

    // Try to load from disk
    try {
      const evidencePath = join(this.evidenceRoot, `${evidenceId}.json`);
      const fileContent = await readFile(evidencePath, "utf8");
      const storedRecord = JSON.parse(fileContent);

      // Cache in memory
      this.evidenceStore.set(evidenceId, storedRecord);

      return storedRecord.data;
    } catch (error) {
      this.logger.warn({ error, evidenceId }, "Could not retrieve evidence");
      return null;
    }
  }

  private async ensureEvidenceDirectory(): Promise<void> {
    try {
      await mkdir(this.evidenceRoot, { recursive: true });
    } catch (error) {
      this.logger.error({ error, path: this.evidenceRoot }, "Failed to create evidence directory");
      throw new EvidenceCollectorError(
        `Failed to create evidence directory ${this.evidenceRoot}`,
        undefined,
        error,
      );
    }
  }

  private async writeEvidenceFile(filePath: string, data: any): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  private calculateChecksum(data: any): string {
    const content = JSON.stringify(data, null, 0); // Consistent serialization
    return createHash("sha256").update(content).digest("hex");
  }

  private redactSensitiveData(data: any): any {
    if (typeof data !== "object" || data === null) {
      return this.redactSensitiveString(String(data));
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitiveData(item));
    }

    const redacted = { ...data };

    for (const [key, value] of Object.entries(redacted)) {
      const keyLower = key.toLowerCase();

      // Redact sensitive field names
      if (this.isSensitiveField(keyLower)) {
        redacted[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        redacted[key] = this.redactSensitiveString(value);
      } else if (typeof value === "object") {
        redacted[key] = this.redactSensitiveData(value);
      }
    }

    return redacted;
  }

  private isSensitiveField(field: string): boolean {
    const sensitiveFields = [
      "password",
      "secret",
      "token",
      "key",
      "auth",
      "credential",
      "api_key",
      "access_token",
      "refresh_token",
      "private_key",
      "cert",
      "certificate",
      "passphrase",
      "pin",
      "ssn",
      "email",
      "phone",
      "credit_card",
      "bank_account",
    ];

    return sensitiveFields.some((sensitive) => field.includes(sensitive));
  }

  private redactSensitiveString(value: string): string {
    // Redact patterns that look like secrets
    const patterns = [
      /\b[A-Za-z0-9+/]{20,}={0,2}\b/g, // Base64-like strings
      /\b[A-Fa-f0-9]{32,}\b/g, // Hex strings (API keys, hashes)
      /\bsk_\w{20,}\b/g, // Stripe-like secret keys
      /\bpk_\w{20,}\b/g, // Public keys
      /\bghp_[a-zA-Z0-9]{36}\b/g, // GitHub personal access tokens
      /\bxoxb-[a-zA-Z0-9-]+\b/g, // Slack bot tokens
      /\bAKIA[0-9A-Z]{16}\b/g, // AWS access keys
      /\b[A-Za-z0-9+/]{40}\b/g, // 40-character tokens
      /--api[_-]?key[=:]\s*[^\s]+/gi, // Command line API key arguments
      /--token[=:]\s*[^\s]+/gi, // Command line token arguments
      /--password[=:]\s*[^\s]+/gi, // Command line password arguments
      /password[=:]\s*[^\s]+/gi, // Generic password patterns in text
    ];

    let redacted = value;
    for (const pattern of patterns) {
      redacted = redacted.replace(pattern, "[REDACTED]");
    }

    return redacted;
  }

  private truncateOutput(output: string, maxLength: number): string {
    if (output.length <= maxLength) {
      return output;
    }

    const truncated = output.substring(0, maxLength);
    return `${truncated}\n\n[OUTPUT TRUNCATED - Original length: ${output.length} characters]`;
  }

  private getRelevantEnvVars(): Record<string, string> {
    const relevantVars: Record<string, string> = {};

    // Include important environment variables (non-sensitive)
    const includePatterns = [
      "NODE_ENV",
      "CI",
      "GITHUB_ACTIONS",
      "VERCEL_ENV",
      "PATH",
      "HOME",
      "USER",
      "PWD",
      "SHELL",
    ];

    for (const [key, value] of Object.entries(process.env)) {
      if (value && includePatterns.some((pattern) => key.includes(pattern))) {
        relevantVars[key] = this.redactSensitiveString(value);
      }
    }

    return relevantVars;
  }

  private classifyEvidenceType(evidenceId: string, data: any): string {
    // Check for execution_trace first since it's a specific type of command execution
    if (evidenceId.includes("execution_trace")) {
      return "execution_trace";
    }

    // Check data structure for accurate classification
    if (data && typeof data === "object") {
      if (data.command || data.exit_code !== undefined) {
        return "command_execution";
      }

      if (data.test_id || data.suite_id) {
        return "test_result";
      }

      if (data.check_id) {
        return "preflight_check";
      }
    }

    // Then check other ID patterns

    if (evidenceId.includes("stdout")) {
      return "command_output_stdout";
    }

    if (evidenceId.includes("stderr")) {
      return "command_output_stderr";
    }

    if (evidenceId.includes("preflight")) {
      return "preflight_evidence";
    }

    if (evidenceId.includes("e2e")) {
      return "e2e_test_evidence";
    }

    if (evidenceId.includes("configuration") || evidenceId.includes("config")) {
      return "configuration";
    }

    return "general";
  }
}
