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
    guestToken: crypto.randomBytes(24).toString('hex'),
    ownerPinHash: '',
    ownerPinSalt: '',
    ownerSessionToken: ''
  };
}

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      const initial = defaultSettings();
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }
    return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return defaultSettings();
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
  if (clean.length < 4) {
    throw new Error('Owner PIN must be at least 4 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  return writeSettings({
    ownerPinSalt: salt,
    ownerPinHash: hashOwnerPin(clean, salt),
    ownerSessionToken: crypto.randomBytes(32).toString('hex')
  });
}

function verifyOwnerPin(pin) {
  const s = readSettings();
  if (!s.ownerPinHash || !s.ownerPinSalt) return false;
  const actual = Buffer.from(String(s.ownerPinHash), 'hex');
  const expected = Buffer.from(hashOwnerPin(pin, s.ownerPinSalt), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function rotateOwnerSessionToken() {
  return writeSettings({ ownerSessionToken: crypto.randomBytes(32).toString('hex') });
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
  rotateOwnerSessionToken,
  ownerPinConfigured
};
