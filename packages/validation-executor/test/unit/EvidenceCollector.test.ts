/**
 * Unit tests for EvidenceCollector
 * Tests integrity validation and redaction functionality
 */

import { ok, strictEqual } from "node:assert";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { EvidenceCollector } from "../../src/core/EvidenceCollector.js";
import { createTestEnvironment, MockRepositoryAdapter } from "../setup.js";

describe("EvidenceCollector", () => {
  test("stores evidence with proper integrity validation", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const testData = {
      test_id: "integrity-test",
      status: "Passed",
      output: "Test completed successfully",
      metadata: { duration: 1000 },
    };

    try {
      const evidencePath = await collector.storeEvidence("test-evidence-1", testData);

      ok(evidencePath, "Should return evidence path");
      ok(evidencePath.includes("test-evidence-1"), "Evidence path should include original ID");

      // Verify evidence file was created
      const manifest = await collector.generateManifest();
      ok(
        manifest.some((e) => e.evidence_id === "test-evidence-1"),
        "Evidence file should exist",
      );
    } finally {
      await env.cleanup();
    }
  });

  test("generates checksums for evidence integrity", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const testData = { content: "test data for checksum" };

    try {
      await collector.storeEvidence("checksum-test", testData);

      const manifest = await collector.generateManifest();
      const evidenceEntry = manifest.find((e) => e.evidence_id === "checksum-test");

      ok(evidenceEntry, "Should find evidence in manifest");
      ok(evidenceEntry.checksum, "Should have checksum");
      strictEqual(evidenceEntry.checksum.length, 64, "Should be SHA-256 hash (64 chars)");
      ok(evidenceEntry.file_size > 0, "Should record file size");
    } finally {
      await env.cleanup();
    }
  });

  test("redacts sensitive data from evidence", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const sensitiveData = {
      command: "deploy --api-key=secret123",
      env_vars: {
        DATABASE_PASSWORD: "password123",
        API_TOKEN: "token-abc-123",
        SAFE_VALUE: "public-info",
      },
      output: "Connected with password: secret123",
    };

    try {
      await collector.storeEvidence("redaction-test", sensitiveData);

      const manifest = await collector.generateManifest();
      const evidenceEntry = manifest.find((e) => e.evidence_id === "redaction-test");
      ok(evidenceEntry, "Should find evidence");

      // Read the actual evidence file to verify redaction
      const evidenceFilePath = join(env.evidenceDir, evidenceEntry.file_path);
      const evidenceContent = await readFile(evidenceFilePath, "utf8");
      const parsedEvidence = JSON.parse(evidenceContent);

      // Verify sensitive values are redacted
      ok(parsedEvidence.data.command.includes("[REDACTED]"), "API key should be redacted");
      strictEqual(
        parsedEvidence.data.env_vars.DATABASE_PASSWORD,
        "[REDACTED]",
        "Password should be redacted",
      );
      strictEqual(parsedEvidence.data.env_vars.API_TOKEN, "[REDACTED]", "Token should be redacted");
      strictEqual(
        parsedEvidence.data.env_vars.SAFE_VALUE,
        "public-info",
        "Safe values should not be redacted",
      );
      ok(parsedEvidence.data.output.includes("[REDACTED]"), "Output password should be redacted");
    } finally {
      await env.cleanup();
    }
  });

  test("stores execution traces with proper metadata", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const traceData = {
      command: "npm test",
      workingDirectory: process.cwd(),
      exitCode: 0,
      stdout: "All tests passed",
      stderr: "",
      duration: 1234,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };

    try {
      const traceId = await collector.storeExecutionTrace(traceData);

      ok(traceId, "Should return trace ID");
      ok(traceId.includes("execution_trace"), "Trace ID should indicate type");

      const manifest = await collector.generateManifest();
      const traceEntry = manifest.find((e) => e.evidence_id === traceId);

      ok(traceEntry, "Should find trace in manifest");
      strictEqual(
        traceEntry.evidence_type,
        "execution_trace",
        "Should classify as execution trace",
      );
    } finally {
      await env.cleanup();
    }
  });

  test("validates evidence integrity after storage", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const testData = { validation: "test data" };

    try {
      await collector.storeEvidence("validation-test", testData);

      // Generate manifest to trigger integrity validation
      const manifest = await collector.generateManifest();
      const entry = manifest.find((e) => e.evidence_id === "validation-test");

      ok(entry, "Evidence should be in manifest");
      ok(entry.integrity_validated, "Evidence should be marked as integrity validated");

      // Verify file actually exists and matches size
      const filePath = join(env.evidenceDir, entry.file_path);
      const stats = await stat(filePath);
      strictEqual(stats.size, entry.file_size, "File size should match manifest");
    } finally {
      await env.cleanup();
    }
  });

  test("handles concurrent evidence storage safely", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const concurrentOperations = Array.from({ length: 5 }, (_, i) =>
      collector.storeEvidence(`concurrent-test-${i}`, { index: i, data: `test data ${i}` }),
    );

    try {
      const evidenceIds = await Promise.all(concurrentOperations);

      strictEqual(evidenceIds.length, 5, "Should store all evidence items");

      // Verify all evidence IDs are unique
      const uniqueIds = new Set(evidenceIds);
      strictEqual(uniqueIds.size, 5, "All evidence IDs should be unique");

      // Verify all files exist
      const manifest = await collector.generateManifest();
      strictEqual(manifest.length, 5, "Manifest should contain all evidence items");
    } finally {
      await env.cleanup();
    }
  });

  test("classifies evidence types correctly", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const collector = await EvidenceCollector.create(adapter, env.evidenceDir);

    const testCases = [
      {
        id: "execution_trace_123",
        data: { command: "test", exitCode: 0 },
        expectedType: "execution_trace",
      },
      {
        id: "preflight_check_result",
        data: { command: "typecheck", exit_code: 0 },
        expectedType: "command_execution",
      },
      {
        id: "configuration_data",
        data: { config: "value" },
        expectedType: "configuration",
      },
      {
        id: "general_evidence",
        data: { info: "general" },
        expectedType: "general",
      },
    ];

    try {
      for (const testCase of testCases) {
        await collector.storeEvidence(testCase.id, testCase.data);
      }

      const manifest = await collector.generateManifest();

      for (const testCase of testCases) {
        const entry = manifest.find((e) => e.evidence_id.includes(testCase.id));
        ok(entry, `Should find evidence for ${testCase.id}`);
        strictEqual(
          entry.evidence_type,
          testCase.expectedType,
          `${testCase.id} should be classified as ${testCase.expectedType}`,
        );
      }
    } finally {
      await env.cleanup();
    }
  });

  test("creates evidence directory if it does not exist", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const nonExistentDir = join(env.tempDir, "non-existent", "evidence");

    // Collector should create the directory
    const collector = await EvidenceCollector.create(adapter, nonExistentDir);

    try {
      await collector.storeEvidence("directory-test", { test: "data" });

      // Verify directory was created and evidence stored
      const stats = await stat(nonExistentDir);
      ok(stats.isDirectory(), "Evidence directory should be created");

      const manifest = await collector.generateManifest();
      ok(manifest.length > 0, "Should store evidence in new directory");
    } finally {
      await env.cleanup();
    }
  });
});
