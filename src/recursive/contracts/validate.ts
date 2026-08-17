// L9_META: layer=recursive, role=schema_validator, status=active, version=1.0.0
// JSON Schema 2020-12 subset validator for the bound recursive schemas, used
// by conformance tests to validate emitted artifacts exactly as emitted (no
// translation shim). Mirrors the compiler in scripts/validate-recursive-schemas.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonSchema = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
  $defs?: Record<string, JsonSchema>;
};

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`external $ref not allowed: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce<JsonSchema>((current, key) => {
      const decoded = key.replaceAll("~1", "/").replaceAll("~0", "~");
      return (
        (current.$defs ?? {})[decoded] ??
        (current as unknown as Record<string, JsonSchema>)[decoded]
      );
    }, root);
}

export function validateAgainstSchema(
  schema: JsonSchema,
  value: unknown,
  path = "$",
): string | null {
  const root = schema;
  const walk = (node: JsonSchema, item: unknown, itemPath: string): string | null => {
    if (node.$ref) return walk(resolveRef(root, node.$ref), item, itemPath);
    if ("const" in node && item !== node.const) return `${itemPath} must equal const`;
    if (node.enum && !node.enum.includes(item)) return `${itemPath} must be in enum`;
    if (node.type === "object") {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return `${itemPath} must be object`;
      for (const key of node.required ?? [])
        if (!(key in item)) return `${itemPath}.${key} is required`;
      if (node.additionalProperties === false) {
        for (const key of Object.keys(item))
          if (!(key in (node.properties ?? {}))) return `${itemPath}.${key} is not allowed`;
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (key in item) {
          const error = walk(child, (item as Record<string, unknown>)[key], `${itemPath}.${key}`);
          if (error) return error;
        }
      }
    }
    if (node.type === "array") {
      if (!Array.isArray(item)) return `${itemPath} must be array`;
      if (item.length < (node.minItems ?? 0)) return `${itemPath} has too few items`;
      for (let index = 0; index < item.length; index += 1) {
        const error = walk(node.items ?? {}, item[index], `${itemPath}[${index}]`);
        if (error) return error;
      }
    }
    if (node.type === "string") {
      if (typeof item !== "string") return `${itemPath} must be string`;
      if (item.length < (node.minLength ?? 0)) return `${itemPath} is too short`;
      if (node.pattern && !new RegExp(node.pattern).test(item))
        return `${itemPath} does not match pattern`;
      if (node.format === "date-time" && Number.isNaN(Date.parse(item)))
        return `${itemPath} must be date-time`;
    }
    if (
      node.type === "integer" &&
      (!Number.isInteger(item) ||
        (item as number) < (node.minimum ?? -Infinity) ||
        (item as number) > (node.maximum ?? Infinity))
    ) {
      return `${itemPath} must be integer in range`;
    }
    if (
      node.type === "number" &&
      (typeof item !== "number" ||
        item < (node.minimum ?? -Infinity) ||
        item > (node.maximum ?? Infinity))
    ) {
      return `${itemPath} must be number in range`;
    }
    if (node.type === "boolean" && typeof item !== "boolean") return `${itemPath} must be boolean`;
    return null;
  };
  return walk(schema, value, path);
}

export function loadRecursiveSchema(
  name:
    | "engineering-signal"
    | "pe-pack"
    | "code-change-outcome"
    | "recursive-engineering-event"
    | "recursive-engineering-wave"
    | "recursive-engineering-run",
): JsonSchema {
  const path = resolve("schemas/recursive", `${name}.schema.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as JsonSchema;
}

export function assertSchemaConformance(
  schemaName: Parameters<typeof loadRecursiveSchema>[0],
  artifact: unknown,
): void {
  const error = validateAgainstSchema(loadRecursiveSchema(schemaName), artifact);
  if (error) throw new Error(`conformance failure for ${schemaName}: ${error}`);
}
