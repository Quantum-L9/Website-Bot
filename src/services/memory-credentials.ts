// L9_META: layer=service, role=governed_memory_credentials, status=active, version=1.0.0

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type MemoryMode = "disabled" | "optional" | "required";

export const DEFAULT_L9_MEMORY_MODE: MemoryMode = "required";
export const DEFAULT_L9_MEMORY_URL = "http://127.0.0.1:8100";
export const GRAPHITI_MACHINE_ALIAS_KEYS = ["GRAPHITI_MCP_TOKEN", "GRAPHITI_MCP_URL"] as const;

export function isBlankMemoryValue(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

export function parseGraphitiMachineAliases(
  contents: string,
): Partial<Record<(typeof GRAPHITI_MACHINE_ALIAS_KEYS)[number], string>> {
  const out: Partial<Record<(typeof GRAPHITI_MACHINE_ALIAS_KEYS)[number], string>> = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "GRAPHITI_MCP_TOKEN" && key !== "GRAPHITI_MCP_URL") continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

export function applyGraphitiMachineAliases(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = env.HOME ?? env.USERPROFILE,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string[] {
  const applied: string[] = [];
  const tokenBlank = isBlankMemoryValue(env.GRAPHITI_MCP_TOKEN);
  const urlBlank = isBlankMemoryValue(env.GRAPHITI_MCP_URL);
  if (!tokenBlank && !urlBlank) return applied;
  if (!homeDir) return applied;
  try {
    const parsed = parseGraphitiMachineAliases(readFile(join(homeDir, ".cursor", "graphiti.env")));
    if (tokenBlank && parsed.GRAPHITI_MCP_TOKEN) {
      env.GRAPHITI_MCP_TOKEN = parsed.GRAPHITI_MCP_TOKEN;
      applied.push("GRAPHITI_MCP_TOKEN");
    }
    if (urlBlank && parsed.GRAPHITI_MCP_URL) {
      env.GRAPHITI_MCP_URL = parsed.GRAPHITI_MCP_URL;
      applied.push("GRAPHITI_MCP_URL");
    }
  } catch {
    // Machine overlay is optional; Infisical / process.env remain the other path.
  }
  return applied;
}

export function resolveMemoryMode(env: NodeJS.ProcessEnv = process.env): MemoryMode {
  const value = env.L9_MEMORY_MODE ?? DEFAULT_L9_MEMORY_MODE;
  if (value === "disabled" || value === "optional" || value === "required") return value;
  throw new Error("L9_MEMORY_MODE must be disabled, optional, or required");
}

export function resolveMemoryCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { baseUrl: string; bearerToken: string } | null {
  applyGraphitiMachineAliases(env);
  const mode = resolveMemoryMode(env);
  if (mode === "disabled") return null;
  const bearerToken = (env.L9_MEMORY_TOKEN ?? env.GRAPHITI_MCP_TOKEN)?.trim();
  const baseUrl = (env.L9_MEMORY_URL ?? env.GRAPHITI_MCP_URL)?.trim() || DEFAULT_L9_MEMORY_URL;
  if (!bearerToken) {
    if (mode === "required") {
      throw new Error("L9_MEMORY_TOKEN or GRAPHITI_MCP_TOKEN is required when L9_MEMORY_MODE=required");
    }
    return null;
  }
  return { baseUrl, bearerToken };
}
