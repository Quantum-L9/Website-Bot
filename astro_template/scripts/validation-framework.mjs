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

  addCheck(id, category, target, description, evidence, status, severity, remedy) {
    this.checks.push(result(id, category, target, description, evidence, status, severity, remedy));
    return this;
  }

  async addFileExistenceCheck(id, filePath, description, severity = "medium", isRequired = false) {
    const { exists } = await import("./lib.mjs");
    const fileExists = exists(filePath);
    let status = "UNKNOWN";
    if (fileExists) status = "PASS";
    else if (isRequired) status = "FAIL";
    return this.addCheck(
      id,
      "file_existence",
      filePath,
      description,
      fileExists ? `${filePath} exists` : `${filePath} missing`,
      status,
      severity,
      `Create ${filePath}`,
    );
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
    return this.addCheck(
      id,
      "file_structure",
      dirPath,
      description,
      hasEnoughFiles
        ? `${files.length} files found`
        : `Only ${files.length} files found (need ${minCount})`,
      hasEnoughFiles ? "PASS" : "UNKNOWN",
      severity,
      `Add more files to ${dirPath}`,
    );
  }

  async addCommandCheck(id, command, args, description, severity = "high") {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });

    return this.addCheck(
      id,
      "command_execution",
      `${command} ${args.join(" ")}`,
      description,
      `Exit code ${result.status}, stderr: ${result.stderr?.slice(0, 200) || "none"}`,
      result.status === 0 ? "PASS" : "FAIL",
      severity,
      "Fix command errors shown in output",
    );
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
