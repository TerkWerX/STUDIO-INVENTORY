const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { getDataKey } = require('./data-key');
const { encryptStreamToFile, decryptFileToFile, isEncryptedBackupFile } = require('./backup-crypto');

const BACKUP_NAME = /^studio-inventory-full-backup-.+\.zip(\.enc)?$/;
const MONTHLY_BACKUP = /^studio-inventory-full-backup-(\d{4}-\d{2})-monthly\.zip\.enc$/;
const RECOVERY_NAME = 'studio-inventory-recovery.zip';
const RECOVERY_PREVIOUS_NAME = 'studio-inventory-recovery-previous.zip';
const DEFAULT_KEEP = 7;
const MONTHLY_KEEP = 6;

const volumeCache = new Map();
const volumeLookups = new Map();

function volumeKey(dir) {
  const root = path.parse(path.resolve(dir)).root;
  if (root.startsWith('\\\\')) return { network: true, label: root };
  const letter = root.slice(0, 1);
  if (!/^[a-z]$/i.test(letter)) return { unknown: true, label: root || dir };
  return { letter: letter.toUpperCase() };
}

/**
 * Which physical disk a drive letter lives on. Asking Windows takes a second
 * or more, so it runs in a child process without blocking the server, and the
 * answer is cached for the life of the process.
 */
function lookupWindowsVolume(key) {
  if (volumeCache.has(key)) return Promise.resolve(volumeCache.get(key));
  if (volumeLookups.has(key)) return volumeLookups.get(key);
  const script = `
$ErrorActionPreference = 'Stop'
$part = Get-Partition -DriveLetter '${key}' | Select-Object -First 1
$disk = Get-Disk -Number $part.DiskNumber
$vol = Get-Volume -DriveLetter '${key}'
@{ Number = $disk.Number; Name = $disk.FriendlyName; Bus = [string]$disk.BusType; DriveType = [string]$vol.DriveType } | ConvertTo-Json -Compress
`;
  const lookup = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000
    }, (err, stdout) => {
      let info = { kind: 'unknown', letter: key, label: `${key}:` };
      if (!err && String(stdout || '').trim()) {
        try {
          const parsed = JSON.parse(String(stdout).trim());
          const bus = String(parsed.Bus || '');
          info = {
            kind: bus.toLowerCase() === 'spaces' ? 'spaces' : 'disk',
            number: parsed.Number,
            name: String(parsed.Name || '').trim(),
            bus,
            driveType: String(parsed.DriveType || ''),
            letter: key,
            label: `${key}: ${String(parsed.Name || '').trim()}`
          };
        } catch { /* leave unknown */ }
      }
      volumeCache.set(key, info);
      volumeLookups.delete(key);
      resolve(info);
    });
  });
  volumeLookups.set(key, lookup);
  return lookup;
}

/** Cached volume info for a folder, or null while the lookup is still running. */
function windowsVolume(dir) {
  const key = volumeKey(dir);
  if (key.network) return { kind: 'network', label: key.label };
  if (key.unknown) return { kind: 'unknown', label: key.label };
  if (volumeCache.has(key.letter)) return volumeCache.get(key.letter);
  lookupWindowsVolume(key.letter);
  return null;
}

/** Look up the disks behind both folders, so the next backupDiskWarning() can answer. */
function warmBackupDiskInfo(backupDir, dataDir) {
  if (process.platform !== 'win32') return Promise.resolve();
  const letters = [backupDir, dataDir].map(volumeKey).filter(key => key.letter).map(key => key.letter);
  return Promise.all(letters.map(lookupWindowsVolume)).then(() => undefined);
}

function backupRole(backup) {
  const bus = String(backup.bus || '').toLowerCase();
  const driveType = String(backup.driveType || '').toLowerCase();
  if (bus === 'usb' && driveType === 'removable') return 'usb-thumb';
  if (bus === 'usb') return 'usb';
  return 'other';
}

