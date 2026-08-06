// L9_META: layer=test, role=source_crawler_integration, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceCrawler } from '../../../src/ingestion/SourceCrawler.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
function pngWith(width: number, height: number): Buffer {
  const buffer = Buffer.from(PNG_1x1);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const HOME = `<!doctype html><html><head><title>Home</title>
  <meta name="description" content="home page"></head><body>
  <h1>Welcome</h1>
  <img src="/img/hero.png" alt="Hero banner">
  <img src="/img/pixel.png" alt="tracking pixel">
  <a href="/services">Services</a>
  <a href="https://external.test/somewhere">External</a>
</body></html>`;

const SERVICES = `<!doctype html><html><head><title>Services</title></head><body>
  <h1>Services</h1><img src="/img/service.png" alt="A service"></body></html>`;

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const html = (body: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
    const png = (buffer: Buffer) => { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(buffer.byteLength) }); res.end(buffer); };
    if (path === '/' || path === '/index.html') return html(HOME);
    if (path === '/services') return html(SERVICES);
    if (path === '/img/hero.png') return png(pngWith(1920, 1080));
    if (path === '/img/service.png') return png(pngWith(1200, 800));
    if (path === '/img/pixel.png') return png(pngWith(1, 1));
    res.writeHead(404); res.end('not found');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

void test('crawls a fixture site, extracts pages, and downloads acceptable images', async () => {
  const server = await startServer();
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const outputDir = mkdtempSync(join(tmpdir(), 'wb-crawl-'));

  try {
    const manifest = await new SourceCrawler({
      seedUrl: `${base}/`,
      allowPrivateHosts: true,
      downloadImages: true,
      maxDepth: 1,
      maxPages: 5,
      outputDir,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    }).crawl();

    // Two same-site pages crawled; the external link is out of scope.
    assert.equal(manifest.pages.length, 2);
    assert.ok(manifest.pages.some(page => page.url.endsWith('/services')));

    // Hero + service accepted; the 1x1 pixel rejected for min dimensions.
    assert.equal(manifest.images.length, 2);
    const hero = manifest.images.find(image => image.sourceUrl.endsWith('/img/hero.png'));
    assert.equal(hero?.width, 1920);
    assert.equal(hero?.altText, 'Hero banner');
    assert.equal(hero?.provenance, 'source-site');
    assert.ok(existsSync(hero?.localPath ?? ''), 'downloaded image is written to disk');
    assert.ok(manifest.rejected.some(entry => entry.sourceUrl.endsWith('/img/pixel.png') && /dimension/i.test(entry.reason)));

    assert.equal(manifest.crawledAt, '2026-07-20T00:00:00.000Z');
    assert.equal(manifest.schema, 'website-bot.source-site-manifest/v1');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(outputDir, { recursive: true, force: true });
  }
});

void test('a forbidden (loopback) seed is blocked by the SSRF gate — no pages crawled', async () => {
  // allowPrivateHosts is NOT set, so the loopback host is rejected by the policy;
  // the crawl yields no pages and records the block as a warning.
  const manifest = await new SourceCrawler({ seedUrl: 'http://127.0.0.1:9/', downloadImages: false }).crawl();
  assert.equal(manifest.pages.length, 0);
  assert.ok(manifest.warnings.some(warning => /127\.0\.0\.1/.test(warning)));
});
