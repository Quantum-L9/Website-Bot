// L9_META: layer=validation, role=llm_wiring_guard, status=active, version=2.0.0
//
// Regression guard for the Website-Bot LLM provider boundary (ADR-0020):
//   - every text/reasoning/vision call crosses src/services/llm.ts to DeepSeek, directly;
//   - no LLM-Router, OpenRouter or Perplexity dispatch remains under src/;
//   - image generation stays isolated in the Gemini adapter;
//   - the adapter is never a local stub that ships canned copy.
// Static checks prove the source shape; the behavioral probe proves where a real call goes
// (a capturing transport — no network, no spend).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// Support both the applied-repository layout (repo root) and the overlay-pack
// layout (Website-Bot/ subtree), mirroring the other L9 validators.
const candidates = [resolve(scriptDir, ".."), resolve(scriptDir, "../Website-Bot")];
const repoRoot = candidates.find((root) => existsSync(resolve(root, "src/services/llm.ts")));
if (!repoRoot) {
  throw new Error("validate-llm-wiring: src/services/llm.ts not found in any known layout");
}

const ADAPTER_REL = "src/services/llm.ts";
const IMAGE_ADAPTER_REL = "src/services/images/GeminiImageGenerator.ts";
const DEEPSEEK_HOST = "api.deepseek.com";
const RETIRED = [
  { pattern: /@quantum-l9\/llm-router/, label: "@quantum-l9/llm-router import" },
  { pattern: /openrouter\.ai|OPENROUTER_API_KEY/, label: "OpenRouter dispatch" },
  { pattern: /perplexity\.ai|PERPLEXITY_API_KEY/, label: "Perplexity dispatch" },
];
const violations = [];

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

// 1. Static: no retired provider path and no second DeepSeek egress anywhere under src/.
for (const file of sourceFiles(resolve(repoRoot, "src"))) {
  const rel = relative(repoRoot, file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");
  for (const { pattern, label } of RETIRED) {
    if (pattern.test(text)) violations.push(`${rel}: ${label} (retired by ADR-0020)`);
  }
  if (rel !== ADAPTER_REL && text.includes(DEEPSEEK_HOST)) {
    violations.push(`${rel}: DeepSeek egress outside ${ADAPTER_REL}`);
  }
  if (/from ['"][^'"]*llm-stub[^'"]*['"]/.test(text)) {
    violations.push(`${rel}: imports a stub module (llm-stub)`);
  }
}

// 2. Static: no stub module may exist in the services directory.
for (const name of readdirSync(resolve(repoRoot, "src/services"))) {
  if (/^llm-stub\.(ts|js|mjs)$/.test(name))
    violations.push(`stub module present: src/services/${name}`);
}

// 3. Static: image generation stays on Gemini and never crosses the text adapter.
const imageAdapter = readFileSync(resolve(repoRoot, IMAGE_ADAPTER_REL), "utf8");
if (/from ['"][^'"]*services\/llm(\.js)?['"]|from ['"]\.\.\/llm(\.js)?['"]/.test(imageAdapter)) {
  violations.push(`${IMAGE_ADAPTER_REL}: image generation must not use the text LLM adapter`);
}
if (
  /GEMINI_API_KEY|generativelanguage|from ['"][^'"]*images\//.test(
    readFileSync(resolve(repoRoot, ADAPTER_REL), "utf8"),
  )
) {
  violations.push(`${ADAPTER_REL}: the text adapter must not reach the Gemini image provider`);
}

// 4. Behavioral: a real adapter call goes to DeepSeek with only DEEPSEEK_API_KEY, and the
//    retired credentials alone never produce a dispatch.
process.env.L9_MEMORY_MODE ??= "disabled";
const { register } = await import("tsx/esm/api");
register();
const { createWebsiteFactoryLLM } = await import(
  pathToFileURL(resolve(repoRoot, ADAPTER_REL)).href
);
const calls = [];
const transport = async (url, init) => {
  calls.push({ url, init });
  return new Response(
    JSON.stringify({
      id: "probe",
      model: "deepseek-flash",
      choices: [{ finish_reason: "stop", message: { content: "probe-ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
const probe = createWebsiteFactoryLLM("llm-wiring-probe", {
  env: { DEEPSEEK_API_KEY: "probe-key" },
  transport,
});
const content = await probe.generateContent("probe");
const host = calls[0] ? new URL(calls[0].url).host : "none";
if (calls.length !== 1 || host !== DEEPSEEK_HOST || content !== "probe-ok") {
  violations.push(
    `behavioral probe: expected one call to ${DEEPSEEK_HOST}, saw ${calls.length} to ${host}`,
  );
}
const retiredOnly = createWebsiteFactoryLLM("llm-wiring-probe", {
  env: { OPENROUTER_API_KEY: "x", PERPLEXITY_API_KEY: "y" },
  transport,
});
const before = calls.length;
let refused = false;
try {
  await retiredOnly.generateContent("probe");
} catch {
  refused = true;
}
if (!refused || calls.length !== before) {
  violations.push("behavioral probe: retired credentials alone must fail before any dispatch");
}

if (violations.length) {
  throw new Error(`LLM wiring regression detected:\n- ${violations.join("\n- ")}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      adapter: ADAPTER_REL,
      text_reasoning_provider: "deepseek",
      endpoint_host: host,
      image_provider_adapter: IMAGE_ADAPTER_REL,
      retired_paths_present: false,
      stub_present: false,
    },
    null,
    2,
  ),
);
