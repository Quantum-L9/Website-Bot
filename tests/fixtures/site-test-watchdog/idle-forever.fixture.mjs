// L9_META: layer=test_fixture, role=site_test_watchdog_idle_child, status=active, version=1.0.0
//
// A test file whose process never exits: its one test passes, then a referenced
// MessagePort keeps the event loop open with no timer and no test running,
// the shape of the site:test:local hang. Only tests/unit/site-test-watchdog.test.ts
// runs it, by explicit path; the suite globs *.test.ts and never picks it up.

import test from "node:test";
import { MessageChannel } from "node:worker_threads";

test("finishes, then leaves the process open", () => {
  const channel = new MessageChannel();
  channel.port1.on("message", () => {});
});
