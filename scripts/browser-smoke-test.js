/**
 * Playwright browser smoke test — key UI flows (v1.5 / v1.6).
 * Requires: npm install && npx playwright install chromium
 */
const playwrightBrowsers = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.BROWSER_SMOKE_PORT || 3853;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(ROOT, 'data', '.browser-smoke-test');
const KEY_DIR = path.join(ROOT, 'data', '.browser-smoke-keys');
const BROWSER_ENGINE = process.env.BROWSER_ENGINE || 'chromium';

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
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
  fs.mkdirSync(KEY_DIR, { recursive: true });

  const env = { ...process.env, PORT: String(PORT), STUDIO_DATA_DIR: DATA_DIR, STUDIO_KEY_DIR: KEY_DIR, STUDIO_SKIP_AUTO_BACKUP: '1' };
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
  const browserType = playwrightBrowsers[BROWSER_ENGINE];
  if (!browserType) throw new Error(`Unsupported BROWSER_ENGINE: ${BROWSER_ENGINE}`);
  const browser = await browserType.launch({ headless: true });
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
      const created = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Pin Test Mic',
          category: 'Microphone',
          location: fp.location,
          replacement_value: 10
        })
      }).then(r => r.json());
      await fetch(`/api/floorplans/${fp.id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ item_id: created.id, x_pct: 20, y_pct: 20, placement: 'floor', icon_mode: 'logo' }]
        })
      });
      return fp.id;
    });
    assert(fpId, 'floorplan id for studio view wall test');

    await navTo(page, 'studio-view', '.studio-browse');
    await page.selectOption('#studio-browse-room', String(fpId));
    await page.waitForSelector(`[data-studio-browse-fp="${fpId}"] .studio-browse-pin`, { timeout: 10000 });
    await page.evaluate(() => {
      const map = document.getElementById('studio-browse-map');
      map.style.width = '800px';
      map.style.height = '360px';
    });
    await page.waitForTimeout(80);
    const pinCheck = await page.evaluate(() => {
      const pin = document.querySelector('.studio-browse-pin');
      const poly = document.querySelector('.floorplan-room-fill');
      const pinBox = pin.getBoundingClientRect();
      const polyBox = poly.getBoundingClientRect();
      const cx = pinBox.left + pinBox.width / 2;
      const cy = pinBox.top + pinBox.height / 2;
      return {
        inside: cx >= polyBox.left && cx <= polyBox.right && cy >= polyBox.top && cy <= polyBox.bottom,
        cx, cy,
        polyLeft: polyBox.left, polyRight: polyBox.right, polyTop: polyBox.top, polyBottom: polyBox.bottom
      };
    });
    assert(pinCheck.inside, `studio pin landed outside the room (${JSON.stringify(pinCheck)})`);
    console.log('✓ studio view pin stays inside the room');
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

    await page.evaluate(async () => {
      const items = await fetch('/api/items').then(r => r.json());
      const item = items[0];
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
      const form = new FormData();
      form.append('files', new Blob([png], { type: 'image/png' }), 'insurance-photo.png');
      const response = await fetch(`/api/items/${item.id}/photos`, { method: 'POST', body: form });
      if (!response.ok) throw new Error(`insurance photo upload failed: ${response.status}`);
    });
    await navTo(page, 'insurance', '.insurance-item');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.insurance-photo'))
      .some(img => img.complete && img.naturalWidth > 0 && img.src.includes('/uploads/photos/')),
    { timeout: 15000 });
    console.log('✓ insurance report photos');

    await navTo(page, 'backup', '#guest-enabled');
    assert(await page.locator('#guest-url').count() === 1, 'guest URL input missing');
    assert(await page.locator('#backup-export-full').count() === 1, 'full backup export button missing');
    assert(await page.locator('#import-full-backup-file').count() === 1, 'full backup restore input missing');
    assert(await page.locator('#owner-pin-set').count() === 1, 'owner PIN control missing');
    console.log('✓ backup / guest settings');

    await navTo(page, 'item-form', '#item-form');
    assert(await page.locator('#depreciated_value').count() === 0, 'depreciated field should stay off the form');
    assert(await page.locator('#parent_item_id').count() === 1, 'parent item field missing');
    assert(await page.locator('#on_insurance_policy').count() === 1, 'insurance flag missing');
    assert(await page.locator('#label-scan-file').count() === 1, 'label scan input missing');
    assert(await page.locator('#requires_power').count() === 1, 'requires power field missing');
    assert(await page.locator('#power_adapter_voltage').count() === 1, 'adapter voltage field missing');
    assert(await page.locator('#instrument_type').count() === 1, 'smart item profile selector missing');
    await page.selectOption('#instrument_type', 'electronic_drum_kit');
    assert(await page.inputValue('#category') === 'Electronic Drum Kit', 'profile did not set electronic drum category');
    assert(await page.locator('#instrument-spec-kit_configuration').count() === 1, 'electronic drum configuration field missing');
    assert(await page.locator('#instrument-spec-module_count').count() === 1, 'electronic drum module field missing');
    assert((await page.textContent('#item-profile-editor')).includes('Trigger cable snake'), 'electronic drum accessory suggestions missing');
    await page.selectOption('#instrument_type', 'equipment_mount');
    assert(await page.locator('#instrument-spec-compatibility_status').count() === 1, 'mount compatibility field missing');
    assert(await page.locator('#instrument-spec-adapter_chain').count() === 1, 'mount adapter chain field missing');
    console.log('✓ item form smart profiles');

    // Leaving a form with unsaved edits asks first; "Keep editing" stays put.
    await page.fill('#name', 'Unsaved draft');
    await page.click('.nav-btn[data-view="dashboard"]');
    await page.waitForSelector('#modal-overlay:not(.hidden)', { timeout: 5000 });
    assert((await page.textContent('#modal-title')).includes('Discard'), 'leaving a changed form did not warn');
    await page.click('#modal-cancel');
    assert(await page.locator('#item-form').count() === 1, 'Keep editing left the form');
    assert(await page.inputValue('#name') === 'Unsaved draft', 'the draft was lost');
    console.log('✓ unsaved form edits are protected');

    // A double click on "Add Item" saves one item, and Escape answers the follow-up questions.
    const doubleName = `Double click check ${Date.now()}`;
    await page.fill('#name', doubleName);
    await page.locator('#item-form button[type="submit"]').dblclick();
    await page.waitForSelector('#modal-overlay:not(.hidden)', { timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /cutout/i.test(document.getElementById('modal-title')?.textContent || '')
      && !document.getElementById('modal-overlay').classList.contains('hidden'), null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-action="edit-item"]', { timeout: 10000 });
    const saved = await page.evaluate(async (name) => (await fetch(`/api/items?q=${encodeURIComponent(name)}`).then(r => r.json())).length, doubleName);
    assert(saved === 1, `double click created ${saved} items`);
    console.log('✓ double-clicking save creates one item; Escape answers dialogs');

    // After editing an item, "Add Item" opens a blank form, not the edited item.
    await page.click('[data-action="edit-item"]');
    await page.waitForSelector('#item-form');
    assert(await page.inputValue('#item-id') !== '', 'edit form has no item id');
    await navTo(page, 'inventory', '#search-input');
    await page.fill('#search-input', 'zzzz-no-such-gear');
    await page.waitForSelector('#view-container [data-nav="item-form"]', { timeout: 10000 });
    await page.click('#view-container [data-nav="item-form"]');
    await page.waitForSelector('#item-form');
    assert(await page.inputValue('#item-id') === '', '"Add Item" opened the item edited before');
    console.log('✓ "Add Item" never reopens the last edited item');

    // Typing in the search box keeps focus and every character across re-renders.
    await navTo(page, 'inventory', '#search-input');
    await page.fill('#search-input', '');
    await page.waitForTimeout(700);
    await page.focus('#search-input');
    await page.keyboard.type('Fen', { delay: 40 });
    await page.waitForTimeout(900);
    await page.keyboard.type('der', { delay: 40 });
    await page.waitForTimeout(900);
    assert(await page.inputValue('#search-input') === 'Fender', `search box lost typing: "${await page.inputValue('#search-input')}"`);
    assert(await page.evaluate(() => document.activeElement?.id) === 'search-input', 'search box lost focus while typing');
    console.log('✓ search keeps focus and keystrokes');

    // A slow response for a page the user already left must not replace the current page.
    await page.route('**/api/items?*', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.continue().catch(() => {});
    });
    await page.click('.nav-btn[data-view="labels"]');
    await page.click('.nav-btn[data-view="dashboard"]');
    await page.waitForTimeout(2500);
    assert((await page.textContent('.page-title')).includes('Dashboard'), 'a late response replaced the page the user moved to');
    await page.unroute('**/api/items?*');
    console.log('✓ late responses never replace the current page');

    // Help & About shows the server log (the only place Windows users can see errors).
    await navTo(page, 'about', '#server-log-show');
    await page.click('#server-log-show');
    await page.waitForSelector('#server-log-lines:not(.hidden)', { timeout: 10000 });
    assert(/running at http:\/\/localhost/.test(await page.textContent('#server-log-lines')), 'the server log is not shown');
    assert(await page.isVisible('#server-log-open'), 'Open Log Folder should be offered on the studio computer');
    assert(await page.isVisible('#app-stop-server'), 'Stop Studio Inventory should be offered on the studio computer');
    console.log('✓ Help & About shows the server log');

    const stats = await page.evaluate(async () => {
      const r = await fetch('/api/stats');
      return r.json();
    });
    assert(typeof stats.activeLoanCount === 'number', 'stats missing activeLoanCount');
    console.log('✓ in-page API reachable');

    const firstItemId = await page.evaluate(async () => {
      const items = await fetch('/api/items?sort=name').then(r => r.json());
      return items[0]?.id;
    });
    assert(firstItemId, 'mobile test item missing');

    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-title', { timeout: 20000 });
    assert(await page.locator('#mobile-menu-toggle').isVisible(), 'phone menu button is not visible');
    assert(!(await page.locator('#main-navigation').isVisible()), 'phone navigation should start collapsed');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone layout overflows horizontally');
    await page.click('#mobile-menu-toggle');
    assert(await page.locator('#main-navigation').isVisible(), 'phone menu did not open');
    await page.click('.nav-btn[data-view="scan"]');
    await page.waitForSelector('#scan-photo-input', { state: 'attached' });
    assert(await page.getAttribute('#scan-photo-input', 'capture') === 'environment', 'scan photo input does not prefer rear camera');
    assert(!(await page.locator('#main-navigation').isVisible()), 'phone menu did not close after navigation');

    await page.goto(`${BASE}/photo-upload.html?id=${firstItemId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#upload-card:not(.hidden)', { timeout: 10000 });
    assert(await page.getAttribute('#camera-input', 'capture') === 'environment', 'phone photo upload does not prefer rear camera');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone upload layout overflows horizontally');

    await page.setViewportSize({ width: 800, height: 1280 });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-title', { timeout: 20000 });
    assert(await page.locator('#mobile-menu-toggle').isVisible(), 'portrait tablet should use compact navigation');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'portrait tablet layout overflows');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.page-title', { timeout: 20000 });
    assert(!(await page.locator('#mobile-menu-toggle').isVisible()), 'landscape tablet should use desktop navigation');
    assert(await page.locator('#main-navigation').isVisible(), 'landscape tablet navigation is hidden');
    console.log('✓ phone and tablet responsive layouts');

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
