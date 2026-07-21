// L9_META: layer=cli, role=client_provisioning_entrypoint, status=active, version=1.0.0
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { validateDomainSpec } from '../src/pipeline/validateDomainSpec.js';
import { ProvisioningCoordinator } from '../src/provisioning/ProvisioningCoordinator.js';
import { buildProvisioningRequest } from '../src/provisioning/request.js';

const args = process.argv.slice(2);
const valueOf = (name: string): string | undefined => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const specPath = valueOf('spec');
if (!specPath) throw new Error('--spec=<normalized-domain-spec.yaml> is required');
const planOnly = args.includes('--plan');
const persistDeployBlock = !args.includes('--no-persist');
const rollbackCreatedResources = !args.includes('--no-rollback');
const domainSpec = validateDomainSpec(parse(readFileSync(specPath, 'utf-8')), specPath);
const request = buildProvisioningRequest(domainSpec, specPath, { planOnly, persistDeployBlock, rollbackCreatedResources });
const receipt = await new ProvisioningCoordinator().provision(request);
console.log(JSON.stringify(receipt, null, 2));
