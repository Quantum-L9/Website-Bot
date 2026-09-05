// L9_META: layer=cli, role=text_trimming, status=active, version=1.0.0
//
// Linear replacements for the anchored-quantifier trims these scripts used.
// Mirrors src/lib/text-trim.ts; kept separate because the scripts tree runs as
// plain .mjs with no build step.
//
// `/\/+$/` and `/[.\s]+$/` look linear and are not. An anchored quantifier is
// retried from every start position, so a value with a long run of the trimmed
// character costs O(n²) (SonarCloud javascript/typescript:S8786). These scan
// once from the relevant end and slice.

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
  return value.slice(0, value.length - trailingRun(value, (char) => char === "/"));
}

/**
 * `value` without its trailing run of characters satisfying `matches`.
 * Replaces the `/[X]+$/` shape.
 *
 * The predicate may itself be a regex test, as long as it is applied to ONE
 * character: a single-character match has nothing to backtrack over, so the
 * class stays exactly the class it replaces — `\s`, for one, covers NBSP and
 * the Unicode space separators that an ASCII list would silently drop.
 * @param {string} value
 * @param {(char: string) => boolean} matches
 * @returns {string}
 */
export function trimEndWhere(value, matches) {
  return value.slice(0, value.length - trailingRun(value, matches));
}

/**
 * Remove every `<...>` tag, replacing each with a single space.
 *
 * Scanned rather than matched with `/<[^>]+>/g`: ">" is never in that class, so
 * once the greedy run stops every backtrack step is futile — and the engine
 * still tries them all, once per start position. Bounding the run would fix the
 * cost and change the result, since a `<img src="data:...">` tag runs to tens
 * of kilobytes. "<>" is not a tag and is left alone, matching the pattern this
 * replaces.
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
