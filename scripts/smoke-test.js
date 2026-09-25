/**
 * CI smoke test: syntax checks, seed, server health endpoint.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || 3848;
const DATA_DIR = path.join(ROOT, 'data', '.smoke-test');
const DB_PATH = path.join(DATA_DIR, 'inventory.db');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function syntaxCheck(file) {
  require('child_process').execSync(`node --check "${file}"`, { cwd: ROOT, stdio: 'inherit' });
}

async function waitForHealth(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) return data;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Health check failed: ${url}`);
}

async function main() {
  console.log('Syntax checks...');
  for (const file of ['server.js', 'db.js', 'seed.js']) {
    syntaxCheck(path.join(ROOT, file));
  }

  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const testEnv = { ...process.env, PORT: String(PORT), STUDIO_DATA_DIR: DATA_DIR };

  console.log('Seeding sample data...');
  await run('node', ['seed.js', '--force'], { env: testEnv });

  console.log(`Starting server on port ${PORT}...`);
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: testEnv,
    stdio: 'ignore'
  });

  try {
    const health = await waitForHealth(`http://127.0.0.1:${PORT}/api/health`);
    if (!health.version) throw new Error('Health API missing version');
    console.log('Health OK:', health);

    const brands = await fetch(`http://127.0.0.1:${PORT}/api/brands`).then(r => r.json());
    if (!Array.isArray(brands) || brands.length === 0) throw new Error('Brands API returned empty');
    console.log(`Brands API OK: ${brands.length} brands`);

    const items = await fetch(`http://127.0.0.1:${PORT}/api/items`).then(r => r.json());
    if (!Array.isArray(items) || items.length === 0) throw new Error('Items API returned empty');
    console.log(`Items API OK: ${items.length} items`);

    const itemId = items[0].id;
    const checkout = await fetch(`http://127.0.0.1:${PORT}/api/items/${itemId}/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrower_name: 'Smoke Test', due_date: '2099-01-01' })
    }).then(r => r.json());
    if (!checkout.loan?.id) throw new Error(`Loan checkout failed: ${checkout.error || 'unknown'}`);

    const returned = await fetch(`http://127.0.0.1:${PORT}/api/loans/${checkout.loan.id}/return`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(r => r.json());
    if (!returned.loan?.returned_at) throw new Error(`Loan return failed: ${returned.error || 'unknown'}`);
    console.log('Loans API OK: checkout + return');

    // CSV export must survive line breaks, quotes and formula-like text, and
    // re-import to the same values.
    const base = `http://127.0.0.1:${PORT}/api`;
    const tricky = {
      name: 'CSV Probe, "the tricky one"',
      brand: 'Röde',
      category: 'Microphone',
      serial_number: '=HYPERLINK("http://example.invalid","click")',
      description: 'Bought used.\nLeft channel crackles; recapped 2025.\n- keep the original caps',
      replacement_value: 450
    };
    const createdProbe = await fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tricky)
    }).then(r => r.json());
    if (!createdProbe.id) throw new Error(`CSV probe item was not created: ${createdProbe.error || 'unknown'}`);
    const csv = await fetch(`${base}/export/csv?q=${encodeURIComponent('CSV Probe')}`).then(r => r.text());
    const { parseCsv } = require('../lib/csv-import');
    const parsed = parseCsv(csv).rows;
    if (parsed.length !== 1) throw new Error(`CSV export produced ${parsed.length} rows for 1 item`);
    for (const field of ['name', 'brand', 'serial_number', 'description']) {
      if (parsed[0][field] !== tricky[field]) {
        throw new Error(`CSV export changed ${field}: ${JSON.stringify(parsed[0][field])}`);
      }
    }
    if (!csv.includes("'=HYPERLINK") || /(^|,)"?=HYPERLINK/m.test(csv)) {
      throw new Error('CSV export left a formula live for spreadsheets');
    }
    const reimport = await fetch(`${base}/import/csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv
    }).then(r => r.json());
    if (reimport.imported !== 1) throw new Error(`CSV re-import imported ${reimport.imported} rows`);
    const copies = await fetch(`${base}/items?q=${encodeURIComponent('CSV Probe')}`).then(r => r.json());
    if (copies.length !== 2 || copies.some(item => item.description !== tricky.description || item.serial_number !== tricky.serial_number)) {
      throw new Error('CSV round trip did not reproduce the item');
    }
    console.log('CSV OK: multi-line, quoted and formula-like values round-trip');

    // Full backup ZIP streams out and restores back.
    const backupRes = await fetch(`${base}/export/full`);
    if (!backupRes.ok) throw new Error(`Full backup download failed: ${backupRes.status}`);
    const backupBytes = Buffer.from(await backupRes.arrayBuffer());
    const zipPath = path.join(DATA_DIR, '..', '.smoke-test-backup.zip');
    fs.writeFileSync(zipPath, backupBytes);
    const { listZipEntries } = require('../lib/folder-backup');
    const names = await listZipEntries(zipPath);
    fs.unlinkSync(zipPath);
    if (!names.includes('backup.json') || !names.some(name => name.startsWith('uploads/'))) {
      throw new Error('Full backup ZIP is missing backup.json or uploads');
    }
    const form = new FormData();
    form.append('backup', new Blob([backupBytes], { type: 'application/zip' }), 'smoke-backup.zip');
    const restored = await fetch(`${base}/import/full`, { method: 'POST', body: form }).then(r => r.json());
    if (!restored.ok || restored.items !== items.length + 2) {
      throw new Error(`Full backup restore failed: ${restored.error || JSON.stringify(restored)}`);
    }
    console.log(`Backup OK: ${names.length} ZIP entries streamed and restored`);

    console.log('Smoke test passed.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 300));
    if (fs.existsSync(DATA_DIR)) {
      try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

main().catch(err => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});