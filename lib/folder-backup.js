const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { getDataKey } = require('./data-key');
const { encryptBackupBuffer, decryptBackupBuffer, isEncryptedBackup } = require('./backup-crypto');

const BACKUP_NAME = /^studio-inventory-full-backup-.+\.zip(\.enc)?$/;
const MONTHLY_BACKUP = /^studio-inventory-full-backup-(\d{4}-\d{2})-monthly\.zip\.enc$/;
const RECOVERY_NAME = 'studio-inventory-recovery.zip';
const RECOVERY_PREVIOUS_NAME = 'studio-inventory-recovery-previous.zip';
const DEFAULT_KEEP = 7;
const MONTHLY_KEEP = 6;

const volumeCache = new Map();

function windowsVolume(dir) {
  const root = path.parse(path.resolve(dir)).root;
  if (root.startsWith('\\\\')) return { kind: 'network', label: root };
  const letter = root.slice(0, 1);
  if (!/^[a-z]$/i.test(letter)) return { kind: 'unknown', label: root || dir };
  const key = letter.toUpperCase();
  if (volumeCache.has(key)) return volumeCache.get(key);
  const script = `
$ErrorActionPreference = 'Stop'
$part = Get-Partition -DriveLetter '${key}' | Select-Object -First 1
$disk = Get-Disk -Number $part.DiskNumber
$vol = Get-Volume -DriveLetter '${key}'
@{ Number = $disk.Number; Name = $disk.FriendlyName; Bus = [string]$disk.BusType; DriveType = [string]$vol.DriveType } | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000
  });
  let info = { kind: 'unknown', letter: key, label: `${key}:` };
  if (result.status === 0 && result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout.trim());
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
  return info;
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

function writeBufferAtomically(buffer, finalPath, { failAfterPartial = false } = {}) {
  const partial = `${finalPath}.partial`;
  try {
    fs.writeFileSync(partial, buffer);
    if (failAfterPartial) throw new Error('Simulated backup write failure');
    fs.renameSync(partial, finalPath);
  } catch (err) {
    try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch { /* leave the previous backup alone */ }
    throw err;
  }
}

function writeZipAtomically(zip, finalPath, { failAfterPartial = false } = {}) {
  const partial = `${finalPath}.partial`;
  try {
    zip.writeZip(partial);
    if (failAfterPartial) throw new Error('Simulated backup write failure');
    fs.renameSync(partial, finalPath);
  } catch (err) {
    try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch { /* leave the previous zip alone */ }
    throw err;
  }
}

function createBackupZip({ database, settings, appVersion, tables, uploadsDir, inboxDir }) {
  const zip = new AdmZip();
  const payload = buildBackupPayload(database, { settings, appVersion, tables });
  zip.addFile('backup.json', Buffer.from(JSON.stringify(payload, null, 2), 'utf8'));
  if (uploadsDir && fs.existsSync(uploadsDir)) zip.addLocalFolder(uploadsDir, 'uploads');
  if (inboxDir && fs.existsSync(inboxDir)) zip.addLocalFolder(inboxDir, 'manual-inbox');
  return zip;
}

function consistentZip(db, options) {
  return db.transaction(() => createBackupZip({ database: db, ...options }))();
}

async function buildDownloadZip({ db, settings, appVersion, tables, uploadsDir, inboxDir }) {
  return consistentZip(db, { settings, appVersion, tables, uploadsDir, inboxDir });
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
  const zip = consistentZip(db, { settings, appVersion, tables, uploadsDir, inboxDir });
  const encrypted = encryptBackupBuffer(zip.toBuffer(), getDataKey());
  writeBufferAtomically(encrypted, finalPath, { failAfterPartial });
  const monthlyPath = path.join(folder, `studio-inventory-full-backup-${monthKey(new Date())}-monthly.zip.enc`);
  writeBufferAtomically(encrypted, monthlyPath);
  pruneMonthlyBackups(folder);
  const kept = rotateBackupFiles(folder, keep);
  return { path: finalPath, folder, kept, monthlyPath };
}

function writeRecoveryCopy({
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
  const zip = consistentZip(db, { settings, appVersion, tables, uploadsDir, inboxDir });
  if (!zip.getEntry('backup.json')) throw new Error('Recovery copy is missing backup.json');
  writeZipAtomically(zip, stagingPath);
  const written = new AdmZip(stagingPath);
  if (!written.getEntry('backup.json')) {
    try { fs.unlinkSync(stagingPath); } catch { /* keep the current recovery zip */ }
    throw new Error('Recovery copy is missing backup.json');
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

function readBackupZip(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (isEncryptedBackup(bytes)) return new AdmZip(decryptBackupBuffer(bytes, getDataKey()));
  return new AdmZip(bytes);
}

module.exports = {
  DEFAULT_KEEP,
  MONTHLY_KEEP,
  RECOVERY_NAME,
  RECOVERY_PREVIOUS_NAME,
  backupDiskWarning,
  validateBackupDir,
  buildBackupPayload,
  writeZipAtomically,
  rotateBackupFiles,
  listBackupZips,
  pruneMonthlyBackups,
  createBackupZip,
  buildDownloadZip,
  writeFolderBackup,
  writeRecoveryCopy,
  readBackupZip
};
