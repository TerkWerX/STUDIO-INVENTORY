const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KEY_FILE = 'catalog-key.blob';
let cached = null;
let cachedDir = '';

function keyDir() {
  if (process.env.STUDIO_KEY_DIR) return path.resolve(process.env.STUDIO_KEY_DIR);
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Studio Inventory');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Studio Inventory');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'studio-inventory');
}

function keyPath() {
  return path.join(keyDir(), KEY_FILE);
}

function runPowerShell(script, input) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Windows could not unlock the catalog key').trim());
  }
  return result.stdout.trim();
}

function protectWindows(key) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;
  return Buffer.from(runPowerShell(script, key.toString('base64')), 'base64');
}

function unprotectWindows(blob) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;
  return Buffer.from(runPowerShell(script, blob.toString('base64')), 'base64');
}

function protectDarwin(key) {
  const result = spawnSync('security', [
    'add-generic-password', '-U',
    '-a', 'studio-inventory',
    '-s', 'Studio Inventory catalog key',
    '-w', key.toString('base64')
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || 'macOS Keychain rejected the catalog key').trim());
}

function unprotectDarwin() {
  const result = spawnSync('security', [
    'find-generic-password',
    '-a', 'studio-inventory',
    '-s', 'Studio Inventory catalog key',
    '-w'
  ], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return Buffer.from(result.stdout.trim(), 'base64');
}

function protectLinux(key) {
  const result = spawnSync('secret-tool', [
    'store', '--label=Studio Inventory catalog key',
    'service', 'studio-inventory',
    'account', 'catalog-key'
  ], { input: key.toString('base64'), encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error('Install libsecret (secret-tool) so the catalog key can live outside the data folder.');
  }
  if (result.status !== 0) throw new Error((result.stderr || 'libsecret rejected the catalog key').trim());
}

function unprotectLinux() {
  const result = spawnSync('secret-tool', [
    'lookup', 'service', 'studio-inventory', 'account', 'catalog-key'
  ], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  return text ? Buffer.from(text, 'base64') : null;
}

/**
 * On macOS and Linux the key normally lives in the Keychain / libsecret.
 * When STUDIO_KEY_DIR is set, it is kept in a file in that folder instead
 * (owner-only permissions). Tests use this so they never touch a developer's
 * real Keychain entry, and headless Linux machines without a desktop keyring
 * can use it to keep the key on separate storage.
 */
function usesKeyFolder() {
  return process.platform !== 'win32' && !!process.env.STUDIO_KEY_DIR;
}

function readWrapped() {
  if (usesKeyFolder()) {
    const file = keyPath();
    if (!fs.existsSync(file)) return null;
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  }
  if (process.platform === 'darwin') return unprotectDarwin();
  if (process.platform === 'linux') return unprotectLinux();
  const file = keyPath();
  if (!fs.existsSync(file)) return null;
  return unprotectWindows(fs.readFileSync(file));
}

function writeWrapped(key) {
  if (usesKeyFolder()) {
    const file = keyPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    return;
  }
  if (process.platform === 'darwin') return protectDarwin(key);
  if (process.platform === 'linux') return protectLinux(key);
  const file = keyPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, protectWindows(key));
}

function remember(key) {
  cached = key;
  cachedDir = keyDir();
  return key;
}

function catalogLock(message) {
  const err = new Error(message);
  err.code = 'CATALOG_LOCKED';
  return err;
}

function getDataKey() {
  if (cached && cachedDir === keyDir()) return cached;
  try {
    const existing = readWrapped();
    if (existing && existing.length === 32) return remember(existing);
  } catch (err) {
    throw catalogLock(`Catalog key could not be unlocked for this account. Studio Inventory stopped so it would not replace the encrypted database. ${err.message}`);
  }
  const created = crypto.randomBytes(32);
  writeWrapped(created);
  return remember(created);
}

function requireExistingDataKey() {
  if (cached && cachedDir === keyDir()) return cached;
  let existing = null;
  try {
    existing = readWrapped();
  } catch (err) {
    throw catalogLock(`Catalog key could not be unlocked for this account. Studio Inventory stopped so it would not replace the encrypted database. ${err.message}`);
  }
  if (!existing || existing.length !== 32) {
    throw catalogLock('Catalog key is missing. Studio Inventory will not create a new key for an encrypted database.');
  }
  return remember(existing);
}

function installRecoveryKey(text) {
  const key = Buffer.from(String(text || '').trim(), 'base64');
  if (key.length !== 32) throw new Error('That recovery key is not valid.');
  writeWrapped(key);
  return remember(key);
}

module.exports = {
  getDataKey,
  requireExistingDataKey,
  installRecoveryKey,
  keyDir
};
