import { readJson, configPath, readText, parseEnvExample, result, writeJsonl, statusFromRows } from './lib.mjs';
const cfg = readJson(configPath);
const env = parseEnvExample();
const form = readText(cfg.form.component);
const rows = [];
rows.push(result('FORM-TAG', 'form_validation', cfg.form.component, 'form tag exists', /<form\b/i.test(form) ? 'found' : 'missing', /<form\b/i.test(form) ? 'PASS' : 'FAIL', 'critical', 'Restore LeadForm form tag.'));
for (const field of cfg.form.requiredFields) {
  const found = new RegExp(`name=["']${field}["']`).test(form);
  rows.push(result(`FORM-FIELD-${field}`, 'form_validation', cfg.form.component, `field ${field} exists`, found ? 'found' : 'missing', found ? 'PASS' : 'FAIL', 'critical', `Add required field ${field}.`));
}
const hasEndpoint = env.PUBLIC_FORM_ENDPOINT && !env.PUBLIC_FORM_ENDPOINT.includes('UNKNOWN');
const hasEnvDrivenAction = /PUBLIC_FORM_ENDPOINT|formEndpoint|data-form-endpoint/i.test(form);
rows.push(result('FORM-DESTINATION', 'form_delivery_validation', cfg.form.component, 'delivery path env-driven or configured', hasEndpoint ? 'endpoint configured' : (hasEnvDrivenAction ? 'env-driven endpoint present' : 'no destination'), hasEndpoint || hasEnvDrivenAction ? (hasEndpoint ? 'PASS' : 'UNKNOWN') : 'FAIL', 'critical', 'Wire LeadForm action to PUBLIC_FORM_ENDPOINT or configure delivery provider.'));
writeJsonl('validation/form_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
