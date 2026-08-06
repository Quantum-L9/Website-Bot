// L9_META: layer=ingestion, role=screenshot_capturer, status=active, version=1.0.0
//
// Screenshot capture behind an interface so the crawler never hard-depends on a
// browser. The default is a no-op (CI and any environment without a browser);
// an optional Playwright-backed capturer loads lazily via a runtime specifier so
// its absence never breaks typecheck or a text-only build. Screenshots are only
// attempted when the spec sets captureScreenshots.

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

/**
 * Best-effort Playwright capturer. Loaded via a runtime specifier so that when
 * the `playwright` package is not installed, importing this module still works
 * and capture() degrades to undefined. Enabled only when the caller opts in.
 */
export class PlaywrightScreenshotCapturer implements ScreenshotCapturer {
  private browser: { newPage(): Promise<unknown>; close(): Promise<void> } | undefined;
  private available = true;

  async capture(request: ScreenshotRequest): Promise<string | undefined> {
    if (!this.available) return undefined;
    try {
      const browser = await this.ensureBrowser();
      if (!browser) return undefined;
      const page = (await browser.newPage()) as {
        goto(url: string, options?: unknown): Promise<unknown>;
        screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
        close(): Promise<void>;
      };
      await page.goto(request.url, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.screenshot({ path: request.outputPath, fullPage: false });
      await page.close();
      return request.outputPath;
    } catch {
      // A missing browser or navigation error must never fail the crawl.
      this.available = false;
      return undefined;
    }
  }

  private async ensureBrowser(): Promise<{ newPage(): Promise<unknown>; close(): Promise<void> } | undefined> {
    if (this.browser) return this.browser;
    const specifier = 'playwright';
    let mod: { chromium?: { launch(options?: unknown): Promise<unknown> } };
    try {
      mod = (await import(specifier)) as typeof mod;
    } catch {
      this.available = false;
      return undefined;
    }
    if (!mod.chromium) { this.available = false; return undefined; }
    this.browser = (await mod.chromium.launch({ headless: true })) as { newPage(): Promise<unknown>; close(): Promise<void> };
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }
}
