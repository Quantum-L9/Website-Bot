// L9_META: layer=stage, role=unknown_resolver, stage_index=2, status=active, version=3.0.0
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:unknown-resolver");

// Advisory-only: error-severity WOM flags never block the pipeline. They are logged loudly
// and recorded on ctx.unresolvedErrorFlags so downstream stages / release evidence can mark
// the build not-publish-safe. A build with unresolved error flags may lack a verified license,
// approved disclaimers, or a real form endpoint, and MUST NOT be published as-is.
const SAFE_DEFAULTS: Record<string, string> = {
  "{{PHONE_PLACEHOLDER}}": "Unknown",
  "{{EMAIL_PLACEHOLDER}}": "Unknown",
  "{{ADDRESS_PLACEHOLDER}}": "Unknown",
  "{{LICENSE_NUMBER_PLACEHOLDER}}": "Unknown",
  "{{COLOR_TOKENS_PLACEHOLDER}}": "pending-design-pass",
  "{{TYPOGRAPHY_PLACEHOLDER}}": "pending-design-pass",
  "{{SPACING_PLACEHOLDER}}": "pending-design-pass",
};

export class UnknownResolverStage implements Stage {
  name = "unknown-resolver";
  version = "3.0.0";

  async run(ctx: BuildContext): Promise<void> {
    const flags = ctx.domainSpec.wom_flags ?? [];
    const errors = flags.filter((flag) => flag.severity === "error");
    if (errors.length > 0) {
      ctx.unresolvedErrorFlags = errors.map((flag) => flag.key);
      logger.warn(
        { unresolvedErrorFlags: ctx.unresolvedErrorFlags, advisory: true },
        `ADVISORY: ${errors.length} error-severity WOM flag(s) unresolved: ${ctx.unresolvedErrorFlags.join(", ")}. Proceeding WITHOUT resolution — the resulting build is NOT safe to publish.`,
      );
    }
    let resolved = 0;
    for (const flag of flags.filter((flag) => flag.severity !== "error")) {
      const replacement = SAFE_DEFAULTS[flag.value];
      if (replacement) {
        flag.value = replacement;
        resolved += 1;
      } else logger.warn({ key: flag.key, value: flag.value }, "WOM flag has no safe default");
    }
    logger.info({ resolved, total: flags.length }, "Unknown resolution complete");
  }
}
