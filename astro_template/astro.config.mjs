// L9_META: layer=template, role=astro_configuration, status=active, version=1.0.0

import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://example.invalid",
  output: "static",
  integrations: [sitemap()],
});
