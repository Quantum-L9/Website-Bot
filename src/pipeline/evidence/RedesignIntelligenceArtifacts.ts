// L9_META: layer=pipeline, role=redesign_intelligence_persistence, status=active, version=1.0.0
//
// Canonical run-bound persistence for the REDESIGN_IMPROVE intelligence chain.
//
// Before this module the CLI kept CompetitiveLandscape, SEOContentBlueprint,
// StructuredContentPackage, ClientVision, DesignReferenceSet and
// DesignReferenceIntelligence in BuildContext memory only; a benchmark driver
// had to capture them in-process, and a process restart lost every paid
// artifact (Quantum AI Partners run 2026-09-01, GAP-3). Every stage that
// produces one of these now persists it here, under the same per-build asset
// root the blueprint and PageContentContract already used, with an index that
// carries schema version, run identity, per-file digests and — for sealed
// artifacts — the content-addressed identity and input refs.
//
// Reload is fail-closed: a file whose digest no longer matches the index, a
// sealed artifact whose integrity or (client_id, build_id) identity does not
// match this run, or a broken lineage between artifacts is REDESIGN_ARTIFACT_
// INVALID, never a silent fallback.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertIntelligenceArtifactIntegrity,
  type CompetitiveLandscapeArtifact,
  type IntelligenceArtifactType,
  type PageContentContractArtifact,
  refForArtifact,
  sameArtifactRef,
  type SEOContentBlueprintArtifact,
  type StructuredContentPackageArtifact,
  type WebsiteBuildBlueprintArtifact,
  type WebsiteIntelligenceArtifact,
} from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../../core/logger.js";
import type { DesignReferenceAcquisitionManifest } from "../../intelligence/DesignReferenceAcquisition.js";
import type {
  ClientVision,
  DesignReferenceIntelligence,
  DesignReferenceSet,
} from "../../intelligence/design-authority.js";
import type { AcceptedDonorEvidence } from "../../intelligence/DonorIngestion.js";
import { type BuildContext, clientAssetRoot } from "../BuildContext.js";
import { BuildError } from "../BuildError.js";
import { sha256Text } from "./EvidenceCanonicalizer.js";

const logger = createModuleLogger("evidence:redesign-intelligence");

export const REDESIGN_INTELLIGENCE_INDEX_SCHEMA =
  "website-bot.redesign-intelligence-index/v1" as const;
export const REDESIGN_INTELLIGENCE_DIR = "redesign-intelligence";

export type RedesignArtifactName =
  | "client-vision"
  | "design-reference-acquisition"
  | "design-reference-set"
  | "design-reference-intelligence"
  | "competitive-landscape"
  | "accepted-donors"
  | "seo-bot-ordering"
  | "website-build-blueprint"
  | "seo-content-blueprint"
  | "page-content-contract"
  | "pcc-determinism"
  | "structured-content-package"
  | "redesign-counters"
  | "redesign-integrity-receipt";

export interface RedesignArtifactRecord {
  file: string;
  sha256: string;
  written_at: string;
  sealed?: {
    artifact_type: IntelligenceArtifactType;
    artifact_id: string;
    payload_digest: string;
    input_refs: Array<{ artifact_type: string; artifact_id: string; payload_digest: string }>;
  };
}

export interface RedesignIntelligenceIndex {
  schema: typeof REDESIGN_INTELLIGENCE_INDEX_SCHEMA;
  client_id: string;
  build_id: string;
  build_intent: "REDESIGN_IMPROVE";
  created_at: string;
  updated_at: string;
  artifacts: Partial<Record<RedesignArtifactName, RedesignArtifactRecord>>;
}

type Identity = Pick<BuildContext, "clientId" | "buildId">;

export function redesignIntelligenceDir(ctx: Identity): string {
  return resolve(clientAssetRoot(ctx), REDESIGN_INTELLIGENCE_DIR);
}

