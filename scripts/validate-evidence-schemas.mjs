import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('schemas');
const required = {
  'assembly-manifest.schema.json': 'website-bot.assembly-manifest/v1',
  'build-proof.schema.json': 'website-bot.build-proof/v1',
  'publication-evidence.schema.json': 'website-bot.publication-evidence/v1',
  'deployment-evidence.schema.json': 'website-bot.deployment-evidence/v1',
  'release-receipt.schema.json': 'website-bot.release-receipt/v1',
  'evidence-index.schema.json': 'website-bot.evidence-index/v1',
  'stage-checkpoint.schema.json': 'website-bot.stage-checkpoint/v1',
  'stage-failure-evidence.schema.json': 'website-bot.stage-failure/v1',
  'seo-bot-registration-ack.schema.json': 'seo-bot.website-factory-registration-ack/v1',
};
const results = [];
for (const [file, schemaConst] of Object.entries(required)) {
  const document = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
  if (document.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error(`${file}: wrong meta-schema`);
  if (document.type !== 'object' || document.additionalProperties !== false) throw new Error(`${file}: object must fail closed`);
  if (document.properties?.schema?.const !== schemaConst) throw new Error(`${file}: schema const drift`);
  if (!Array.isArray(document.required) || !document.required.includes('schema')) throw new Error(`${file}: schema is not required`);
  results.push({ file, schema: schemaConst });
}
const extras = readdirSync(directory).filter(name => name.endsWith('.schema.json') && !(name in required));
console.log(JSON.stringify({ ok: true, validated: results, additionalSchemas: extras.sort() }, null, 2));
