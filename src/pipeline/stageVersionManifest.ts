// L9_META: layer=pipeline, role=stage_version_manifest, status=active, version=1.0.0
//
// Checkpoint version discipline. A resumed or cached build reuses a stage's
// checkpoint only while the stage's declared `version` is unchanged
// (PipelineRunner.assessReuse / resumeStage). That is sound only if the
// version really moves whenever the stage's output semantics can move.
//
// This module binds each stage's declared version to a fingerprint of the
// source that shapes its output: the stage module, its transitive non-type
// local imports, and any declared extra sources (the Astro template for the
// assembler). config/stage-version-manifest.json records, per stage, an
// append-only history of {version, fingerprint, reason?}. The check fails when
// a stage's current fingerprint differs from its latest history entry; the
// only sanctioned updates are a version bump, or an explicit `output_unchanged`
// reason recorded against the same version (L9-COORD-001: a checkpoint is a
// derived result valid only against its declared coordinates).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

export const STAGE_VERSION_MANIFEST_SCHEMA = "website-bot.stage-version-manifest/v1";
export const STAGE_VERSION_MANIFEST_PATH = "config/stage-version-manifest.json";
export const STAGES_DIR = "src/stages";

export interface StageHistoryEntry {
  version: string;
  fingerprint: string;
  /** Present when the fingerprint changed without a version bump. */
  output_unchanged?: string;
}

export interface StageManifestEntry {
  module: string;
  history: StageHistoryEntry[];
}

export interface StageVersionManifest {
  schema: typeof STAGE_VERSION_MANIFEST_SCHEMA;
  /**
   * Modules that carry no output semantics (logging, error types, the build
   * context carrier). Excluded from every fingerprint so that touching them
   * does not force every stage's version.
   */
  non_output_shaping: string[];
  /** Extra output-shaping sources per stage (files or directories). */
  extra_sources: Record<string, string[]>;
  stages: Record<string, StageManifestEntry>;
}

export interface StageIdentity {
  name: string;
  version: string | undefined;
  module: string;
}

const toPosix = (path: string): string => path.split(sep).join("/");

/** Stage modules: every src/stages/*Stage.ts. */
export function stageModules(root: string): string[] {
  return readdirSync(join(root, STAGES_DIR))
    .filter((name) => name.endsWith("Stage.ts"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${STAGES_DIR}/${name}`);
}

/** The stage's declared `name` and `version` class fields, read from source. */
export function stageIdentity(root: string, module: string): StageIdentity {
  const source = readFileSync(join(root, module), "utf-8");
  const name = classField(source, "name");
  const version = classField(source, "version");
  if (!name) throw new Error(`${module}: no \`name = "..."\` field`);
  return { name, version, module };
}

/**
 * The string value of an indented `field = "..."` class field (optionally
 * readonly), read line by line: no backtracking pattern runs over the source.
 */
function classField(source: string, field: string): string | undefined {
  for (const line of source.split("\n")) {
    if (!/^\s/.test(line)) continue;
    const text = line.trim().replace(/^readonly\s+/, "");
    if (!text.startsWith(field)) continue;
    const rest = text.slice(field.length).trimStart();
    if (!rest.startsWith("=")) continue;
    const value = rest.slice(1).trimStart();
    if (!value.startsWith('"')) continue;
    const end = value.indexOf('"', 1);
    if (end > 1) return value.slice(1, end);
  }
  return undefined;
}

/** A statement with its leading line and block comments removed. */
function withoutLeadingComments(statement: string): string {
  let text = statement.trimStart();
  for (;;) {
    if (text.startsWith("//")) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1).trimStart();
    } else if (text.startsWith("/*")) {
      const close = text.indexOf("*/");
      text = close === -1 ? "" : text.slice(close + 2).trimStart();
    } else return text.trimEnd();
  }
}

/**
 * The statement from its last line that begins with `import` or `export`: a
 * chunk split on ";" can open with the tail of a preceding declaration
 * (`}` closing an interface whose members end in ";").
 */
function statementStart(chunk: string): string {
  const lines = chunk.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trimStart();
    if (line.startsWith("import ") || line.startsWith("export "))
      return [line, ...lines.slice(index + 1)].join("\n").trimEnd();
  }
  return chunk;
}

