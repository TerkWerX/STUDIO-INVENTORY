const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_PATH = path.join(
  process.env.STUDIO_DATA_DIR
    ? path.resolve(process.env.STUDIO_DATA_DIR)
    : path.join(__dirname, '..', 'data'),
  'studio-settings.json'
);

const SECRET_KEYS = [
  'guestToken', 'ownerPinHash', 'ownerPinSalt', 'ownerSessionToken', 'ownerSessionTokens', 'scanLinkSecret'
];

function defaultSettings() {
  return {
    guestEnabled: false,
    guestToken: '',
    ownerPinHash: '',
    ownerPinSalt: '',
    ownerSessionToken: '',
    ownerSessionTokens: [],
    scanLinkSecret: '',
    autoBackupDir: '',
    autoBackupKeep: 7,
    autoBackupLastAt: '',
    autoBackupLastPath: '',
    autoBackupLastError: '',
    catalogEncryption: '',
    recoveryKeyShown: false,
    recoveryKeyConfirmed: false,
    // Off by default: looking up a logo sends the brand's website domain to
    // third-party icon services. Manual "Fetch logo" buttons still work.
    brandLogoLookups: false,
    // Off by default: DYMO's framework is the one script loaded from another
    // origin, so it stays out of the page's script-src until it is turned on.
    dymoLabelPrinting: false
  };
}

const BACKUP_PATH = `${SETTINGS_PATH}.bak`;
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN']);

let jsonCache = null;          // { stamp, data } for the last good read of the JSON file
let lastGoodSettings = null;   // last fully merged settings returned by readSettings()
let secretsTableReady = false;
let unreadableStampLogged = '';

function database() {
  return require('../db').db;
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function statOrNull(file) {
  try { return fs.statSync(file); } catch { return null; }
}

function stampOf(stat) {
  return stat ? `${stat.mtimeMs}:${stat.size}` : '';
}

function hasSecretValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return !!value;
}

/**
 * Read and parse a JSON settings file. Retries briefly because antivirus,
 * backup and sync tools on Windows can hold a just-written file for a moment.
 */
function readJsonFile(file) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('settings file does not contain a JSON object');
      }
      return { ok: true, data };
    } catch (err) {
      lastError = err;
      if (err.code === 'ENOENT') break;
      if (err instanceof SyntaxError || !RETRYABLE_CODES.has(err.code)) {
        // A half-written file will not fix itself; one short retry covers a racing writer.
        if (attempt >= 1) break;
      }
      pause(40 * (attempt + 1));
    }
  }
  return { ok: false, error: lastError };
}

/** Write via a temp file and rename, so a crash never leaves a truncated file. */
function atomicWriteFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!RETRYABLE_CODES.has(err.code) || attempt >= 9) {
        try { fs.unlinkSync(tmp); } catch { /* leave nothing behind */ }
        throw err;
      }
      pause(50 * (attempt + 1));
    }
  }
}

function settingsReadError(detail) {
  return Object.assign(new Error(
    `Studio Inventory could not read ${SETTINGS_PATH} (${detail}). It will not create new secrets, `
    + 'because that would invalidate every printed QR label, guest link and the owner PIN. '
    + `Restore the file (or ${path.basename(BACKUP_PATH)}) from a backup, or delete both files to start fresh.`
  ), { status: 503, expose: true });
}

/**
 * The JSON half of the settings. A missing file means a fresh install. An
 * unreadable file is recovered from the .bak copy, or from the last good read
 * in memory; it is never silently replaced with new defaults.
 */
function loadJsonSettings() {
  const stat = statOrNull(SETTINGS_PATH);
  if (!stat) {
    const backup = statOrNull(BACKUP_PATH) ? readJsonFile(BACKUP_PATH) : null;
    if (backup?.ok) {
      console.warn(`  ${path.basename(SETTINGS_PATH)} was missing; restored it from ${path.basename(BACKUP_PATH)}.`);
      atomicWriteFile(SETTINGS_PATH, JSON.stringify(backup.data, null, 2));
      jsonCache = { stamp: stampOf(statOrNull(SETTINGS_PATH)), data: backup.data };
      return { exists: true, data: backup.data };
    }
    return { exists: false, data: {} };
  }

  const stamp = stampOf(stat);
  if (jsonCache && jsonCache.stamp === stamp) return { exists: true, data: jsonCache.data };

  const main = readJsonFile(SETTINGS_PATH);
  if (main.ok) {
    jsonCache = { stamp, data: main.data };
    return { exists: true, data: main.data };
  }

  const backup = statOrNull(BACKUP_PATH) ? readJsonFile(BACKUP_PATH) : null;
  if (backup?.ok) {
    const aside = SETTINGS_PATH.replace(/\.json$/, `.unreadable-${Date.now()}.json`);
    try { fs.renameSync(SETTINGS_PATH, aside); } catch { /* still restore below */ }
    atomicWriteFile(SETTINGS_PATH, JSON.stringify(backup.data, null, 2));
    jsonCache = { stamp: stampOf(statOrNull(SETTINGS_PATH)), data: backup.data };
    console.warn(`  ${path.basename(SETTINGS_PATH)} could not be read (${main.error?.message}); restored it from ${path.basename(BACKUP_PATH)}.`);
    return { exists: true, data: backup.data };
  }

  if (jsonCache) {
    if (unreadableStampLogged !== stamp) {
      unreadableStampLogged = stamp;
      console.error(`  ${path.basename(SETTINGS_PATH)} could not be read (${main.error?.message}); keeping the settings already in memory.`);
    }
    return { exists: true, data: jsonCache.data, stale: true };
  }
  throw settingsReadError(main.error?.message || 'unknown error');
}

