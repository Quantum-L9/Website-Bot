// L9_META: layer=lib, role=text_coercion, status=active, version=1.0.0
//
// Safe text coercion for values that arrive as `unknown`.
//
// The compilers and stages in this repo read LLM output and third-party JSON as
// `Record<string, unknown>` and then call `String(field ?? "")`. That is correct
// for the shape the model is supposed to return and silently wrong for anything
// else: an object becomes the literal "[object Object]" and an array containing
// one becomes "a,[object Object]". Those strings are not caught by a schema
// check — they are well-formed strings — so they travel all the way into a
// sealed blueprint, a stored pattern row, or generated page copy.
//
// SonarCloud flags the call sites as typescript:S6551.

/**
 * `value` as text, or `fallback` when it has no sensible text form.
 *
 * Arrays are joined with "," and their elements coerced individually, which is
 * what `String(array)` already did for the all-strings case — the difference is
 * that a non-primitive element now yields the fallback instead of
 * "[object Object]". Objects, symbols and functions have no text form at all
 * and take the fallback whole.
 *
 * @param value the raw field
 * @param fallback used when `value` is absent or not representable
 */
export function textField(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((entry) => textField(entry, ""));
    const joined = parts.join(",");
    return joined === "" ? fallback : joined;
  }
  return fallback;
}
