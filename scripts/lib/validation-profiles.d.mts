export const FACTORY_VALIDATION_PROFILES: string[];
export const SITE_TEMPLATE_VALIDATION_PROFILES: string[];
export const IMPLEMENTED_VALIDATION_PROFILES: string[];
/** @deprecated Empty — site profiles are implemented against astro_template. */
export const UNIMPLEMENTED_SITE_PROFILES: string[];
export const WEBSITE_BOT_VALIDATION_PROFILES: string[];

export interface ProfileRunDecision {
  status: "INVALID_PROFILE" | "INCOMPLETE" | "RUN";
  exitCode: number;
  nonEvidence: boolean;
  reason: string | null;
}

export function resolveProfileRun(profile: string | undefined): ProfileRunDecision;

export function collectWebsiteBotConfigErrors(options?: {
  profile?: string;
  environment?: string;
  timeout?: string;
}): string[];
