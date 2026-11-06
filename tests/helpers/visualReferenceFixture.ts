// L9_META: layer=test, role=visual_reference_fixture, status=active, version=1.0.0
//
// The one design under visual protection (WB-BUILD-CONTRACT-TESTS-01 Wave 4):
// the synthetic REDESIGN_IMPROVE fixture with its client logo, hero, service
// and team photos, built for real (astro check + astro build) and passed
// through the real browser gate. The regression tests and the approval
// command both render it from here, so what a human approves is exactly what
// the tests compare. Every business, route and image is synthetic.

import { join, resolve } from "node:path";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { RenderedSiteValidationStage } from "../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../src/stages/SiteBuildStage.js";
import { redesignContext } from "./redesignAssemblyFixture.js";

export const VISUAL_DESIGN_ID = "wb-fixture-redesign";

/** Home, a services page and the conversion page. */
export const VISUAL_ROUTES = ["/", "/services/drains", "/contact"] as const;

export const VISUAL_FONT_DIR = resolve("tests/visual/fonts");
export const VISUAL_REFERENCE_ROOT = resolve("tests/visual/references");
export const referenceDir = (designId: string): string => join(VISUAL_REFERENCE_ROOT, designId);

export interface BuiltReferenceSite {
  ctx: BuildContext;
  distDir: string;
  /** The real browser gate's verdict: a baseline is never taken from failing output. */
  renderedSiteValidation: "PASS" | "FAIL";
  renderedSiteError?: string;
}

export async function buildReferenceSite(): Promise<BuiltReferenceSite> {
  const ctx = await redesignContext({
    provided: [
      { id: "brand-logo", intendedPlacement: "global:logo" },
      { id: "storefront", intendedPlacement: "/:hero" },
      { id: "repair-van", intendedPlacement: "/:service#repairs" },
      { id: "new-heater", intendedPlacement: "/:service#installs" },
      { id: "crew-photo", intendedPlacement: "/:team#story" },
    ],
  });
  await new SiteAssemblerStage().run(ctx);
  await new SiteBuildStage().run(ctx);
  if (!ctx.distDir) throw new Error("astro build produced no dist/");
  try {
    await new RenderedSiteValidationStage().run(ctx);
    return { ctx, distDir: ctx.distDir, renderedSiteValidation: "PASS" };
  } catch (error) {
    return {
      ctx,
      distDir: ctx.distDir,
      renderedSiteValidation: "FAIL",
      renderedSiteError: error instanceof Error ? error.message : String(error),
    };
  }
}
