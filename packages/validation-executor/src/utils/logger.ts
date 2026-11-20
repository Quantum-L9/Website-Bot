import pino, { type DestinationStream, type Logger } from "pino";
import pretty from "pino-pretty";

/**
 * Shared in-process pretty destination for non-production output.
 *
 * pino's `transport: { target: "pino-pretty" }` starts one worker thread per
 * logger. Every engine instance calls createLogger, so a single test file
 * spawned 50+ workers, and thread-stream keeps each worker ref'd until it
 * reports ready. Under load a worker could stay ref'd after the tests finished,
 * holding the event loop open with no child process (the intermittent
 * `node --test test/unit/*.test.ts` hang). pino-pretty used as a synchronous
 * stream runs in the calling thread and holds no handle, so a process that has
 * finished its work exits.
 */
let prettyDestination: DestinationStream | undefined;

function getPrettyDestination(): DestinationStream {
  prettyDestination ??= pretty({
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
    sync: true,
  });
  return prettyDestination;
}

/**
 * Create a logger instance for validation executor components.
 *
 * LOG_LEVEL and NODE_ENV are read on every call, as before: the CLI raises
 * LOG_LEVEL at runtime and loggers created afterwards must honour it.
 */
export function createLogger(name: string): Logger {
  const options = { name, level: process.env.LOG_LEVEL || "info" };
  if (process.env.NODE_ENV === "production") {
    return pino(options);
  }
  return pino(options, getPrettyDestination());
}
