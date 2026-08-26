const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_PATH = path.join(
  process.env.STUDIO_DATA_DIR
    ? path.resolve(process.env.STUDIO_DATA_DIR)
    : path.join(__dirname, '..', 'data'),
  'studio-settings.json'
);

function defaultSettings() {
  return {
    guestEnabled: false,
    guestToken: '',
    ownerPinHash: '',
    ownerPinSalt: '',
    ownerSessionToken: '',
    ownerSessionTokens: [],
    scanLinkSecret: ''
  };
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

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      const initial = normalizeSettings().settings;
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }
    const normalized = normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
    if (normalized.changed) {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(normalized.settings, null, 2));
    }
    return normalized.settings;
  } catch {
    return normalizeSettings().settings;
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
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
  readSettings,
  writeSettings,
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
