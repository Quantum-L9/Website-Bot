// L9_META: layer=service, role=llm_output_json_extraction, status=active, version=1.0.0
//
// Defensive JSON extraction for LLM responses. Models routinely ignore
// "no fences" instructions and wrap JSON in markdown code fences or prose.
// This module recovers the JSON payload deterministically without ever
// widening what counts as valid JSON: the final parse is still JSON.parse.
//
// Extraction order (first success wins):
//   1. Raw string parses as-is.
//   2. Markdown code fence(s) stripped (```json ... ``` or ``` ... ```).
//   3. First balanced top-level JSON value ({...} or [...]) found by a
//      string-and-escape-aware scanner (handles prose before/after JSON).
// If none succeed, throws JsonExtractionError listing every attempt.

export class JsonExtractionError extends Error {
  readonly attempts: string[];
  constructor(message: string, attempts: string[]) {
    super(message);
    this.name = 'JsonExtractionError';
    this.attempts = attempts;
  }
}

function stripCodeFences(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return undefined;
  const lines = trimmed.split(/\r?\n/);
  // Drop the opening fence line (``` or ```json etc.).
  let body = lines.slice(1);
  // Drop the closing fence line if present.
  const lastFence = body.map(line => line.trim()).lastIndexOf('```');
  if (lastFence !== -1) body = body.slice(0, lastFence);
  const candidate = body.join('\n').trim();
  return candidate.length > 0 ? candidate : undefined;
}

function scanBalancedJson(raw: string): string | undefined {
  const start = raw.search(/[[{]/);
  if (start === -1) return undefined;
  const open = raw[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }
  return undefined;
}

/**
 * Extract and parse the first JSON value from an LLM response.
 * Throws JsonExtractionError (never a bare SyntaxError) when no candidate parses.
 */
export function extractJson(raw: string): unknown {
  const attempts: string[] = [];
  const candidates: Array<{ label: string; text: string | undefined }> = [
    { label: 'raw', text: raw },
    { label: 'fence-stripped', text: stripCodeFences(raw) },
    { label: 'balanced-scan', text: scanBalancedJson(raw) },
  ];
  for (const { label, text } of candidates) {
    if (text === undefined) continue;
    try {
      return JSON.parse(text);
    } catch (error) {
      attempts.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new JsonExtractionError(
    `No parseable JSON found in LLM response (${attempts.length} extraction strategies failed)`,
    attempts,
  );
}
