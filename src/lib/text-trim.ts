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

/** Count of characters at the end of `value` that satisfy `matches`. */
function trailingRun(value: string, matches: (char: string) => boolean): number {
  let length = 0;
  while (length < value.length && matches(value[value.length - 1 - length]!)) length += 1;
  return length;
}

/** Count of characters at the start of `value` that satisfy `matches`. */
function leadingRun(value: string, matches: (char: string) => boolean): number {
  let length = 0;
  while (length < value.length && matches(value[length]!)) length += 1;
  return length;
}

/** `value` without its trailing "/" run. Replaces `.replace(/\/+$/, "")`. */
export function stripTrailingSlashes(value: string): string {
  return value.slice(0, value.length - trailingRun(value, (char) => char === "/"));
}

/**
 * `value` without leading and trailing runs of `chars`.
 *
 * Replaces the `/^X+|X+$/g` shape. `chars` is a set of literal characters, not
 * a pattern, so nothing here can reintroduce backtracking.
 */
export function trimChars(value: string, chars: string): string {
  const set = new Set(chars);
  const inSet = (char: string): boolean => set.has(char);
  const start = leadingRun(value, inSet);
  if (start === value.length) return "";
  return value.slice(start, value.length - trailingRun(value, inSet));
}
