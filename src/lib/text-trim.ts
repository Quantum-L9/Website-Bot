// L9_META: layer=lib, role=text_trimming, status=active, version=1.0.0
//
// Linear replacements for the anchored-quantifier trims this repo used
// everywhere.
//
// `/\/+$/`, `/^_+|_+$/g` and friends look linear and are not. An anchored
// quantifier is retried from every start position, so a value with a long run
// of the trimmed character — or a long tail that never matches — costs O(n²)
// (SonarCloud typescript:S8786). These scan once from the relevant end and
// slice, which is both linear and easier to read than the pattern it replaces.

/** `value` without its trailing "/" run. Replaces `.replace(/\/+$/, "")`. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/**
 * `value` without leading and trailing runs of `chars`.
 *
 * Replaces the `/^X+|X+$/g` shape. `chars` is a set of literal characters, not
 * a pattern, so nothing here can reintroduce backtracking.
 */
export function trimChars(value: string, chars: string): string {
  const set = new Set(chars);
  let start = 0;
  while (start < value.length && set.has(value[start]!)) start += 1;
  if (start === value.length) return "";
  let end = value.length;
  while (end > start && set.has(value[end - 1]!)) end -= 1;
  return value.slice(start, end);
}
