/**
 * How a command ended, as reported by the runner. Used to describe a check or
 * test outcome without inventing an exit status for a killed process.
 */
export interface TerminationDetail {
  timedOut: boolean;
  terminationSignal: string | null;
  duration: number;
}

/**
 * Contributing causes that describe how the command terminated.
 * A process with no exit status is described by its signal, never as
 * "Non-zero exit code: null".
 */
export function terminationCauses(exitCode: number | null, detail: TerminationDetail): string[] {
  if (detail.timedOut) {
    const signal = detail.terminationSignal ? ` (terminated by ${detail.terminationSignal})` : "";
    return [`Command timed out after ${detail.duration}ms${signal}`];
  }
  if (exitCode === null) {
    const signal = detail.terminationSignal ?? "unknown signal";
    return [`Terminated without exit status by ${signal}`];
  }
  if (exitCode !== 0) {
    return [`Non-zero exit code: ${exitCode}`];
  }
  return [];
}
