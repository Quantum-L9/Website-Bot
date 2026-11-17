// L9_META: layer=stage, role=lead_endpoint_verifier, status=active, version=1.0.0
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { canonicalJson, sha256Text } from "../pipeline/evidence/EvidenceCanonicalizer.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:lead-endpoint-verification");

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * verified       — the configured HTTPS action accepted a test submission.
 * not_configured — the spec declares no lead form action.
 * failed         — an action is configured but is not HTTPS, unreachable, or rejected the test.
 * skipped        — plan or dry-run: nothing was sent, so nothing is verified.
 */
export type LeadCaptureStatus = "verified" | "not_configured" | "failed" | "skipped";

export interface LeadCaptureVerification {
  schema: "website-bot.lead-capture-verification/v1";
  buildId: string;
  clientId: string;
  status: LeadCaptureStatus;
  method: "test_submission" | "none";
  /** The exact action the template would render; undefined when not configured. */
  endpoint?: string;
  /** HTTPS origin of the endpoint (no path or query) for receipts. */
  endpointOrigin?: string;
  httpStatus?: number;
  reason: string;
  /** Marker carried by the test submission so the receiver can discard it. */
  testMarker: string;
  checkedAt: string;
  /** sha256 of the canonical JSON of every other field. */
  digest: string;
}

declare module "../pipeline/BuildContext.js" {
  interface BuildContext {
    /** Set by LeadEndpointVerificationStage; absent means no verification ran. */
    leadCaptureVerification?: LeadCaptureVerification;
  }
}

export const LEAD_TEST_MARKER = "website-bot-lead-verification";
const EVIDENCE_FILE = "lead-capture-verification.json";

/**
 * The only door through which a lead form action reaches rendered output:
 * the action is returned only when verification evidence for that exact
 * action passed in this build. Anything else renders the non-submitting
 * contact-availability section.
 */
export function verifiedLeadFormAction(
  ctx: Pick<BuildContext, "leadCaptureVerification">,
  action: string | undefined,
): string | undefined {
  if (!action) return undefined;
  const verification = ctx.leadCaptureVerification;
  if (verification?.status !== "verified" || verification.endpoint !== action) return undefined;
  return action;
}

export function leadCaptureDigest(value: Omit<LeadCaptureVerification, "digest">): string {
  return sha256Text(canonicalJson(value));
}

function isAccepted(status: number): boolean {
  // A form receiver either answers 2xx or redirects to its thank-you page.
  return (status >= 200 && status < 300) || status === 301 || status === 302 || status === 303;
}

export class LeadEndpointVerificationStage implements Stage {
  name = "lead-endpoint-verification";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    // Verification is re-proven on every run: a resumed build must never
    // render a live form on the strength of an earlier, possibly stale, check.
    resumable: false,
    externalMutation: true,
  };

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs = Number(process.env.WEBSITE_BOT_LEAD_VERIFY_TIMEOUT_MS ?? 10_000),
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    const raw = ctx.domainSpec.seo_contract?.lead_form_action;
    const action = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
    const verification = await this.verify(ctx, action);
    ctx.leadCaptureVerification = verification;
    this.persist(ctx, verification);
    const log = { status: verification.status, origin: verification.endpointOrigin };
    if (verification.status === "verified") logger.info(log, "Lead endpoint verified");
    else
      logger.warn(
        { ...log, reason: verification.reason },
        "Lead endpoint not verified; primary CTA and form stay hidden",
      );
  }

  private async verify(
    ctx: BuildContext,
    action: string | undefined,
  ): Promise<LeadCaptureVerification> {
    if (!action)
      return this.record(ctx, { status: "not_configured", reason: "no lead form action" });
    let parsed: URL;
    try {
      parsed = new URL(action);
    } catch {
      return this.record(ctx, {
        status: "failed",
        endpoint: action,
        reason: "lead form action is not a valid URL",
      });
    }
    const endpointOrigin = parsed.origin;
    if (parsed.protocol !== "https:")
      return this.record(ctx, {
        status: "failed",
        endpoint: action,
        endpointOrigin,
        reason: "lead form action must use HTTPS",
      });
    if (ctx.mode === "plan" || ctx.dryRun)
      return this.record(ctx, {
        status: "skipped",
        endpoint: action,
        endpointOrigin,
        reason: "plan or dry-run: no test submission sent",
      });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(parsed, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/html;q=0.9",
          "X-Website-Bot-Test": "true",
        },
        body: new URLSearchParams({
          name: "Website-Bot Verification",
          email: "lead-verification@example.com",
          phone: "+10000000000",
          message: `Automated ${LEAD_TEST_MARKER} for build ${ctx.buildId}. Test submission, please discard.`,
          website_bot_test: "true",
          _test: "true",
        }).toString(),
      });
      const accepted = isAccepted(response.status);
      return this.record(ctx, {
        status: accepted ? "verified" : "failed",
        method: "test_submission",
        endpoint: action,
        endpointOrigin,
        httpStatus: response.status,
        reason: accepted
          ? "endpoint accepted a test submission"
          : `endpoint rejected the test submission with HTTP ${response.status}`,
      });
    } catch (error) {
      return this.record(ctx, {
        status: "failed",
        method: "test_submission",
        endpoint: action,
        endpointOrigin,
        reason: controller.signal.aborted
          ? `endpoint did not answer within ${this.timeoutMs}ms`
          : `endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private record(
    ctx: BuildContext,
    fields: {
      status: LeadCaptureStatus;
      reason: string;
      method?: LeadCaptureVerification["method"];
      endpoint?: string;
      endpointOrigin?: string;
      httpStatus?: number;
    },
  ): LeadCaptureVerification {
    const body: Omit<LeadCaptureVerification, "digest"> = {
      schema: "website-bot.lead-capture-verification/v1",
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      status: fields.status,
      method: fields.method ?? "none",
      ...(fields.endpoint ? { endpoint: fields.endpoint } : {}),
      ...(fields.endpointOrigin ? { endpointOrigin: fields.endpointOrigin } : {}),
      ...(fields.httpStatus !== undefined ? { httpStatus: fields.httpStatus } : {}),
      reason: fields.reason,
      testMarker: LEAD_TEST_MARKER,
      checkedAt: this.now().toISOString(),
    };
    return { ...body, digest: leadCaptureDigest(body) };
  }

  private persist(ctx: BuildContext, verification: LeadCaptureVerification): void {
    // Evidence lives beside the evidence store, never in the published site source.
    const root = ctx.evidenceStore.rootDir;
    if (root.includes("://")) return;
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, EVIDENCE_FILE), `${JSON.stringify(verification, null, 2)}\n`, "utf-8");
  }
}
