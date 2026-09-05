// L9_META: layer=validation, role=boundary_validator, status=active, version=1.3.0
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packRoot = resolve(scriptDir, "../..");

// .l9 and .l9-worktrees are git-ignored governance state (memory receipts,
// externally managed lock worktrees of OTHER repos) that can appear in a
// working copy at any time; they are not repository source and must not
// affect boundary classification of this repo's code.
const DEFAULT_SKIP_DIR_NAMES = [
  "node_modules",
  ".git",
  "build",
  "dist",
  ".astro",
  ".l9",
  ".l9-worktrees",
];

/**
 * Structural containment: candidate must be root or a strict descendant.
 * Rejects naïve prefix false-positives (e.g. /repo/foo2 under /repo/foo).
 */
export function isInsideRoot(root, candidate) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const rel = relative(rootResolved, candidateResolved);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/** readdir that tolerates ENOENT (dangling links/missing dirs return undefined). */
function readdirTolerant(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/** lstat that tolerates ENOENT (missing roots return undefined). */
function lstatTolerant(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/**
 * Walk scan roots without following symlinks (including symlink roots).
 * Dangling symlinks are skipped (no unhandled ENOENT).
 *
 * @param {string[]} roots
 * @param {{ onFile?: (absolutePath: string) => void, skipDirNames?: string[] }} [options]
 * @returns {{ skipped_symlinks: number, skipped_symlink_roots: number }}
 */
export function walkRoots(roots, options = {}) {
  const onFile = options.onFile ?? (() => {});
  const skipDirNames = options.skipDirNames ?? DEFAULT_SKIP_DIR_NAMES;
  const stats = { skipped_symlinks: 0, skipped_symlink_roots: 0 };

  function walk(dir, root) {
    const entries = readdirTolerant(dir);
    if (!entries) return;

    for (const dirent of entries) {
      if (skipDirNames.includes(dirent.name)) continue;
      const p = resolve(dir, dirent.name);
      if (!isInsideRoot(root, p)) continue;

      // Do not follow symlinks (files or directories); dangling links must not throw.
      if (dirent.isSymbolicLink()) {
        stats.skipped_symlinks += 1;
        continue;
      }

      if (dirent.isDirectory()) {
        walk(p, root);
      } else if (dirent.isFile() && /\.(ts|js|mjs|md|ya?ml|json)$/.test(dirent.name)) {
        onFile(p);
      }
    }
  }

  for (const root of roots) {
    const st = lstatTolerant(root);
    if (!st) continue;
    // Symlink supplied as a root must not bypass no-follow.
    if (st.isSymbolicLink()) {
      stats.skipped_symlink_roots += 1;
      continue;
    }
    if (!st.isDirectory()) continue;
    walk(root, root);
  }

  return stats;
}

/**
 * Layout detection: applied-repository layout keeps BOUNDARY_CLASSIFICATION.yaml at the
 * repository root; the paired overlay pack keeps it one level above the Website-Bot subtree.
 */
function resolveClassificationLocations() {
  if (existsSync(resolve(repoRoot, "BOUNDARY_CLASSIFICATION.yaml"))) {
    return {
      contextRoot: repoRoot,
      classificationPath: resolve(repoRoot, "BOUNDARY_CLASSIFICATION.yaml"),
    };
  }
  if (existsSync(resolve(packRoot, "BOUNDARY_CLASSIFICATION.yaml"))) {
    return {
      contextRoot: packRoot,
      classificationPath: resolve(packRoot, "BOUNDARY_CLASSIFICATION.yaml"),
    };
  }
  throw new Error("BOUNDARY_CLASSIFICATION.yaml not found at repository root or pack root");
}

function loadAndValidateClassification(classificationPath) {
  const classificationText = readFileSync(classificationPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const classification = JSON.parse(classificationText);
  for (const [name, system] of Object.entries(classification.systems ?? {})) {
    if (system.classification !== "platform_application" || system.runtime_node !== false) {
      throw new Error(`${name} boundary classification is not locked`);
    }
  }
  const boundary = classification.boundaries?.website_bot_to_seo_bot;
  if (
    boundary?.protocol !== "l9.website-factory.handoff/3.0" ||
    boundary.gate_required !== false ||
    boundary.transport_packet_required !== false
  ) {
    throw new Error("website_bot_to_seo_bot exception is incomplete");
  }
  return boundary;
}

/**
 * In pack layout, scan both overlay subtrees; in applied-repository layout, scan the
 * repository source itself. Missing roots are skipped rather than fatal so the same
 * validator runs in Website-Bot and SEO-Bot checkouts.
 */
function resolveScanRoots(contextRoot) {
  const candidateRoots =
    contextRoot === packRoot
      ? [resolve(packRoot, "Website-Bot"), resolve(packRoot, "SEO-Bot")]
      : [repoRoot];
  const roots = candidateRoots.filter((root) => {
    try {
      const st = lstatSync(root);
      return st.isDirectory() || st.isSymbolicLink();
    } catch {
      return false;
    }
  });
  if (roots.length === 0) throw new Error("no scan roots found for boundary validation");
  return roots;
}

function createFileInspector(contextRoot, violations) {
  const validatorRelPaths = new Set([
    "Website-Bot/scripts/validate-l9-boundaries.mjs",
    "scripts/validate-l9-boundaries.mjs",
  ]);
  const allowedPlatformApiPaths = new Set([
    "Website-Bot/src/stages/HandoffEmitterStage.ts",
    "src/stages/HandoffEmitterStage.ts",
    // Machine-to-machine intelligence seam (ADR-0004 / WEBSITE_INTELLIGENCE_LOCK):
    // the improve pipeline is the sanctioned consumer of SEO-Bot's build-time API.
    "Website-Bot/src/stages/CompetitiveIntelligenceStage.ts",
    "src/stages/CompetitiveIntelligenceStage.ts",
    // Campaign 7: the redesign content authority chain (SEOContentBlueprint →
    // PageContentContract → StructuredContentPackage) consumes the same seam.
    "Website-Bot/src/stages/RedesignContentAuthorityStage.ts",
    "src/stages/RedesignContentAuthorityStage.ts",
    // The readiness proof for that seam: it runs before the first paid
    // build-intelligence call and owns the SEO_BOT_* credential preconditions.
    "Website-Bot/src/stages/SeoBuildIntelligencePreflightStage.ts",
    "src/stages/SeoBuildIntelligencePreflightStage.ts",
    "Website-Bot/src/intelligence/SeoBuildIntelligenceHttpClient.ts",
    "src/intelligence/SeoBuildIntelligenceHttpClient.ts",
  ]);

  return function inspectFile(p) {
    const text = readFileSync(p, "utf8");
    const rel = relative(contextRoot, p).replaceAll("\\", "/");
    if (!validatorRelPaths.has(rel) && /PacketEnvelope/.test(text))
      violations.push(`${rel}: PacketEnvelope`);
    const inProducerSource = rel.startsWith("Website-Bot/src/") || rel.startsWith("src/");
    if (
      /SEO_BOT_URL|\/api\/clients\/register/.test(text) &&
      inProducerSource &&
      !allowedPlatformApiPaths.has(rel)
    ) {
      violations.push(`${rel}: unauthorized direct platform API egress`);
    }
    if (inProducerSource && /llm-stub/.test(text)) {
      violations.push(
        `${rel}: forbidden llm-stub reference (production LLM must use @quantum-l9/llm-router)`,
      );
    }
  };
}

/**
 * LLM router restoration guards: the production generation path must consume the real
 * @quantum-l9/llm-router package and never fall back to a local stub.
 */
function checkLlmRouterGuards(producerRoot, violations) {
  if (!existsSync(producerRoot)) return;
  if (existsSync(resolve(producerRoot, "src/services/llm-stub.ts"))) {
    violations.push("src/services/llm-stub.ts: production LLM stub must not exist");
  }
  const llmServicePath = resolve(producerRoot, "src/services/llm.ts");
  if (
    existsSync(llmServicePath) &&
    !/@quantum-l9\/llm-router/.test(readFileSync(llmServicePath, "utf8"))
  ) {
    violations.push("src/services/llm.ts: must import @quantum-l9/llm-router");
  }
  const pkgPath = resolve(producerRoot, "package.json");
  if (
    existsSync(pkgPath) &&
    !JSON.parse(readFileSync(pkgPath, "utf8")).dependencies?.["@quantum-l9/llm-router"]
  ) {
    violations.push("package.json: missing @quantum-l9/llm-router dependency");
  }
}

function runCli() {
  const { contextRoot, classificationPath } = resolveClassificationLocations();
  const boundary = loadAndValidateClassification(classificationPath);
  const roots = resolveScanRoots(contextRoot);

  const violations = [];
  const walkStats = walkRoots(roots, {
    onFile: createFileInspector(contextRoot, violations),
  });

  // LLM router restoration guards (producer subtree only).
  const producerRoot = contextRoot === packRoot ? resolve(packRoot, "Website-Bot") : repoRoot;
  checkLlmRouterGuards(producerRoot, violations);

  if (violations.length)
    throw new Error(`forbidden boundary references:\n${violations.join("\n")}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        classification: "platform_application",
        protocol: boundary.protocol,
        layout: contextRoot === packRoot ? "pack" : "repository",
        packet_envelope_findings: 0,
        direct_peer_bypass_findings: 0,
        skipped_symlinks: walkStats.skipped_symlinks,
        skipped_symlink_roots: walkStats.skipped_symlink_roots,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runCli();
}
