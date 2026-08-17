// L9_META: layer=stage, role=redesign_schema_serializer, status=active, version=1.0.0
//
// Campaign 7 R10: under REDESIGN_IMPROVE final JSON-LD serialization is
// deterministic. Inputs are VerifiedBusinessFacts (spec-derived), the
// StructuredContentPackage (FAQ content authority), and route structure.
// Zero LLM calls — the legacy LLM-backed SchemaGeneratorStage is NOT in the
// redesign execution plan.

import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { normalizeSiteUrl } from "../validation/validate-generated-site.js";

const logger = createModuleLogger("stage:redesign-schema-serializer");

export class RedesignSchemaSerializerStage implements Stage {
  name = "redesign-schema-serializer";
  version = "1.0.0";

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info({ intent: ctx.buildIntent }, "not a redesign build; serializer skipped");
      return;
    }
    if (ctx.dryRun) {
      logger.info("[dry-run] Would serialize deterministic JSON-LD schemas");
      return;
    }
    const contentPackage = ctx.structuredContentPackage;
    if (!contentPackage) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "redesign-schema-serializer requires the accepted StructuredContentPackage",
      );
    }
    ctx.redesignCounters ??= {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    };

    const { business_name, vertical, geography } = ctx.domainSpec;
    const seo = ctx.domainSpec.seo_contract ?? {};
    const siteUrl =
      typeof seo.site_url === "string" && seo.site_url.trim().length > 0
        ? normalizeSiteUrl(seo.site_url)
        : "";
    const phone = typeof seo.phone === "string" ? seo.phone : "";

    ctx.generatedSchemas.set("Organization", {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: business_name,
      url: siteUrl,
      contactPoint: {
        "@type": "ContactPoint",
        telephone: phone,
        contactType: "customer service",
        areaServed: geography.states,
      },
    });
    ctx.generatedSchemas.set("LocalBusiness", {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: business_name,
      description: `${vertical} services in ${geography.states.join(", ")}`,
      url: siteUrl,
      telephone: phone,
      address: {
        "@type": "PostalAddress",
        addressRegion: geography.primary_state,
        addressCountry: "US",
      },
      areaServed: geography.states.map((state) => ({ "@type": "State", name: state })),
    });
    ctx.generatedSchemas.set("ServiceArea", {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `${business_name} — ${vertical}`,
      provider: { "@type": "Organization", name: business_name },
      serviceType: vertical,
      areaServed: geography.states.map((state) => ({ "@type": "AdministrativeArea", name: state })),
    });

    // FAQPage from the StructuredContentPackage — SEO-Bot content authority,
    // deterministic serialization here. Stable route order, stable dedupe.
    const faqs: Array<{ question: string; answer: string }> = [];
    const seenQuestions = new Set<string>();
    for (const route of contentPackage.payload.routes) {
      if (route.schema_content_inputs.faq === false) continue;
      for (const faq of route.faqs) {
        const key = faq.question.trim().toLowerCase();
        if (!key || seenQuestions.has(key)) continue;
        seenQuestions.add(key);
        faqs.push({ question: faq.question, answer: faq.answer });
      }
    }
    if (faqs.length > 0) {
      ctx.generatedSchemas.set("FAQPage", {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      });
    }
    ctx.generatedSchemas.set("BreadcrumbList", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: ctx.domainSpec.routes.map((route, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: route.title,
        item: `${siteUrl}${route.slug}`,
      })),
    });

    // Runtime proof for the receipt: this path performed zero LLM calls.
    if (ctx.redesignCounters.redesignSchemaLlmCalls !== 0) {
      throw new BuildError(
        "FORBIDDEN_LLM_OPERATION",
        `redesign schema serialization performed ${ctx.redesignCounters.redesignSchemaLlmCalls} LLM call(s); required count is 0`,
      );
    }
    logger.info(
      {
        schemas: [...ctx.generatedSchemas.keys()],
        llmCalls: ctx.redesignCounters.redesignSchemaLlmCalls,
      },
      "Deterministic schema serialization complete (0 LLM calls)",
    );
  }
}
