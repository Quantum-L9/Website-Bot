// L9_META: layer=pipeline, role=resume_target_resolution, status=active, version=1.0.0
//
// Resolve `--resume <buildId>` to the build's persisted evidence root and
// economics record, so a resumed run reloads the spec, mode and intent the
// build was started with instead of starting a new build from scratch.

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildError } from "./BuildError.js";
import type { BuildEconomics } from "./evidence/BuildEconomics.js";
import { evidenceDigest } from "./evidence/EvidenceCanonicalizer.js";
import { economicsPath, readBuildEconomics } from "./SpendLedger.js";

export interface ResumeTarget {
  buildId: string;
  rootDir: string;
  economics: BuildEconomics;
}

const BUILD_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Accepts `--resume=<id>`, `--resume <id>`, and the legacy
 * `--resume --build-id=<id>`. Returns undefined when not resuming.
 */
export function parseResumeArgument(args: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => arg === "--resume" || arg.startsWith("--resume="));
  if (index < 0) return undefined;
  const flag = args[index] as string;
  const legacy = args.find((arg) => arg.startsWith("--build-id="))?.slice("--build-id=".length);
  let buildId: string | undefined;
  if (flag.startsWith("--resume=")) buildId = flag.slice("--resume=".length);
  else {
    const next = args[index + 1];
    buildId = next && !next.startsWith("--") ? next : legacy;
  }
  if (!buildId) throw new Error("--resume requires a build id: --resume <buildId>");
  if (legacy && legacy !== buildId)
    throw new Error(`--resume ${buildId} conflicts with --build-id=${legacy}`);
  if (!BUILD_ID.test(buildId)) throw new Error(`invalid build id for --resume: ${buildId}`);
  return buildId;
}

/** Digest binding a build to its spec content (canonical, whitespace-insensitive). */
export function specDigest(parsedSpec: unknown): string {
  return evidenceDigest(parsedSpec);
}

/**
 * Locate the build's evidence root: the explicit --evidence-dir, else the
 * single `<evidenceRoot>/<client>/<buildId>` that holds an economics record.
 * Zero or several candidates fail closed.
 */
export function resolveResumeTarget(options: {
  buildId: string;
  evidenceDir?: string;
  evidenceRoot?: string;
}): ResumeTarget {
  const { buildId } = options;
  let rootDir: string;
  if (options.evidenceDir) rootDir = resolve(options.evidenceDir);
  else {
    const base = resolve(options.evidenceRoot ?? join("build", "evidence"));
    const candidates = existsSync(base)
      ? readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(base, entry.name, buildId))
          .filter((dir) => existsSync(economicsPath(dir)))
      : [];
    if (candidates.length !== 1)
      throw new BuildError(
        "RESUME_STATE_MISSING",
        candidates.length === 0
          ? `Cannot resume ${buildId}: no build-economics.json for it under ${base}; pass --evidence-dir or start a new build`
          : `Cannot resume ${buildId}: ambiguous evidence roots ${candidates.join(", ")}; pass --evidence-dir`,
      );
    rootDir = candidates[0] as string;
  }
  const economics = readBuildEconomics(rootDir);
  if (!economics)
    throw new BuildError(
      "RESUME_STATE_MISSING",
      `Cannot resume ${buildId}: ${economicsPath(rootDir)} does not exist; start a new build`,
    );
  if (economics.build_id !== buildId)
    throw new BuildError(
      "EVIDENCE_IDENTITY_MISMATCH",
      `Evidence root ${rootDir} belongs to build ${economics.build_id}, not ${buildId}`,
    );
  return { buildId, rootDir, economics };
}
