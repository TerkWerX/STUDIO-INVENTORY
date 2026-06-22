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

    await navTo(page, 'studio-setup', '[data-studio-tab="racks"]');
    await page.click('[data-studio-tab="racks"]');
    await page.waitForSelector('#new-rack-form', { timeout: 10000 });
    await navTo(page, 'studio-setup', '[data-studio-tab="floorplans"]');
    await page.click('[data-studio-tab="floorplans"]');
    await page.waitForSelector('#floorplan-select', { timeout: 10000 });
    console.log('✓ studio setup floorplans tab');

    await page.click('[data-studio-tab="rooms"]');
    await page.waitForSelector('#new-room-form', { timeout: 10000 });
    await page.fill('#room-name', 'Browser Smoke Room');
    await page.click('#new-room-form button[type="submit"]');
    await page.waitForSelector('.floorplan-draw-wrap', { timeout: 15000 });
    await page.click('[data-studio-tab="rooms"]');
    await page.waitForSelector('[data-action="room-floorplan"]', { timeout: 10000 });
    await page.locator('[data-action="room-floorplan"]').first().click();
    await page.waitForSelector('.floorplan-draw-wrap', { timeout: 15000 });
    const errState = await page.locator('.empty-state h3').textContent().catch(() => '');
    assert(!String(errState).includes('Error'), `room setup editor failed: ${errState}`);
    console.log('✓ studio setup edit room');

    const fpId = await page.evaluate(async () => {
      const fps = await fetch('/api/floorplans').then(r => r.json());
      const fp = fps[fps.length - 1];
      if (!fp) return null;
      await fetch(`/api/floorplans/${fp.id}/geometry`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }],
          bounds_width: 12,
          bounds_depth: 12,
          ceiling_height: 9
        })
      });
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
      const form = new FormData();
      form.append('image', new Blob([png], { type: 'image/png' }), 'wall.png');
      await fetch(`/api/floorplans/${fp.id}/walls/0/photo`, { method: 'POST', body: form });
      await fetch(`/api/floorplans/${fp.id}/walls/0/calibration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.12 }, { x: 0.88, y: 0.9 }, { x: 0.12, y: 0.88 }],
          lens_k: 0,
          calibrated: true
        })
      });
      return fp.id;
    });
    assert(fpId, 'floorplan id for studio view wall test');

    await navTo(page, 'studio-view', '.studio-browse');
    await page.selectOption('#studio-browse-room', String(fpId));
    await page.waitForSelector(`[data-studio-browse-fp="${fpId}"]`, { timeout: 10000 });
    await page.click('[data-studio-wall="0"]');
    await page.waitForSelector('#wall-elevation-overlay:not(.hidden)', { timeout: 20000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('.we-wall-bg-underlay, .we-wall-bg-warped');
      return img && img.complete && img.naturalWidth > 0
        && (img.src.startsWith('data:image') || img.src.includes('/uploads/'));
    }, { timeout: 20000 });
    console.log('✓ studio view wall elevation displays');
    await page.click('#wall-elevation-overlay .wall-elevation-close');
    await page.waitForFunction(
      () => document.getElementById('wall-elevation-overlay')?.classList.contains('hidden'),
      { timeout: 5000 }
    );

    await navTo(page, 'scan', '#scan-wedge-input');
    await page.fill('#scan-wedge-input', 'SM57-88421');
    await page.click('#scan-wedge-go');
    await page.waitForSelector('.scan-result-found', { timeout: 15000 });
    console.log('✓ scan lookup');

    await navTo(page, 'software', '.page-title');
    assert((await page.textContent('.page-title')).includes('Software'), 'software page title wrong');
    await page.click('[data-nav="software-form"]');
    await page.waitForSelector('#software-form', { timeout: 10000 });
    await page.fill('#sw-name', 'Browser Test Plugin');
    await page.fill('#sw-publisher', 'Smoke Test Audio');
    await page.selectOption('#sw-category', 'Plugin');
    await page.fill('#sw-license-key', 'BROWSER-TEST-KEY');
    await page.click('#software-form button[type="submit"]');
    await page.waitForSelector('.sw-detail-title', { timeout: 15000 });
    assert((await page.textContent('.sw-detail-title')).includes('Browser Test Plugin'), 'software detail failed');
    console.log('✓ software catalog');

    await navTo(page, 'manuals', '#manual-fts-search');
    assert(await page.locator('#manual-search').count() === 1, 'manual list search missing');
    assert(await page.locator('.manual-finder-card').count() === 1, 'manual finder card missing');
    assert(await page.locator('.manual-inbox-panel').count() === 1, 'manual inbox panel missing');
    assert(await page.locator('.manual-finder-row [data-action="manual-web-search"]').count() > 0, 'manual online finder buttons missing');
    assert(await page.locator('.manual-finder-row [data-action="manual-inbox-import"]').count() > 0, 'manual inbox import buttons missing');
    assert(await page.locator('.manual-finder-row [data-action="archive-manual-url"]').count() > 0, 'manual archive URL buttons missing');
    console.log('✓ manuals');

    await navTo(page, 'backup', '#guest-enabled');
    assert(await page.locator('#guest-url').count() === 1, 'guest URL input missing');
    assert(await page.locator('#backup-export-full').count() === 1, 'full backup export button missing');
    assert(await page.locator('#import-full-backup-file').count() === 1, 'full backup restore input missing');
    assert(await page.locator('#owner-pin-set').count() === 1, 'owner PIN control missing');
    console.log('✓ backup / guest settings');

    await navTo(page, 'item-form', '#item-form');
    assert(await page.locator('#depreciated_value').count() === 1, 'depreciated field missing on form');
    assert(await page.locator('#parent_item_id').count() === 1, 'parent item field missing');
    assert(await page.locator('#on_insurance_policy').count() === 1, 'insurance flag missing');
    assert(await page.locator('#label-scan-file').count() === 1, 'label scan input missing');
    assert(await page.locator('#requires_power').count() === 1, 'requires power field missing');
    assert(await page.locator('#power_adapter_voltage').count() === 1, 'adapter voltage field missing');
    console.log('✓ item form extended fields');

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
