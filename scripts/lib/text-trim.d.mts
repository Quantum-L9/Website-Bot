/** `value` without its trailing "/" run. Replaces `.replace(/\/+$/, "")`. */
export function stripTrailingSlashes(value: string): string;

/**
 * `value` without its trailing run of characters satisfying `matches`.
 * Replaces the `/[X]+$/` shape.
 */
export function trimEndWhere(value: string, matches: (char: string) => boolean): string;

/** Every `<...>` tag replaced with a single space; `<>` is left alone. */
export function stripHtmlTags(html: string): string;
