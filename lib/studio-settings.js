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
    guestToken: crypto.randomBytes(24).toString('hex')
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

module.exports = {
  SETTINGS_PATH,
  readSettings,
  writeSettings,
  regenerateGuestToken,
  isValidGuestToken
};