/** Secrets row from the encrypted catalog: null when absent; throws if unreadable. */
function readSecretRow() {
  const db = database();
  if (!db) return null;
  if (!secretsTableReady) {
    const ready = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_secrets'"
    ).get();
    if (!ready) return null;
    secretsTableReady = true;
  }
  const row = db.prepare('SELECT * FROM studio_secrets WHERE id = 1').get();
  if (!row) return null;
  let tokens = [];
  try { tokens = JSON.parse(row.owner_session_tokens || '[]'); } catch { tokens = []; }
  return {
    guestToken: row.guest_token || '',
    scanLinkSecret: row.scan_link_secret || '',
    ownerPinHash: row.owner_pin_hash || '',
    ownerPinSalt: row.owner_pin_salt || '',
    ownerSessionToken: row.owner_session_token || '',
    ownerSessionTokens: Array.isArray(tokens) ? tokens : []
  };
}

function writeSecretRow(settings) {
  database().prepare(`
    INSERT INTO studio_secrets (
      id, guest_token, scan_link_secret, owner_pin_hash, owner_pin_salt, owner_session_token, owner_session_tokens
    ) VALUES (1, @guestToken, @scanLinkSecret, @ownerPinHash, @ownerPinSalt, @ownerSessionToken, @ownerSessionTokens)
    ON CONFLICT(id) DO UPDATE SET
      guest_token = @guestToken,
      scan_link_secret = @scanLinkSecret,
      owner_pin_hash = @ownerPinHash,
      owner_pin_salt = @ownerPinSalt,
      owner_session_token = @ownerSessionToken,
      owner_session_tokens = @ownerSessionTokens
  `).run({
    guestToken: settings.guestToken || '',
    scanLinkSecret: settings.scanLinkSecret || '',
    ownerPinHash: settings.ownerPinHash || '',
    ownerPinSalt: settings.ownerPinSalt || '',
    ownerSessionToken: settings.ownerSessionToken || '',
    ownerSessionTokens: JSON.stringify(settings.ownerSessionTokens || [])
  });
}

function withoutSecrets(settings) {
  const next = { ...settings };
  for (const key of SECRET_KEYS) delete next[key];
  return next;
}

function normalizeSettings(value = {}) {
  const next = { ...defaultSettings(), ...value };
  let changed = false;

  if (!next.guestToken) {
    next.guestToken = crypto.randomBytes(24).toString('hex');
    changed = true;
  }
  if (!next.scanLinkSecret) {
    next.scanLinkSecret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }
  if (!Array.isArray(next.ownerSessionTokens)) {
    next.ownerSessionTokens = [];
    changed = true;
  }

  next.ownerSessionTokens = next.ownerSessionTokens
    .filter(entry => entry && typeof entry.token === 'string' && entry.token.length >= 32)
    .slice(-20);

  // Preserve sessions created by versions that stored a single token.
  if (next.ownerSessionToken
      && !next.ownerSessionTokens.some(entry => entry.token === next.ownerSessionToken)) {
    next.ownerSessionTokens.push({ token: next.ownerSessionToken, createdAt: new Date().toISOString() });
    next.ownerSessionTokens = next.ownerSessionTokens.slice(-20);
    changed = true;
  }

  return { settings: next, changed };
}

function writeJsonSettings(settings, includeSecrets) {
  const body = includeSecrets ? settings : withoutSecrets(settings);
  const text = JSON.stringify(body, null, 2);
  atomicWriteFile(SETTINGS_PATH, text);
  // The .bak copy always mirrors the last complete write.
  atomicWriteFile(BACKUP_PATH, text);
  jsonCache = { stamp: stampOf(statOrNull(SETTINGS_PATH)), data: JSON.parse(text) };
}

let tempFilesChecked = false;

/** Remove temp files left by a crash between write and rename (they hold secrets). */
function removeStaleTempFiles() {
  if (tempFilesChecked) return;
  tempFilesChecked = true;
  const dir = path.dirname(SETTINGS_PATH);
  const base = path.basename(SETTINGS_PATH);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if ((name.startsWith(`${base}.`) && name.endsWith('.tmp'))
        && !name.startsWith(`${base}.${process.pid}.`)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* best effort */ }
    }
  }
}

