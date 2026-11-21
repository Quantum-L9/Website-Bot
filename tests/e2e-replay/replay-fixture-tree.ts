// L9_META: layer=test, role=e2e_replay_fixture_tree, status=active, version=1.0.0
//
// The replay fixture tree a build is run against: the committed replay
// fixtures (fixtures/replay), with each file of an overlay directory replacing
// its namesake. QUALITY_OVERLAY carries the production-volume structured
// content response; every build that must pass the pipeline's rendered-site
// quality check (site-quality-check) replays with it, since the committed
// e2e-replay response is plumbing-sized copy below the checker's word floors.

import { cpSync, existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
export const REPLAY_FIXTURES = join(REPO, "fixtures", "replay");
export const QUALITY_OVERLAY = join(REPO, "tests", "quality", "replay-overlay");

/** Fixture tree = committed replay fixtures with each overlay file replacing its namesake. */
export function fixtureTree(
  out: string,
  overlay: string | undefined,
): { dir: string; overlaid: string[] } {
  if (!overlay) return { dir: REPLAY_FIXTURES, overlaid: [] };
  const dir = join(out, "fixtures");
  cpSync(REPLAY_FIXTURES, dir, { recursive: true });
  const overlaid: string[] = [];
  const walk = (from: string) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const path = join(from, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const rel = relative(overlay, path);
        if (!existsSync(join(REPLAY_FIXTURES, rel)))
          throw new Error(`overlay file ${rel} replaces no committed replay fixture`);
        cpSync(path, join(dir, rel));
        overlaid.push(rel);
      }
    }
  };
  walk(overlay);
  overlaid.sort((a, b) => a.localeCompare(b));
  return { dir, overlaid };
}
