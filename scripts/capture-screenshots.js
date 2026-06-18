/**
 * Capture README screenshots (requires server running on PORT).
 * Usage: node scripts/capture-screenshots.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3847;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'images');

async function shot(page, file, setup) {
  if (setup) await setup(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  console.log('  saved', file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await shot(page, 'dashboard.png');

  await page.click('[data-nav="brands"]');
  await page.waitForSelector('.brand-grid', { timeout: 10000 });
  await shot(page, 'brands.png');

  await browser.close();
  console.log('Screenshots written to docs/images/');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});