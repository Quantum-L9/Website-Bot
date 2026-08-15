// L9_META: layer=validation, role=json_schema_2020_compiler, status=active, version=1.0.0
// Validates the six bound recursive contract schemas (schemas/recursive/) with
// the same JSON Schema 2020-12 subset compiler pattern as
// scripts/validate-evidence-schemas.mjs. External $refs are rejected; every
// schema must fail closed (additionalProperties: false) and pass a generated
// positive fixture plus a negative fixture with the schema stamp removed.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('schemas/recursive');
const required = {
  'engineering-signal.schema.json': 'l9.engineering-signal/v1',
  'pe-pack.schema.json': 'l9.pe-pack/v1',
  'code-change-outcome.schema.json': 'l9.code-change-outcome/v1',
  'recursive-engineering-event.schema.json': 'l9.recursive-engineering-event/v1',
  'recursive-engineering-wave.schema.json': 'l9.recursive-engineering-wave/v1',
  'recursive-engineering-run.schema.json': 'l9.recursive-engineering-run/v1',
};
function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) { throw new Error(`external $ref not allowed: ${ref}`); }
  return ref.slice(2).split('/').reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}
function compile(root) {
  const validate = (schema, value, path = '$') => {
    if (schema.$ref) return validate(resolveRef(root, schema.$ref), value, path);
    if ('const' in schema && value !== schema.const) return `${path} must equal const`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} must be in enum`;
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be object`;
      for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} is required`;
      if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) return `${path}.${key} is not allowed`;
      for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) { const e = validate(child, value[key], `${path}.${key}`); if (e) return e; }
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) return `${path} must be array`;
      if (value.length < (schema.minItems ?? 0)) return `${path} has too few items`;
      for (let i = 0; i < value.length; i++) { const e = validate(schema.items ?? {}, value[i], `${path}[${i}]`); if (e) return e; }
    }
    if (schema.type === 'string') {
      if (typeof value !== 'string') return `${path} must be string`;
      if (value.length < (schema.minLength ?? 0)) return `${path} is too short`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} does not match pattern`;
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return `${path} must be date-time`;
    }
    if (schema.type === 'integer' && (!Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return `${path} must be integer in range`;
    if (schema.type === 'number' && (typeof value !== 'number' || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return `${path} must be number in range`;
    if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path} must be boolean`;
    return null;
  };
  return value => { const error = validate(root, value); return { valid: !error, error }; };
}
function sample(root, schema = root) {
  if (schema.$ref) return sample(root, resolveRef(root, schema.$ref));
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object') {
    const out = {};
    for (const key of schema.required ?? []) out[key] = sample(root, schema.properties?.[key] ?? {});
    return out;
  }
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => sample(root, schema.items ?? {}));
  if (schema.type === 'boolean') return true;
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 1;
  if (schema.type === 'string') {
    if (schema.format === 'date-time') return '2026-08-15T00:00:00.000Z';
    const p = schema.pattern ?? '';
    if (p.includes('{64}')) return 'a'.repeat(64);
    if (p.includes('{40}')) return 'a'.repeat(40);
    if (p.includes('\\d+\\.\\d+\\.\\d+')) return '1.0.0';
    return 'x'.repeat(Math.max(1, schema.minLength ?? 1));
  }
  return {};
}
const results = [];
for (const [file, schemaConst] of Object.entries(required)) {
  const doc = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
  if (doc.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error(`${file}: wrong meta-schema`);
  if (doc.type !== 'object' || doc.additionalProperties !== false) throw new Error(`${file}: object must fail closed`);
  if (doc.properties?.schema?.const !== schemaConst) throw new Error(`${file}: schema const drift`);
  const validator = compile(doc);
  const positive = sample(doc);
  const pass = validator(positive);
  if (!pass.valid) throw new Error(`${file}: generated positive fixture failed: ${pass.error}`);
  const negative = { ...positive };
  delete negative.schema;
  const fail = validator(negative);
  if (fail.valid) throw new Error(`${file}: negative fixture unexpectedly passed`);
  results.push({ file, schema: schemaConst, positive_fixture: 'passed', negative_fixture: 'rejected' });
}
const extras = readdirSync(directory).filter(name => name.endsWith('.schema.json') && !(name in required));
console.log(JSON.stringify({ ok: true, draft: '2020-12', validated: results, additionalSchemas: extras.sort() }, null, 2));
