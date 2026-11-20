/**
 * Regression: createLogger must not start worker threads.
 *
 * A pino `transport` starts one worker thread per logger, and every engine
 * instance creates a logger, so a single test file started 50+ workers. One of
 * them intermittently kept the event loop alive after all tests had passed,
 * hanging `node --test test/unit/*.test.ts` with no child process. The logger
 * now writes through an in-process pino-pretty stream; this test fails if a
 * worker thread is started again.
 */

import { strictEqual } from "node:assert";
import { createRequire } from "node:module";
import { after, describe, test } from "node:test";

const require = createRequire(import.meta.url);
const workerThreads: typeof import("node:worker_threads") = require("node:worker_threads");

// thread-stream reads `require("worker_threads").Worker` once, when pino loads,
// so the counter must be installed before the logger module is imported.
const OriginalWorker = workerThreads.Worker;
let workersStarted = 0;
workerThreads.Worker = class CountingWorker extends OriginalWorker {
  constructor(...args: ConstructorParameters<typeof OriginalWorker>) {
    super(...args);
    workersStarted += 1;
  }
};

after(() => {
  workerThreads.Worker = OriginalWorker;
});

const savedNodeEnv = process.env.NODE_ENV;

/** Returns the number of worker threads started while creating and using `count` loggers. */
async function workersStartedBy(nodeEnv: string | undefined, count: number): Promise<number> {
  const before = workersStarted;
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
  try {
    const { createLogger } = await import("../../src/utils/logger.js");
    for (let i = 0; i < count; i += 1) {
      createLogger(`regression-${i}`).info("logger regression probe");
    }
    return workersStarted - before;
  } finally {
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
  }
}

const WORKER_STARTED = "createLogger started a worker thread (pino transport)";

describe("createLogger", () => {
  test("starts no worker thread in development output mode", async () => {
    strictEqual(await workersStartedBy(undefined, 60), 0, WORKER_STARTED);
  });

  test("starts no worker thread in test output mode", async () => {
    strictEqual(await workersStartedBy("test", 60), 0, WORKER_STARTED);
  });

  test("starts no worker thread in production output mode", async () => {
    strictEqual(await workersStartedBy("production", 60), 0, WORKER_STARTED);
  });
});
