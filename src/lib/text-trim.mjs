// L9_META: layer=lib, role=text_trimming, status=active, version=1.0.0
//
// Linear replacements for the anchored-quantifier scans this repo used
// everywhere, and the single owner of them.
//
// Plain .mjs rather than .ts on purpose: both trees need these. `src/**` reads
// them through the .d.mts beside this file, and the `scripts/**` tooling — much
// of which is untranspiled .mjs and cannot import TypeScript — imports this
// module directly. A second copy under scripts/lib is what SonarCloud's
// duplication gate was pointing at, and there is no reason for one.
//
// Why any of it exists: `/\/+$/`, `/^_+|_+$/g` and `/<[^>]+>/g` look linear and
// are not. An anchored quantifier is retried from every start position, and a
// negated class before its delimiter backtracks futilely once per start, so a
// long run or a stray "<" costs O(n²) (SonarCloud javascript/typescript:S8786).
// These scan once and slice.

/**
 * @param {string} value
 * @param {(char: string) => boolean} matches
 * @returns {number} count of characters at the end of `value` that match
 */
function trailingRun(value, matches) {
  let length = 0;
  while (length < value.length && matches(value[value.length - 1 - length])) length += 1;
  return length;
}

/**
 * `value` without its trailing "/" run. Replaces `.replace(/\/+$/, "")`.
 * @param {string} value
 * @returns {string}
 */
export function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/**
 * `value` without leading and trailing runs of `chars`. Replaces the
 * `/^X+|X+$/g` shape. `chars` is a set of literal characters, not a pattern,
 * so nothing here can reintroduce backtracking.
 * @param {string} value
 * @param {string} chars
 * @returns {string}
 */
export function trimChars(value, chars) {
  const set = new Set(chars);
  let start = 0;
  while (start < value.length && set.has(value[start])) start += 1;
  if (start === value.length) return "";
  let end = value.length;
  while (end > start && set.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/**
 * `value` without its trailing run of characters satisfying `matches`.
 * Replaces the `/[X]+$/` shape.
 *
 * The predicate may itself be a regex test, as long as it is applied to ONE
 * character: a single-character match has nothing to backtrack over, so the
 * class stays exactly the class it replaces — `\s`, for one, covers NBSP and
 * the Unicode space separators an ASCII list would silently drop.
 * @param {string} value
 * @param {(char: string) => boolean} matches
 * @returns {string}
 */
export function trimEndWhere(value, matches) {
  return value.slice(0, value.length - trailingRun(value, matches));
}

/**
 * Every `<...>` tag replaced with a single space.
 *
 * Scanned rather than matched with `/<[^>]+>/g`: ">" is never in that class, so
 * once the greedy run stops every backtrack step is futile — and the engine
 * still tries them all, once per start position. Bounding the run would fix the
 * cost and change the result, since a `<img src="data:...">` tag runs to tens
 * of kilobytes and past the bound would stop being stripped, spilling base64
 * into extracted text. "<>" has nothing between the brackets, so it is not a
 * tag and is left alone — matching the pattern this replaces.
 * @param {string} html
 * @returns {string}
 */
export function stripHtmlTags(html) {
  let stripped = "";
  let cursor = 0;
  for (;;) {
    const open = html.indexOf("<", cursor);
    if (open === -1) break;
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    if (close === open + 1) {
      stripped += html.slice(cursor, open + 1);
      cursor = open + 1;
      continue;
    }
    stripped += `${html.slice(cursor, open)} `;
    cursor = close + 1;
  }
  return stripped + html.slice(cursor);
}
