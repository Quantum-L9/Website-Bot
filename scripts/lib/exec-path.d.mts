/**
 * Absolute path to a system command, resolved from a fixed set of trusted
 * directories rather than `$PATH`. Honors a `<NAME>_BIN` absolute-path
 * override. Throws when the command is not found.
 */
export function resolveSystemCommand(name: string): string;

/**
 * Absolute path to a tool shipped with the running Node install ("npm",
 * "npx"), derived from `process.execPath` rather than `$PATH`.
 */
export function resolveNodeTool(name: string): string;
