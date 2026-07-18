// L9_META: layer=stage, role=schema_generator, stage_index=5, status=active, version=2.0.0
// Generates JSON-LD structured data: Organization, LocalBusiness, FAQPage, BreadcrumbList, ServiceArea.
// V-07 FIX: ServiceArea schema added for geo-targeting support.
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:schema-generator');

export class SchemaGeneratorStage implements Stage {
  name = 'schema-generator';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info('[dry-run] Would generate JSON-LD schemas');
      return;
    }

    const { business_name, vertical, geography } = ctx.domainSpec;
    const seo = ctx.domainSpec.seo_contract as Record<string, unknown> | undefined ?? {};

    // ── Organization ─────────────────────────────────────────────────────
    const orgSchema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: business_name,
      url: (seo.site_url as string) ?? '',
      logo: (seo.logo_url as string) ?? '',
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: (seo.phone as string) ?? '',
        contactType: 'customer service',
        areaServed: geography.states,
      },
    };
    ctx.generatedSchemas.set('Organization', orgSchema);

    // ── LocalBusiness ─────────────────────────────────────────────────────
    const lbSchema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: business_name,
      description: `${vertical} services in ${geography.states.join(', ')}`,
      url: (seo.site_url as string) ?? '',
      telephone: (seo.phone as string) ?? '',
      address: {
        '@type': 'PostalAddress',
        addressRegion: geography.primary_state,
        addressCountry: 'US',
      },
      areaServed: geography.states.map(s => ({ '@type': 'State', name: s })),
    };
    ctx.generatedSchemas.set('LocalBusiness', lbSchema);

    // ── ServiceArea (V-07) ────────────────────────────────────────────────
    const serviceAreaSchema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: `${business_name} — ${vertical}`,
      provider: { '@type': 'Organization', name: business_name },
      areaServed: geography.states.map(s => ({
        '@type': 'AdministrativeArea',
        name: s,
        containedInPlace: { '@type': 'Country', name: 'United States' },
      })),
      serviceType: vertical,
    };
    ctx.generatedSchemas.set('ServiceArea', serviceAreaSchema);

    // ── FAQPage (LLM-generated) ───────────────────────────────────────────
    const faqPrompt = `
Generate 5 FAQ pairs (question + answer) for a ${vertical} company serving ${geography.states.join(', ')}.
Return ONLY a JSON array: [{"question":"...","answer":"..."}, ...]
Do not include guarantee claims or legal advice.
    `.trim();
    let faqRaw: string;
    try { faqRaw = await ctx.llm.generateSchema(faqPrompt); }
    catch (e) { throw new BuildError('SCHEMA_GENERATION_FAILED', `FAQ schema LLM call failed: ${e}`, true); }

    let faqs: Array<{ question: string; answer: string }>;
    try {
      const parsed: unknown = JSON.parse(faqRaw);
      // Accept a bare array or a { faqs: [...] } wrapper; reject anything else.
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { faqs?: unknown }).faqs))
          ? (parsed as { faqs: unknown[] }).faqs
          : null;
      if (!arr) throw new Error('expected a JSON array (or a { faqs: [...] } wrapper) of { question, answer } objects');
      faqs = arr.filter(
        (f): f is { question: string; answer: string } =>
          !!f && typeof f === 'object' &&
          typeof (f as { question?: unknown }).question === 'string' &&
          typeof (f as { answer?: unknown }).answer === 'string',
      );
      if (faqs.length === 0) throw new Error('no valid { question, answer } entries in FAQ response');
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new BuildError('SCHEMA_GENERATION_FAILED', `FAQ JSON parse/shape failed (${detail}): ${faqRaw}`, true);
    }

    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    };
    ctx.generatedSchemas.set('FAQPage', faqSchema);

    // ── BreadcrumbList ────────────────────────────────────────────────────
    const siteUrl = (seo.site_url as string) ?? 'https://example.com';
    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: ctx.domainSpec.routes.map((route, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: route.title,
        item: `${siteUrl}${route.slug}`,
      })),
    };
    ctx.generatedSchemas.set('BreadcrumbList', breadcrumbSchema);

    logger.info({ schemas: [...ctx.generatedSchemas.keys()] }, 'Schema generation complete');
  }
}
