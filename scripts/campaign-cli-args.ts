// L9_META: layer=script, role=campaign_cli_args, status=active, version=1.0.0
/**
 * Shared argument parsing for the campaign commands.
 * Accepts both --name=value (repo-idiomatic) and space-separated forms (DEC-003).
 */
export interface ParsedArgs {
  values: Record<string, string>;
  flags: Set<string>;
}

export function parseCampaignArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals >= 0) {
      values[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values[body] = next;
      index += 1;
    } else {
      flags.add(body);
    }
  }
  return { values, flags };
}

export function requiredValue(args: ParsedArgs, name: string): string {
  const value = args.values[name];
  if (!value) {
    throw new Error(`missing required flag --${name}`);
  }
  return value;
}

export function optionalInt(args: ParsedArgs, name: string): number | undefined {
  const value = args.values[name];
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

export function siteSlugOf(sourceUrl: string): string {
  const normalized = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(sourceUrl)
    ? sourceUrl
    : `https://${sourceUrl}`;
  const hostname = new URL(normalized).hostname;
  const parts = hostname.split(".").filter((part) => part && part !== "www");
  if (parts.length === 0) throw new Error(`cannot derive site slug from source url: ${sourceUrl}`);
  return parts[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function defaultCampaignId(sourceUrl: string): string {
  const slug = siteSlugOf(sourceUrl);
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${slug}-${stamp}-001`;
}
