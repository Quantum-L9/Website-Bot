// L9_META: layer=test, role=visual_enhancement_slot_contract, status=active, version=1.0.0
//
// WB-QAP-02: optional visual enhancement slots with a static-first fallback.
// The real astro_template/src/lib/visualEnhancements.ts source is loaded by
// type stripping (no transpiler dependency) into Node and into headless
// Chromium. Enhancers are test fixtures only; the template ships none.
// Requires the Playwright chromium binary; its absence is a gate failure,
// never a skip (CI installs it, as for rendered-site-browser.test.ts).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import test, { after, before } from "node:test";
import { type Browser, chromium, type Page } from "playwright";

const SOURCE = stripTypeScriptTypes(
  readFileSync(resolve("astro_template/src/lib/visualEnhancements.ts"), "utf8"),
);
const DATA_URL = `data:text/javascript;charset=utf-8,${encodeURIComponent(SOURCE)}`;

interface SlotPlanView {
  status: string;
  moduleId?: string;
}
interface VisualEnhancementsModule {
  VISUAL_SLOTS: Record<string, { sections: readonly string[] }>;
  ENHANCER_MODULES: Record<string, unknown>;
  ENABLED_SLOTS: Record<string, string>;
  slotForSection(section: string): string | undefined;
  planSlot(
    slot: string,
    enabled?: Record<string, string>,
    modules?: Record<string, unknown>,
  ): SlotPlanView;
}

const FIXTURE_PAGE = `<!doctype html><html><head><style>
  .visual-slot{position:relative;isolation:isolate}
  .visual-slot__layer{position:absolute;inset:0;z-index:-1;pointer-events:none}
</style></head><body>
<header><a class="brand" href="/">Brand lockup</a><nav><a href="/services">Services</a></nav></header>
<main>
  <div class="visual-slot" data-visual-slot="hero_backdrop" data-enhancement="pending">
    <div class="visual-slot__layer" aria-hidden="true" data-visual-layer></div>
    <section data-section="hero"><h1>Static heading</h1><p>Static copy.</p>
      <a class="btn btn--primary" href="#quote">Get a Free Quote</a></section>
  </div>
  <div class="visual-slot" data-visual-slot="cta_backdrop" data-enhancement="pending">
    <div class="visual-slot__layer" aria-hidden="true" data-visual-layer></div>
    <section data-section="cta"><h2>Ready?</h2><a href="#quote">Request a quote</a></section>
  </div>
  <div class="visual-slot" data-visual-slot="not_allowlisted" data-enhancement="pending">
    <div class="visual-slot__layer" aria-hidden="true" data-visual-layer></div>
    <section data-section="other"><h2>Other</h2></section>
  </div>
</main></body></html>`;

// Runs in the page. Fixture enhancers record every import in window.__loads.
const PAGE_HARNESS = `
window.__loads = [];
window.__cleanups = 0;
const record = (id, factory) => async () => { window.__loads.push(id); return factory(); };
const draw = (layer) => { layer.innerHTML = '<i data-fixture-drawing></i>'; return () => { window.__cleanups++; }; };
window.__fixtures = {
  light: { requires: [], animated: false, load: record("light", () => ({ default: { mount: draw } })) },
  animated: { requires: [], animated: true, load: record("animated", () => ({ default: { mount: draw } })) },
  webgl: { requires: ["webgl"], animated: false, load: record("webgl", () => ({ default: { mount: draw } })) },
  importThrows: { requires: [], animated: false, load: record("importThrows", () => { throw new Error("import failed"); }) },
  mountThrows: { requires: [], animated: false, load: record("mountThrows", () => ({ default: { mount() { throw new Error("mount failed"); } } })) },
  lateFailure: { requires: [], animated: false, load: record("lateFailure", () => ({ default: { mount(layer, context) {
    const cleanup = draw(layer);
    setTimeout(() => context.fail(new Error("late failure")), 20);
    setTimeout(() => { throw new Error("uncaught late failure"); }, 30);
    return cleanup;
  } } })) },
};
window.__staticSnapshot = () => [...document.querySelectorAll("[data-visual-slot]")].map((root) =>
  [...root.children].filter((child) => !child.hasAttribute("data-visual-layer")).map((child) => child.outerHTML).join(""));
window.__run = async (enabled, environment) => {
  const ve = await import(${JSON.stringify(DATA_URL)});
  const env = { reducedMotion: environment.reducedMotion, supports: (capability) => capability === "webgl" && environment.webgl };
  const outcomes = {};
  for (const root of document.querySelectorAll("[data-visual-slot]")) {
    outcomes[root.dataset.visualSlot] = await ve.activateSlot(root, env, enabled, window.__fixtures);
  }
  return outcomes;
};
window.__layers = () => Object.fromEntries([...document.querySelectorAll("[data-visual-slot]")].map((root) => {
  const layer = root.querySelector("[data-visual-layer]");
  return [root.dataset.visualSlot, { children: layer.childElementCount, hidden: layer.hidden, state: root.dataset.enhancement }];
}));
`;

