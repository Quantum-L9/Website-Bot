// L9_META: layer=recursive, role=mutation_envelope_enforcement, status=active, version=1.0.0
// Mutation envelope enforcement. A scope violation STOPS instead of
// broadening the patch: the executor may never rewrite the envelope, and a
// diff touching a forbidden or control-plane path is rejected outright.
import type { PEPack } from "../contracts/types.js";
import { CONTROL_PLANE_PATHS } from "../state/constants.js";
import { stripTrailingSlashes } from "../../lib/text-trim.js";

export interface ProposedPatch {
  changedFiles: string[];
  diffLines: number;
}

export interface EnvelopeVerdict {
  allowed: boolean;
  violations: string[];
}

function pathWithin(relativePath: string, prefix: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const trimmed = stripTrailingSlashes(prefix.replaceAll("\\", "/"));
  return normalized === trimmed || normalized.startsWith(`${trimmed}/`);
}

export function evaluateMutationEnvelope(pack: PEPack, patch: ProposedPatch): EnvelopeVerdict {
  const violations: string[] = [];
  const envelope = pack.mutationEnvelope;

  for (const file of patch.changedFiles) {
    const onControlPlane = CONTROL_PLANE_PATHS.some((prefix) => pathWithin(file, prefix));
    if (onControlPlane) {
      violations.push(`control-plane path is immutable: ${file}`);
      continue;
    }
    const explicitlyForbidden = envelope.forbiddenPaths.some((prefix) => pathWithin(file, prefix));
    if (explicitlyForbidden) {
      violations.push(`forbidden path in envelope: ${file}`);
      continue;
    }
    if (
      envelope.allowedPaths.length > 0 &&
      !envelope.allowedPaths.some((prefix) => pathWithin(file, prefix))
    ) {
      violations.push(`path outside allowed envelope: ${file}`);
    }
  }

  if (patch.changedFiles.length > envelope.maxChangedFiles) {
    violations.push(
      `changed ${patch.changedFiles.length} files, envelope allows ${envelope.maxChangedFiles}`,
    );
  }
  if (patch.diffLines > envelope.maxDiffLines) {
    violations.push(`diff is ${patch.diffLines} lines, envelope allows ${envelope.maxDiffLines}`);
  }
  if (envelope.architectureExpansionAllowed !== false) {
    violations.push(
      "architecture expansion must be prohibited (architectureExpansionAllowed must be false)",
    );
  }

  return { allowed: violations.length === 0, violations };
}
