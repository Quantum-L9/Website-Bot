import { spawnSync } from 'node:child_process';
const mode = process.argv.includes('--prod') ? 'production' : 'preview';
const required = ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(JSON.stringify({ status: 'BLOCKED', reason: 'missing_vercel_environment', missing }, null, 2));
  process.exit(2);
}
const preflight = spawnSync('npm', ['run', 'verify:all'], { stdio: 'inherit' });
if (preflight.status !== 0) {
  console.error(JSON.stringify({ status: 'BLOCKED', reason: 'verification_failed_before_deploy' }, null, 2));
  process.exit(preflight.status || 1);
}
const args = mode === 'production' ? ['vercel', '--prod', '--yes'] : ['vercel', '--yes'];
const deploy = spawnSync('npx', args, { stdio: 'inherit', env: process.env });
process.exit(deploy.status || 0);
