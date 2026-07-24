// L9_META: layer=validation, role=placeholder_pattern_catalog, status=active, version=1.0.0
/**
 * Canonical catalog of placeholder / unfinished-content patterns.
 *
 * Each pattern carries a severity contract:
 *  - `error`   → the build MUST fail: shipping this text to a production site
 *                would be a client-visible defect (e.g. "[phone number]").
 *  - `warning` → suspicious but potentially legitimate; surfaced in evidence
 *                and logs, never fails the build on its own.
 *
 * Patterns are applied to LLM-generated copy and generated JSON-LD schemas.
 * Keep every regex global-flag-free; the scanner manages iteration itself.
 */

export type PlaceholderSeverity = 'error' | 'warning';

export interface PlaceholderPattern {
  /** Stable machine identifier, used in evidence and tests. */
  id: string;
  /** Human explanation of why this pattern is a defect. */
  description: string;
  severity: PlaceholderSeverity;
  regex: RegExp;
}

export interface PlaceholderFinding {
  patternId: string;
  description: string;
  severity: PlaceholderSeverity;
  /** Where the text came from, e.g. `content:/contact:contact_form` or `schema:LocalBusiness`. */
  source: string;
  /** The exact matched text, truncated for evidence hygiene. */
  match: string;
  /** Surrounding context to make findings actionable without re-running. */
  excerpt: string;
}

const MAX_MATCH_LENGTH = 80;
const EXCERPT_RADIUS = 40;

export const PLACEHOLDER_PATTERNS: readonly PlaceholderPattern[] = [
  {
    id: 'bracketed-placeholder',
    description: 'Bracketed fill-in placeholder left in copy (e.g. "[phone number]", "[business name]")',
    severity: 'error',
    regex: /\[(?:your |insert |add |enter )?[a-z][a-z0-9 _-]{1,40}(?:number|name|address|email|phone|city|state|url|link|date|here)\]/i,
  },
  {
    id: 'template-variable',
    description: 'Unrendered template variable (e.g. "{{phone}}", "${city}", "<PHONE>")',
    severity: 'error',
    regex: /\{\{[^}]{1,60}\}\}|\$\{[^}]{1,60}\}|<(?:PHONE|EMAIL|ADDRESS|NAME|CITY|STATE|URL)[^>]{0,20}>/,
  },
  {
    id: 'lorem-ipsum',
    description: 'Lorem ipsum filler text',
    severity: 'error',
    regex: /lorem\s+ipsum|dolor\s+sit\s+amet/i,
  },
  {
    id: 'todo-marker',
    description: 'Authoring marker left in shipped copy (TODO/FIXME/TBD/XXX)',
    severity: 'error',
    regex: /\b(?:TODO|FIXME|TBD|XXX)\b[:\s]/,
  },
  {
    id: 'placeholder-word',
    description: 'Literal "placeholder" text left in copy',
    severity: 'error',
    regex: /\bplace\s?holder\b/i,
  },
  {
    id: 'coming-soon-stub',
    description: 'Stub copy such as "coming soon" or "under construction"',
    severity: 'warning',
    regex: /\b(?:coming soon|under construction|to be added|to be determined)\b/i,
  },
  {
    id: 'example-domain',
    description: 'RFC 2606 example/test domain in shipped content (example.com, example.org, *.invalid, *.test)',
    severity: 'error',
    regex: /\bhttps?:\/\/(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:invalid|test))\b/i,
  },
  {
    id: 'reserved-phone',
    description: 'Reserved fictional phone number (555-01xx range) in shipped content',
    severity: 'warning',
    regex: /\b\(?\d{3}\)?[\s.-]?555[\s.-]?01\d{2}\b/,
  },
  {
    id: 'test-form-endpoint',
    description: 'Form endpoint that looks like a test/placeholder ID (contains "test", "demo", "sample", "placeholder")',
    severity: 'error',
    regex: /https?:\/\/(?:www\.)?formspree\.io\/f\/[a-z0-9-]*(?:test|demo|sample|placeholder)[a-z0-9-]*/i,
  },
  {
    id: 'empty-schema-value',
    description: 'Empty required value in structured data (e.g. "telephone": "")',
    severity: 'error',
    regex: /"(?:telephone|email|url|name|streetAddress)"\s*:\s*""/,
  },
] as const;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function excerptAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + matchLength + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/**
 * Scan a single text blob against the full pattern catalog.
 * Returns at most one finding per pattern per source to keep evidence readable;
 * the first match is always the one reported.
 */
export function scanText(source: string, text: string): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    findings.push({
      patternId: pattern.id,
      description: pattern.description,
      severity: pattern.severity,
      source,
      match: truncate(match[0], MAX_MATCH_LENGTH),
      excerpt: excerptAround(text, match.index, match[0].length),
    });
  }
  return findings;
}
