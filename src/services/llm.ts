// L9_META
// skill_schema: 1
// parent: l9-website-factory
// layer: service
// role: llm_router_wrapper
// tags: [llm, router, openrouter, perplexity, vision, budget]
// owner: igor_beylin
// status: active
// version: 2.0.0
// updated: 2026-06-15
// /L9_META

/**
 * L9 Website Factory — LLM Service Layer
 * Wraps @l9/llm-router with convenience methods for site generation tasks.
 * Pattern: Convenience methods → TaskDescriptor → Router → Provider → Response
 * Consumers: site generation pipeline, content generation, design intelligence, visual QA
 */

import {
  L9LLMRouter,
  TaskType,
  TaskComplexity,
  TaskDescriptor,
  LLMResponse,
  BudgetExhaustedError,
  type RouterConfig,
  type FullSiteQAConfig,
} from '@l9/llm-router';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface WebsiteFactoryLLMConfig {
  perplexityApiKey: string;
  openrouterApiKey: string;
  clientId: string;
  monthlyBudget?: number;  // Default: $200
  weeklyBudget?: number;   // Default: $50
}

// ═══════════════════════════════════════════════════════════════
// WEBSITE FACTORY LLM SERVICE
// ═══════════════════════════════════════════════════════════════

export class WebsiteFactoryLLM {
  private router: L9LLMRouter;
  private clientId: string;

  constructor(config: WebsiteFactoryLLMConfig) {
    this.clientId = config.clientId;

    const routerConfig: RouterConfig = {
      perplexityApiKey: config.perplexityApiKey,
      openrouterApiKey: config.openrouterApiKey,
      appName: 'l9-website-factory',
      budget: {
        monthlyBudgetPerClient: config.monthlyBudget ?? 200,
        weeklyTarget: config.weeklyBudget ?? 50,
        weeklyHardCeiling: (config.weeklyBudget ?? 50) * 2,
        globalMonthlyHardCeiling: 500,
        surgeThreshold: 0.6,
      },
    };

    this.router = new L9LLMRouter(routerConfig);
    this.router.initClient(this.clientId);
  }

  // ─────────────────────────────────────────────────────────────
  // CONTENT GENERATION (blog posts, page copy, meta descriptions)
  // ─────────────────────────────────────────────────────────────

  async generateContent(
    prompt: string,
    options?: { complexity?: TaskComplexity; context?: string },
  ): Promise<string> {
    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.CONTENT_GENERATION,
        complexity: options?.complexity ?? TaskComplexity.MEDIUM,
        description: 'Website content generation',
      },
      'You are an expert website copywriter. Generate compelling, conversion-optimized content that is factual, professional, and aligned with the brand voice. Never invent credentials, certifications, or claims.',
      prompt,
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // DESIGN INTELLIGENCE (color selection, layout reasoning)
  // ─────────────────────────────────────────────────────────────

  async designReasoning(
    prompt: string,
    options?: { complexity?: TaskComplexity },
  ): Promise<string> {
    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.STRATEGIC_REASONING,
        complexity: options?.complexity ?? TaskComplexity.HIGH,
        description: 'Design intelligence layer reasoning',
      },
      'You are a senior UX/UI designer and brand strategist. Reason about design decisions with explicit rationale. Consider accessibility (WCAG AA), conversion optimization, and brand alignment. Output structured reasoning with clear recommendations.',
      prompt,
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // SEO CONTENT (meta tags, schema markup, FAQ generation)
  // ─────────────────────────────────────────────────────────────

  async generateSEOContent(
    prompt: string,
    options?: { complexity?: TaskComplexity },
  ): Promise<string> {
    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.CONTENT_GENERATION,
        complexity: options?.complexity ?? TaskComplexity.LOW,
        description: 'SEO meta content generation',
      },
      'You are an SEO specialist. Generate optimized meta titles (≤60 chars), meta descriptions (≤155 chars), and structured data markup. Follow Google guidelines. Output in the exact format requested.',
      prompt,
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // COMPETITOR RESEARCH (market positioning, content gaps)
  // ─────────────────────────────────────────────────────────────

  async researchCompetitor(
    query: string,
    options?: { depth?: 'shallow' | 'deep' },
  ): Promise<string> {
    const complexity = options?.depth === 'deep'
      ? TaskComplexity.CRITICAL
      : TaskComplexity.MEDIUM;

    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.COMPETITOR_RESEARCH,
        complexity,
        description: `Competitor research: ${query}`,
      },
      'You are a competitive intelligence analyst. Research the specified competitor or market segment. Return structured findings with sources. Focus on actionable differentiators.',
      query,
      { consensus: options?.depth === 'deep' },
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // VISUAL QA (screenshot-based layout validation)
  // ─────────────────────────────────────────────────────────────

