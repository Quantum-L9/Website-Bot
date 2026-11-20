// L9_META: layer=stage, role=pre_deploy_blind_judge, status=active, version=1.0.0
//
// Pre-deploy blind judge. In modes that publish or deploy (publish-proof,
// end-to-end) the built candidate is judged blind against the client's
// current site (spec assets.sourceSite.url) BEFORE client-source-publish and
// vercel-deploy, through the same machinery as `npm run quality:judge`
// (src/validation/blind-judge.ts). The outcome is recorded as the
// blind_judge_vs_baseline readiness level, with the judge report as evidence.
//
//   PASS               publication proceeds.
//   FAIL               publication is refused. Never waivable.
//   NOT_RUN / BLOCKED  publication is refused unless the operator records an
//                      explicit waiver (WEBSITE_BOT_BLIND_JUDGE_WAIVER=<reason>).
//                      A waiver lets publication proceed; the level stays
//                      NOT_RUN / BLOCKED with the waiver in its reason. It is
//                      never recorded as PASS (L9-UNKNOWN-001, L9-ASSURANCE-001).
//
// The judge's paid calls go through the build's budgeted LLM adapter (ctx.llm),
// so the build cap admits them like any other call.

import { relative, resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { ReadinessObservation } from "../pipeline/evidence/ReadinessLadder.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { TaskComplexity, TaskType } from "../services/llm.js";
import {
  defaultJudgeDeps,
  type JudgeDeps,
  type JudgeReport,
  runJudge,
  type ViewportName,
} from "../validation/blind-judge.js";
import { normalizeRouteSlug } from "../validation/validate-generated-site.js";

const logger = createModuleLogger("stage:pre-deploy-blind-judge");

/** Operator waiver for a judge that could not run or could not conclude. */
export const BLIND_JUDGE_WAIVER_ENV = "WEBSITE_BOT_BLIND_JUDGE_WAIVER";
/** Routes judged per build: the home page first, then the spec's order. */
export const MAX_JUDGED_ROUTES = 3;
const VIEWPORTS: ViewportName[] = ["desktop_1440", "iphone_14"];

export type JudgeRunner = typeof runJudge;

export class PreDeployBlindJudgeStage implements Stage {
  name = "pre-deploy-blind-judge";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => ["build" as const],
    outputs: (_ctx: BuildContext) => [],
    // The verdict is not persisted as checkpointable evidence; a resumed
    // build judges the candidate again rather than reusing an old verdict.
    resumable: false,
    externalMutation: false,
  };

  constructor(
    private readonly judge: JudgeRunner = runJudge,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly captureDeps: Pick<JudgeDeps, "capture"> = defaultJudgeDeps(process.env),
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info("[dry-run] Would judge the built candidate blind against the client's site");
      return;
    }
    const waiver = this.env[BLIND_JUDGE_WAIVER_ENV]?.trim() || undefined;
    const observation = await this.observe(ctx);
    this.record(ctx, observation, waiver);
    if (observation.state === "PASS") return;
    if (observation.state === "FAIL")
      throw new BuildError(
        "PRE_DEPLOY_JUDGE_BLOCKED",
        `Blind judge preferred the client's current site; publication refused (report: ${observation.evidence_ref})`,
      );
    if (waiver) {
      logger.warn(
        { state: observation.state, reason: observation.reason, waiver },
        "Blind judge did not pass; publication proceeds under the operator's explicit waiver",
      );
      return;
    }
    throw new BuildError(
      "PRE_DEPLOY_JUDGE_BLOCKED",
      `Blind judge is ${observation.state} (${observation.reason}); publication refused without ${BLIND_JUDGE_WAIVER_ENV}=<reason>`,
    );
  }

  private record(ctx: BuildContext, observation: ReadinessObservation, waiver?: string): void {
    const waived =
      waiver && (observation.state === "NOT_RUN" || observation.state === "BLOCKED")
        ? { reason: `${observation.reason}; publication waived by operator: ${waiver}` }
        : {};
    ctx.readiness = {
      ...ctx.readiness,
      blind_judge_vs_baseline: { ...observation, ...waived },
    };
  }

  /** Run the judge and turn its report into a readiness observation. */
  private async observe(ctx: BuildContext): Promise<ReadinessObservation> {
    const baseline = ctx.domainSpec.assets?.sourceSite?.url?.trim();
    if (!baseline)
      return {
        state: "NOT_RUN",
        evidence_ref: null,
        reason: "no baseline: the spec names no assets.sourceSite.url to judge against",
      };
    const build = await ctx.evidenceStore.readBuild();
    if (!build)
      return {
        state: "BLOCKED",
        evidence_ref: null,
        reason: "no persisted build evidence to judge",
      };
    const reportPath = resolve(clientAssetRoot(ctx), "blind-judge", "report.json");
    let report: JudgeReport;
    try {
      report = await this.judge(
        {
          candidate: { dist: build.value.distDir },
          baseline: { url: baseline },
          pages: judgedRoutes(ctx),
          viewports: VIEWPORTS,
          trials: 3,
          runId: `${ctx.buildId}-pre-deploy`,
          clientId: ctx.clientId,
          reportPath,
        },
        {
          env: this.env,
          capture: this.captureDeps.capture,
          loadJudge: async () => ({
            judge: (instruction, userPrompt, images) =>
              ctx.llm.strategize(
                {
                  type: TaskType.SCREENSHOT_ANALYSIS,
                  complexity: TaskComplexity.HIGH,
                  requiresSearch: false,
                  description: "[pre-deploy-blind-judge] blind_pairwise",
                },
                instruction,
                userPrompt,
                images,
              ),
          }),
        },
      );
    } catch (error) {
      // A budget refusal is the build's own decision, not a judge outcome.
      if (error instanceof BuildError) throw error;
      return {
        state: "BLOCKED",
        evidence_ref: null,
        reason: `judge failed to run: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const evidence_ref = relative(process.cwd(), reportPath);
    const summary = `candidate ${report.aggregate.candidate_wins}/${report.aggregate.decisive} decisive trials; Wilson LB ${report.aggregate.wilson_lower_bound ?? "n/a"}`;
    if (report.status === "PASS") return { state: "PASS", evidence_ref };
    if (report.status === "FAIL")
      return { state: "FAIL", evidence_ref, reason: `${report.reasons.join(", ")}; ${summary}` };
    const cause = report.reasons.join(", ") || report.status;
    const firstError = report.errors[0];
    return {
      state: report.status,
      evidence_ref: null,
      reason: firstError ? `${cause}: ${firstError}` : cause,
    };
  }
}

/** The routes the judge sees: home first, then the spec's order, capped. */
export function judgedRoutes(ctx: Pick<BuildContext, "domainSpec">): string[] {
  const slugs = ctx.domainSpec.routes.map((route) => normalizeRouteSlug(route.slug));
  const ordered = slugs.includes("/") ? ["/", ...slugs.filter((slug) => slug !== "/")] : slugs;
  return [...new Set(ordered)].slice(0, MAX_JUDGED_ROUTES);
}
