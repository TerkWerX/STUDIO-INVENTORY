/**
 * Unit tests (node --test) for CSV export/import and streamed backups.
 * No server, no OS keyring: keys are generated in-process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { toCsv } = require('../lib/csv-export');
const { parseCsv } = require('../lib/csv-import');
const {
  encryptBackupBuffer, decryptBackupBuffer, encryptStreamToFile, decryptFileToFile, isEncryptedBackupFile
} = require('../lib/backup-crypto');
const {
  createBackupZipStream, writeStreamAtomically, readZipEntry, listZipEntries, extractZipPrefixes
} = require('../lib/folder-backup');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'studio-backup-test-'));
}

test('CSV keeps multi-line, quoted, comma and non-ASCII text in one row each', () => {
  const values = [
    'Bought used.\nLeft channel crackles; recapped 2025.',
    'Windows line\r\nbreak',
    'He said "mint", then shipped it',
    'Röde NT1 — 5th gen ✓',
    'plain',
    ''
  ];
  const csv = toCsv(['name', 'description'], values.map((value, i) => [`Item ${i}`, value]));
  const rows = parseCsv(csv).rows;
  assert.equal(rows.length, values.length);
  rows.forEach((row, i) => {
    assert.equal(row.name, `Item ${i}`);
    assert.equal(row.description, values[i].trim());
  });
});

test('CSV neutralizes formula-like text for spreadsheets and restores it on import', () => {
  const risky = ['=HYPERLINK("http://example.invalid","x")', '+48V phantom', '-5 dB pad', '@studio', '\tTabbed'];
  const csv = toCsv(['name'], risky.map(value => [value]));
  for (const line of csv.replace(/^﻿/, '').split('\r\n').slice(1).filter(Boolean)) {
    assert.match(line.replace(/^"/, ''), /^'/, `cell left live: ${line}`);
  }
  assert.deepEqual(parseCsv(csv).rows.map(row => row.name), risky.map(value => value.trim()));
});

test('CSV leaves numbers alone and starts with a UTF-8 byte-order mark', () => {
  const csv = toCsv(['price', 'delta'], [[1299.5, -5]]);
  assert.ok(csv.startsWith('﻿'));
  assert.deepEqual(parseCsv(csv).rows, [{ price: '1299.5', delta: '-5' }]);
});

test('streamed encryption reads and writes the original backup format', async () => {
  const dir = tempDir();
  const key = crypto.randomBytes(32);
  const plain = crypto.randomBytes(2 * 1024 * 1024 + 123);

  const streamed = path.join(dir, 'streamed.enc');
  await encryptStreamToFile(Readable.from([plain.subarray(0, 1000), plain.subarray(1000)]), streamed, key);
  assert.ok(isEncryptedBackupFile(streamed));
  assert.ok(decryptBackupBuffer(fs.readFileSync(streamed), key).equals(plain), 'older app versions can read new backups');

  const legacy = path.join(dir, 'legacy.enc');
  fs.writeFileSync(legacy, encryptBackupBuffer(plain, key));
  const decrypted = path.join(dir, 'legacy.zip');
  await decryptFileToFile(legacy, decrypted, key);
  assert.ok(fs.readFileSync(decrypted).equals(plain), 'new code reads backups written by older versions');

  const damaged = fs.readFileSync(streamed);
  damaged[4096] ^= 1;
  fs.writeFileSync(path.join(dir, 'damaged.enc'), damaged);
  await assert.rejects(
    decryptFileToFile(path.join(dir, 'damaged.enc'), path.join(dir, 'damaged.zip'), key),
    /could not unlock/
  );
  assert.ok(!fs.existsSync(path.join(dir, 'damaged.zip')), 'unauthenticated plaintext must not be left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backup ZIP streams from a snapshot and extracts back byte for byte', async () => {
  const dir = tempDir();
  const uploads = path.join(dir, 'uploads');
  fs.mkdirSync(path.join(uploads, 'photos', '7'), { recursive: true });
  fs.mkdirSync(path.join(uploads, 'manuals', '7'), { recursive: true });
  const photo = crypto.randomBytes(512 * 1024);
  const manual = Buffer.from('Manual text '.repeat(5000));
  fs.writeFileSync(path.join(uploads, 'photos', '7', 'front.jpg'), photo);
  fs.writeFileSync(path.join(uploads, 'manuals', '7', 'guide.txt'), manual);
  const snapshot = {
    json: Buffer.from(JSON.stringify({ manifest: { format: 'studio-inventory-full-backup' }, tables: {} })),
    files: [
      { path: path.join(uploads, 'photos', '7', 'front.jpg'), name: 'uploads/photos/7/front.jpg', size: photo.length, mtime: new Date() },
      { path: path.join(uploads, 'manuals', '7', 'guide.txt'), name: 'uploads/manuals/7/guide.txt', size: manual.length, mtime: new Date() },
      { path: path.join(uploads, 'photos', '7', 'deleted-meanwhile.jpg'), name: 'uploads/photos/7/deleted-meanwhile.jpg', size: 10, mtime: new Date() }
    ]
  };
  const zipPath = path.join(dir, 'backup.zip');
  const skipped = [];
  await writeStreamAtomically(createBackupZipStream(snapshot, { onSkip: file => skipped.push(file.name) }), zipPath);
  assert.deepEqual(skipped, ['uploads/photos/7/deleted-meanwhile.jpg'], 'a vanished file is skipped, not fatal');
  assert.ok(!fs.existsSync(`${zipPath}.partial`));

  const names = await listZipEntries(zipPath);
  assert.ok(names.includes('backup.json'));
  assert.equal(JSON.parse((await readZipEntry(zipPath, 'backup.json')).toString()).manifest.format, 'studio-inventory-full-backup');

  const restored = path.join(dir, 'restored');
  const written = await extractZipPrefixes(zipPath, [{ prefix: 'uploads', dir: restored }]);
  assert.equal(written, 3);
  assert.ok(fs.readFileSync(path.join(restored, 'photos', '7', 'front.jpg')).equals(photo));
  assert.ok(fs.readFileSync(path.join(restored, 'manuals', '7', 'guide.txt')).equals(manual));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an interrupted backup write never replaces the previous file', async () => {
  const dir = tempDir();
  const target = path.join(dir, 'studio-inventory-full-backup-x.zip');
  await writeStreamAtomically(Readable.from([Buffer.from('good')]), target);
  const failing = new Readable({
    read() {
      this.push(Buffer.from('partial'));
      this.destroy(new Error('disk unplugged'));
    }
  });
  await assert.rejects(writeStreamAtomically(failing, target), /disk unplugged/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'good');
  assert.ok(!fs.existsSync(`${target}.partial`));
  fs.rmSync(dir, { recursive: true, force: true });
});
