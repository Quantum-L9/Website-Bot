// L9_META: layer=pipeline, role=llm_spend_admission, status=active, version=1.0.0
//
// Wraps the build's LLM adapter so every dispatch is admitted by the build's
// SpendLedger before it is sent, and every provider-reported cost is charged
// to the ledger as soon as the call returns. The adapter's own process-local
// allowance stays in place as the in-call backstop.

import type { UsageRecord, WebsiteFactoryLLM } from "../services/llm.js";
import { BuildError } from "./BuildError.js";
import type { SpendLedger } from "./SpendLedger.js";

/** Marks a wrapped adapter with its ledger and the adapter it wraps. */
const BUDGETED = Symbol.for("website-bot.budgeted-llm");

interface BudgetedMarker {
  ledger: SpendLedger;
  inner: WebsiteFactoryLLM;
}

function marker(llm: WebsiteFactoryLLM): BudgetedMarker | undefined {
  return (llm as unknown as Record<symbol, BudgetedMarker | undefined>)[BUDGETED];
}

export function isBudgetedLLM(llm: WebsiteFactoryLLM): boolean {
  return marker(llm) !== undefined;
}

export function budgetedLLM(adapter: WebsiteFactoryLLM, ledger: SpendLedger): WebsiteFactoryLLM {
  const existing = marker(adapter);
  if (existing?.ledger === ledger) return adapter;
  // Re-binding to a new ledger (a resumed run in the same process) unwraps first.
  const inner = existing?.inner ?? adapter;
  const drained: UsageRecord[] = [];

  const settle = (): void => {
    const records = typeof inner.flushUsage === "function" ? inner.flushUsage() : [];
    for (const record of records) {
      drained.push(record);
      if (record.costUsd > 0)
        ledger.charge("llm", record.costUsd, "provider_reported", record.stage);
    }
  };

  const guarded =
    <A extends unknown[]>(call: (...args: A) => Promise<string>) =>
    async (...args: A): Promise<string> => {
      ledger.admit("llm", ledger.reserve.llm);
      try {
        return await call(...args);
      } catch (error) {
        // The adapter's own allowance is sized to the build's remaining cap;
        // its refusal happens before dispatch and is the same budget event.
        if (
          !(error instanceof BuildError) &&
          error instanceof Error &&
          error.message.startsWith("Budget exhausted for ") &&
          error.message.includes("of LLM_BUILD_BUDGET_USD")
        ) {
          settle();
          ledger.admit("llm", ledger.remainingUsd + ledger.reserve.llm);
        }
        throw error;
      } finally {
        settle();
      }
    };

  const wrapped: WebsiteFactoryLLM = {
    generateContent: guarded((prompt: string, context?: string) =>
      inner.generateContent(prompt, context),
    ),
    designReasoning: guarded((prompt: string) => inner.designReasoning(prompt)),
    generateSchema: guarded((prompt: string) => inner.generateSchema(prompt)),
    validateLayout: guarded((imagePaths: string[], context: string) =>
      inner.validateLayout(imagePaths, context),
    ),
    strategize: guarded((...args: Parameters<WebsiteFactoryLLM["strategize"]>) =>
      inner.strategize(...args),
    ),
    recordUsage(stage, taskType, inputTokens, outputTokens, costUsd, model) {
      inner.recordUsage(stage, taskType, inputTokens, outputTokens, costUsd, model);
      settle();
    },
    flushUsage() {
      settle();
      return drained.splice(0, drained.length);
    },
  };
  Object.defineProperty(wrapped, BUDGETED, { value: { ledger, inner } satisfies BudgetedMarker });
  return wrapped;
}
