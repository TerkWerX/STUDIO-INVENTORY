/**
 * Playwright browser smoke test — key UI flows (v1.5 / v1.6).
 * Requires: npm install && npx playwright install chromium
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.BROWSER_SMOKE_PORT || 3853;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(ROOT, 'data', '.browser-smoke-test');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForHealth(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) return data;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Health check failed: ${url}`);
}

async function seedAndStartServer() {
  if (fs.existsSync(DATA_DIR)) {
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* win lock */ }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const env = { ...process.env, PORT: String(PORT), STUDIO_DATA_DIR: DATA_DIR };
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['seed.js', '--force'], { cwd: ROOT, env, stdio: 'inherit' });
    seed.on('close', c => (c === 0 ? resolve() : reject(new Error('seed failed'))));
  });

  const server = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  await waitForHealth(`${BASE}/api/health`);
  return server;
}

async function navTo(page, view, readySelector) {
  await page.click(`.nav-btn[data-view="${view}"]`);
  await page.waitForSelector(readySelector, { timeout: 20000 });
}

async function main() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error('Playwright not installed — run: npm install && npx playwright install chromium');
  }

  const server = await seedAndStartServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('Browser smoke: loading app...');
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-title', { timeout: 20000 });
    const title = await page.textContent('.page-title');
    assert(title.includes('Dashboard'), `expected Dashboard, got "${title}"`);
    console.log('✓ dashboard');

    await navTo(page, 'inventory', '#search-input');
    const rows = await page.locator('tbody tr[data-action="view-item"]').count();
    assert(rows > 0, 'inventory table empty');
    assert(await page.locator('#filter-show-accessories').count() === 1, 'accessories toggle missing');
    console.log('✓ inventory');

    await page.locator('tbody tr[data-action="view-item"]').first().click();
    await page.waitForSelector('.loan-card', { timeout: 20000 });
    await page.waitForSelector('#loan-checkout-form');
    assert(await page.locator('#depreciated_value').count() === 0, 'depreciated on detail only in value trio');
    assert(await page.locator('.value-trio').count() === 1, 'value trio missing on detail');
    console.log('✓ item detail');

    await page.fill('#loan-borrower', 'Browser Test User');
    await page.fill('#loan-due', '2099-12-31');
    await page.fill('#loan-note', 'Playwright smoke test');
    await page.click('#loan-checkout-form button[type="submit"]');
    await page.waitForSelector('#loan-return-form', { timeout: 20000 });
    assert(await page.locator('.loan-status-out, .loan-status-overdue').count() >= 1, 'loan status pill missing');
    console.log('✓ loan checkout (UI)');

    await navTo(page, 'loans', '.page-title');
    assert((await page.textContent('.page-title')).includes('Loans'), 'loans page title wrong');
    assert(await page.locator('[data-action="return-loan"]').count() >= 1, 'active loan not on loans page');
    console.log('✓ loans page');

    await page.locator('[data-action="return-loan"]').first().click();
    await page.waitForSelector('#modal-overlay:not(.hidden) #modal-confirm', { timeout: 5000 });
    await page.click('#modal-confirm');
    await page.waitForFunction(() => {
      const num = document.querySelector('.loan-summary-grid .loan-summary-card .loan-summary-num');
      return num && num.textContent.trim() === '0';
    }, { timeout: 20000 });
    console.log('✓ loan return (UI)');

    await navTo(page, 'studio-view', '[data-studio-tab="racks"]');
    await page.click('[data-studio-tab="racks"]');
    await page.waitForSelector('#new-rack-form', { timeout: 10000 });
    await navTo(page, 'studio-view', '[data-studio-tab="floorplans"]');
    await page.click('[data-studio-tab="floorplans"]');
    await page.waitForSelector('#floorplan-select', { timeout: 10000 });
    console.log('✓ studio view floorplans tab');

    await navTo(page, 'scan', '#scan-wedge-input');
    await page.fill('#scan-wedge-input', 'SM57-88421');
    await page.click('#scan-wedge-go');
    await page.waitForSelector('.scan-result-found', { timeout: 15000 });
    console.log('✓ scan lookup');

    await navTo(page, 'manuals', '#manual-fts-search');
    assert(await page.locator('#manual-search').count() === 1, 'manual list search missing');
    console.log('✓ manuals');

    await navTo(page, 'backup', '#guest-enabled');
    assert(await page.locator('#guest-url').count() === 1, 'guest URL input missing');
    console.log('✓ backup / guest settings');

    await navTo(page, 'item-form', '#item-form');
    assert(await page.locator('#depreciated_value').count() === 1, 'depreciated field missing on form');
    assert(await page.locator('#parent_item_id').count() === 1, 'parent item field missing');
    assert(await page.locator('#on_insurance_policy').count() === 1, 'insurance flag missing');
    console.log('✓ item form (v1.5 fields)');

    const stats = await page.evaluate(async () => {
      const r = await fetch('/api/stats');
      return r.json();
    });
    assert(typeof stats.activeLoanCount === 'number', 'stats missing activeLoanCount');
    console.log('✓ in-page API reachable');

    console.log('\nBrowser smoke test passed.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch(err => {
  console.error('\nBrowser smoke test FAILED:', err.message);
  process.exit(1);
});