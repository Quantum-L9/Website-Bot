// L9_META: layer=test, role=visual_reference_registry, status=active, version=1.0.0
//
// Which designs are under visual protection. A design enters protection only
// through tests/visual/approve-reference.ts; until then it is listed as
// awaiting-approval and must have no reference files at all.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VISUAL_REGISTRY_SCHEMA = "website-bot.visual-reference-registry/v1" as const;

export interface VisualRegistryEntry {
  design_id: string;
  fixture: string;
  routes: string[];
  status: "approved" | "awaiting-approval";
}

export interface VisualRegistry {
  schema: typeof VISUAL_REGISTRY_SCHEMA;
  designs: VisualRegistryEntry[];
}

export function readRegistry(root: string): VisualRegistry {
  const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf-8")) as VisualRegistry;
  if (registry.schema !== VISUAL_REGISTRY_SCHEMA || !Array.isArray(registry.designs)) {
    throw new Error(`visual reference registry is not ${VISUAL_REGISTRY_SCHEMA}`);
  }
  return registry;
}

export function writeRegistry(root: string, registry: VisualRegistry): void {
  writeFileSync(join(root, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
}