function indexPath(ctx: Identity): string {
  return resolve(redesignIntelligenceDir(ctx), "index.json");
}

function isSealed(value: unknown): value is WebsiteIntelligenceArtifact {
  return (
    typeof value === "object" &&
    value !== null &&
    "protocol" in value &&
    "artifact_id" in value &&
    "integrity" in value &&
    "payload" in value
  );
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, path);
}

export function readRedesignIntelligenceIndex(ctx: Identity): RedesignIntelligenceIndex | undefined {
  const path = indexPath(ctx);
  if (!existsSync(path)) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<RedesignIntelligenceIndex>;
  if (
    parsed.schema !== REDESIGN_INTELLIGENCE_INDEX_SCHEMA ||
    parsed.client_id !== ctx.clientId ||
    parsed.build_id !== ctx.buildId ||
    typeof parsed.artifacts !== "object" ||
    parsed.artifacts === null
  ) {
    throw new BuildError(
      "REDESIGN_ARTIFACT_INVALID",
      `redesign intelligence index at ${path} does not belong to build ${ctx.buildId} (${ctx.clientId})`,
    );
  }
  return parsed as RedesignIntelligenceIndex;
}

/**
 * Persist one redesign intelligence artifact for this run. Plan/dry runs
 * persist nothing (the plan contract promises no runtime evidence files).
 */
export function persistRedesignArtifact(
  ctx: Pick<BuildContext, "clientId" | "buildId" | "dryRun">,
  name: RedesignArtifactName,
  value: unknown,
): RedesignArtifactRecord | undefined {
  if (ctx.dryRun) return undefined;
  const dir = redesignIntelligenceDir(ctx);
  mkdirSync(dir, { recursive: true });
  const file = `${name}.json`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  atomicWrite(resolve(dir, file), content);
  const now = new Date().toISOString();
  const record: RedesignArtifactRecord = {
    file,
    sha256: sha256Text(content),
    written_at: now,
    ...(isSealed(value)
      ? {
          sealed: {
            artifact_type: value.artifact_type,
            artifact_id: value.artifact_id,
            payload_digest: value.integrity.payload_digest,
            input_refs: value.input_refs,
          },
        }
      : {}),
  };
  const existing = readRedesignIntelligenceIndex(ctx);
  const index: RedesignIntelligenceIndex = existing ?? {
    schema: REDESIGN_INTELLIGENCE_INDEX_SCHEMA,
    client_id: ctx.clientId,
    build_id: ctx.buildId,
    build_intent: "REDESIGN_IMPROVE",
    created_at: now,
    updated_at: now,
    artifacts: {},
  };
  index.artifacts[name] = record;
  index.updated_at = now;
  atomicWrite(indexPath(ctx), `${JSON.stringify(index, null, 2)}\n`);
  logger.info({ name, file: resolve(dir, file), sha256: record.sha256 }, "redesign artifact persisted");
  return record;
}

/**
 * Load one persisted artifact, verifying its file digest against the index and
 * — for sealed artifacts — integrity plus run identity. Returns undefined only
 * when the artifact was never persisted; corruption or mismatch throws.
 */
