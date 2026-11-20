// L9_META: layer=ingestion, role=screenshot_capturer, status=active, version=1.0.0
//
// Screenshot capture behind an interface so the crawler never hard-depends on a
// browser. The default is a no-op (CI and any environment without a browser);
// an optional Playwright-backed capturer loads lazily via a runtime specifier so
// its absence never breaks typecheck or a text-only build. Screenshots are only
// attempted when the spec sets captureScreenshots.

import { statSync } from "node:fs";

export interface ScreenshotRequest {
  url: string;
  outputPath: string;
}

export interface ScreenshotCapturer {
  capture(request: ScreenshotRequest): Promise<string | undefined>;
  close(): Promise<void>;
}

/** Records no screenshot; the manifest simply carries no screenshotPath. */
export class NoopScreenshotCapturer implements ScreenshotCapturer {
  async capture(): Promise<string | undefined> {
    return undefined;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

type BrowserPage = {
  goto(url: string, options?: unknown): Promise<unknown>;
  url(): string;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  close(): Promise<void>;
};

export function screenshotStaysOnHost(requestedUrl: string, finalUrl: string): boolean {
  try {
    return (
      new URL(finalUrl).hostname.replace(/\.$/, "").toLowerCase() ===
      new URL(requestedUrl).hostname.replace(/\.$/, "").toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Best-effort Playwright capturer. Loaded via a runtime specifier so that when
 * the `playwright` package is not installed, importing this module still works
 * and capture() degrades to undefined. Enabled only when the caller opts in.
 */
export class PlaywrightScreenshotCapturer implements ScreenshotCapturer {
  private browser: { newPage(): Promise<unknown>; close(): Promise<void> } | undefined;
  private available = true;

  constructor(private readonly openPage?: () => Promise<BrowserPage>) {}

  async capture(request: ScreenshotRequest): Promise<string | undefined> {
    if (!this.available) return undefined;
    let page: BrowserPage | undefined;
    try {
      page = this.openPage ? await this.openPage() : await this.openBrowserPage();
      if (!page) return undefined;
      await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (!screenshotStaysOnHost(request.url, page.url())) return undefined;
      await page.screenshot({ path: request.outputPath, fullPage: false });
      const info = statSync(request.outputPath, { throwIfNoEntry: false });
      if (!info?.isFile() || info.size === 0) return undefined;
      return request.outputPath;
    } catch {
      // A missing browser or navigation error must never fail the crawl.
      // Keep the capturer available so a later page can still succeed.
      return undefined;
    } finally {
      await page?.close().catch(() => {});
    }
  }

  private async openBrowserPage(): Promise<BrowserPage | undefined> {
    const browser = await this.ensureBrowser();
    if (!browser) return undefined;
    return (await browser.newPage()) as BrowserPage;
  }

  private async ensureBrowser(): Promise<
    { newPage(): Promise<unknown>; close(): Promise<void> } | undefined
  > {
    if (this.browser) return this.browser;
    const specifier = "playwright";
    let mod: { chromium?: { launch(options?: unknown): Promise<unknown> } };
    try {
      mod = (await import(specifier)) as typeof mod;
    } catch {
      this.available = false;
      return undefined;
    }
    if (!mod.chromium) {
      this.available = false;
      return undefined;
    }
    this.browser = (await mod.chromium.launch({ headless: true })) as {
      newPage(): Promise<unknown>;
      close(): Promise<void>;
    };
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }
}
