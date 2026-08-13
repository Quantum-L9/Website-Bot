// L9_META: layer=test, role=page_extractor_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPage } from '../../src/ingestion/PageExtractor.js';

const HTML = `<!doctype html><html><head>
  <title>Acme Roofing — Home</title>
  <meta name="description" content="Trusted local roofers">
  <link rel="canonical" href="https://acme.example/">
  <link rel="stylesheet" href="/_astro/Base.css">
  <meta property="og:image" content="/social/card.jpg">
  <script type="application/ld+json">{"@type":"Organization","image":"https://acme.example/logo.png"}</script>
</head><body>
  <h1>Roofing done right</h1>
  <header>
    <a href="/services">Services</a>
    <a href="/gallery">Gallery</a>
    <a href="/about">About</a>
    <a href="/services/roof-repair">Roof Repair</a>
    <a href="tel:+17046487252">(704) 648-7252</a>
  </header>
  <picture><source srcset="/img/hero-800.webp 800w, /img/hero-1600.webp 1600w"></picture>
  <img src="/img/hero.jpg" srcset="/img/hero-2x.jpg 2x" alt="Roof crew" class="hero above">
  <div style="background-image: url('/img/bg.png')"></div>
  <h2>Services</h2>
  <img src="data:image/gif;base64,AAAA" alt="ignored data uri">
  <a href="/services">Services</a>
  <a href="https://external.test/x">External</a>
  <a href="#top">Anchor</a>
</body></html>`;

void test('extracts page metadata and headings', () => {
  const page = extractPage(HTML, 'https://acme.example/');
  assert.equal(page.title, 'Acme Roofing — Home');
  assert.equal(page.description, 'Trusted local roofers');
  assert.equal(page.canonicalUrl, 'https://acme.example/');
  assert.ok(page.stylesheets.includes('https://acme.example/_astro/Base.css'));
  assert.deepEqual(page.headings, ['Roofing done right', 'Services']);
});

void test('discovers images across src, srcset, picture, og, background, and JSON-LD', () => {
  const page = extractPage(HTML, 'https://acme.example/');
  const byOrigin = (origin: string) => page.images.filter(image => image.origin === origin).map(image => image.url);
  assert.ok(byOrigin('img').includes('https://acme.example/img/hero.jpg'));
  assert.ok(byOrigin('srcset').includes('https://acme.example/img/hero-2x.jpg'));
  assert.ok(byOrigin('picture').includes('https://acme.example/img/hero-1600.webp'));
  assert.ok(byOrigin('og').includes('https://acme.example/social/card.jpg'));
  assert.ok(byOrigin('background').includes('https://acme.example/img/bg.png'));
  assert.ok(byOrigin('structured-data').includes('https://acme.example/logo.png'));
  // data: URIs are never emitted as candidates
  assert.ok(!page.images.some(image => image.url.startsWith('data:')));
});

void test('captures placement context and resolves only same-doc links', () => {
  const page = extractPage(HTML, 'https://acme.example/');
  const hero = page.images.find(image => image.url.endsWith('/img/hero.jpg'));
  assert.equal(hero?.altText, 'Roof crew');
  assert.ok(hero?.cssClasses.includes('hero'));
  assert.equal(hero?.nearestHeading, 'Roofing done right');
  assert.ok(page.links.includes('https://acme.example/services'));
  assert.ok(page.links.includes('https://external.test/x'));
  assert.ok(!page.links.some(link => link.includes('#top')));
});

void test('extracts display phones and compact header nav from the live HTML', () => {
  const page = extractPage(HTML, 'https://acme.example/');
  assert.deepEqual(page.phones, ['(704) 648-7252']);
  assert.ok(page.nav.some(item => item.href === '/gallery' && item.label === 'Gallery'));
  assert.ok(page.nav.some(item => item.href === '/services/roof-repair'));
  assert.ok((page.bodyText?.length ?? 0) > 20);
});