function backupDiskWarning(backupDir, dataDir) {
  const offsite = 'That plugged-in drive is not the offsite copy. Keep another copy in cloud storage you control, or on a drive you store somewhere else. The app does not upload it.';
  if (process.platform !== 'win32') {
    try {
      if (fs.statSync(backupDir).dev === fs.statSync(dataDir).dev) {
        return `This folder is on the same device as the catalog. Use a separate physical disk, not another partition. A USB thumb drive is a good second copy. ${offsite}`;
      }
    } catch { /* still warn */ }
    return `Keep this folder on a separate physical disk, not another partition of the catalog drive. A USB thumb drive can stay plugged in for that second copy. ${offsite}`;
  }
  const catalog = windowsVolume(dataDir);
  const backup = windowsVolume(backupDir);
  if (!catalog || !backup) return 'Checking which disk this folder is on…';
  const where = catalog.label ? `Catalog is on ${catalog.label}.` : '';
  if (catalog.kind === 'disk' && backup.kind === 'disk' && catalog.number === backup.number) {
    return `This folder is on the same physical disk as the catalog (${catalog.name || catalog.label}). Another drive letter on that disk is still one drive. Use a USB thumb drive or another device for the second copy. ${offsite}`;
  }
  if (backup.kind === 'spaces') {
    return `${where} This folder is on ${backup.label}, a Storage Spaces pool. That counts as another device, not as a USB stick and not as offsite. ${offsite}`;
  }
  if (backup.kind === 'network') {
    return `${where} This is a network path. It counts as offsite only if the share is another computer, not a folder on this PC. A USB thumb drive that stays plugged in is the second copy, on a second kind of media.`;
  }
  if (backupRole(backup) === 'usb-thumb') {
    return `${where} This USB thumb drive (${backup.label}) is a second kind of media. It can stay plugged in as the second copy. ${offsite}`;
  }
  if (backupRole(backup) === 'usb') {
    return `${where} This USB device (${backup.label}) is separate from the catalog disk and counts as a second kind of media. It can stay plugged in as the second copy. ${offsite}`;
  }
  if (catalog.kind === 'disk' && backup.kind === 'disk') {
    return `${where} This folder is on ${backup.label}, a different device. A USB thumb drive is the clearest second kind of media if this one is another internal drive. ${offsite}`;
  }
  return `Use three copies: the catalog, a USB thumb drive that can stay plugged in, and one offsite copy. Do not use another partition of the catalog drive. ${offsite}`;
}

