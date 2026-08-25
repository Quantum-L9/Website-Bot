import { TaskComplexity, type TaskDescriptor, TaskType } from "@quantum-l9/llm-router";

/**
 * Website-Bot's LLM operations for the REDESIGN_IMPROVE seam.
 *
 * No providers. No model names. No final page-copy generation. The application
 * declares capability only; provider selection belongs to LLM-Router, and final
 * page copy is owned by SEO-Bot (see WEBSITE_INTELLIGENCE_LOCK.json).
 */
export type WebsiteImproveLlmOperation =
  | "DONOR_NUGGET_EXTRACTION"
  | "VISUAL_PATTERN_ANALYSIS"
  | "PATTERN_SYNTHESIS"
  | "WEBSITE_BLUEPRINT"
  | "VISUAL_DELTA_ANALYSIS";

type PolicyEntry = Omit<TaskDescriptor, "clientId" | "description">;

export const WEBSITE_IMPROVE_LLM_POLICY: Record<WebsiteImproveLlmOperation, PolicyEntry> = {
  DONOR_NUGGET_EXTRACTION: {
    type: TaskType.EXTRACTION,
    complexity: TaskComplexity.HIGH,
    expectedOutputTokens: 3500,
    requiresReasoning: true,
    requiresSearch: false,
  },
  VISUAL_PATTERN_ANALYSIS: {
    type: TaskType.SCREENSHOT_ANALYSIS,
    complexity: TaskComplexity.HIGH,
    expectedOutputTokens: 2500,
    requiresReasoning: true,
    requiresSearch: false,
  },
  PATTERN_SYNTHESIS: {
    type: TaskType.STRATEGIC_REASONING,
    complexity: TaskComplexity.HIGH,
    expectedOutputTokens: 5000,
    requiresReasoning: true,
    requiresSearch: false,
  },
  WEBSITE_BLUEPRINT: {
    // HIGH (claude-sonnet-4) rather than CRITICAL (o3): this op must emit a
    // large STRICT JSON schema under "JSON only" instructions. o3's long
    // reasoning repeatedly produced unparseable output (golden runs #1 and
    // #12: "No parseable JSON found" even at the raised token cap), while
    // sonnet-4 reliably emits schema-shaped JSON (the same model the
    // governed vision path already trusts for structured output).
    type: TaskType.STRATEGIC_REASONING,
    complexity: TaskComplexity.HIGH,
    // A full 29-route blueprint JSON routinely exceeds 6000 output tokens;
    // truncation at the cap made the response unparseable (golden run #1).
    expectedOutputTokens: 12000,
    requiresReasoning: true,
    requiresSearch: false,
  },
  VISUAL_DELTA_ANALYSIS: {
    type: TaskType.LAYOUT_VALIDATION,
    complexity: TaskComplexity.HIGH,
    expectedOutputTokens: 3000,
    requiresReasoning: true,
    requiresSearch: false,
  },
};

export function websiteImproveTask(
  operation: WebsiteImproveLlmOperation,
  clientId: string,
  description: string,
): TaskDescriptor {
  return {
    ...WEBSITE_IMPROVE_LLM_POLICY[operation],
    clientId,
    description,
  };
}

/**
 * Fail-closed invariant guard:
 *  - no Website-Bot Improve operation may request a search provider;
 *  - Website-Bot Improve mode may never own final page-copy generation.
 */
export function assertWebsiteImprovePolicy(): void {
  for (const [operation, descriptor] of Object.entries(WEBSITE_IMPROVE_LLM_POLICY)) {
    if (descriptor.requiresSearch !== false) {
      throw new Error(
        `LLM_POLICY_VIOLATION: Website-Bot Improve operation ${operation} may not request a search provider.`,
      );
    }
    if (descriptor.type === TaskType.CONTENT_GENERATION) {
      throw new Error(
        `FORBIDDEN_LLM_OPERATION: Website-Bot Improve mode does not own final page-copy generation.`,
      );
    }
  }
}
