// L9_META: layer=stage, role=redesign_integrity_receipt, status=active, version=1.0.0
//
// Campaign 7 §16: emits and validates the RedesignExecutionIntegrityReceipt
// at the end of every REDESIGN_IMPROVE run. Emission requires every piece of
// runtime evidence to exist; validation enforces the impossibility matrix
// (10 donors with evidence, zero-LLM counters, 100% required visual slots,
// no unexplained asset loss, visual QA for end-to-end).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import {
  emitRedesignExecutionIntegrityReceipt,
  validateRedesignExecutionIntegrityReceipt,
} from "../pipeline/evidence/RedesignExecutionIntegrityReceipt.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:redesign-integrity-receipt");

export class RedesignIntegrityReceiptStage implements Stage {
  name = "redesign-integrity-receipt";
  version = "1.0.0";

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info({ intent: ctx.buildIntent }, "not a redesign build; receipt not required");
      return;
    }
    if (ctx.dryRun) {
      logger.info("[dry-run] Would emit + validate the redesign execution integrity receipt");
      return;
    }
    const receipt = emitRedesignExecutionIntegrityReceipt(ctx);
    validateRedesignExecutionIntegrityReceipt(receipt, {
      requireVisualQa: ctx.mode === "end-to-end",
    });
    const dir = clientAssetRoot(ctx);
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "redesign-integrity-receipt.json");
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
    logger.info(
      {
        path,
        donors: receipt.qualified_donor_count,
        counters: receipt.counters,
        requiredVisualPct: receipt.visual.required_visual_slots_filled_pct,
      },
      "Redesign execution integrity receipt emitted and validated",
    );
  }
}
