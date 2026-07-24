// L9_META: layer=stage, role=schema_generator, stage_index=5, status=active, version=2.1.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { extractJson } from '../services/extractJson.js';
import { normalizeSiteUrl } from '../validation/validate-generated-site.js';

const logger = createModuleLogger('stage:schema-generator');

type FaqEntry = { question: string; answer: string };

function coerceFaqs(parsed: unknown): FaqEntry[] {
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { faqs?: unknown }).faqs)
      ? (parsed as { faqs: unknown[] }).faqs
      : [];
  return values.filter((item): item is FaqEntry =>
    Boolean(item) && typeof item === 'object'
    && typeof (item as { question?: unknown }).question === 'string'
    && typeof (item as { answer?: unknown }).answer === 'string');
}

export class SchemaGeneratorStage implements Stage {
  name = 'schema-generator';
  version = '2.1.0';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) { logger.info('[dry-run] Would generate JSON-LD schemas'); return; }
    const { business_name, vertical, geography } = ctx.domainSpec;
    const seo = ctx.domainSpec.seo_contract ?? {};
    const siteUrl = typeof seo.site_url === 'string' && seo.site_url.trim().length > 0 ? normalizeSiteUrl(seo.site_url) : '';
    const phone = typeof seo.phone === 'string' ? seo.phone : '';
    ctx.generatedSchemas.set('Organization', {
      '@context': 'https://schema.org', '@type': 'Organization', name: business_name, url: siteUrl,
      contactPoint: { '@type': 'ContactPoint', telephone: phone, contactType: 'customer service', areaServed: geography.states },
    });
    ctx.generatedSchemas.set('LocalBusiness', {
      '@context': 'https://schema.org', '@type': 'LocalBusiness', name: business_name,
      description: `${vertical} services in ${geography.states.join(', ')}`, url: siteUrl, telephone: phone,
      address: { '@type': 'PostalAddress', addressRegion: geography.primary_state, addressCountry: 'US' },
      areaServed: geography.states.map(state => ({ '@type': 'State', name: state })),
    });
    ctx.generatedSchemas.set('ServiceArea', {
      '@context': 'https://schema.org', '@type': 'Service', name: `${business_name} — ${vertical}`,
      provider: { '@type': 'Organization', name: business_name }, serviceType: vertical,
      areaServed: geography.states.map(state => ({ '@type': 'AdministrativeArea', name: state })),
    });
    const faqs = await this.generateFaqs(ctx, vertical, geography.states);
    ctx.generatedSchemas.set('FAQPage', {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqs.map(faq => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } })),
    });
    ctx.generatedSchemas.set('BreadcrumbList', {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: ctx.domainSpec.routes.map((route, index) => ({ '@type': 'ListItem', position: index + 1, name: route.title, item: `${siteUrl}${route.slug}` })),
    });
    logger.info({ schemas: [...ctx.generatedSchemas.keys()] }, 'Schema generation complete');
  }

  /**
   * Generate FAQ pairs with fence-tolerant JSON extraction and a single
   * corrective retry before failing closed. The second attempt feeds the
   * parse failure back to the model so it can self-correct.
   */
  private async generateFaqs(ctx: BuildContext, vertical: string, states: string[]): Promise<FaqEntry[]> {
    const basePrompt = `Generate 5 FAQ pairs for a ${vertical} company serving ${states.join(', ')}. Return a JSON array of {"question","answer"}.`;
    const maxAttempts = 2;
    let lastFailure = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const prompt = attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nYour previous reply was rejected (${lastFailure}). Reply with ONLY the raw JSON array — no prose, no markdown fences.`;
      const raw = await ctx.llm.generateSchema(prompt);
      try {
        const faqs = coerceFaqs(extractJson(raw));
        if (faqs.length === 0) throw new Error('no valid FAQ entries in parsed JSON');
        if (attempt > 1) logger.warn({ attempt }, 'FAQ generation succeeded after corrective retry');
        return faqs;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        logger.warn({ attempt, failure: lastFailure }, 'FAQ JSON parse or shape failed');
      }
    }
    throw new BuildError('SCHEMA_GENERATION_FAILED', `FAQ JSON parse or shape failed after ${maxAttempts} attempts: ${lastFailure}`, true);
  }
}
