/**
 * Extended API smoke test — loans, studio view, guest, v1.5 fields.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || 3850;
const DATA_DIR = path.join(ROOT, 'data', '.api-smoke-test');

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

async function api(base, path, opts = {}) {
  const res = await fetch(`${base}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${body.error || res.statusText}`);
  return body;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
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
  const base = `http://127.0.0.1:${PORT}/api`;

  try {
    const health = await waitForHealth(`${base}/health`);
    assert(health.version, 'health missing version');
    console.log('✓ health', health.version);

    const created = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Loan Test Mic',
        category: 'Microphone',
        brand: 'Shure',
        model: 'SM57',
        replacement_value: 99,
        depreciated_value: 60,
        on_insurance_policy: true,
        insurance_policy_note: 'Rider A'
      })
    });
    assert(created.depreciated_value === 60, 'depreciated_value not saved');
    assert(created.on_insurance_policy === true, 'on_insurance_policy not saved');
    console.log('✓ item create with v1.5 fields');

    const parent = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Parent Amp', category: 'Amplifier', replacement_value: 1200 })
    });
    const accessory = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Amp Cover', category: 'Accessory', parent_item_id: parent.id, replacement_value: 40 })
    });
    assert(accessory.parent?.id === parent.id, 'parent link missing on accessory');
    const topOnly = await api(base, '/items');
    assert(!topOnly.some(i => i.id === accessory.id), 'accessory should be hidden by default');
    const withAcc = await api(base, '/items?include_accessories=1');
    assert(withAcc.some(i => i.id === accessory.id), 'include_accessories failed');
    console.log('✓ accessories / parent_item_id');

    const checkout = await api(base, `/items/${created.id}/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrower_name: 'Mike', due_date: '2026-12-31', note: 'Gig' })
    });
    assert(checkout.loan?.borrower_name === 'Mike', 'checkout failed');
    assert(checkout.item.studio_status === 'loaned', 'status not loaned after checkout');
    console.log('✓ loan checkout');

    const loans = await api(base, '/loans');
    assert(loans.active.length >= 1, 'active loans empty');
    console.log('✓ GET /loans');

    const stats = await api(base, '/stats');
    assert(stats.activeLoanCount >= 1, 'stats missing activeLoanCount');
    console.log('✓ stats includes loan counts');

    const returned = await api(base, `/loans/${checkout.loan.id}/return`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ return_note: 'All good' })
    });
    assert(returned.loan.returned_at, 'return failed');
    assert(returned.item.studio_status === 'in_studio', 'status not reset after return');
    console.log('✓ loan return');

    const rack = await api(base, '/racks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Rack', location: 'Control Room' })
    });
    await api(base, `/racks/${rack.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: parent.id, position: 0, slot_label: 'U1' }] })
    });
    const racks = await api(base, '/racks');
    assert(racks[0].items?.length === 1, 'rack items not saved');
    console.log('✓ racks');

    const chain = await api(base, '/signal-chains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Vocal Chain' })
    });
    await api(base, `/signal-chains/${chain.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: created.id, position: 0 }] })
    });
    const chains = await api(base, '/signal-chains');
    assert(chains[0].items?.length === 1, 'chain items not saved');
    console.log('✓ signal chains');

    const map = await api(base, '/studio/map');
    assert(Array.isArray(map.zones), 'studio map zones missing');
    console.log('✓ studio map');

    const guest = await api(base, '/settings/guest');
    assert(guest.guestToken, 'guest token missing');
    const guestOn = await api(base, '/settings/guest', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestEnabled: true })
    });
    const guestItems = await fetch(`http://127.0.0.1:${PORT}/api/guest/${guestOn.guestToken}/items`).then(r => r.json());
    assert(Array.isArray(guestItems), 'guest items failed');
    console.log('✓ guest link');

    const manualSearch = await api(base, '/manuals/search?q=test');
    assert(Array.isArray(manualSearch), 'manual search not array');
    console.log('✓ manual search endpoint');

    const enriched = await api(base, `/items/${created.id}`);
    assert(Array.isArray(enriched.loans), 'item.loans missing');
    assert(enriched.loans.some(l => l.borrower_name === 'Mike'), 'loan history on item missing');
    console.log('✓ enrichItem loans');

    const lookup = await api(base, '/lookup?code=SM57-88421');
    assert(lookup.item?.name, 'serial lookup failed');
    console.log('✓ barcode/serial lookup');

    const rackItems = await api(base, '/items?location=Main+Rack');
    assert(rackItems.length > 0, 'no Main Rack items in seed');
    const fp = await api(base, '/floorplans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Main Rack' })
    });
    assert(fp.id, 'floorplan create failed');
    await api(base, `/floorplans/${fp.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ item_id: rackItems[0].id, x_pct: 40, y_pct: 55 }] })
    });
    const fps = await api(base, '/floorplans');
    assert(fps.some(p => p.items?.length >= 1), 'floorplan items not saved');
    console.log('✓ floorplans');

    console.log('\nExtended API smoke test passed.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch(err => {
  console.error('\nExtended API smoke test FAILED:', err.message);
  process.exit(1);
});