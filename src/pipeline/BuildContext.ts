// L9_META: layer=pipeline, role=context_carrier, status=active, version=3.0.0
import type { WebsiteFactoryLLM } from '../services/llm.js';
import type { AssemblyManifest } from './evidence/AssemblyManifest.js';
import type { BuildProof } from './evidence/BuildProof.js';
import type { DeploymentEvidence } from './evidence/DeploymentEvidence.js';
import type { PublicationEvidence } from './evidence/PublicationEvidence.js';
import type { EvidenceGateStatus, ReleaseReceipt } from './evidence/ReleaseReceipt.js';
import type { ProvisioningReceipt, ProvisioningSpec } from '../provisioning/types.js';
import type { EvidenceStore } from './evidence/EvidenceStore.js';
import type { EvidenceIndex } from './evidence/EvidenceIndex.js';
import type { SourceSiteManifest } from './evidence/SourceSiteManifest.js';
import type { ImageAssetPlan } from './evidence/ImageAssetPlan.js';
import type { ImageAssetManifest, ResolvedImageAsset } from './evidence/ImageAssetManifest.js';

export type ExecutionMode = 'plan' | 'local-proof' | 'publish-proof' | 'end-to-end';

export interface DeployTarget {
  githubRepo: string;
  githubRepoId?: string;
  sourceBranch: string;
  publishCredentialRef?: string;
  vercelProjectId?: string;
  vercelDeployHook?: string;
  seoBotGithubCredentialRef?: string;
  seoBotVercelDeployHookRef?: string;
}

export interface SeoContract {
  site_url?: string;
  phone?: string;
  lead_form_action?: string;
  target_keywords?: string[];
}

/** Source website to crawl for reusable assets. Off unless explicitly enabled. */
export interface SourceSiteSpec {
  url: string;
  enabled?: boolean;
  maxPages?: number;
  maxDepth?: number;
  allowSubdomains?: boolean;
  captureScreenshots?: boolean;
  downloadImages?: boolean;
}

/** An operator-supplied image, resolved before any crawl or generation. */
export interface ProvidedImageSpec {
  id: string;
  path: string;
  altText?: string;
  intendedPlacement?: string;
}

/** A desired image position on the generated site, and how to fill it. */
export interface ImageSlotSpec {
  id: string;
  placement: string;
  required: boolean;
  preferredSources?: Array<'provided' | 'source-site' | 'generated'>;
  altText?: string;
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  generation?: {
    intent: string;
    subject?: string;
    composition?: string;
    style?: string;
    exclusions?: string[];
  };
}

/**
 * Asset inputs and desired image slots. Kept deliberately separate from routes
 * and SEO: source inputs (what exists) never conflate with image slots (what the
 * generated site needs). Absent for text-only builds, which must be unaffected.
 */
export interface AssetSpec {
  sourceSite?: SourceSiteSpec;
  providedImages?: ProvidedImageSpec[];
  imageSlots?: ImageSlotSpec[];
  generation?: {
    enabled: boolean;
    model?: string;
    budgetUsd?: number;
    promptCompiler?: 'default' | 'igor-motif';
  };
}

export interface DomainSpec {
  client_id: string;
  business_name: string;
  vertical: string;
  geography: { states: string[]; primary_state: string };
  design: { status: 'resolved' | 'pending'; palette?: Record<string, string>; fonts?: Record<string, string> };
  routes: Array<{ slug: string; title: string; components: string[]; noindex?: boolean }>;
  seo_contract?: SeoContract;
  wom_flags?: Array<{ key: string; value: string; severity: 'error' | 'warning' | 'info' }>;
  deploy?: {
    github_repo: string;
    github_repo_id?: string;
    source_branch?: string;
    publish_credential_ref?: string;
    vercel_project_id?: string;
    vercel_deploy_hook?: string;
    seo_bot_github_credential_ref?: string;
    seo_bot_vercel_deploy_hook_ref?: string;
  };
  provision?: ProvisioningSpec;
  assets?: AssetSpec;
}

/** A resolved image as exposed to the generated Astro site's siteConfig. */
export interface SiteImageEntry {
  src: string;
  alt: string;
  width: number;
  height: number;
  source: 'provided' | 'source-site' | 'generated';
}

export interface SiteConfig {
  businessName: string;
  siteUrl: string;
  vertical: string;
  clientId: string;
  namespace: string;
  geography: { primaryState: string; states: string[] };
  nav: Array<{ href: string; label: string }>;
  schemas: { siteWide: object[]; perRoute: Record<string, object[]> };
  designTokens: Record<string, string>;
  leadFormAction?: string;
  phone?: string;
  /** Resolved images keyed by placement (e.g. "global:logo", "/:hero"). */
  images?: Record<string, SiteImageEntry>;
}

export interface QualityEvidence {
  seoBaseline: EvidenceGateStatus;
  visualQa: EvidenceGateStatus;
}

export interface BuildContext {
  buildId: string;
  clientId: string;
  domainSpec: DomainSpec;
  dryRun: boolean;
  mode: ExecutionMode;
  autoRegisterSeoBot: boolean;
  llm: WebsiteFactoryLLM;
  outputDir: string;
  designTokens?: Record<string, string>;
  siteConfig?: SiteConfig;
  /** In-memory evidence fields are caches only. EvidenceStore is authoritative. */
  assemblyManifest?: AssemblyManifest;
  buildProof?: BuildProof;
  publicationEvidence?: PublicationEvidence;
  deploymentEvidence?: DeploymentEvidence;
  releaseReceipt?: ReleaseReceipt;
  releaseReceiptPath?: string;
  provisioningReceipt?: ProvisioningReceipt;
  evidenceStore: EvidenceStore;
  evidenceIndex: EvidenceIndex;
  resume: boolean;
  qualityEvidence: QualityEvidence;
  distDir?: string;
  deployTarget?: DeployTarget;
  deploymentUrl?: string;
  sourceCommitSha?: string;
  generatedContent: Map<string, string>;
  generatedSchemas: Map<string, object>;
  /**
   * Image pipeline state. All optional and lazily initialized so text-only
   * builds — which never touch the image stages — carry none of it. The
   * EvidenceStore remains authoritative for release evidence; these are the
   * image-pipeline equivalents of the other in-memory evidence caches.
   */
  sourceSiteManifest?: SourceSiteManifest;
  imageAssetPlan?: ImageAssetPlan;
  imageAssetManifest?: ImageAssetManifest;
  /** Resolved images keyed by placement, ready for the assembler to copy. */
  resolvedImages?: Map<string, ResolvedImageAsset>;
  baselineRanks?: Record<string, number | null>;
  visualQaPassed: boolean;
  /** Set by UnknownResolverStage when error-severity WOM flags are allowed through in advisory mode. Presence means the build is not publish-safe. */
  unresolvedErrorFlags?: string[];
  stageResults: Map<string, { ok: boolean; skipped?: boolean; error?: string }>;
  startedAt: Date;
}

export function makeBuildId(clientId: string): string {
  return `${clientId}-${Date.now()}`;
}
