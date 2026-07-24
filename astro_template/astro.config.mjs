// L9_META: layer=template, role=astro_configuration, status=active, version=1.0.0
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://example.invalid',
  output: 'static',
  integrations: [sitemap()],
});