/**
 * Relative specifiers of a module's non-type `import ... from` / `export ...
 * from` statements, found by splitting statements on ";" (a linear scan).
 */
function relativeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const statement of source.split(";")) {
    const text = statementStart(withoutLeadingComments(statement));
    const keyword = ["import ", "export "].find((candidate) => text.startsWith(candidate));
    if (!keyword || text.slice(keyword.length).trimStart().startsWith("type ")) continue;
    const from = text.lastIndexOf(' from "');
    if (from === -1) continue;
    const start = from + ' from "'.length;
    const end = text.indexOf('"', start);
    const specifier = end === -1 ? "" : text.slice(start, end);
    if (specifier.startsWith("./") || specifier.startsWith("../")) specifiers.push(specifier);
  }
  return specifiers;
}

/** Local, non-type imports of one module, resolved to repo-relative paths. */
function localImports(root: string, module: string): string[] {
  const source = readFileSync(join(root, module), "utf-8");
  const found: string[] = [];
  for (const specifier of relativeSpecifiers(source)) {
    const base = normalize(join(dirname(module), specifier));
    const candidates = [base.replace(/\.js$/, ".ts"), base, `${base}.ts`, join(base, "index.ts")];
    const hit = candidates.find(
      (path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile(),
    );
    if (hit) found.push(toPosix(hit));
  }
  return found;
}

function filesUnder(root: string, path: string): string[] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) throw new Error(`declared source ${path} does not exist`);
  if (statSync(absolute).isFile()) return [toPosix(path)];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    entry.name === "node_modules" || entry.name.startsWith(".")
      ? []
      : filesUnder(root, toPosix(join(path, entry.name))),
  );
}