function readSettings() {
  removeStaleTempFiles();
  try {
    const json = loadJsonSettings();
    const stored = readSecretRow();
    const inDatabase = !!stored || json.data.catalogEncryption === 'armed';
    const { settings, changed } = normalizeSettings({ ...json.data, ...(stored || {}) });

    if (!json.stale) {
      if (inDatabase) {
        if (changed || !stored) writeSecretRow(settings);
        const jsonHoldsSecrets = SECRET_KEYS.some(key => hasSecretValue(json.data[key]));
        if (changed || jsonHoldsSecrets || !json.exists) writeJsonSettings(settings, false);
      } else if (changed || !json.exists) {
        writeJsonSettings(settings, true);
      }
    }
    lastGoodSettings = settings;
    return settings;
  } catch (err) {
    // Never fall back to fresh defaults: new secrets would break every label and link.
    if (lastGoodSettings) {
      console.error('  Settings read failed; using the settings already in memory:', err.message);
      return lastGoodSettings;
    }
    throw err;
  }
}

function writeSettings(patch) {
  const current = readSettings();
  const next = { ...current, ...patch };
  const inDatabase = !!readSecretRow() || next.catalogEncryption === 'armed';
  if (inDatabase) {
    writeSecretRow(next);
    writeJsonSettings(next, false);
  } else {
    writeJsonSettings(next, true);
  }
  lastGoodSettings = next;
  return next;
}

function commitCatalogEncryption() {
  const current = readSettings();
  writeSecretRow(current);
  writeJsonSettings({ ...current, catalogEncryption: 'armed' }, false);
  return readSettings();
}

function regenerateGuestToken() {
  return writeSettings({ guestToken: crypto.randomBytes(24).toString('hex') });
}

function isValidGuestToken(token) {
  const s = readSettings();
  return s.guestEnabled && token && token === s.guestToken;
}

function hashOwnerPin(pin, salt) {
  return crypto.pbkdf2Sync(String(pin || ''), salt, 120000, 32, 'sha256').toString('hex');
}

function setOwnerPin(pin) {
  const clean = String(pin || '').trim();
  if (clean.length < 6) {
    throw new Error('Owner PIN must be at least 6 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  return writeSettings({
    ownerPinSalt: salt,
    ownerPinHash: hashOwnerPin(clean, salt),
    ownerSessionToken: '',
    ownerSessionTokens: []
  });
}

function verifyOwnerPin(pin) {
  const s = readSettings();
  if (!s.ownerPinHash || !s.ownerPinSalt) return false;
  const actual = Buffer.from(String(s.ownerPinHash), 'hex');
  const expected = Buffer.from(hashOwnerPin(pin, s.ownerPinSalt), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createOwnerSessionToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const s = readSettings();
  const ownerSessionTokens = [
    ...(s.ownerSessionTokens || []),
    { token, createdAt: new Date().toISOString() }
  ].slice(-20);
  writeSettings({ ownerSessionToken: '', ownerSessionTokens });
  return token;
}

function revokeOwnerSessionToken(token) {
  const clean = String(token || '');
  if (!clean) return readSettings();
  const s = readSettings();
  return writeSettings({
    ownerSessionToken: s.ownerSessionToken === clean ? '' : s.ownerSessionToken,
    ownerSessionTokens: (s.ownerSessionTokens || []).filter(entry => entry.token !== clean)
  });
}

function isValidOwnerSessionToken(token) {
  const clean = String(token || '');
  if (!clean) return false;
  const s = readSettings();
  const candidates = [
    s.ownerSessionToken,
    ...(s.ownerSessionTokens || []).map(entry => entry.token)
  ].filter(Boolean);
  return candidates.some(candidate => {
    const actual = Buffer.from(String(candidate));
    const expected = Buffer.from(clean);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

function itemScanToken(itemId) {
  const secret = readSettings().scanLinkSecret;
  return crypto.createHmac('sha256', secret)
    .update(`studio-inventory:item:${String(itemId)}`)
    .digest('base64url');
}

function isValidItemScanToken(itemId, token) {
  if (!token) return false;
  const actual = Buffer.from(itemScanToken(itemId));
  const expected = Buffer.from(String(token));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function ownerPinConfigured() {
  const s = readSettings();
  return !!(s.ownerPinHash && s.ownerPinSalt);
}

module.exports = {
  SETTINGS_PATH,
  BACKUP_PATH,
  readSettings,
  writeSettings,
  commitCatalogEncryption,
  regenerateGuestToken,
  isValidGuestToken,
  setOwnerPin,
  verifyOwnerPin,
  createOwnerSessionToken,
  revokeOwnerSessionToken,
  isValidOwnerSessionToken,
  itemScanToken,
  isValidItemScanToken,
  ownerPinConfigured
};
