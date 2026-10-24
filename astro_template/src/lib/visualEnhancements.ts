// L9_META: layer=template, role=visual_enhancement_allowlist, status=active, version=1.0.0
/**
 * Compile-time allowlist for optional visual enhancements (WB-QAP-02).
 *
 * A slot wraps a noncritical visual region of a section. The section's static
 * markup always renders first and is never replaced: an enabled enhancer may
 * draw only into a decorative, aria-hidden layer behind it. Nothing here is a
 * runtime plugin registry: slots, modules and enablement are source constants,
 * modules are static import thunks (never URLs), and every slot is disabled.
 *
 * This module has no imports and uses only erasable TypeScript so the same
 * source runs in the Astro build, in the browser bundle and in tests.
 */

export const VISUAL_SLOTS = {
  hero_backdrop: { sections: ["hero"] },
  cta_backdrop: { sections: ["cta", "final_cta"] },
} as const;
export type VisualSlotId = keyof typeof VISUAL_SLOTS;

export type EnhancementCapability = "webgl";

export interface EnhancerContext {
  reducedMotion: boolean;
  /** Report a failure after startup; the decorative layer is torn down. */
  fail(error: unknown): void;
}

export interface VisualEnhancer {
  /** Draw into the decorative layer only. May return a cleanup function. */
  mount(
    layer: HTMLElement,
    context: EnhancerContext,
  ): (() => void) | undefined | Promise<(() => void) | undefined>;
}

export interface EnhancerModuleEntry {
  readonly requires: readonly EnhancementCapability[];
  /** Animated enhancers are skipped under prefers-reduced-motion. */
  readonly animated: boolean;
  readonly load: () => Promise<{ default: VisualEnhancer }>;
}

/** Eligible optional modules. Ships empty: the template carries no graphics engine. */
export const ENHANCER_MODULES: Readonly<Record<string, EnhancerModuleEntry>> = {};

/** Build-time enablement, slot -> module id. Every slot is disabled by default. */
export const ENABLED_SLOTS: Readonly<Partial<Record<VisualSlotId, string>>> = {};

export type SlotPlan =
  | { status: "unknown-slot" }
  | { status: "disabled" }
  | { status: "missing-module"; moduleId: string }
  | { status: "enabled"; moduleId: string; entry: EnhancerModuleEntry };

export type SlotOutcome =
  | "unknown-slot"
  | "disabled"
  | "missing-module"
  | "reduced-motion"
  | "unsupported"
  | "failed"
  | "mounted";

export interface SlotEnvironment {
  reducedMotion: boolean;
  supports(capability: EnhancementCapability): boolean;
}

const hasOwn = (record: object, key: string): boolean => Object.hasOwn(record, key);

export function isVisualSlotId(value: string): value is VisualSlotId {
  return hasOwn(VISUAL_SLOTS, value);
}

export function slotForSection(section: string): VisualSlotId | undefined {
  for (const [slot, definition] of Object.entries(VISUAL_SLOTS)) {
    if ((definition.sections as readonly string[]).includes(section)) return slot as VisualSlotId;
  }
  return undefined;
}

/** Resolve a slot against the allowlists without importing anything. */
export function planSlot(
  slot: string,
  enabled: Readonly<Partial<Record<string, string>>> = ENABLED_SLOTS,
  modules: Readonly<Record<string, EnhancerModuleEntry>> = ENHANCER_MODULES,
): SlotPlan {
  if (!isVisualSlotId(slot)) return { status: "unknown-slot" };
  const moduleId = hasOwn(enabled, slot) ? enabled[slot] : undefined;
  if (!moduleId) return { status: "disabled" };
  if (!hasOwn(modules, moduleId)) return { status: "missing-module", moduleId };
  return { status: "enabled", moduleId, entry: modules[moduleId] as EnhancerModuleEntry };
}

/** Browser capabilities, probed lazily so a disabled slot never touches graphics APIs. */
export function browserEnvironment(): SlotEnvironment {
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    supports(capability) {
      if (capability !== "webgl") return false;
      try {
        const canvas = document.createElement("canvas");
        return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
      } catch {
        return false;
      }
    },
  };
}

/**
 * Activate one slot root. Every non-mounted outcome leaves the static content
 * untouched and the decorative layer empty and hidden.
 */
export async function activateSlot(
  root: HTMLElement,
  environment: SlotEnvironment,
  enabled: Readonly<Partial<Record<string, string>>> = ENABLED_SLOTS,
  modules: Readonly<Record<string, EnhancerModuleEntry>> = ENHANCER_MODULES,
): Promise<SlotOutcome> {
  const layer = root.querySelector<HTMLElement>(":scope > [data-visual-layer]");
  let cleanup: (() => void) | undefined;
  const settle = (outcome: SlotOutcome): SlotOutcome => {
    root.dataset.enhancement = outcome;
    if (outcome !== "mounted" && layer) {
      try {
        cleanup?.();
      } catch {
        // A failing cleanup cannot be allowed to break the static fallback.
      }
      layer.replaceChildren();
      layer.hidden = true;
    }
    return outcome;
  };

  const plan = planSlot(root.dataset.visualSlot ?? "", enabled, modules);
  if (plan.status !== "enabled") return settle(plan.status);
  if (!layer) return settle("failed");
  if (plan.entry.animated && environment.reducedMotion) return settle("reduced-motion");
  if (!plan.entry.requires.every((capability) => environment.supports(capability)))
    return settle("unsupported");

  let failed = false;
  const context: EnhancerContext = {
    reducedMotion: environment.reducedMotion,
    fail: () => {
      if (!failed) {
        failed = true;
        settle("failed");
      }
    },
  };
  try {
    const loaded = await plan.entry.load();
    const result = await loaded.default.mount(layer, context);
    if (typeof result === "function") cleanup = result;
  } catch {
    failed = true;
    return settle("failed");
  }
  return failed ? "failed" : settle("mounted");
}