interface RunResult {
  outcomes: Record<string, string>;
  loads: string[];
  layers: Record<string, { children: number; hidden: boolean; state: string }>;
  staticBefore: string[];
  staticAfter: string[];
  cleanups: number;
  pageErrors: string[];
}

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function openFixture(options: { javaScriptEnabled?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    javaScriptEnabled: options.javaScriptEnabled ?? true,
  });
  const page = await context.newPage();
  await page.setContent(FIXTURE_PAGE);
  return page;
}

async function runSlots(
  enabled: Record<string, string>,
  environment: { reducedMotion: boolean; webgl: boolean } = { reducedMotion: false, webgl: true },
  settleMs = 0,
): Promise<RunResult> {
  const page = await openFixture();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.evaluate(PAGE_HARNESS);
    const staticBefore = (await page.evaluate("window.__staticSnapshot()")) as string[];
    const outcomes = (await page.evaluate(
      `window.__run(${JSON.stringify(enabled)}, ${JSON.stringify(environment)})`,
    )) as Record<string, string>;
    if (settleMs) await page.waitForTimeout(settleMs);
    return {
      outcomes,
      loads: (await page.evaluate("window.__loads")) as string[],
      layers: (await page.evaluate("window.__layers()")) as RunResult["layers"],
      staticBefore,
      staticAfter: (await page.evaluate("window.__staticSnapshot()")) as string[],
      cleanups: (await page.evaluate("window.__cleanups")) as number,
      pageErrors,
    };
  } finally {
    await page.context().close();
  }
}

void test("the template ships empty allowlists, so every slot is disabled by default", async () => {
  const ve = (await import(DATA_URL)) as VisualEnhancementsModule;
  assert.deepEqual(ve.ENHANCER_MODULES, {});
  assert.deepEqual(ve.ENABLED_SLOTS, {});
  assert.deepEqual(Object.keys(ve.VISUAL_SLOTS), ["hero_backdrop", "cta_backdrop"]);
  for (const slot of Object.keys(ve.VISUAL_SLOTS))
    assert.deepEqual(ve.planSlot(slot), { status: "disabled" });
  assert.equal(ve.slotForSection("hero"), "hero_backdrop");
  assert.equal(ve.slotForSection("final_cta"), "cta_backdrop");
  assert.equal(ve.slotForSection("faq"), undefined);
});

void test("slot planning is per slot and never trusts an unlisted slot or module", async () => {
  const ve = (await import(DATA_URL)) as VisualEnhancementsModule;
  const modules = {
    light: { requires: [], animated: false, load: () => assert.fail("planning must not import") },
  };
  const enabled = { hero_backdrop: "light", cta_backdrop: "ghost", not_allowlisted: "light" };
  assert.equal(ve.planSlot("hero_backdrop", enabled, modules).status, "enabled");
  assert.deepEqual(ve.planSlot("cta_backdrop", enabled, modules), {
    status: "missing-module",
    moduleId: "ghost",
  });
  assert.equal(ve.planSlot("not_allowlisted", enabled, modules).status, "unknown-slot");
  assert.equal(ve.planSlot("cta_backdrop", { hero_backdrop: "light" }, modules).status, "disabled");
  // Prototype keys are not allowlist entries.
  assert.equal(ve.planSlot("constructor", enabled, modules).status, "unknown-slot");
  assert.equal(
    ve.planSlot("hero_backdrop", { hero_backdrop: "toString" }, modules).status,
    "missing-module",
  );
});

void test("an enabled lightweight enhancer draws only in its own slot's layer; other slots stay independent", async () => {
  const run = await runSlots({ hero_backdrop: "light" });
  assert.deepEqual(run.outcomes, {
    hero_backdrop: "mounted",
    cta_backdrop: "disabled",
    not_allowlisted: "unknown-slot",
  });
  assert.deepEqual(run.loads, ["light"]);
  assert.deepEqual(run.layers.hero_backdrop, { children: 1, hidden: false, state: "mounted" });
  assert.deepEqual(run.layers.cta_backdrop, { children: 0, hidden: true, state: "disabled" });
  assert.deepEqual(run.staticAfter, run.staticBefore);
});

