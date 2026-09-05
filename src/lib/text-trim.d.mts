/** `value` without its trailing "/" run. Replaces `.replace(/\/+$/, "")`. */
export function stripTrailingSlashes(value: string): string;

/** `value` without leading and trailing runs of the literal characters `chars`. */
export function trimChars(value: string, chars: string): string;

/** `value` without its trailing run of characters satisfying `matches`. */
export function trimEndWhere(value: string, matches: (char: string) => boolean): string;

/** Every `<...>` tag replaced with a single space; `<>` is left alone. */
export function stripHtmlTags(html: string): string;
