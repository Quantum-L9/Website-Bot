import { spawn } from "node:child_process";
import { chromium } from "playwright";
const SITE_ROOT = new URL("../../build/sites/quantumaipartners_com/", import.meta.url).pathname;
const PORT = 4322;
const preview = spawn("npx", ["astro", "preview", "--port", String(PORT), "--host", "127.0.0.1"], { cwd: SITE_ROOT, stdio: "ignore" });
process.on("exit", () => { try { preview.kill("SIGTERM"); } catch {} });
// Loopback-only readiness probe against the local astro preview
// (127.0.0.1); no traffic leaves the machine.
// nosemgrep
for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Loopback-only navigation probe against the local astro preview
// (127.0.0.1); no traffic leaves the machine.
// nosemgrep
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
const probe = await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const h1 = document.querySelector("h1");
  const h1cs = h1 ? getComputedStyle(h1) : null;
  const hero = document.querySelector("section, [class*=hero], header") ?? document.body;
  const heroBg = getComputedStyle(hero).backgroundImage;
  const imgs = [...document.querySelectorAll("img")].map(i => ({ src: i.getAttribute("src"), alt: i.getAttribute("alt") }));
  const nav = [...document.querySelectorAll("nav a")].map(a => a.textContent.trim());
  return {
    bodyBackground: cs.backgroundColor,
    bodyColor: cs.color,
    fontFamily: cs.fontFamily.slice(0, 60),
    h1Text: h1?.textContent.trim().slice(0, 80),
    h1Font: h1cs?.fontFamily.slice(0, 60),
    h1Size: h1cs?.fontSize,
    h1Color: h1cs?.color,
    heroBackgroundImage: heroBg === "none" ? "none" : heroBg.slice(0, 90),
    heroBgColor: getComputedStyle(hero).backgroundColor,
    images: imgs.slice(0, 3),
    nav: nav,
    linkColor: getComputedStyle(document.querySelector("a") ?? document.body).color,
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
process.exit(0);
