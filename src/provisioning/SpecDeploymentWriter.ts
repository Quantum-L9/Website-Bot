// L9_META: layer=provisioning, role=domain_spec_deploy_writer, status=active, version=1.0.0
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseDocument } from 'yaml';
import type { GitHubProvisioningResult, ProvisioningRequest, VercelProvisioningResult } from './types.js';

export interface SpecWriteResult { persisted: boolean; path: string; backupPath?: string; }

export class SpecDeploymentWriter {
  write(request: ProvisioningRequest, github: GitHubProvisioningResult, vercel: VercelProvisioningResult): SpecWriteResult {
    const path = resolve(request.specPath);
    if (!request.persistDeployBlock || request.planOnly) return { persisted: false, path };
    const original = readFileSync(path, 'utf-8');
    const document = parseDocument(original);
    if (document.errors.length > 0) throw new Error(`Cannot persist provisioning result: ${document.errors.map(error => error.message).join('; ')}`);
    const rootPath = document.has('domain_spec') ? ['domain_spec', 'deploy'] : ['deploy'];
    const deploy = {
      github_repo: github.fullName,
      github_repo_id: github.repositoryId,
      source_branch: github.sourceBranch,
      publish_credential_ref: request.github.publishCredentialRef,
      vercel_project_id: vercel.projectId,
      seo_bot_github_credential_ref: request.maintenance.githubCredentialRef,
      ...(request.maintenance.vercelDeployHookRef ? { seo_bot_vercel_deploy_hook_ref: request.maintenance.vercelDeployHookRef } : {}),
    };
    document.setIn(rootPath, deploy);
    const next = document.toString({ lineWidth: 0 });
    if (next === original) return { persisted: false, path };

    const backupPath = `${path}.before-provisioning`;
    const temporaryPath = `${path}.${process.pid}.tmp`;
    if (!existsSync(backupPath)) writeFileSync(backupPath, original, 'utf-8');
    writeFileSync(temporaryPath, next, 'utf-8');
    renameSync(temporaryPath, path);
    return { persisted: true, path, backupPath };
  }

  restore(result: SpecWriteResult): void {
    if (!result.persisted || !result.backupPath || !existsSync(result.backupPath)) return;
    const temporaryPath = `${result.path}.${process.pid}.restore.tmp`;
    writeFileSync(temporaryPath, readFileSync(result.backupPath));
    renameSync(temporaryPath, result.path);
    rmSync(result.backupPath, { force: true });
  }
}