void test("an unknown allowlist ID or unregistered module never imports anything", async () => {
  const run = await runSlots({ not_allowlisted: "light", cta_backdrop: "ghost" });
  assert.equal(run.outcomes.not_allowlisted, "unknown-slot");
  assert.equal(run.outcomes.cta_backdrop, "missing-module");
  assert.equal(run.outcomes.hero_backdrop, "disabled");
  assert.deepEqual(run.loads, []);
  assert.deepEqual(run.staticAfter, run.staticBefore);
});

void test("a module that throws on import or during mount fails closed onto the static fallback", async () => {
  for (const fixture of ["importThrows", "mountThrows"]) {
    const run = await runSlots({ hero_backdrop: fixture });
    assert.equal(run.outcomes.hero_backdrop, "failed", fixture);
    assert.deepEqual(run.loads, [fixture]);
    assert.deepEqual(run.layers.hero_backdrop, { children: 0, hidden: true, state: "failed" });
    assert.deepEqual(run.staticAfter, run.staticBefore, fixture);
  }
});

void test("a failure after startup tears down the layer and never touches the static content", async () => {
  const run = await runSlots({ hero_backdrop: "lateFailure" }, undefined, 120);
  assert.equal(run.outcomes.hero_backdrop, "mounted");
  assert.deepEqual(run.layers.hero_backdrop, { children: 0, hidden: true, state: "failed" });
  assert.equal(run.cleanups, 1);
  assert.deepEqual(run.pageErrors, ["uncaught late failure"]);
  assert.deepEqual(run.staticAfter, run.staticBefore);
});

void test("reduced motion and missing WebGL skip the enhancer before it is imported", async () => {
  const reduced = await runSlots(
    { hero_backdrop: "animated", cta_backdrop: "light" },
    {
      reducedMotion: true,
      webgl: true,
    },
  );
  assert.equal(reduced.outcomes.hero_backdrop, "reduced-motion");
  // A static (non-animated) enhancer is still allowed under reduced motion.
  assert.equal(reduced.outcomes.cta_backdrop, "mounted");
  assert.deepEqual(reduced.loads, ["light"]);
  const noWebgl = await runSlots(
    { hero_backdrop: "webgl" },
    { reducedMotion: false, webgl: false },
  );
  assert.equal(noWebgl.outcomes.hero_backdrop, "unsupported");
  assert.deepEqual(noWebgl.loads, []);
  for (const run of [reduced, noWebgl]) assert.deepEqual(run.staticAfter, run.staticBefore);
});

void test("with JavaScript disabled the static heading, copy, CTA and navigation stay readable", async () => {
  const page = await openFixture({ javaScriptEnabled: false });
  try {
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("h1").textContent(), "Static heading");
    const cta = page.locator("a.btn--primary");
    assert.equal(await cta.isVisible(), true);
    // The decorative layer sits behind the content: the CTA is the hit target at its own centre.
    const box = await cta.boundingBox();
    assert.ok(box);
    const hit = await page.evaluate(
      `document.elementFromPoint(${box.x + box.width / 2}, ${box.y + box.height / 2})?.textContent`,
    );
    assert.equal(hit, "Get a Free Quote");
    assert.equal(await page.locator("header a").count(), 2);
  } finally {
    await page.context().close();
  }
});

void test("a disabled or missing slot renders only the static section, with no wrapper or JavaScript", () => {
  const slot = readFileSync(
    resolve("astro_template/src/components/VisualEnhancementSlot.astro"),
    "utf8",
  );
  // Inactive slots are a pure passthrough of the slotted static markup.
  assert.match(slot, /\{active \? \([\s\S]*\) : \(\s*<slot \/>\s*\)\}/);
  // Script and style exist only on the enabled branch (Astro 5 renders scripts where declared).
  assert.match(slot, /\{active && <style is:inline set:html=\{SLOT_CSS\} \/>\}/);
  assert.match(slot, /\{active && \(\s*<script>/);
  assert.equal((slot.match(/<script/g) ?? []).length, 1);
  assert.match(slot, /aria-hidden="true" data-visual-layer/);
  assert.match(slot, /throw new Error\(`Unknown visual enhancement slot/);
  assert.doesNotMatch(slot, /client:|https?:\/\//);
  // The allowlist is source constants with static import thunks only.
  assert.doesNotMatch(SOURCE, /https?:\/\/|fetch\(|import\(\s*[^)'"`]/);
});