/** Every output-shaping source of a stage, sorted. */
export function stageSources(
  root: string,
  module: string,
  manifest: Pick<StageVersionManifest, "non_output_shaping" | "extra_sources">,
  stageName: string,
): string[] {
  const excluded = new Set(manifest.non_output_shaping);
  const seen = new Set<string>();
  const queue = [module];
  while (queue.length) {
    const next = queue.pop() as string;
    if (seen.has(next) || (next !== module && excluded.has(next))) continue;
    seen.add(next);
    queue.push(...localImports(root, next));
  }
  for (const extra of manifest.extra_sources[stageName] ?? [])
    for (const file of filesUnder(root, extra)) seen.add(file);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** sha256 over (path, content sha256) pairs: content- and layout-bound. */
export function fingerprintSources(root: string, sources: string[]): string {
  const hash = createHash("sha256");
  for (const path of sources) {
    const content = createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex");
    hash.update(`${path}\0${content}\n`);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function readManifest(root: string): StageVersionManifest {
  return JSON.parse(
    readFileSync(join(root, STAGE_VERSION_MANIFEST_PATH), "utf-8"),
  ) as StageVersionManifest;
}

export interface StageState {
  identity: StageIdentity;
  fingerprint: string;
  sources: string[];
}

export function currentStages(root: string, manifest: StageVersionManifest): StageState[] {
  return stageModules(root).map((module) => {
    const identity = stageIdentity(root, module);
    const sources = stageSources(root, module, manifest, identity.name);
    return { identity, sources, fingerprint: fingerprintSources(root, sources) };
  });
}

/** Every reason one stage's manifest entry does not describe it as it is now. */
function stageProblems(manifest: StageVersionManifest, stage: StageState): string[] {
  const { name, version, module } = stage.identity;
  if (!version) return [`${name} (${module}): declares no version, so resume cannot key on it`];
  const entry = manifest.stages[name];
  if (!entry)
    return [`${name}: missing from ${STAGE_VERSION_MANIFEST_PATH} (run npm run stages:manifest)`];
  const problems: string[] = [];
  if (entry.module !== module)
    problems.push(`${name}: module is ${module}, manifest says ${entry.module}`);
  problems.push(...historyProblems(name, entry.history));
  const latest = entry.history.at(-1);
  if (!latest) return problems;
  if (latest.version !== version)
    problems.push(`${name}: declares version ${version}, manifest records ${latest.version}`);
  if (latest.fingerprint !== stage.fingerprint)
    problems.push(
      `${name}: output-shaping source changed (${latest.fingerprint.slice(0, 19)} -> ${stage.fingerprint.slice(0, 19)}) ` +
        `without a manifest update: bump ${module}'s version, or record ` +
        `\`npm run stages:manifest -- --unchanged ${name}="<reason>"\` if its output semantics did not change`,
    );
  return problems;
}

/** Every reason the committed manifest does not describe the current stages. */
export function manifestProblems(root: string, manifest: StageVersionManifest): string[] {
  const problems: string[] = [];
  if (manifest.schema !== STAGE_VERSION_MANIFEST_SCHEMA)
    problems.push(`manifest schema is ${JSON.stringify(manifest.schema)}`);
  const stages = currentStages(root, manifest);
  const names = new Set(stages.map((stage) => stage.identity.name));
  for (const name of Object.keys(manifest.stages))
    if (!names.has(name)) problems.push(`${name}: in the manifest but no stage declares it`);
  for (const stage of stages) problems.push(...stageProblems(manifest, stage));
  return problems;
}

/** The history is append-only in meaning: a fingerprint change keeps the version only with a reason. */
export function historyProblems(name: string, history: StageHistoryEntry[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(history) || history.length === 0) return [`${name}: empty history`];
  history.forEach((entry, index) => {
    if (!/^sha256:[0-9a-f]{64}$/.test(entry.fingerprint))
      problems.push(`${name}: history[${index}] fingerprint is malformed`);
    const previous = history[index - 1];
    if (!previous) return;
    if (entry.fingerprint === previous.fingerprint && entry.version === previous.version)
      problems.push(`${name}: history[${index}] repeats history[${index - 1}]`);
    if (entry.version === previous.version && !entry.output_unchanged?.trim())
      problems.push(
        `${name}: history[${index}] changes the fingerprint at version ${entry.version} without an output_unchanged reason`,
      );
  });
  return problems;
}

export interface UpdateResult {
  manifest: StageVersionManifest;
  changed: string[];
  refused: string[];
}

/**
 * Bring the manifest up to date. A stage whose fingerprint moved gets a new
 * history entry only when its version moved too, or when `unchanged` names it
 * with a reason; otherwise it is refused and the manifest is left as it was.
 */
export function updateManifest(
  root: string,
  manifest: StageVersionManifest,
  unchanged: Record<string, string> = {},
): UpdateResult {
  const next: StageVersionManifest = structuredClone(manifest);
  const changed: string[] = [];
  const refused: string[] = [];
  const stages = currentStages(root, next);
  const present = new Set(stages.map((stage) => stage.identity.name));
  for (const name of Object.keys(next.stages))
    if (!present.has(name)) {
      delete next.stages[name];
      changed.push(`${name}: removed (no stage declares it)`);
    }
  for (const { identity, fingerprint } of stages) {
    const { name, version, module } = identity;
    if (!version) {
      refused.push(`${name}: declares no version`);
      continue;
    }
    const entry = next.stages[name];
    if (!entry) {
      next.stages[name] = { module, history: [{ version, fingerprint }] };
      changed.push(`${name}: added at ${version}`);
      continue;
    }
    entry.module = module;
    const latest = entry.history.at(-1);
    if (latest?.fingerprint === fingerprint && latest.version === version) continue;
    if (latest?.version !== version) {
      entry.history.push({ version, fingerprint });
      changed.push(`${name}: ${latest?.version ?? "none"} -> ${version}`);
      continue;
    }
    const reason = unchanged[name]?.trim();
    if (!reason) {
      refused.push(
        `${name}: output-shaping source changed at version ${version}; bump the version or pass --unchanged ${name}="<reason>"`,
      );
      continue;
    }
    entry.history.push({ version, fingerprint, output_unchanged: reason });
    changed.push(`${name}: fingerprint recorded as output-unchanged at ${version}`);
  }
  next.stages = Object.fromEntries(
    Object.entries(next.stages).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { manifest: next, changed, refused };
}

/** Repository root from a module inside it. */
export function repoRoot(from: string = import.meta.dirname): string {
  return resolve(from, "..", "..");
}

export function relativeToRoot(root: string, path: string): string {
  return toPosix(relative(root, path));
}
