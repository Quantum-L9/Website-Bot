// L9_META: layer=test, role=visual_capture_stability, status=active, version=1.0.0
//
// Visual capture stability and failure legibility, without a browser:
// - captureStable accepts a screenshot only once two consecutive screenshots
//   are byte-identical, and fails closed ("capture unstable") when a view
//   never converges within its attempt budget;
// - a failing comparison's detail names the bounding box of the differing
//   pixels, so the changed region is readable from a log alone.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CaptureUnstableError,
  captureStable,
  comparisonDetail,
  DEFAULT_MAX_STABLE_ATTEMPTS,
  DEFAULT_VISUAL_TOLERANCE,
  formatBoundingBox,
} from "../../src/validation/visual-regression.js";

/** A shooter that returns the given frames in order and counts calls. */
function frames(...values: string[]): { shoot: () => Promise<Buffer>; calls: () => number } {
  let index = 0;
  return {
    shoot: async () => Buffer.from(values[Math.min(index++, values.length - 1)] ?? ""),
    calls: () => index,
  };
}

void test("captureStable: a settled page is accepted after two identical screenshots", async () => {
  const shooter = frames("a", "a", "z");
  const result = await captureStable(shooter.shoot, "/", "desktop");
  assert.equal(result.bytes.toString(), "a");
  assert.equal(result.attempts, 2);
  assert.equal(shooter.calls(), 2);
});

void test("captureStable: a page still settling is re-captured until two consecutive screenshots agree", async () => {
  // The first frame is the outlier (as /contact@mobile was in the failed CI
  // baseline); it is never returned, and agreement must be consecutive.
  const shooter = frames("outlier", "b", "c", "c");
  const result = await captureStable(shooter.shoot, "/contact", "mobile");
  assert.equal(result.bytes.toString(), "c");
  assert.equal(result.attempts, 4);
});

void test("captureStable: non-consecutive repeats do not count as stable", async () => {
  const shooter = frames("a", "b", "a", "b", "a");
  await assert.rejects(captureStable(shooter.shoot, "/", "mobile", 5), CaptureUnstableError);
  assert.equal(shooter.calls(), 5);
});

void test("captureStable: a view that never converges fails closed as capture unstable", async () => {
  let n = 0;
  const shoot = async () => Buffer.from(`frame-${n++}`);
  await assert.rejects(captureStable(shoot, "/contact", "mobile"), (error: unknown) => {
    assert.ok(error instanceof CaptureUnstableError);
    assert.equal(error.route, "/contact");
    assert.equal(error.viewport, "mobile");
    assert.equal(error.attempts, DEFAULT_MAX_STABLE_ATTEMPTS);
    assert.equal(error.distinctImages, DEFAULT_MAX_STABLE_ATTEMPTS);
    assert.match(
      error.message,
      /^capture unstable: \/contact@mobile \(no two consecutive screenshots were byte-identical in 5 attempts; 5 distinct images\)$/,
    );
    return true;
  });
  assert.equal(n, DEFAULT_MAX_STABLE_ATTEMPTS);
});

void test("captureStable: an attempt budget that cannot confirm stability is refused", async () => {
  for (const budget of [0, 1, 2.5, Number.NaN]) {
    await assert.rejects(
      captureStable(frames("a").shoot, "/", "desktop", budget),
      /maxStableAttempts must be an integer >= 2/,
    );
  }
});

void test("comparisonDetail: a pixel failure names the differing region", () => {
  const detail = comparisonDetail(
    {
      width: 390,
      height: 1455,
      differing: 862,
      bbox: { x: 16, y: 1203, width: 358, height: 48 },
      sameSize: true,
      expectedSize: [390, 1455],
      actualSize: [390, 1455],
    },
    862 / (390 * 1455),
    DEFAULT_VISUAL_TOLERANCE,
  );
  assert.equal(
    detail,
    "862 of 567450 pixels differ (0.152%, allowed 0.050%); differing region x=16 y=1203 w=358 h=48",
  );
});

void test("comparisonDetail: a size change also names the differing region", () => {
  const detail = comparisonDetail(
    {
      width: 390,
      height: 1500,
      differing: 17_550,
      bbox: { x: 0, y: 1455, width: 390, height: 45 },
      sameSize: false,
      expectedSize: [390, 1455],
      actualSize: [390, 1500],
    },
    17_550 / (390 * 1500),
    DEFAULT_VISUAL_TOLERANCE,
  );
  assert.equal(
    detail,
    "size changed from 390x1455 to 390x1500; differing region x=0 y=1455 w=390 h=45",
  );
});

void test("comparisonDetail: an identical capture names no region", () => {
  const detail = comparisonDetail(
    {
      width: 10,
      height: 10,
      differing: 0,
      bbox: null,
      sameSize: true,
      expectedSize: [10, 10],
      actualSize: [10, 10],
    },
    0,
    DEFAULT_VISUAL_TOLERANCE,
  );
  assert.equal(detail, "0 of 100 pixels differ (0.000%, allowed 0.050%)");
  assert.equal(formatBoundingBox({ x: 1, y: 2, width: 3, height: 4 }), "x=1 y=2 w=3 h=4");
});
