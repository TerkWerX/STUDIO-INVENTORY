const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { getDataKey, requireExistingDataKey } = require('./data-key');

function isPlainSqlite(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    return read >= 15 && buf.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch {
    return false;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function passphrase(key) {
  return key.toString('hex');
}

function configure(database) {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}

function openWithKey(file, key) {
  const database = new Database(file);
  try {
    database.pragma(`key='${passphrase(key)}'`);
    database.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (err) {
    try { database.close(); } catch { /* the key did not belong */ }
    throw err;
  }
  return configure(database);
}

function removePlainCopy(file) {
  for (const suffix of ['.plain', '.plain-wal', '.plain-shm']) {
    const target = file + suffix;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
        break;
      } catch (err) {
        if (attempt === 7) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
      }
    }
  }
}

function migratePlain(file, key) {
  const copy = `${file}.plain`;
  fs.copyFileSync(file, copy);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, `${copy}${ext}`);
  }
  let database;
  try {
    database = new Database(file);
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.pragma('journal_mode = DELETE');
    database.pragma(`rekey='${passphrase(key)}'`);
    database.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    database.close();
    database = null;
    const checked = openWithKey(file, key);
    removePlainCopy(file);
    return checked;
  } catch (err) {
    if (database) {
      try { database.close(); } catch { /* restore the plain file */ }
    }
    fs.copyFileSync(copy, file);
    for (const ext of ['-wal', '-shm']) {
      const saved = `${copy}${ext}`;
      if (fs.existsSync(saved)) fs.copyFileSync(saved, file + ext);
    }
    throw new Error(`Could not encrypt the existing catalog, so the original database was left in place. ${err.message}`);
  }
}

function encryptionArmed(file) {
  if (process.env.STUDIO_ENCRYPT_NOW === '1') return true;
  const settingsPath = path.join(path.dirname(file), 'studio-settings.json');
  for (const candidate of [settingsPath, `${settingsPath}.bak`]) {
    try {
      const settings = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return settings.catalogEncryption === 'armed';
    } catch { /* try the backup copy */ }
  }
  return false;
}

function openWithSuppliedKey(file, recoveryKey) {
  const key = Buffer.from(String(recoveryKey || '').trim(), 'base64');
  if (key.length !== 32) {
    const err = new Error('That recovery key is not valid.');
    err.code = 'CATALOG_LOCKED';
    throw err;
  }
  return openWithKey(file, key);
}

function openInventoryDatabase(file) {
  const exists = fs.existsSync(file) && fs.statSync(file).size > 0;
  if (exists && !isPlainSqlite(file)) {
    return openWithKey(file, requireExistingDataKey());
  }
  if (!encryptionArmed(file)) {
    return configure(new Database(file));
  }
  const key = getDataKey();
  if (!exists || fs.statSync(file).size === 0) {
    const database = new Database(file);
    database.pragma(`rekey='${passphrase(key)}'`);
    return configure(database);
  }
  return migratePlain(file, key);
}

module.exports = {
  openInventoryDatabase,
  openWithSuppliedKey,
  isPlainSqlite
};