function validateBackupDir(dir, dataDir) {
  const raw = String(dir || '').trim();
  if (!raw) throw new Error('Choose a backup folder first');
  if (!path.isAbsolute(raw)) throw new Error('Backup folder must be a full path');
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Backup folder does not exist');
  }
  const dataResolved = path.resolve(dataDir);
  const rel = path.relative(dataResolved, resolved);
  const insideData = rel === '' || (!path.isAbsolute(rel) && !rel.startsWith('..'));
  if (insideData) {
    throw new Error('Backup folder must be outside the Studio Inventory data folder');
  }
  const probe = path.join(resolved, `.studio-inventory-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch {
    throw new Error('Backup folder is not writable');
  }
  return resolved;
}

function safeBackupSettings(settings) {
  return {
    guestEnabled: !!settings.guestEnabled,
    guestToken: settings.guestToken || '',
    scanLinkSecret: settings.scanLinkSecret || ''
  };
}

function exportTables(database, tables) {
  return Object.fromEntries(tables.map((table) => {
    const exists = database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);
    if (!exists) return [table, []];
    return [table, database.prepare(`SELECT * FROM ${table}`).all()];
  }));
}

function buildBackupPayload(database, { settings, appVersion, tables }) {
  return {
    manifest: {
      app: 'Studio Inventory',
      format: 'studio-inventory-full-backup',
      version: 1,
      appVersion: appVersion || '',
      exportedAt: new Date().toISOString()
    },
    settings: safeBackupSettings(settings),
    tables: exportTables(database, tables)
  };
}

function isOrdinaryBackup(name) {
  return BACKUP_NAME.test(name) && !name.includes('-monthly');
}

function listBackupZips(dir) {
  return fs.readdirSync(dir)
    .filter(isOrdinaryBackup)
    .sort();
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function pruneMonthlyBackups(dir, keepMonths = MONTHLY_KEEP, now = new Date()) {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (keepMonths - 1));
  const cutoffKey = monthKey(cutoff);
  for (const name of fs.readdirSync(dir)) {
    const match = name.match(MONTHLY_BACKUP);
    if (match && match[1] < cutoffKey) fs.unlinkSync(path.join(dir, name));
  }
}

function rotateBackupFiles(dir, keep = DEFAULT_KEEP) {
  const limit = Math.max(1, Number(keep) || DEFAULT_KEEP);
  const names = listBackupZips(dir);
  const extra = names.length - limit;
  for (let i = 0; i < extra; i++) {
    fs.unlinkSync(path.join(dir, names[i]));
  }
  return listBackupZips(dir);
}

// ---------------------------------------------------------------------------
// Writing backups
//
// A backup is a ZIP with backup.json (every catalog table) plus uploads/ and
// manual-inbox/. It used to be assembled entirely in memory, which needed
// several times the size of the photos and manuals and froze the server while
// it compressed. Now the catalog tables and the file list are captured in one
// quick snapshot, and the ZIP is streamed to disk (or to the browser) file by
// file, so memory stays flat and other requests keep being answered.
// ---------------------------------------------------------------------------

// Already-compressed formats are stored as-is; deflating them again only costs time.
const STORED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif',
  '.pdf', '.zip', '.gz', '.tgz', '.7z', '.rar', '.xz', '.bz2', '.dmg', '.pkg', '.msi', '.exe',
  '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.mp4', '.mov', '.m4v', '.webm',
  '.docx', '.xlsx', '.pptx', '.odt', '.enc'
]);

function listFilesRecursive(root, prefix) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, name);
      } else if (entry.isFile()) {
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        files.push({ path: full, name: `${prefix}/${name}`, size: stat.size, mtime: stat.mtime });
      }
    }
  };
  walk(root, '');
  return files;
}

/**
 * Capture the catalog tables and the list of files in one read transaction.
 * This is the only synchronous step, and it reads metadata only.
 */
function snapshotBackup({ db, settings, appVersion, tables, uploadsDir, inboxDir }) {
  return db.transaction(() => {
    const payload = buildBackupPayload(db, { settings, appVersion, tables });
    return {
      json: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      files: [
        ...listFilesRecursive(uploadsDir, 'uploads'),
        ...listFilesRecursive(inboxDir, 'manual-inbox')
      ]
    };
  })();
}

/**
 * A readable stream of the backup ZIP. Files are opened one at a time as the
 * ZIP reaches them. A file deleted after the snapshot is written as empty
 * rather than failing the whole backup.
 */
function createBackupZipStream(snapshot, { onSkip } = {}) {
  const zip = new yazl.ZipFile();
  const output = zip.outputStream;
  zip.on('error', err => output.destroy(err));
  zip.addBuffer(snapshot.json, 'backup.json', { mtime: new Date() });
  for (const file of snapshot.files) {
    const compress = !STORED_EXTENSIONS.has(path.extname(file.name).toLowerCase());
    try {
      zip.addReadStreamLazy(file.name, { mtime: file.mtime, compress }, (callback) => {
        fs.open(file.path, 'r', (err, fd) => {
          if (err) {
            onSkip?.(file, err);
            return callback(null, Readable.from([]));
          }
          const stream = fs.createReadStream(null, { fd });
          stream.on('error', streamErr => zip.emit('error', streamErr));
          callback(null, stream);
        });
      });
    } catch (err) {
      // Names a ZIP cannot hold (for example a backslash in a Linux file name).
      onSkip?.(file, err);
    }
  }
  zip.end();
  return output;
}

function logSkippedFile(file, err) {
  console.warn(`  Backup skipped ${file.name}: ${err.message}`);
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Write to name.partial, flush, then rename, so an interrupted backup never replaces a good one. */
async function writeAtomically(finalPath, writePartial, { failAfterPartial = false } = {}) {
  const partial = `${finalPath}.partial`;
  try {
    await writePartial(partial);
    if (failAfterPartial) throw new Error('Simulated backup write failure');
    fs.renameSync(partial, finalPath);
  } catch (err) {
    try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch { /* leave the previous backup alone */ }
    throw err;
  }
}

async function writeStreamAtomically(source, finalPath, options = {}) {
  return writeAtomically(finalPath, async (partial) => {
    try {
      await pipeline(source, fs.createWriteStream(partial));
    } finally {
      source.destroy?.();
    }
    fsyncFile(partial);
  }, options);
}

async function copyFileAtomically(sourcePath, finalPath) {
  return writeAtomically(finalPath, async (partial) => {
    await fs.promises.copyFile(sourcePath, partial);
    fsyncFile(partial);
  });
}

/** Stream a full backup ZIP (for a browser download). */
function createDownloadZipStream({ db, settings, appVersion, tables, uploadsDir, inboxDir }) {
  const snapshot = snapshotBackup({ db, settings, appVersion, tables, uploadsDir, inboxDir });
  return createBackupZipStream(snapshot, { onSkip: logSkippedFile });
}

async function writeFolderBackup({
  db,
  destDir,
  dataDir,
  uploadsDir,
  inboxDir,
  settings,
  appVersion,
  tables,
  keep = DEFAULT_KEEP,
  failAfterPartial = false
}) {
  const folder = validateBackupDir(destDir, dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalPath = path.join(folder, `studio-inventory-full-backup-${stamp}.zip.enc`);
  const key = getDataKey();
  const snapshot = snapshotBackup({ db, settings, appVersion, tables, uploadsDir, inboxDir });
  await writeAtomically(finalPath, async (partial) => {
    const zipStream = createBackupZipStream(snapshot, { onSkip: logSkippedFile });
    try {
      await encryptStreamToFile(zipStream, partial, key);
    } finally {
      zipStream.destroy();
    }
  }, { failAfterPartial });
  const monthlyPath = path.join(folder, `studio-inventory-full-backup-${monthKey(new Date())}-monthly.zip.enc`);
  await copyFileAtomically(finalPath, monthlyPath);
  pruneMonthlyBackups(folder);
  const kept = rotateBackupFiles(folder, keep);
  return { path: finalPath, folder, kept, monthlyPath };
}

async function writeRecoveryCopy({
  db,
  destDir,
  dataDir,
  uploadsDir,
  inboxDir,
  settings,
  appVersion,
  tables
}) {
  const folder = validateBackupDir(destDir, dataDir);
  const finalPath = path.join(folder, RECOVERY_NAME);
  const previousPath = path.join(folder, RECOVERY_PREVIOUS_NAME);
  const stagingPath = path.join(folder, `${RECOVERY_NAME}.new`);
  const snapshot = snapshotBackup({ db, settings, appVersion, tables, uploadsDir, inboxDir });
  await writeStreamAtomically(createBackupZipStream(snapshot, { onSkip: logSkippedFile }), stagingPath);
  const problem = await verifyBackupZip(stagingPath);
  if (problem) {
    try { fs.unlinkSync(stagingPath); } catch { /* keep the current recovery zip */ }
    throw new Error(problem);
  }
  const hadCurrent = fs.existsSync(finalPath);
  if (hadCurrent) {
    if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
    fs.renameSync(finalPath, previousPath);
  }
  try {
    fs.renameSync(stagingPath, finalPath);
  } catch (err) {
    if (!fs.existsSync(finalPath) && fs.existsSync(previousPath)) fs.renameSync(previousPath, finalPath);
    throw err;
  }
  return { path: finalPath, previousPath: hadCurrent ? previousPath : '', folder };
}

// ---------------------------------------------------------------------------
// Reading backups (restore, verification, recovery page)
// ---------------------------------------------------------------------------

const MAX_BACKUP_JSON_BYTES = 1024 * 1024 * 1024;

function openZipFile(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) reject(new Error(`This is not a Studio Inventory backup ZIP (${err.message}).`));
      else resolve(zip);
    });
  });
}

function openEntryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

/** Visit every entry in order; onEntry(entry, openStream) may be async. */
async function forEachZipEntry(zipPath, onEntry) {
  const zip = await openZipFile(zipPath);
  try {
    await new Promise((resolve, reject) => {
      let stopped = false;
      const fail = (err) => { if (!stopped) { stopped = true; reject(err); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!stopped) { stopped = true; resolve(); } });
      zip.on('entry', (entry) => {
        Promise.resolve(onEntry(entry, () => openEntryStream(zip, entry)))
          .then((result) => {
            if (result === false) { stopped = true; resolve(); } else zip.readEntry();
          })
          .catch(fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function readStreamToBuffer(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error('backup.json is larger than Studio Inventory can read');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The bytes of one named entry, or null when the ZIP does not contain it. */
async function readZipEntry(zipPath, name, maxBytes = MAX_BACKUP_JSON_BYTES) {
  let found = null;
  await forEachZipEntry(zipPath, async (entry, openStream) => {
    if (entry.fileName !== name) return true;
    found = await readStreamToBuffer(await openStream(), maxBytes);
    return false;
  });
  return found;
}

async function listZipEntries(zipPath) {
  const names = [];
  await forEachZipEntry(zipPath, (entry) => { names.push(entry.fileName); });
  return names;
}

/** '' when the ZIP is a readable Studio Inventory backup, otherwise the problem. */
async function verifyBackupZip(zipPath) {
  try {
    const raw = await readZipEntry(zipPath, 'backup.json');
    if (!raw) return 'The recovery ZIP is missing backup.json.';
    const backup = JSON.parse(raw.toString('utf8'));
    if (backup?.manifest?.format !== 'studio-inventory-full-backup' || !backup.tables) {
      return 'The recovery ZIP is not a Studio Inventory backup.';
    }
    return '';
  } catch {
    return 'The recovery ZIP could not be read.';
  }
}

/**
 * A plain ZIP path for a backup file. Encrypted backups are decrypted (and
 * authenticated) into a temporary file in tempDir; call cleanup() when done.
 */
async function openBackupZip(filePath, { tempDir = path.dirname(filePath) } = {}) {
  if (!isEncryptedBackupFile(filePath)) return { zipPath: filePath, encrypted: false, cleanup: () => {} };
  fs.mkdirSync(tempDir, { recursive: true });
  const zipPath = path.join(tempDir, `.decrypted-backup-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.zip`);
  await decryptFileToFile(filePath, zipPath, getDataKey());
  return {
    zipPath,
    encrypted: true,
    cleanup: () => { try { fs.unlinkSync(zipPath); } catch { /* already gone */ } }
  };
}

/** Remove decrypted temp copies left behind by a crash during restore. */
function removeDecryptedLeftovers(tempDir) {
  let names = [];
  try { names = fs.readdirSync(tempDir); } catch { return; }
  for (const name of names) {
    if (name.startsWith('.decrypted-backup-')) {
      try { fs.unlinkSync(path.join(tempDir, name)); } catch { /* best effort */ }
    }
  }
}

async function readBackupJson(filePath, options = {}) {
  const opened = await openBackupZip(filePath, options);
  try {
    const raw = await readZipEntry(opened.zipPath, 'backup.json');
    if (!raw) throw new Error('Backup ZIP is missing backup.json');
    return JSON.parse(raw.toString('utf8'));
  } finally {
    opened.cleanup();
  }
}

/**
 * Stream entries under each prefix ("uploads", "manual-inbox") into its target
 * folder. Names that would leave the folder are skipped. Returns files written.
 */
async function extractZipPrefixes(zipPath, targets) {
  let written = 0;
  await forEachZipEntry(zipPath, async (entry, openStream) => {
    const name = String(entry.fileName || '').replace(/\\/g, '/');
    if (name.endsWith('/')) return true;
    for (const { prefix, dir } of targets) {
      if (!name.startsWith(`${prefix}/`)) continue;
      const rel = name.slice(prefix.length + 1);
      if (!rel || rel.split('/').some(part => part === '..' || part === '')) return true;
      const base = path.resolve(dir);
      const dest = path.resolve(base, rel);
      if (!dest.startsWith(base + path.sep)) return true;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await pipeline(await openStream(), fs.createWriteStream(dest));
      written++;
      return true;
    }
    return true;
  });
  return written;
}

module.exports = {
  DEFAULT_KEEP,
  MONTHLY_KEEP,
  RECOVERY_NAME,
  RECOVERY_PREVIOUS_NAME,
  backupDiskWarning,
  warmBackupDiskInfo,
  validateBackupDir,
  buildBackupPayload,
  rotateBackupFiles,
  listBackupZips,
  pruneMonthlyBackups,
  snapshotBackup,
  createBackupZipStream,
  createDownloadZipStream,
  writeStreamAtomically,
  writeFolderBackup,
  writeRecoveryCopy,
  openBackupZip,
  readBackupJson,
  readZipEntry,
  listZipEntries,
  verifyBackupZip,
  extractZipPrefixes,
  removeDecryptedLeftovers
};
