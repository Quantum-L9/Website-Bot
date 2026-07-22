// L9_META: layer=stage, role=posthog_injection, stage_index=7, status=active, version=3.0.0
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:posthog-snippet');
const MARKER = '<!-- L9:POSTHOG:INJECTED -->';

export class PostHogSnippetStage implements Stage {
  name = 'posthog-snippet';

  async run(ctx: BuildContext): Promise<void> {
    const legacyKey = process.env.POSTHOG_KEY;
    const posthogKey = process.env.PUBLIC_POSTHOG_KEY ?? (legacyKey?.startsWith('phc_') ? legacyKey : undefined);
    const required = process.env.POSTHOG_REQUIRED === 'true';
    if (!posthogKey) {
      if (required && !ctx.dryRun) throw new BuildError('POSTHOG_INJECT_FAILED', 'PostHog is required but no public project key is configured');
      logger.info('PostHog public project key not configured; analytics injection skipped');
      return;
    }
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(posthogKey)) {
      throw new BuildError('POSTHOG_INJECT_FAILED', 'PostHog public project key has an invalid shape');
    }
    if (ctx.dryRun) {
      logger.info('[dry-run] Would inject PostHog snippet into generated BaseLayout.astro');
      return;
    }

    const layoutPath = join(ctx.outputDir, 'src/layouts/BaseLayout.astro');
    if (!existsSync(layoutPath)) throw new BuildError('POSTHOG_INJECT_FAILED', `${layoutPath} not found`);
    let layout = readFileSync(layoutPath, 'utf-8');
    if (layout.includes(MARKER)) {
      logger.info('PostHog snippet already injected; idempotent skip');
      return;
    }
    if (!layout.includes('</head>')) throw new BuildError('POSTHOG_INJECT_FAILED', 'Generated layout does not contain a </head> anchor');

    const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';
    let parsedHost: URL;
    try { parsedHost = new URL(host); }
    catch { throw new BuildError('POSTHOG_INJECT_FAILED', 'POSTHOG_HOST must be a valid HTTPS URL'); }
    if (parsedHost.protocol !== 'https:') throw new BuildError('POSTHOG_INJECT_FAILED', 'POSTHOG_HOST must use HTTPS');

    const snippet = `${MARKER}\n<script is:inline define:vars={{ posthogKey: ${JSON.stringify(posthogKey)}, posthogHost: ${JSON.stringify(parsedHost.toString().replace(/\/$/, ''))} }}>\n  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=u._i.push([i,s,a]),u.prefix=a,u.peopleProperties={},u._i=[],u.identify=function(t,e,o){u.push(["identify",t,e,o])},u.capture=function(t,e){u.push(["capture",t,e])},o=0;o<u._i.length;o++)n=u._i[o],g(u,n[0]);e.__SV=1})}(document,window.posthog||[]);\n  posthog.init(posthogKey, { api_host: posthogHost, autocapture: true });\n  document.addEventListener('DOMContentLoaded', function() {\n    document.querySelectorAll('a[href^="tel:"], a[data-cta], button[data-cta]').forEach(function(el) {\n      el.addEventListener('click', function() { posthog.capture('cta_click', { label: el.textContent?.trim(), page: window.location.pathname }); });\n    });\n    document.querySelectorAll('form').forEach(function(form) {\n      form.addEventListener('submit', function() { posthog.capture('form_submit', { formId: form.id || 'unknown', page: window.location.pathname }); });\n    });\n  });\n</script>`;
    layout = layout.replace('</head>', `${snippet}\n</head>`);
    writeFileSync(layoutPath, layout, 'utf-8');
    logger.info({ layoutPath }, 'PostHog analytics injected');
  }
}