  async validateLayout(
    screenshotPaths: string[],
    context: string,
  ): Promise<string> {
    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.LAYOUT_VALIDATION,
        complexity: TaskComplexity.MEDIUM,
        description: 'Visual layout validation',
      },
      'You are a senior frontend QA engineer. Analyze the provided screenshots for layout issues: misalignment, overlapping elements, broken responsive behavior, poor contrast, truncated text, or unprofessional appearance. Report issues with severity (critical/high/medium/low) and specific location.',
      context,
      { images: screenshotPaths },
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // SITE MINING (analyze existing site for content extraction)
  // ─────────────────────────────────────────────────────────────

  async analyzeSiteContent(
    prompt: string,
    screenshotPaths?: string[],
  ): Promise<string> {
    const taskType = screenshotPaths?.length
      ? TaskType.SCREENSHOT_ANALYSIS
      : TaskType.CONTENT_GENERATION;

    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: taskType,
        complexity: TaskComplexity.MEDIUM,
        description: 'Existing site analysis for migration',
      },
      'You are a website migration specialist. Analyze the existing site content and structure. Identify reusable assets, content that needs improvement, and structural patterns. Output structured findings.',
      prompt,
      { images: screenshotPaths },
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // DOMAIN SPEC GENERATION (from site mining + operator input)
  // ─────────────────────────────────────────────────────────────

  async generateDomainSpec(
    prompt: string,
    options?: { complexity?: TaskComplexity },
  ): Promise<string> {
    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.STRATEGIC_REASONING,
        complexity: options?.complexity ?? TaskComplexity.HIGH,
        description: 'Domain specification generation',
      },
      'You are an expert website strategist. Generate a comprehensive domain specification from the provided inputs. The spec must cover: business identity, audience segments, service area, conversion model, page architecture, SEO strategy, compliance requirements, and design direction. Output in YAML format matching the L9 domain_spec.normalized.yaml schema.',
      prompt,
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // FACT VERIFICATION (claims, credentials, compliance)
  // ─────────────────────────────────────────────────────────────

  async verifyFact(query: string): Promise<string> {
    const response = await this.router.execute(
      {
        clientId: this.clientId,
        type: TaskType.FACT_VERIFICATION,
        complexity: TaskComplexity.LOW,
        description: `Fact verification: ${query}`,
      },
      'You are a fact-checker. Verify the claim using web sources. Return: VERIFIED (with source), UNVERIFIED (insufficient evidence), or FALSE (contradicted by sources). Include source URLs.',
      query,
    );
    return response.content;
  }

  // ─────────────────────────────────────────────────────────────
  // FULL SITE VISUAL QA PLAN
  // ─────────────────────────────────────────────────────────────

  planFullSiteQA(pages: string[], options?: { competitorUrl?: string }) {
    const config: FullSiteQAConfig = {
      pages,
      viewports: Object.values(this.router.getViewports()),
      competitorUrl: options?.competitorUrl,
      conversionAudit: true,
    };
    return this.router.planVisualQA(config);
  }

  // ─────────────────────────────────────────────────────────────
  // BUDGET & REPORTING
  // ─────────────────────────────────────────────────────────────

  getBudgetReport() {
    return this.router.getClientBudgetReport(this.clientId);
  }

  getCallLog(limit?: number) {
    return this.router.getCallLogByClient(this.clientId, limit);
  }

  getRouter(): L9LLMRouter {
    return this.router;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION (for use in scripts and pipeline stages)
// ═══════════════════════════════════════════════════════════════

export function createWebsiteFactoryLLM(clientId?: string): WebsiteFactoryLLM {
  const config: WebsiteFactoryLLMConfig = {
    perplexityApiKey: process.env.PERPLEXITY_API_KEY ?? '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    clientId: clientId ?? process.env.CLIENT_ID ?? 'default',
    monthlyBudget: Number(process.env.MONTHLY_BUDGET_PER_CLIENT) || 200,
    weeklyBudget: Number(process.env.WEEKLY_BUDGET_TARGET) || 50,
  };

  if (!config.perplexityApiKey || !config.openrouterApiKey) {
    throw new Error(
      'Missing required API keys. Set PERPLEXITY_API_KEY and OPENROUTER_API_KEY environment variables.',
    );
  }

  return new WebsiteFactoryLLM(config);
}

// Re-export types for convenience
export { TaskType, TaskComplexity, BudgetExhaustedError } from '@l9/llm-router';
