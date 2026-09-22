/**
 * Extended API smoke test — loans, studio view, guest, v1.5 fields.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

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

  const { writeZipAtomically, rotateBackupFiles, backupDiskWarning, validateBackupDir } = require('../lib/folder-backup');
  const atomicDir = path.join(DATA_DIR, 'atomic-check');
  fs.mkdirSync(atomicDir, { recursive: true });
  const AdmZipLocal = require('adm-zip');
  const goodZip = new AdmZipLocal();
  goodZip.addFile('keep.txt', Buffer.from('keep'));
  const goodPath = path.join(atomicDir, 'studio-inventory-full-backup-good.zip');
  writeZipAtomically(goodZip, goodPath);
  const badZip = new AdmZipLocal();
  badZip.addFile('bad.txt', Buffer.from('bad'));
  let atomicFailed = false;
  try {
    writeZipAtomically(badZip, path.join(atomicDir, 'studio-inventory-full-backup-bad.zip'), { failAfterPartial: true });
  } catch {
    atomicFailed = true;
  }
  assert(atomicFailed, 'partial backup write should fail');
  assert(fs.existsSync(goodPath), 'failed write removed the previous backup');
  assert(!fs.readdirSync(atomicDir).some(name => name.endsWith('.partial')), 'partial backup file was left behind');
  fs.writeFileSync(path.join(atomicDir, 'studio-inventory-full-backup-older.zip'), 'old');
  fs.writeFileSync(path.join(atomicDir, 'studio-inventory-full-backup-newer.zip'), 'new');
  fs.writeFileSync(path.join(atomicDir, 'studio-inventory-recovery.zip'), 'recovery');
  fs.writeFileSync(path.join(atomicDir, 'studio-inventory-full-backup-2020-01-monthly.zip.enc'), 'old-month');
  const rotated = rotateBackupFiles(atomicDir, 2);
  assert(rotated.length === 2, 'backup rotation did not keep the newest files');
  assert(!rotated.includes('studio-inventory-full-backup-good.zip'), 'rotation removed a newer backup');
  assert(fs.existsSync(path.join(atomicDir, 'studio-inventory-recovery.zip')), 'rotation deleted the recovery ZIP');
  assert(fs.existsSync(path.join(atomicDir, 'studio-inventory-full-backup-2020-01-monthly.zip.enc')), 'rotation deleted a monthly backup');
  const { pruneMonthlyBackups } = require('../lib/folder-backup');
  pruneMonthlyBackups(atomicDir, 6, new Date('2026-09-22T00:00:00Z'));
  assert(!fs.existsSync(path.join(atomicDir, 'studio-inventory-full-backup-2020-01-monthly.zip.enc')), 'monthly backup older than six months was kept');
  const sameDiskDir = path.join(ROOT, 'data', '.api-smoke-same-disk');
  fs.mkdirSync(sameDiskDir, { recursive: true });
  validateBackupDir(sameDiskDir, DATA_DIR);
  const diskWarning = backupDiskWarning(sameDiskDir, DATA_DIR);
  assert(/same physical disk/i.test(diskWarning), `same-disk folder was not warned: ${diskWarning}`);
  assert(/offsite/i.test(diskWarning), 'backup warning did not mention an offsite copy');
  assert(/USB thumb drive/i.test(diskWarning), 'backup warning did not allow a USB thumb drive');
  console.log('✓ folder backup atomic write');

  const KEY_DIR = path.join(ROOT, 'data', '.api-smoke-keys');
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
  fs.mkdirSync(KEY_DIR, { recursive: true });
  process.env.STUDIO_KEY_DIR = KEY_DIR;
  const PlainDatabase = require('better-sqlite3');
  const { openInventoryDatabase, isPlainSqlite } = require('../lib/open-database');
  const migrateDir = path.join(ROOT, 'data', '.api-smoke-migrate');
  fs.rmSync(migrateDir, { recursive: true, force: true });
  fs.mkdirSync(migrateDir, { recursive: true });
  const migrateFile = path.join(migrateDir, 'inventory.db');
  const plain = new PlainDatabase(migrateFile);
  plain.exec('CREATE TABLE kept (name TEXT)');
  plain.prepare('INSERT INTO kept VALUES (?)').run('Kept Guitar');
  plain.close();
  const unarmed = openInventoryDatabase(migrateFile);
  assert(unarmed.prepare('SELECT name FROM kept').get().name === 'Kept Guitar', 'unarmed open lost the row');
  unarmed.close();
  assert(isPlainSqlite(migrateFile), 'unarmed catalog was encrypted');
  fs.writeFileSync(path.join(migrateDir, 'studio-settings.json'), JSON.stringify({ catalogEncryption: 'armed' }));
  const migrated = openInventoryDatabase(migrateFile);
  assert(migrated.prepare('SELECT name FROM kept').get().name === 'Kept Guitar', 'encryption migration lost the row');
  migrated.close();
  assert(!isPlainSqlite(migrateFile), 'migrated catalog is still a plain SQLite file');
  assert(!fs.existsSync(`${migrateFile}.plain`), 'plaintext catalog was left beside the encrypted file');
  fs.copyFileSync(migrateFile, path.join(ROOT, 'data', '.api-smoke-copied.db'));
  fs.rmSync(migrateDir, { recursive: true, force: true });
  const savedKeyDir = process.env.STUDIO_KEY_DIR;
  process.env.STUDIO_KEY_DIR = path.join(ROOT, 'data', '.api-smoke-nokey');
  fs.mkdirSync(process.env.STUDIO_KEY_DIR, { recursive: true });
  let refused = false;
  try {
    openInventoryDatabase(path.join(ROOT, 'data', '.api-smoke-copied.db'));
  } catch (err) {
    refused = /key/i.test(err.message);
  }
  assert(refused, 'copied database opened without its catalog key');
  assert(!isPlainSqlite(path.join(ROOT, 'data', '.api-smoke-copied.db')), 'failed unlock rewrote the copied database');
  const { openWithSuppliedKey } = require('../lib/open-database');
  const { getDataKey, installRecoveryKey } = require('../lib/data-key');
  const { assertPlainRecoveryZip } = require('../lib/move-catalog');
  process.env.STUDIO_KEY_DIR = savedKeyDir;
  const paperKey = getDataKey().toString('base64');
  const moveKeyDir = path.join(ROOT, 'data', '.api-smoke-move-keys');
  fs.rmSync(moveKeyDir, { recursive: true, force: true });
  fs.mkdirSync(moveKeyDir, { recursive: true });
  const copiedDb = path.join(ROOT, 'data', '.api-smoke-copied.db');
  process.env.STUDIO_KEY_DIR = moveKeyDir;
  let lockedCode = '';
  try { openInventoryDatabase(copiedDb); } catch (err) { lockedCode = err.code || ''; }
  assert(lockedCode === 'CATALOG_LOCKED', 'a new machine did not stop for the recovery key');
  let wrongRejected = false;
  try { openWithSuppliedKey(copiedDb, Buffer.alloc(32).toString('base64')); } catch { wrongRejected = true; }
  assert(wrongRejected, 'wrong recovery key opened the catalog');
  assert(!fs.existsSync(path.join(moveKeyDir, 'catalog-key.blob')), 'wrong key replaced the Windows key');
  const moved = openWithSuppliedKey(copiedDb, paperKey);
  assert(moved.prepare('SELECT name FROM kept').get().name === 'Kept Guitar', 'recovery key did not open the catalog');
  moved.close();
  installRecoveryKey(paperKey);
  const reopened = openInventoryDatabase(copiedDb);
  assert(reopened.prepare('SELECT name FROM kept').get().name === 'Kept Guitar', 'saved recovery key did not reopen the catalog');
  reopened.close();
  const encryptedZip = path.join(ROOT, 'data', '.api-smoke-encrypted-backup.bin');
  fs.writeFileSync(encryptedZip, Buffer.concat([Buffer.from('SIDB'), Buffer.alloc(20)]));
  let rejectedEncryptedZip = false;
  try { assertPlainRecoveryZip(encryptedZip); } catch (err) { rejectedEncryptedZip = /recovery key/i.test(err.message); }
  assert(rejectedEncryptedZip, 'encrypted backup was accepted as a recovery ZIP');
  const plainZipPath = path.join(ROOT, 'data', '.api-smoke-recovery-shape.zip');
  const shape = new AdmZip();
  shape.addFile('backup.json', Buffer.from(JSON.stringify({
    manifest: { format: 'studio-inventory-full-backup' },
    tables: {}
  })));
  shape.writeZip(plainZipPath);
  assertPlainRecoveryZip(plainZipPath);
  fs.unlinkSync(encryptedZip);
  fs.unlinkSync(plainZipPath);
  process.env.STUDIO_KEY_DIR = savedKeyDir;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.unlinkSync(copiedDb); break; } catch (err) {
      if (attempt === 9) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  console.log('✓ encrypted catalog round-trip and locked copy');

  const backfillDir = path.join(ROOT, 'data', '.api-smoke-backfill');
  fs.rmSync(backfillDir, { recursive: true, force: true });
  process.env.STUDIO_DATA_DIR = backfillDir;
  const { db: backfillDb, initSchema, backfillOpeningValues } = require('../db');
  initSchema();
  backfillDb.prepare(`INSERT INTO items (name, replacement_value, value_updated_at) VALUES ('Old Amp', 250, '2024-05-01 12:00:00')`).run();
  assert(backfillOpeningValues() === 1, 'opening snapshot was not written');
  const opening = backfillDb.prepare('SELECT amount, note, recorded_at FROM item_value_events').get();
  assert(opening.amount === 250 && opening.note === 'Opening snapshot', 'opening snapshot is wrong');
  assert(String(opening.recorded_at).startsWith('2024-05-01'), 'opening snapshot ignored the existing date');
  assert(backfillOpeningValues() === 0, 'opening snapshot was written twice');
  backfillDb.close();
  delete process.env.STUDIO_DATA_DIR;
  console.log('✓ opening value snapshot');

  const env = {
    ...process.env,
    PORT: String(PORT),
    STUDIO_DATA_DIR: DATA_DIR,
    STUDIO_KEY_DIR: KEY_DIR,
    STUDIO_SKIP_AUTO_BACKUP: '1',
    STUDIO_ENCRYPT_NOW: '1',
    STUDIO_ALLOW_SAME_DISK: '1'
  };
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['seed.js', '--force'], { cwd: ROOT, env, stdio: 'inherit' });
    seed.on('close', c => (c === 0 ? resolve() : reject(new Error('seed failed'))));
  });

  const server = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const base = `http://127.0.0.1:${PORT}/api`;

  try {
    const health = await waitForHealth(`${base}/health`);
    assert(health.version, 'health missing version');
    assert(!isPlainSqlite(path.join(DATA_DIR, 'inventory.db')), 'catalog was left as a plain SQLite file');
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
        insurance_policy_note: 'Rider A',
        warranty_end_date: '2099-05-01',
        warranty_note: 'Transferable warranty',
        requires_power: true,
        power_adapter_voltage: '48V phantom',
        power_adapter_current: '',
        power_adapter_polarity: '',
        power_adapter_notes: 'Condenser test path'
      })
    });
    assert(created.depreciated_value === 60, 'depreciated_value not saved');
    assert(created.on_insurance_policy === true, 'on_insurance_policy not saved');
    assert(created.requires_power === true, 'requires_power not saved');
    assert(created.power_adapter_voltage === '48V phantom', 'power_adapter_voltage not saved');
    console.log('✓ item create with extended fields');

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

    const meta = await api(base, '/meta');
    assert(meta.instrumentProfiles.some(profile => profile.id === 'electronic_drum_kit'), 'electronic drum profile missing');
    assert(meta.instrumentProfiles.some(profile => profile.id === 'equipment_mount'), 'mounting hardware profile missing');
    assert(meta.instrumentProfiles.some(profile => profile.id === 'studio_monitor'), 'studio monitor profile missing');

    const drumKit = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Combined Alesis Command Mesh Kit',
        category: 'Electronic Drum Kit',
        instrument_type: 'electronic_drum_kit',
        instrument_specs: {
          kit_configuration: 'Two combined Alesis Command Mesh sets',
          module_count: 2,
          tom_count: 6,
          untrusted_unknown_field: '<script>bad()</script>'
        }
      })
    });
    assert(drumKit.instrument_specs.module_count === 2, 'electronic drum module count not saved');
    assert(!Object.prototype.hasOwnProperty.call(drumKit.instrument_specs, 'untrusted_unknown_field'), 'unknown profile field was not removed');

    const controlPad = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alesis ControlPad',
        category: 'Electronic Drum Component',
        instrument_type: 'electronic_percussion_controller',
        instrument_specs: { playing_pad_count: 8, mount_pattern: 'ControlPad mounting plate' },
        parent_item_id: drumKit.id,
        purchase_price: 199
      })
    });
    const adapterMount = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gibraltar adapter clamp',
        category: 'Mounting Hardware',
        instrument_type: 'equipment_mount',
        instrument_specs: {
          hardware_type: 'Adapter bracket',
          compatibility_status: 'Adapter required',
          incompatible_system: 'Original ControlPad mount did not fit Alesis Command rack clamps',
          adapter_chain: 'ControlPad plate → Gibraltar clamp → Alesis Command rack tube'
        },
        parent_item_id: controlPad.id,
        purchase_price: 34.99
      })
    });
    const thumbScrews = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'ControlPad mounting thumb screws',
        category: 'Fasteners / Small Hardware',
        instrument_type: 'fastener_hardware',
        instrument_specs: { fastener_type: 'Thumb screw', package_quantity: 4, mounts_item: 'ControlPad mounting plate' },
        parent_item_id: adapterMount.id,
        purchase_price: 12.49
      })
    });
    const controlPadDetail = await api(base, `/items/${controlPad.id}`);
    assert(controlPadDetail.accessories.some(item => item.id === adapterMount.id), 'nested mount not linked to ControlPad');
    const mountDetail = await api(base, `/items/${adapterMount.id}`);
    assert(mountDetail.accessories.some(item => item.id === thumbScrews.id), 'thumb screws not linked to mount');
    const drumKitDetail = await api(base, `/items/${drumKit.id}`);
    assert(drumKitDetail.assembly_totals.component_count === 3, 'nested assembly component count is wrong');
    assert(Math.abs(drumKitDetail.assembly_totals.total_purchase - 246.48) < 0.001, 'nested assembly purchase total is wrong');
    const profileSearch = await api(base, '/items?q=Adapter%20required&include_accessories=1');
    assert(profileSearch.some(item => item.id === adapterMount.id), 'profile specification search failed');
    const cycleRes = await fetch(`${base}/items/${drumKit.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_item_id: thumbScrews.id })
    });
    assert(cycleRes.status === 400, 'nested item cycle should be rejected');
    console.log('✓ smart profiles + nested paid component hierarchy');

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

    const { findGearDocuments, buildDocumentQueries } = require('../lib/manual-finder');
    const queries = buildDocumentQueries({ brand: 'Shure', model: 'SM57', name: 'SM57' }, { kind: 'all' });
    assert(queries.length === 3, 'document search did not cover user, service, and quick start');
    assert(queries.some(entry => /service manual/i.test(entry.query)), 'service manual query missing');
    assert(queries.some(entry => /quick start/i.test(entry.query)), 'quick start query missing');
    const specQuery = buildDocumentQueries({ brand: 'Shure', model: 'SM57', name: 'SM57' }, { kind: 'spec' });
    assert(specQuery.length === 1 && /spec sheet/i.test(specQuery[0].query), 'spec sheet was not a separate document search');
    const warrantyQuery = buildDocumentQueries({ brand: 'Shure', model: 'SM57', name: 'SM57' }, { kind: 'warranty' });
    assert(/warranty/i.test(warrantyQuery[0].query), 'warranty was not a separate document search');
    const documentLookup = await findGearDocuments({ brand: 'Shure', model: 'SM57', name: 'SM57' }, {
      kind: 'all',
      fetchText: async (url) => {
        if (url.includes('lite.duckduckgo.com')) return '<html></html>';
        if (url.includes('support.example.test/sm57')) {
          return '<html><a href="https://support.example.test/sm57-quickstart.pdf">SM57 Quick Start Guide</a></html>';
        }
        return `<html>
          <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=${encodeURIComponent('https://support.example.test/sm57-user.pdf')}">Shure SM57 User Manual PDF</a>
          <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=${encodeURIComponent('https://support.example.test/sm57')}">Shure SM57 support page</a>
        </html>`;
      }
    });
    const savedPdf = documentLookup.results.find(result => result.downloadUrl === 'https://support.example.test/sm57-user.pdf');
    assert(savedPdf && savedPdf.kind === 'user', 'direct user-manual PDF was not downloadable');
    const supportPage = documentLookup.results.find(result => result.url === 'https://support.example.test/sm57');
    assert(supportPage?.files?.some(file => file.url.endsWith('sm57-quickstart.pdf')), 'page scan did not find the quick start PDF');
    console.log('✓ document lookup finds a PDF and keeps it on the gear');

    const manualSearch = await api(base, '/manuals/search?q=test');
    assert(Array.isArray(manualSearch), 'manual search not array');
    console.log('✓ manual search endpoint');

    const archivedManual = await api(base, `/items/${created.id}/manuals/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `http://127.0.0.1:${PORT}/icons/icon.svg` })
    });
    assert(archivedManual.relative_path?.startsWith(`manuals/${created.id}/`), 'archived manual stored outside item manuals folder');
    const manualItem = await api(base, `/items/${created.id}`);
    assert(manualItem.manuals.some(m => m.id === archivedManual.id && m.source_url), 'archived manual not attached to item');
    console.log('✓ manual archive from URL');

    const discoveredManuals = await api(base, `/items/${created.id}/manuals/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `http://127.0.0.1:${PORT}/icons/icon.svg` })
    });
    assert(Array.isArray(discoveredManuals.candidates), 'manual discover candidates missing');
    assert(discoveredManuals.candidates.length === 1, 'direct manual discover failed');
    console.log('✓ manual URL discovery');

    const inboxDir = path.join(DATA_DIR, 'manual-inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, 'inbox-test-manual.pdf'), '%PDF-1.4\n% test manual\n');
    const inbox = await api(base, '/manual-inbox');
    assert(inbox.files.some(f => f.name === 'inbox-test-manual.pdf'), 'manual inbox file not listed');
    const importedInboxManual = await api(base, `/items/${parent.id}/manuals/import-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'inbox-test-manual.pdf' })
    });
    assert(importedInboxManual.attachment?.relative_path?.startsWith(`manuals/${parent.id}/`), 'inbox import stored outside item manuals folder');
    assert(!fs.existsSync(path.join(inboxDir, 'inbox-test-manual.pdf')), 'inbox import should move file out of inbox');
    const parentWithManual = await api(base, `/items/${parent.id}`);
    assert(parentWithManual.manuals.some(m => m.id === importedInboxManual.attachment.id), 'inbox manual not attached to item');
    console.log('✓ manual inbox import');

    const enriched = await api(base, `/items/${created.id}`);
    assert(Array.isArray(enriched.loans), 'item.loans missing');
    assert(enriched.loans.some(l => l.borrower_name === 'Mike'), 'loan history on item missing');
    console.log('✓ enrichItem loans');

    const publicItem = await api(base, `/public/items/${created.id}`);
    assert(publicItem.name === created.name, 'public QR item missing display fields');
    assert(Array.isArray(publicItem.manuals), 'public QR item missing manuals');
    for (const privateField of ['attachments', 'receipts', 'loans', 'maintenance', 'purchase_price',
      'insurance_policy_note', 'on_insurance_policy', 'activeLoan']) {
      assert(!Object.prototype.hasOwnProperty.call(publicItem, privateField), `public QR leaked ${privateField}`);
    }
    console.log('✓ public QR payload excludes private inventory data');
    const signedScanBeforeBackup = await api(base, `/items/${created.id}/scan-link`);
    assert(signedScanBeforeBackup.accessToken, 'signed QR access token missing');

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
    await api(base, `/floorplans/${fp.id}/geometry`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        map_mode: 'draw',
        polygon: [{ x: 10, y: 80 }, { x: 90, y: 80 }, { x: 90, y: 15 }, { x: 10, y: 15 }],
        bounds_width: 18,
        bounds_depth: 14,
        ceiling_height: 9.5,
        wall_lengths: [18, 14, 18, 14],
        unit: 'ft'
      })
    });
    await api(base, `/floorplans/${fp.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{
          item_id: rackItems[0].id, x_pct: 12, y_pct: 78,
          placement: 'wall', wall_edge: 0, wall_t: 0.35,
          height_ft: 6.5, icon_mode: 'logo'
        }]
      })
    });
    const fps = await api(base, '/floorplans');
    const saved = fps.find(p => p.id === fp.id);
    assert(saved?.polygon?.length === 4, 'floorplan polygon not saved');
    assert(saved?.items?.length >= 1, 'floorplan items not saved');
    assert(saved.items[0].placement === 'wall', 'wall placement not saved');
    assert(saved.ceiling_height === 9.5, 'ceiling_height not saved');
    assert(saved.items[0].height_ft === 6.5, 'height_ft not saved');
    const placement = await api(base, `/items/${rackItems[0].id}/placement`);
    assert(placement.floorplan_id === fp.id, 'item placement endpoint failed');
    const loanItem = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Wall Loan Guitar',
        category: 'Guitar',
        location: 'Main Rack',
        replacement_value: 800
      })
    });
    await api(base, `/floorplans/${fp.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          ...(saved.items || []).map(it => ({
            item_id: it.id, x_pct: it.x_pct, y_pct: it.y_pct,
            placement: it.placement, wall_edge: it.wall_edge, wall_t: it.wall_t,
            height_ft: it.height_ft, icon_mode: it.icon_mode, wall_display: true
          })),
          {
            item_id: loanItem.id, x_pct: 50, y_pct: 20,
            placement: 'wall', wall_edge: 1, wall_t: 0.5, height_ft: 5.5,
            icon_mode: 'photo', wall_display: true
          }
        ]
      })
    });
    const wallLoan = await api(base, `/items/${loanItem.id}/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrower_name: 'Test Friend' })
    });
    assert(wallLoan.wall_removed === true, 'loan should hide wall display');
    const afterLoan = await api(base, `/items/${loanItem.id}/placement`);
    assert(afterLoan.wall_display === false, 'wall_display should be false on loan');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD0lEQVQ42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('image', new Blob([png], { type: 'image/png' }), 'wall.png');
    const upRes = await fetch(`${base}/floorplans/${fp.id}/walls/0/photo`, { method: 'POST', body: form });
    if (!upRes.ok) throw new Error(`wall photo upload failed: ${upRes.status}`);
    await api(base, `/floorplans/${fp.id}/walls/0/calibration`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.12 }, { x: 0.88, y: 0.9 }, { x: 0.12, y: 0.88 }],
        lens_k: 0.02,
        calibrated: true
      })
    });
    const fps2 = await api(base, '/floorplans');
    const cal = fps2.find(p => p.id === fp.id);
    assert(cal?.wall_photos?.['0']?.calibrated === true, 'wall calibration not saved');
    console.log('✓ floorplans v2 + loan wall hide + wall align');

    const backupRes = await fetch(`${base}/export/full`);
    assert(backupRes.ok, 'full backup export failed');
    const backupBuffer = Buffer.from(await backupRes.arrayBuffer());
    const backupZip = new AdmZip(backupBuffer);
    const backupJsonEntry = backupZip.getEntry('backup.json');
    assert(backupJsonEntry, 'full backup missing backup.json');
    const backupJson = JSON.parse(backupJsonEntry.getData().toString('utf8'));
    assert(backupJson.tables.floorplans.some(row => row.id === fp.id), 'full backup missing floorplan row');
    assert(backupJson.tables.floorplan_items.length >= 1, 'full backup missing wall placements');
    assert(backupZip.getEntries().some(e => e.entryName.startsWith('uploads/floorplans/walls/')), 'full backup missing wall photo files');

    const restoreForm = new FormData();
    restoreForm.append('backup', new Blob([backupBuffer], { type: 'application/zip' }), 'studio-backup.zip');
    const restoreRes = await fetch(`${base}/import/full`, { method: 'POST', body: restoreForm });
    const restoreJson = await restoreRes.json().catch(() => ({}));
    if (!restoreRes.ok) throw new Error(`full backup restore failed: ${restoreJson.error || restoreRes.statusText}`);
    assert(restoreJson.files >= 1, 'full backup restore did not restore files');
    assert(restoreJson.manualsProcessed >= 1, `full backup restore did not process restored manuals: ${JSON.stringify(restoreJson)}`);
    const restoredFloorplans = await api(base, '/floorplans');
    const restoredCal = restoredFloorplans.find(p => p.id === fp.id);
    assert(restoredCal?.wall_photos?.['0']?.calibrated === true, 'full backup restore lost wall calibration');
    assert(restoredCal?.items?.length >= 1, 'full backup restore lost wall placements');
    const signedScanAfterRestore = await api(base, `/items/${created.id}/scan-link`);
    assert(signedScanAfterRestore.accessToken === signedScanBeforeBackup.accessToken,
      'full backup restore invalidated printed signed QR labels');
    console.log('✓ full backup export / restore');

    const invalidZip = new AdmZip(backupBuffer);
    const invalidBackup = JSON.parse(invalidZip.getEntry('backup.json').getData().toString('utf8'));
    invalidBackup.tables.floorplan_items[0].item_id = 987654321;
    invalidZip.updateFile('backup.json', Buffer.from(JSON.stringify(invalidBackup), 'utf8'));
    const invalidRestoreForm = new FormData();
    invalidRestoreForm.append('backup', new Blob([invalidZip.toBuffer()], { type: 'application/zip' }), 'invalid-backup.zip');
    const invalidRestoreRes = await fetch(`${base}/import/full`, { method: 'POST', body: invalidRestoreForm });
    const invalidRestoreBody = await invalidRestoreRes.json().catch(() => ({}));
    assert(!invalidRestoreRes.ok, 'invalid full backup should be rejected');
    assert(String(invalidRestoreBody.error || '').includes('invalid database relationship'), 'invalid restore error missing relationship validation');
    const afterRejectedRestore = await api(base, '/floorplans');
    const preservedCal = afterRejectedRestore.find(p => p.id === fp.id);
    assert(preservedCal?.wall_photos?.['0']?.calibrated === true, 'rejected restore changed current database');
    const preservedWallPath = preservedCal.wall_photos['0'].path;
    const preservedWallRes = await fetch(`http://127.0.0.1:${PORT}/uploads/${preservedWallPath}`);
    assert(preservedWallRes.ok, 'rejected restore changed current upload files');
    console.log('✓ invalid full backup rejected without changing current data');

    const sw = await api(base, '/software', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'FabFilter Pro-Q 3',
        publisher: 'FabFilter',
        category: 'Plugin',
        license_type: 'perpetual',
        license_key: 'TEST-KEY-12345',
        plugin_format: 'vst3',
        replacement_value: 179
      })
    });
    assert(sw.id, 'software create failed');
    const swList = await api(base, '/software');
    assert(swList.some(s => s.name === 'FabFilter Pro-Q 3'), 'software list failed');
    const swSub = await api(base, '/software', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Splice Plan',
        publisher: 'Splice',
        license_type: 'subscription',
        renewal_date: '2099-06-01',
        replacement_value: 12
      })
    });
    assert(swSub.id, 'subscription software failed');
    const statsWithSoftware = await api(base, '/stats');
    assert(statsWithSoftware.softwareTotals?.count >= 2, 'software stats missing');
    assert(Array.isArray(statsWithSoftware.softwareRenewals), 'software renewals missing');
    console.log('✓ software licenses');

    await api(base, `/items/${created.id}/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_date: '2026-04-01', service_type: 'inspection', note: 'JSON round-trip check' })
    });
    const jsonExportRes = await fetch(`${base}/export/json`);
    assert(jsonExportRes.ok, 'JSON export failed');
    const jsonExport = await jsonExportRes.json();
    const jsonImport = await api(base, '/import/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: jsonExport.items,
        software_licenses: jsonExport.software_licenses,
        replace: true,
        confirmPhrase: 'replace the catalog'
      })
    });
    assert(jsonImport.imported === jsonExport.items.length, 'JSON import item count mismatch');
    assert(jsonImport.importedSoftware === jsonExport.software_licenses.length, 'JSON import software count mismatch');
    assert(jsonImport.importedAttachments >= 1, 'JSON import did not reconnect existing attachments');
    const roundTripped = await api(base, `/items/${created.id}`);
    assert(roundTripped.depreciated_value === 60, 'JSON import lost depreciated value');
    assert(roundTripped.on_insurance_policy === true, 'JSON import lost insurance flag');
    assert(roundTripped.insurance_policy_note === 'Rider A', 'JSON import lost insurance note');
    assert(roundTripped.warranty_end_date === '2099-05-01', 'JSON import lost warranty date');
    assert(roundTripped.warranty_note === 'Transferable warranty', 'JSON import lost warranty note');
    assert(roundTripped.requires_power === true, 'JSON import lost power fields');
    assert(roundTripped.loans.some(l => l.borrower_name === 'Mike'), 'JSON import lost loan history');
    assert(roundTripped.maintenance.some(m => m.note === 'JSON round-trip check'), 'JSON import lost maintenance history');
    assert(roundTripped.manuals.length >= 1, 'JSON import lost existing manual attachment metadata');
    const roundTrippedAccessory = await api(base, `/items/${accessory.id}`);
    assert(roundTrippedAccessory.parent?.id === parent.id, 'JSON import lost accessory relationship');
    const roundTrippedMount = await api(base, `/items/${adapterMount.id}`);
    assert(roundTrippedMount.instrument_type === 'equipment_mount', 'JSON import lost item profile');
    assert(roundTrippedMount.instrument_specs.compatibility_status === 'Adapter required', 'JSON import lost profile specifications');
    assert(roundTrippedMount.accessories.some(item => item.id === thumbScrews.id), 'JSON import lost nested component hierarchy');
    const roundTrippedSoftware = await api(base, '/software');
    assert(roundTrippedSoftware.some(s => s.name === 'FabFilter Pro-Q 3'), 'JSON import lost software licenses');
    console.log('✓ JSON catalog export / replace round-trip');

    const backupRoot = path.join(ROOT, 'data', '.api-smoke-backups');
    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.mkdirSync(backupRoot, { recursive: true });
    let rejectedInside = false;
    try {
      await api(base, '/backup/folder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: DATA_DIR })
      });
    } catch {
      rejectedInside = true;
    }
    assert(rejectedInside, 'backup folder inside data should be rejected');
    await api(base, '/backup/folder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: backupRoot, keep: 2 })
    });
    const first = await api(base, '/backup/folder/run', { method: 'POST' });
    assert(first.lastPath && fs.existsSync(first.lastPath), 'folder backup file missing');
    const encBytes = fs.readFileSync(first.lastPath);
    assert(encBytes.subarray(0, 4).toString('utf8') === 'SIDB', 'folder backup is not an encrypted blob');
    const { readBackupZip } = require('../lib/folder-backup');
    const zip = readBackupZip(first.lastPath);
    assert(first.lastPath.endsWith('.zip.enc'), 'folder backup was not encrypted');
    assert(zip.getEntry('backup.json'), 'folder backup missing backup.json');
    const recovery = await api(base, '/backup/recovery-key');
    assert(Buffer.from(recovery.recoveryKey || '', 'base64').length === 32, 'localhost recovery key is missing');
    await api(base, '/backup/folder/run', { method: 'POST' });
    await api(base, '/backup/folder/run', { method: 'POST' });
    const recoveryCopy = await api(base, '/backup/recovery-copy', { method: 'POST' });
    assert(recoveryCopy.recoveryReady, 'recovery copy was not recorded');
    const recoveryFile = path.join(backupRoot, 'studio-inventory-recovery.zip');
    const firstRecoveryBytes = fs.readFileSync(recoveryFile);
    assert(firstRecoveryBytes.subarray(0, 2).toString('utf8') === 'PK', 'recovery copy is not a plain ZIP');
    const recoveryZip = new AdmZip(firstRecoveryBytes);
    assert(recoveryZip.getEntry('backup.json'), 'recovery copy missing backup.json');
    await api(base, '/backup/recovery-copy', { method: 'POST' });
    const previousRecovery = fs.readFileSync(path.join(backupRoot, 'studio-inventory-recovery-previous.zip'));
    assert(previousRecovery.equals(firstRecoveryBytes), 'refresh did not keep the previous recovery ZIP');
    await api(base, '/backup/folder/run', { method: 'POST' });
    const names = fs.readdirSync(backupRoot).filter(name => name.endsWith('.zip.enc') && !name.includes('-monthly')).sort();
    assert(names.length === 2, `expected 2 rotated backups, saw ${names.length}: ${fs.readdirSync(backupRoot).join(', ')}`);
    assert(fs.readdirSync(backupRoot).some(name => name.includes('-monthly')), 'monthly backup was not written');
    assert(fs.existsSync(recoveryFile), 'rotation deleted the recovery ZIP');
    assert(fs.existsSync(path.join(backupRoot, 'studio-inventory-recovery-previous.zip')), 'rotation deleted the previous recovery ZIP');
    const beforeRefusedEncrypt = fs.readFileSync(recoveryFile);
    let refusedEncrypt = false;
    try {
      await api(base, '/backup/encrypt', { method: 'POST' });
    } catch {
      refusedEncrypt = true;
    }
    assert(refusedEncrypt, 'encrypt ran before the recovery key was typed');
    assert(fs.readFileSync(recoveryFile).equals(beforeRefusedEncrypt), 'refused encrypt changed the recovery ZIP');
    let wrongKey = false;
    try {
      await api(base, '/backup/recovery-key/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryKey: 'not-the-key' })
      });
    } catch (err) {
      wrongKey = /not the recovery key/i.test(err.message);
    }
    assert(wrongKey, 'wrong recovery key was accepted');
    assert((await api(base, '/backup/folder')).recoveryKeyConfirmed !== true, 'wrong key confirmed the recovery key');
    const guestBeforeEncrypt = await api(base, '/settings/guest');
    await api(base, '/backup/recovery-key/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey: recovery.recoveryKey })
    });
    const encrypted = await api(base, '/backup/encrypt', { method: 'POST' });
    assert(encrypted.encryptionArmed, 'catalog encryption was not armed');
    const settingsFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'studio-settings.json'), 'utf8'));
    assert(!settingsFile.guestToken, 'guest token was left in the settings file');
    assert(!settingsFile.scanLinkSecret, 'QR secret was left in the settings file');
    assert(!settingsFile.ownerPinHash, 'PIN hash was left in the settings file');
    const guestAfterEncrypt = await api(base, '/settings/guest');
    assert(guestAfterEncrypt.guestToken === guestBeforeEncrypt.guestToken, 'encryption lost the guest token');
    const backupForm = new FormData();
    backupForm.append('backup', new Blob([fs.readFileSync(path.join(backupRoot, names[names.length - 1]))]), 'backup.zip');
    const restored = await fetch(`${base}/import/full`, { method: 'POST', body: backupForm });
    const restoredBody = await restored.json();
    assert(restored.ok && restoredBody.ok, restoredBody.error || 'folder backup restore failed');
    const afterRestore = await api(base, `/items/${created.id}`);
    assert(afterRestore.name === 'Loan Test Mic', 'restored backup lost the item');
    const failDir = path.join(ROOT, 'data', '.api-smoke-backup-fail');
    fs.rmSync(failDir, { recursive: true, force: true });
    fs.mkdirSync(failDir, { recursive: true });
    await api(base, '/backup/folder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: failDir, keep: 2 })
    });
    const okStatus = await api(base, '/backup/folder/run', { method: 'POST' });
    fs.rmSync(failDir, { recursive: true, force: true });
    let failedRun = false;
    try {
      await api(base, '/backup/folder/run', { method: 'POST' });
    } catch {
      failedRun = true;
    }
    assert(failedRun, 'backup to a missing folder should fail');
    const afterFail = await api(base, '/backup/folder');
    assert(afterFail.lastError, 'status hid the backup error');
    assert(afterFail.lastAt === okStatus.lastAt, 'failed backup erased the previous success time');
    await api(base, '/backup/folder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: backupRoot, keep: 2 })
    });
    console.log('✓ folder backup write, rotate, restore');

    const before = await api(base, '/stats');
    const guitar = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sold Test Guitar',
        category: 'Guitar',
        serial_number: 'SOLD-123',
        replacement_value: 500
      })
    });
    const part = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sold Test Case',
        category: 'Accessory',
        parent_item_id: guitar.id,
        replacement_value: 80
      })
    });
    let rejectedSale = false;
    try {
      await api(base, `/items/${guitar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studio_status: 'sold' })
      });
    } catch (err) {
      rejectedSale = /date/i.test(err.message);
    }
    assert(rejectedSale, 'sold gear without a date should be rejected');
    const sold = await api(base, `/items/${guitar.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studio_status: 'sold',
        disposition_date: '2026-09-01',
        studio_status_note: 'Sold to a student'
      })
    });
    assert(sold.studio_status === 'sold', 'sold status not saved');
    assert(sold.serial_number === 'SOLD-123', 'sold record lost its serial');
    const soldPart = await api(base, `/items/${part.id}`);
    assert(soldPart.studio_status === 'sold', 'nested part did not follow the parent');
    const visible = await api(base, '/items');
    assert(!visible.some(item => item.id === guitar.id), 'sold guitar still in the default list');
    const withFormer = await api(base, '/items?include_former=1');
    assert(withFormer.some(item => item.id === guitar.id), 'sold guitar missing when former gear is requested');
    const after = await api(base, '/stats');
    assert(after.totals.total_replacement === before.totals.total_replacement, 'sold gear still counts in the insured total');
    const soldBackup = await api(base, '/backup/folder/run', { method: 'POST' });
    const soldForm = new FormData();
    soldForm.append('backup', new Blob([fs.readFileSync(soldBackup.lastPath)]), 'backup.zip');
    const soldRestore = await fetch(`${base}/import/full`, { method: 'POST', body: soldForm });
    const soldRestoreBody = await soldRestore.json();
    assert(soldRestore.ok && soldRestoreBody.ok, soldRestoreBody.error || 'sold-gear backup restore failed');
    const restoredSold = await api(base, `/items/${guitar.id}`);
    assert(restoredSold.studio_status === 'sold' && restoredSold.serial_number === 'SOLD-123', 'restore dropped the sold record');
    const broughtBack = await api(base, `/items/${guitar.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studio_status: 'in_studio', studio_status_note: '', disposition_date: '' })
    });
    assert(broughtBack.studio_status === 'in_studio', 'parent did not return to the studio');
    const partBack = await api(base, `/items/${part.id}`);
    assert(partBack.studio_status === 'in_studio', 'cascaded part did not return with the parent');
    const holdout = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Holdout Parent', category: 'Guitar', replacement_value: 10 })
    });
    const holdoutPart = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Holdout Part', category: 'Accessory', parent_item_id: holdout.id })
    });
    await api(base, `/items/${holdout.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studio_status: 'stolen', disposition_date: '2026-08-01', studio_status_note: 'Taken from the gig' })
    });
    await api(base, `/items/${holdoutPart.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studio_status_note: 'Kept this part' })
    });
    await api(base, `/items/${holdout.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studio_status: 'in_studio' })
    });
    const holdoutAfter = await api(base, `/items/${holdoutPart.id}`);
    assert(holdoutAfter.studio_status === 'stolen', 'a part with its own note was restored with the parent');
    const duplicate = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Erase Me', category: 'Other', replacement_value: 15 })
    });
    let blockedDelete = false;
    try {
      await api(base, `/items/${duplicate.id}`, { method: 'DELETE' });
    } catch (err) {
      blockedDelete = /name|erase|owned/i.test(err.message);
    }
    assert(blockedDelete, 'delete without a typed name removed the item');
    const stillThere = await api(base, `/items/${duplicate.id}`);
    assert(stillThere.value_events.length >= 1, 'blocked delete destroyed value history');
    let wrongName = false;
    try {
      await api(base, `/items/${duplicate.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erase: true, confirmName: 'not the name' })
      });
    } catch (err) {
      wrongName = /name|erase|owned/i.test(err.message);
    }
    assert(wrongName, 'erase with the wrong name removed the item');
    await api(base, `/items/${duplicate.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erase: true, confirmName: 'Erase Me' })
    });
    let erased = false;
    try {
      await api(base, `/items/${duplicate.id}`);
    } catch (err) {
      erased = /404/.test(err.message);
    }
    assert(erased, 'erase with the item name left the duplicate in place');
    const { insurancePdfTables } = await import('../public/js/lib/insurance-rows.mjs');
    const tables = insurancePdfTables([
      {
        name: 'Kept', brand: 'A', model: 'B', serial_number: '1', location: 'Rack', condition: 'Good',
        purchase_price: 10, replacement_value: 20, quantity: 1, studio_status: 'in_studio',
        value_updated_at: '2026-01-02', receipts: [{}]
      },
      {
        name: 'Gone', brand: 'C', model: 'D', serial_number: '2', location: 'Should not be the date column',
        studio_status: 'sold', disposition_date: '2026-09-01', studio_status_note: 'Student', purchase_price: 5
      }
    ]);
    assert(tables.formerHeaders[4] === 'Status', 'former PDF reused the location column');
    assert(tables.formerRows[0][4] === 'sold' && tables.formerRows[0][5] === '2026-09-01', 'former PDF put the sold date in the wrong column');
    assert(!tables.formerHeaders.includes('Location'), 'former PDF still has a location column');
    assert(tables.ownedRows[0].at(-1) === 'Yes', 'owned PDF did not say a receipt is on file');
    const labeled = insurancePdfTables([
      {
        name: 'Old', studio_status: 'in_studio', replacement_value: 1, quantity: 1,
        latest_value_event: { note: 'Opening snapshot', recorded_at: '2024-05-01' }
      },
      {
        name: 'New', studio_status: 'in_studio', replacement_value: 1, quantity: 1,
        latest_value_event: { note: 'Reverb avg', recorded_at: '2026-09-01' }
      }
    ]);
    assert(String(labeled.ownedRows[0][8]).includes('not an appraisal'), 'opening snapshot was presented as an appraisal');
    assert(!String(labeled.ownedRows[1][8]).includes('not an appraisal'), 'a real value note was labeled as a snapshot');
    console.log('✓ former gear stays recorded and leaves the insured total');

    const valued = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Value History Amp',
        category: 'Amplifier',
        serial_number: 'AMP-1',
        replacement_value: 400,
        replacement_value_note: 'First listing'
      })
    });
    const firstEvents = (await api(base, `/items/${valued.id}`)).value_events;
    assert(firstEvents.length === 1 && firstEvents[0].amount === 400, 'first save did not record a value');
    await api(base, `/items/${valued.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replacement_value: 450,
        replacement_value_note: 'Reverb avg',
        serial_number: 'AMP-2'
      })
    });
    const traced = await api(base, `/items/${valued.id}`);
    assert(traced.value_events.length === 2, 'second value edit did not append history');
    assert(traced.value_events[0].amount === 450 && traced.value_events[0].note === 'Reverb avg', 'latest value event is wrong');
    assert(traced.audit.some(entry => entry.field === 'serial_number' && entry.new_value === 'AMP-2'), 'serial change was not audited');
    const historyBackup = await api(base, '/backup/folder/run', { method: 'POST' });
    const historyForm = new FormData();
    historyForm.append('backup', new Blob([fs.readFileSync(historyBackup.lastPath)]), 'backup.zip');
    const historyRestore = await fetch(`${base}/import/full`, { method: 'POST', body: historyForm });
    const historyRestoreBody = await historyRestore.json();
    assert(historyRestore.ok && historyRestoreBody.ok, historyRestoreBody.error || 'history backup restore failed');
    const restoredHistory = await api(base, `/items/${valued.id}`);
    assert(restoredHistory.value_events.length === 2, 'restore lost value history');
    assert(restoredHistory.audit.some(entry => entry.field === 'serial_number'), 'restore lost the audit log');
    const splitBefore = await api(base, '/stats');
    const kit = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Split Kit', category: 'Guitar', replacement_value: 100 })
    });
    await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Split Pedal', category: 'Pedal', parent_item_id: kit.id, replacement_value: 25 })
    });
    const splitAfter = await api(base, '/stats');
    assert(splitAfter.totals.top_level_replacement - splitBefore.totals.top_level_replacement === 100, 'top-level total did not count the kit');
    assert(splitAfter.totals.nested_replacement - splitBefore.totals.nested_replacement === 25, 'nested total did not count the part');
    assert(splitAfter.totals.total_replacement - splitBefore.totals.total_replacement === 125, 'headline total dropped a nested part');
    console.log('✓ value history and audit survive backup');

    const doomed = await api(base, '/software', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Delete Me Plugin', publisher: 'Test', license_key: 'SECRET' })
    });
    let blockedSoftware = false;
    try {
      await api(base, `/software/${doomed.id}`, { method: 'DELETE' });
    } catch (err) {
      blockedSoftware = /name/i.test(err.message);
    }
    assert(blockedSoftware, 'software delete without the name removed the license');
    assert((await api(base, '/software')).some(entry => entry.id === doomed.id), 'blocked software delete removed the license');
    await api(base, `/software/${doomed.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erase: true, confirmName: 'Delete Me Plugin' })
    });
    assert(!(await api(base, '/software')).some(entry => entry.id === doomed.id), 'named software delete left the license');

    const phraseItem = await api(base, '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Phrase Keep', category: 'Other', replacement_value: 30 })
    });
    let blockedReplace = false;
    try {
      await api(base, '/import/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [], replace: true })
      });
    } catch (err) {
      blockedReplace = /replace the catalog/i.test(err.message);
    }
    assert(blockedReplace, 'JSON replace without the phrase wiped the catalog');
    assert((await api(base, `/items/${phraseItem.id}`)).value_events.length >= 1, 'refused replace destroyed value history');
    await api(base, '/import/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [], replace: true, confirmPhrase: 'replace the catalog' })
    });
    let phraseGone = false;
    try {
      await api(base, `/items/${phraseItem.id}`);
    } catch (err) {
      phraseGone = /404/.test(err.message);
    }
    assert(phraseGone, 'typed phrase did not replace the catalog');
    console.log('✓ replace and software delete require the typed words');

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
