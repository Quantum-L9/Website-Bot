// L9_META: layer=pipeline, role=context_carrier, status=active, version=2.0.0
import type { WebsiteFactoryLLM } from '../services/llm.js';

export interface DomainSpec {
  client_id: string;
  business_name: string;
  vertical: string;
  geography: { states: string[]; primary_state: string };
  design: { status: 'resolved' | 'pending'; palette?: Record<string, string>; fonts?: Record<string, string> };
  routes: Array<{ slug: string; title: string; components: string[] }>;
  seo_contract?: Record<string, unknown>;
  wom_flags?: Array<{ key: string; value: string; severity: 'error' | 'warning' | 'info' }>;
}

export interface BuildContext {
  buildId: string;
  clientId: string;
  domainSpec: DomainSpec;
  dryRun: boolean;
  autoRegisterSeoBot: boolean;
  llm: WebsiteFactoryLLM;
  deploymentUrl?: string;
  generatedContent: Map<string, string>;
  generatedSchemas: Map<string, object>;
  baselineRanks?: Record<string, number | null>;
  visualQaPassed: boolean;
  stageResults: Map<string, { ok: boolean; skipped?: boolean; error?: string }>;
  startedAt: Date;
}

export function makeBuildId(clientId: string): string {
  return `${clientId}-${Date.now()}`;
}