export function loadRedesignArtifact<T>(
  ctx: Identity,
  name: RedesignArtifactName,
  options: { sealed?: IntelligenceArtifactType } = {},
): T | undefined {
  const index = readRedesignIntelligenceIndex(ctx);
  const record = index?.artifacts[name];
  if (!index || !record) return undefined;
  const path = resolve(redesignIntelligenceDir(ctx), record.file);
  if (!existsSync(path)) {
    throw new BuildError(
      "REDESIGN_ARTIFACT_INVALID",
      `redesign artifact ${name} is indexed but missing on disk: ${path}`,
    );
  }
  const content = readFileSync(path, "utf-8");
  if (sha256Text(content) !== record.sha256) {
    throw new BuildError(
      "REDESIGN_ARTIFACT_INVALID",
      `redesign artifact ${name} digest does not match its index record (tampered or partially written)`,
    );
  }
  const value = JSON.parse(content) as unknown;
  if (options.sealed) {
    if (!isSealed(value) || value.artifact_type !== options.sealed) {
      throw new BuildError(
        "REDESIGN_ARTIFACT_INVALID",
        `redesign artifact ${name} is not a sealed ${options.sealed} artifact`,
      );
    }
    try {
      assertIntelligenceArtifactIntegrity(value);
    } catch (error) {
      throw new BuildError(
        "REDESIGN_ARTIFACT_INVALID",
        `redesign artifact ${name} failed integrity verification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (value.client_id !== ctx.clientId || value.build_id !== ctx.buildId) {
      throw new BuildError(
        "REDESIGN_ARTIFACT_INVALID",
        `redesign artifact ${name} belongs to ${value.client_id}/${value.build_id}, not ${ctx.clientId}/${ctx.buildId}`,
      );
    }
    if (record.sealed?.artifact_id !== value.artifact_id) {
      throw new BuildError(
        "REDESIGN_ARTIFACT_INVALID",
        `redesign artifact ${name} identity drifted from its index record`,
      );
    }
  }
  return value as T;
}

export interface PersistedRedesignIntelligence {
  clientVision?: ClientVision;
  designReferenceAcquisition?: DesignReferenceAcquisitionManifest;
  designReferenceSet?: DesignReferenceSet;
  designReferenceIntelligence?: DesignReferenceIntelligence;
  competitiveLandscape?: CompetitiveLandscapeArtifact;
  acceptedDonors?: AcceptedDonorEvidence[];
  seoBotOrdering?: BuildContext["seoBotOrdering"];
  websiteBlueprint?: WebsiteBuildBlueprintArtifact;
  seoContentBlueprint?: SEOContentBlueprintArtifact;
  pageContentContract?: PageContentContractArtifact;
  pccDeterminism?: BuildContext["pccDeterminism"];
  structuredContentPackage?: StructuredContentPackageArtifact;
  redesignCounters?: BuildContext["redesignCounters"];
}

/**
 * Load everything persisted for this run and re-verify the lineage between
 * sealed artifacts. A lineage break is a REDESIGN_ARTIFACT_INVALID failure:
 * artifacts from two different acquisitions must never be recombined.
 */
export function loadPersistedRedesignIntelligence(ctx: Identity): PersistedRedesignIntelligence {
  const loaded: PersistedRedesignIntelligence = {
    clientVision: loadRedesignArtifact(ctx, "client-vision"),
    designReferenceAcquisition: loadRedesignArtifact(ctx, "design-reference-acquisition"),
    designReferenceSet: loadRedesignArtifact(ctx, "design-reference-set"),
    designReferenceIntelligence: loadRedesignArtifact(ctx, "design-reference-intelligence"),
    competitiveLandscape: loadRedesignArtifact(ctx, "competitive-landscape", {
      sealed: "competitive_landscape",
    }),
    acceptedDonors: loadRedesignArtifact(ctx, "accepted-donors"),
    seoBotOrdering: loadRedesignArtifact(ctx, "seo-bot-ordering"),
    websiteBlueprint: loadRedesignArtifact(ctx, "website-build-blueprint", {
      sealed: "website_build_blueprint",
    }),
    seoContentBlueprint: loadRedesignArtifact(ctx, "seo-content-blueprint", {
      sealed: "seo_content_blueprint",
    }),
    pageContentContract: loadRedesignArtifact(ctx, "page-content-contract", {
      sealed: "page_content_contract",
    }),
    pccDeterminism: loadRedesignArtifact(ctx, "pcc-determinism"),
    structuredContentPackage: loadRedesignArtifact(ctx, "structured-content-package", {
      sealed: "structured_content_package",
    }),
    redesignCounters: loadRedesignArtifact(ctx, "redesign-counters"),
  };

  const lineage = (condition: boolean, message: string): void => {
    if (!condition) throw new BuildError("REDESIGN_ARTIFACT_INVALID", `lineage broken: ${message}`);
  };
  if (loaded.websiteBlueprint && loaded.competitiveLandscape) {
    lineage(
      sameArtifactRef(
        loaded.websiteBlueprint.payload.provenance.competitive_landscape_ref,
        refForArtifact(loaded.competitiveLandscape),
      ),
      "website-build-blueprint does not reference the persisted competitive-landscape",
    );
  }
  if (loaded.seoContentBlueprint && loaded.competitiveLandscape) {
    lineage(
      sameArtifactRef(
        loaded.seoContentBlueprint.payload.competitive_landscape_ref,
        refForArtifact(loaded.competitiveLandscape),
      ),
      "seo-content-blueprint does not reference the persisted competitive-landscape",
    );
  }
  if (loaded.pageContentContract && loaded.websiteBlueprint && loaded.seoContentBlueprint) {
    lineage(
      sameArtifactRef(
        loaded.pageContentContract.payload.inputs.website_build_blueprint,
        refForArtifact(loaded.websiteBlueprint),
      ) &&
        sameArtifactRef(
          loaded.pageContentContract.payload.inputs.seo_content_blueprint,
          refForArtifact(loaded.seoContentBlueprint),
        ),
      "page-content-contract does not reference the persisted blueprints",
    );
  }
  if (loaded.structuredContentPackage && loaded.pageContentContract) {
    lineage(
      sameArtifactRef(
        loaded.structuredContentPackage.payload.page_content_contract_ref,
        refForArtifact(loaded.pageContentContract),
      ),
      "structured-content-package does not reference the persisted page-content-contract",
    );
  }
  return loaded;
}

/**
 * Hydrate the BuildContext from persisted intelligence on resume. Returns the
 * names hydrated; the caller decides whether that is enough to skip its paid
 * work. Nothing already present on the context is overwritten.
 */
export function hydrateRedesignIntelligence(
  ctx: BuildContext,
  names: readonly RedesignArtifactName[],
): RedesignArtifactName[] {
  const persisted = loadPersistedRedesignIntelligence(ctx);
  const hydrated: RedesignArtifactName[] = [];
  const assign = <K extends keyof BuildContext>(
    name: RedesignArtifactName,
    key: K,
    value: BuildContext[K] | undefined,
  ): void => {
    if (!names.includes(name) || value === undefined) return;
    if (ctx[key] === undefined) ctx[key] = value;
    hydrated.push(name);
  };
  assign("client-vision", "clientVision", persisted.clientVision);
  assign(
    "design-reference-acquisition",
    "designReferenceAcquisition",
    persisted.designReferenceAcquisition,
  );
  assign("design-reference-set", "designReferenceSet", persisted.designReferenceSet);
  assign(
    "design-reference-intelligence",
    "designReferenceIntelligence",
    persisted.designReferenceIntelligence,
  );
  assign("competitive-landscape", "competitiveLandscape", persisted.competitiveLandscape);
  assign("accepted-donors", "acceptedDonors", persisted.acceptedDonors);
  assign("seo-bot-ordering", "seoBotOrdering", persisted.seoBotOrdering);
  assign("website-build-blueprint", "websiteBlueprint", persisted.websiteBlueprint);
  assign("seo-content-blueprint", "seoContentBlueprint", persisted.seoContentBlueprint);
  assign("page-content-contract", "pageContentContract", persisted.pageContentContract);
  assign("pcc-determinism", "pccDeterminism", persisted.pccDeterminism);
  assign(
    "structured-content-package",
    "structuredContentPackage",
    persisted.structuredContentPackage,
  );
  assign("redesign-counters", "redesignCounters", persisted.redesignCounters);
  return hydrated;
}
