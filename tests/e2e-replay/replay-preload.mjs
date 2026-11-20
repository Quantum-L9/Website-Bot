// L9_META: layer=test, role=e2e_replay_network_preload, status=active, version=1.0.0
//
// Loaded with `node --import` into the pipeline process by
// tests/e2e-replay/pipeline-replay.test.ts. It replaces globalThis.fetch so the
// two provider transports that go through it — the DeepSeek adapter
// (src/services/llm.ts) and the Gemini image generator — are answered from
// committed fixtures, and so that every other host is refused. Loopback stays
// real: the SEO-Bot replay server listens there, and the npm-undici heavy
// transport reaches it over a genuine socket.
//
// Competitor ("donor") sites live under the reserved `.example` TLD (RFC 2606)
// in the replayed landscape. Their pages are served from one committed HTML
// fixture both to fetch() and to Playwright, whose `chromium.launch` is wrapped
// so every page it opens routes `.example` to the fixture, lets loopback
// through, and aborts anything else.
//
// A request no fixture matches is a test failure, never a silent pass-through.
// Every request is appended to REPLAY_LOG so the test can assert what crossed
// the boundary.

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const fixturesDir = process.env.REPLAY_FIXTURES_DIR;
const logPath = process.env.REPLAY_LOG;
if (!fixturesDir || !logPath) {
  throw new Error("replay-preload requires REPLAY_FIXTURES_DIR and REPLAY_LOG");
}

const DEEPSEEK_HOST = "api.deepseek.com";
const GEMINI_HOST = "generativelanguage.googleapis.com";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loadFixtures(kind) {
  const dir = join(fixturesDir, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(dir, name), "utf-8")) }));
}

const DONOR_TLD = ".example";
const donorPage = readFileSync(join(fixturesDir, "web", "donor-page.html"), "utf-8");
const deepseek = loadFixtures("deepseek");
const gemini = loadFixtures("gemini");
const realFetch = globalThis.fetch.bind(globalThis);

function record(entry) {
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function bodyText(input, init) {
  if (init?.body !== undefined && init.body !== null) {
    return typeof init.body === "string" ? init.body : Buffer.from(init.body).toString("utf-8");
  }
  if (input instanceof Request) return input.clone().text();
  return "";
}

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(content);
}

function promptOf(body) {
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed.messages)) {
      return parsed.messages.map((message) => textOfContent(message.content)).join("\n");
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/** First fixture whose every `match` substring occurs in the prompt. */
function select(fixtures, prompt) {
  return fixtures.find((fixture) => fixture.match.every((needle) => prompt.includes(needle)));
}

/**
 * DeepSeek fixtures keep `message.content` as a JSON object so they stay
 * reviewable; the wire carries it as the string the provider returns.
 */
function materialize(response) {
  if (!Array.isArray(response?.choices)) return response;
  return {
    ...response,
    choices: response.choices.map((choice) =>
      typeof choice.message?.content === "string"
        ? choice
        : {
            ...choice,
            message: { ...choice.message, content: JSON.stringify(choice.message.content) },
          },
    ),
  };
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = async function replayFetch(input, init) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (LOOPBACK.has(url.hostname)) return realFetch(input, init);
  if (url.hostname.endsWith(DONOR_TLD)) {
    record({
      kind: "replayed",
      host: url.hostname,
      path: url.pathname,
      fixture: "web/donor-page.html",
    });
    return new Response(donorPage, { status: 200, headers: { "content-type": "text/html" } });
  }

  const body = await bodyText(input, init);
  const prompt = promptOf(body);
  const fixtures =
    url.hostname === DEEPSEEK_HOST ? deepseek : url.hostname === GEMINI_HOST ? gemini : undefined;
  if (!fixtures) {
    record({ kind: "denied", host: url.hostname, path: url.pathname });
    throw new TypeError(`replay: network access to ${url.hostname} is denied`);
  }
  const fixture = select(fixtures, prompt);
  if (!fixture) {
    record({ kind: "unmatched", host: url.hostname, path: url.pathname, prompt });
    return json(599, {
      error: { message: `replay: no fixture matches this ${url.hostname} request` },
    });
  }
  record({ kind: "replayed", host: url.hostname, path: url.pathname, fixture: fixture.name });
  return json(fixture.status ?? 200, materialize(fixture.response));
};

// Playwright: route every page of every browser this process launches.
async function routeBrowserTraffic(route) {
  const url = new URL(route.request().url());
  if (url.protocol === "data:" || url.protocol === "blob:" || LOOPBACK.has(url.hostname)) {
    return route.continue();
  }
  if (url.hostname.endsWith(DONOR_TLD)) {
    record({
      kind: "replayed",
      host: url.hostname,
      path: url.pathname,
      fixture: "web/donor-page.html",
      via: "browser",
    });
    return route.fulfill({ status: 200, contentType: "text/html", body: donorPage });
  }
  record({ kind: "denied", host: url.hostname, path: url.pathname, via: "browser" });
  return route.abort("blockedbyclient");
}

const { chromium } = await import("playwright");
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...contextArgs) => {
    const context = await newContext(...contextArgs);
    await context.route("**/*", routeBrowserTraffic);
    return context;
  };
  browser.newPage = async (...pageArgs) => {
    const context = await browser.newContext(...pageArgs);
    const page = await context.newPage();
    // Browser.newPage owns its context; close it with the page.
    page.once("close", () => void context.close().catch(() => {}));
    return page;
  };
  return browser;
};
