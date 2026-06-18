// L9_META: layer=stage, role=posthog_injection, stage_index=6, status=active, version=2.0.0
// Idempotently injects PostHog + CTA/form event listeners into Layout.astro.
// Skips gracefully when POSTHOG_KEY is not set.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:posthog-snippet');
const MARKER = '<!-- L9:POSTHOG:INJECTED -->';
const LAYOUT_PATH = 'src/layouts/Layout.astro';

export class PostHogSnippetStage implements Stage {
  name = 'posthog-snippet';

  async run(ctx: BuildContext): Promise<void> {
    const posthogKey = process.env.POSTHOG_KEY;
    if (!posthogKey) {
      logger.info('POSTHOG_KEY not set — skipping PostHog injection');
      return;
    }

    if (ctx.dryRun) {
      logger.info('[dry-run] Would inject PostHog snippet into Layout.astro');
      return;
    }

    if (!existsSync(LAYOUT_PATH)) {
      throw new BuildError('POSTHOG_INJECT_FAILED', `${LAYOUT_PATH} not found — cannot inject PostHog snippet`);
    }

    let layout = readFileSync(LAYOUT_PATH, 'utf-8');

    if (layout.includes(MARKER)) {
      logger.info('PostHog snippet already injected — idempotent skip');
      return;
    }

    const snippet = `${MARKER}
<script define:vars={{ posthogKey: '${posthogKey}' }}>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=u._i.push([i,s,a]),u.prefix=a,u.peopleProperties={},u._i=[],u.identify=function(t,e,o){u.push(["identify",t,e,o])},u.capture=function(t,e){u.push(["capture",t,e]),u.init(i,s,a),o=0;o<u._i.length;o++)n=u._i[o],g(u,n[0]);e.__SV=1})}(document,window.posthog||[]);
  posthog.init(posthogKey, { api_host: 'https://app.posthog.com', autocapture: true });

  // CTA conversion tracking
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[href*="tel:"], a[data-cta], button[data-cta]').forEach(function(el) {
      el.addEventListener('click', function() {
        posthog.capture('cta_click', { label: el.textContent?.trim(), page: window.location.pathname });
      });
    });
    document.querySelectorAll('form').forEach(function(form) {
      form.addEventListener('submit', function() {
        posthog.capture('form_submit', { formId: form.id || 'unknown', page: window.location.pathname });
      });
    });
  });
<\/script>`;

    layout = layout.replace('</head>', snippet + '\n</head>');
    writeFileSync(LAYOUT_PATH, layout, 'utf-8');
    logger.info({ layoutPath: LAYOUT_PATH }, 'PostHog snippet injected');
  }
}
