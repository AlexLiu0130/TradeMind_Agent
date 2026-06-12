// Re-captures docs/demo assets (screenshots + walkthrough video) headlessly via
// Playwright — no macOS screen-recording permission needed. Run from dashboard/:
//   node ../scripts/capture_demo_assets.mjs
// Requires the dev server at http://localhost:3000 with API caches warmed.
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "dashboard/package.json"));
const { chromium } = require("playwright");
const OUT = path.join(ROOT, "docs/demo/screenshots");
const VIDEO_DIR = path.join(ROOT, "docs/demo/.video_tmp");
const BASE = process.env.TRADEMIND_DEMO_URL || "http://localhost:3000";
const VIEWPORT = { width: 1680, height: 1050 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function smoothScroll(page, toY, steps = 30, stepMs = 50) {
  const fromY = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps;
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await sleep(stepMs);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
});
const page = await ctx.newPage();

// 1. Portfolio cockpit — wait for live data + event timeline, screenshot top, then scroll tour.
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page
  .waitForSelector("text=即将到来", { timeout: 150_000 })
  .catch(() => console.warn("event timeline still loading; shooting anyway"));
await sleep(3000);
await page.screenshot({ path: path.join(OUT, "01-portfolio.jpg"), quality: 88, type: "jpeg" });
console.log("shot 01-portfolio");
const trends = page.locator("text=Market Trends").first();
await trends.scrollIntoViewIfNeeded().catch(() => {});
await page.evaluate(() => window.scrollBy(0, -80));
await sleep(2000);
await page.screenshot({ path: path.join(OUT, "05-cockpit-greeks-events.jpg"), quality: 88, type: "jpeg" });
console.log("shot 05-cockpit-greeks-events");
await smoothScroll(page, await page.evaluate(() => window.scrollY + 1200));
await sleep(1500);
await smoothScroll(page, 0, 20, 40);
await sleep(800);

// 2. Wheel
await page.goto(`${BASE}/wheel`, { waitUntil: "load", timeout: 60000 });
await sleep(4000);
await page.screenshot({ path: path.join(OUT, "02-wheel.jpg"), quality: 88, type: "jpeg" });
console.log("shot 02-wheel");
await smoothScroll(page, 600);
await sleep(1200);

// 3. Intel / Serenity archive
await page.goto(`${BASE}/intel`, { waitUntil: "load", timeout: 60000 });
await sleep(4000);
await page.screenshot({ path: path.join(OUT, "03-intel.jpg"), quality: 88, type: "jpeg" });
console.log("shot 03-intel");
await smoothScroll(page, 900);
await sleep(1500);

// 4. Showcase
await page.goto(`${BASE}/showcase`, { waitUntil: "load", timeout: 60000 });
await sleep(3500);
await page.screenshot({ path: path.join(OUT, "04-showcase.jpg"), quality: 88, type: "jpeg" });
console.log("shot 04-showcase");
await smoothScroll(page, 1200);
await sleep(1500);

const video = page.video();
await ctx.close();
const videoPath = await video.path();
console.log("video:", videoPath);
await browser.close();
