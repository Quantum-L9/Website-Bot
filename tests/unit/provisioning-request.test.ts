// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProvisioningRequest, type ProvisionableDomainSpec } from '../../src/provisioning/request.js';

function domainSpec(): ProvisionableDomainSpec {
  return {
    client_id: 'Acme Roofing Charlotte',
    business_name: 'Acme Roofing',
    provision: {
      github: { owner: 'Quantum-L9' },
      vercel: {
        environment: [
          { key: 'PUBLIC_SITE_URL', value_ref: 'env://ACME_PUBLIC_SITE_URL', targets: ['production'] },
        ],
      },
    },
  };
}

void test('normalizes a DomainSpec into an idempotent provisioning request', () => {
  const request = buildProvisioningRequest(domainSpec(), 'inputs/acme.yaml', { planOnly: false });
  assert.equal(request.github.repository, 'acme-roofing-charlotte-site');
  assert.equal(request.github.visibility, 'private');
  assert.equal(request.github.sourceBranch, 'main');
  assert.equal(request.github.publishCredentialRef, 'env://GITHUB_SITE_TOKEN');
  assert.equal(request.vercel.project, 'acme-roofing-charlotte-site');
  assert.deepEqual(request.vercel.environment[0].targets, ['production']);
  assert.equal(request.maintenance.githubCredentialRef, 'env://SEO_BOT_SITE_GITHUB_TOKEN');
  assert.equal(request.persistDeployBlock, true);
  assert.equal(request.rollbackCreatedResources, true);
});

void test('rejects duplicate Vercel environment keys', () => {
  const spec = domainSpec();
  spec.provision!.vercel.environment = [
    { key: 'SITE_URL', value_ref: 'env://SITE_URL_A' },
    { key: 'SITE_URL', value_ref: 'env://SITE_URL_B' },
  ];
  assert.throws(
    () => buildProvisioningRequest(spec, 'inputs/acme.yaml', { planOnly: false }),
    /duplicate keys/,
  );
});

void test('rejects raw credential values in provisioning configuration', () => {
  const spec = domainSpec();
  spec.provision!.github.publish_credential_ref = 'ghp_raw_secret';
  assert.throws(
    () => buildProvisioningRequest(spec, 'inputs/acme.yaml', { planOnly: false }),
    /must be env:\/\/NAME/,
  );
});
