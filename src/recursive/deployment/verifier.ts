// L9_META: layer=recursive, role=deployment_verifier, status=active, version=1.0.0
// Deployment verification with automatic rollback. The next wave is legal only
// after a receipt proves the exact expected SHA is deployed and healthy.
// A health failure restores the previous verified SHA and terminates the run.
// NOTE: this program run never deploys (DEC-001); the simulation drives the
// same code against a local deployment directory.
import { sha256Text } from "../../services/hashing.js";

export interface DeploymentAdapter {
  deploy(sha: string, environment: string): Promise<{ deploymentId: string; deployedSha: string }>;
  health(environment: string): Promise<boolean>;
  rollback(
    previousSha: string,
    environment: string,
  ): Promise<{ rollbackId: string; deployedSha: string }>;
}

export interface DeploymentReceipt {
  schema: "l9.recursive.deployment-receipt/v1";
  deploymentId: string;
  environment: string;
  mergeSha: string;
  deployedSha: string;
  healthVerdict: "PASS" | "FAIL";
  rollback?: {
    rollbackReceiptRef: string;
    restoredSha: string;
    verified: boolean;
  };
  producedAt: string;
}

export const DEPLOYMENT_RECEIPT_SCHEMA = "l9.recursive.deployment-receipt/v1";

export class DeploymentVerifier {
  constructor(private readonly adapter: DeploymentAdapter) {}

  /**
   * Deploys the exact merge SHA, validates health, and rolls back on failure.
   * DEPLOYMENT_PROVENANCE_MISMATCH fails closed: a deployment whose reported
   * SHA differs from the requested merge SHA is treated as failed.
   */
  async deployAndVerify(input: {
    mergeSha: string;
    environment: string;
    previousVerifiedSha: string;
    maxAttempts: number;
  }): Promise<{ receipt: DeploymentReceipt; rolledBack: boolean }> {
    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      const deployment = await this.adapter.deploy(input.mergeSha, input.environment);
      if (deployment.deployedSha !== input.mergeSha) {
        const rollback = await this.adapter.rollback(input.previousVerifiedSha, input.environment);
        return {
          rolledBack: true,
          receipt: this.receipt({
            deploymentId: deployment.deploymentId,
            environment: input.environment,
            mergeSha: input.mergeSha,
            deployedSha: deployment.deployedSha,
            healthVerdict: "FAIL",
            rollback: {
              rollbackReceiptRef: rollback.rollbackId,
              restoredSha: rollback.deployedSha,
              verified: rollback.deployedSha === input.previousVerifiedSha,
            },
          }),
        };
      }
      const healthy = await this.adapter.health(input.environment);
      if (healthy) {
        return {
          rolledBack: false,
          receipt: this.receipt({
            deploymentId: deployment.deploymentId,
            environment: input.environment,
            mergeSha: input.mergeSha,
            deployedSha: deployment.deployedSha,
            healthVerdict: "PASS",
          }),
        };
      }
      const rollback = await this.adapter.rollback(input.previousVerifiedSha, input.environment);
      if (attempt === input.maxAttempts) {
        return {
          rolledBack: true,
          receipt: this.receipt({
            deploymentId: deployment.deploymentId,
            environment: input.environment,
            mergeSha: input.mergeSha,
            deployedSha: deployment.deployedSha,
            healthVerdict: "FAIL",
            rollback: {
              rollbackReceiptRef: rollback.rollbackId,
              restoredSha: rollback.deployedSha,
              verified: rollback.deployedSha === input.previousVerifiedSha,
            },
          }),
        };
      }
      // Budget remains: retry the deployment after the rollback restored the
      // previous verified revision. Evidence is preserved; nothing widens.
    }
    // Unreachable: the loop always returns; kept for exhaustiveness.
    throw new Error(`deployment attempts exhausted (${input.maxAttempts}) without verification`);
  }

  private receipt(input: {
    deploymentId: string;
    environment: string;
    mergeSha: string;
    deployedSha: string;
    healthVerdict: "PASS" | "FAIL";
    rollback?: { rollbackReceiptRef: string; restoredSha: string; verified: boolean };
  }): DeploymentReceipt {
    return {
      schema: DEPLOYMENT_RECEIPT_SCHEMA,
      deploymentId: input.deploymentId,
      environment: input.environment,
      mergeSha: input.mergeSha,
      deployedSha: input.deployedSha,
      healthVerdict: input.healthVerdict,
      ...(input.rollback ? { rollback: input.rollback } : {}),
      producedAt: new Date().toISOString(),
    };
  }
}

/** Local directory deployment adapter used by the simulated three-wave proof. */
export class LocalDirectoryDeploymentAdapter implements DeploymentAdapter {
  constructor(
    private readonly targetDir: string,
    private readonly healthMarker: string,
  ) {}

  async deploy(
    sha: string,
    _environment: string,
  ): Promise<{ deploymentId: string; deployedSha: string }> {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(this.targetDir, { recursive: true });
    writeFileSync(this.healthMarker, `deployed:${sha}:healthy\n`, "utf-8");
    return { deploymentId: `local-${sha256Text(sha).slice(0, 12)}`, deployedSha: sha };
  }

  async health(_environment: string): Promise<boolean> {
    const { readFileSync, existsSync } = await import("node:fs");
    if (!existsSync(this.healthMarker)) return false;
    return readFileSync(this.healthMarker, "utf-8").includes(":healthy");
  }

  async rollback(
    previousSha: string,
    _environment: string,
  ): Promise<{ rollbackId: string; deployedSha: string }> {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(this.targetDir, { recursive: true });
    writeFileSync(this.healthMarker, `deployed:${previousSha}:healthy\n`, "utf-8");
    return {
      rollbackId: `rollback-${sha256Text(previousSha).slice(0, 12)}`,
      deployedSha: previousSha,
    };
  }
}
