import { result, statusFromRows, writeJsonl } from "./lib.mjs";

/**
 * Shared validation framework for Astro site scripts
 * Eliminates duplication while maintaining individual script clarity
 */
export class ValidationRunner {
  constructor(name) {
    this.name = name;
    this.checks = [];
  }

  /**
   * Add a check (S107: options object instead of 8 params). Positional calls
   * are still accepted via the shim for backward compatibility with
   * generated sites that copy this script verbatim.
   */
  addCheck(optionsOrId, ...legacyArgs) {
    const opts =
      typeof optionsOrId === "object" && optionsOrId !== null
        ? optionsOrId
        : {
            id: optionsOrId,
            category: legacyArgs[0],
            target: legacyArgs[1],
            description: legacyArgs[2],
            evidence: legacyArgs[3],
            status: legacyArgs[4],
            severity: legacyArgs[5] ?? "medium",
            remedy: legacyArgs[6] ?? "",
          };
    this.checks.push(
      result({
        check_id: opts.id,
        check_class: opts.category,
        target_artifact: opts.target,
        expected_result: opts.description,
        actual_result: opts.evidence,
        status: opts.status,
        severity: opts.severity,
        remediation_if_failed: opts.remedy,
      }),
    );
    return this;
  }

  async addFileExistenceCheck(id, filePath, description, severity = "medium", isRequired = false) {
    const { exists } = await import("./lib.mjs");
    const fileExists = exists(filePath);
    let status = "UNKNOWN";
    if (fileExists) status = "PASS";
    else if (isRequired) status = "FAIL";
    return this.addCheck({
      id,
      category: "file_existence",
      target: filePath,
      description,
      evidence: fileExists ? `${filePath} exists` : `${filePath} missing`,
      status,
      severity,
      remedy: `Create ${filePath}`,
    });
  }

  async addDirectoryContentCheck(
    id,
    dirPath,
    fileFilter,
    description,
    severity = "medium",
    minCount = 1,
  ) {
    const { listFiles } = await import("./lib.mjs");
    const files = listFiles(dirPath, fileFilter);
    const hasEnoughFiles = files.length >= minCount;
    return this.addCheck({
      id,
      category: "file_structure",
      target: dirPath,
      description,
      evidence: hasEnoughFiles
        ? `${files.length} files found`
        : `Only ${files.length} files found (need ${minCount})`,
      status: hasEnoughFiles ? "PASS" : "UNKNOWN",
      severity,
      remedy: `Add more files to ${dirPath}`,
    });
  }

  async addCommandCheck(id, command, args, description, severity = "high") {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });

    return this.addCheck({
      id,
      category: "command_execution",
      target: `${command} ${args.join(" ")}`,
      description,
      evidence: `Exit code ${result.status}, stderr: ${result.stderr?.slice(0, 200) || "none"}`,
      status: result.status === 0 ? "PASS" : "FAIL",
      severity,
      remedy: "Fix command errors shown in output",
    });
  }

  async run(options = {}) {
    const {
      outputFile = `validation/${this.name}_checks.jsonl`,
      strictMode = false,
      exitOnFail = true,
    } = options;

    // Write evidence
    writeJsonl(outputFile, this.checks);

    // Generate summary
    const status = statusFromRows(this.checks);
    console.log(
      JSON.stringify(
        {
          status,
          checks: this.checks.length,
          name: this.name,
        },
        null,
        2,
      ),
    );

    // Exit handling
    if (status === "FAIL" && exitOnFail) {
      if (strictMode || process.env.STRICT_VALIDATION === "true") {
        process.exit(1);
      }
    }

    return { status, checks: this.checks };
  }
}

export function createValidator(name) {
  return new ValidationRunner(name);
}
