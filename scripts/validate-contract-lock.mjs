// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lockPath = resolve('contracts/CONTRACT_LOCK.json');
const schemaPath = resolve('contracts/website-factory-handoff.v3.schema.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const digest = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
if (lock.protocol !== 'l9.website-factory.handoff' || lock.schema_version !== '3.0') {
  throw new Error('CONTRACT_LOCK.json does not identify the canonical handoff v3 contract');
}
if (lock.schema_sha256 !== digest) {
  throw new Error(`handoff contract drift: expected ${lock.schema_sha256}, observed ${digest}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, schema: schemaPath, sha256: digest })}\n`);
