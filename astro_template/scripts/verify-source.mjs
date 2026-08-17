import { exists, readText } from "./lib.mjs";
import { createValidator } from "./validation-framework.mjs";

const validator = createValidator("source");

// Check Astro pages exist
await validator.addDirectoryContentCheck(
  "pages-exist",
  "src/pages",
  (file) => file.endsWith(".astro") || file.endsWith(".md"),
  "At least one page file exists",
  "high",
  1,
);

// Check layouts directory
await validator.addDirectoryContentCheck(
  "layouts-exist",
  "src/layouts",
  (file) => file.endsWith(".astro"),
  "Layout files exist",
  "medium",
  0, // Optional
);

// Check components directory
await validator.addDirectoryContentCheck(
  "components-exist",
  "src/components",
  (file) => file.endsWith(".astro") || file.endsWith(".tsx") || file.endsWith(".jsx"),
  "Component files exist",
  "medium",
  0, // Optional
);

// Check for main page
const indexExists = exists("src/pages/index.astro") || exists("src/pages/index.md");
validator.addCheck({
  id: "index-page-exists",
  category: "file_existence",
  target: "src/pages/index.*",
  description: "Index page exists",
  evidence: indexExists ? "Index page found" : "No index page found",
  status: indexExists ? "PASS" : "FAIL",
  severity: "high",
  remedy: "Create src/pages/index.astro or src/pages/index.md",
});

// Validate Astro config if it exists
if (exists("astro.config.mjs")) {
  try {
    const configText = readText("astro.config.mjs");
    const hasDefineConfig = configText.includes("defineConfig");
    validator.addCheck({
      id: "astro-config-valid",
      category: "config_validation",
      target: "astro.config.mjs",
      description: "Uses defineConfig export",
      evidence: hasDefineConfig ? "defineConfig found" : "defineConfig missing",
      status: hasDefineConfig ? "PASS" : "FAIL",
      severity: "medium",
      remedy: "Use defineConfig in astro.config.mjs",
    });
  } catch (error) {
    validator.addCheck({
      id: "astro-config-readable",
      category: "file_validation",
      target: "astro.config.mjs",
      description: "Config file is readable",
      evidence: `Error: ${error.message}`,
      status: "FAIL",
      severity: "medium",
      remedy: "Fix astro.config.mjs syntax errors",
    });
  }
}

await validator.run();
