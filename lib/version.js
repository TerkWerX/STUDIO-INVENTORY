const https = require('https');
const PKG = require('../package.json');

const WEBSITE = 'https://www.terkwerx.com';
const RELEASE_URL = `${WEBSITE}/project-studio-inventory.html#download`;
const MANIFEST_URL = `${WEBSITE}/downloads/studio-inventory/latest.json`;
const CACHE_MS = Number(process.env.STUDIO_UPDATE_CACHE_MS) || 6 * 60 * 60 * 1000;
let cache = { at: 0, result: null };
let pending = null;

function parseVersion(input) {
  const match = String(input || '').match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function getCurrentVersion() { return PKG.version; }

function trustedUrl(input, download = false) {
  const url = new URL(input, WEBSITE);
  if (url.protocol !== 'https:' || !['www.terkwerx.com', 'terkwerx.com'].includes(url.hostname)
      || url.port || url.username || url.password
      || (download && !url.pathname.startsWith('/downloads/studio-inventory/'))) {
    throw new Error('Invalid TerkWerX update URL');
  }
  return url.href;
}

function fetchLatestRelease(url = MANIFEST_URL, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(trustedUrl(url), {
      headers: { 'User-Agent': 'Studio-Inventory', Accept: 'application/json', 'Cache-Control': 'no-cache' }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        try {
          if (redirects >= 3 || !res.headers.location) throw new Error('Too many update redirects');
          resolve(fetchLatestRelease(trustedUrl(new URL(res.headers.location, url).href), redirects + 1));
        } catch (error) { reject(error); }
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`TerkWerX update service returned HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) { req.destroy(new Error('Update manifest is too large')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('TerkWerX returned an invalid update manifest')); }
      });
    });
    // Bound the whole request, including DNS and a stalled response.
    const timer = setTimeout(() => req.destroy(new Error('TerkWerX update check timed out')), 12000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}

function releaseInfo(manifest, platform = process.platform, arch = process.arch, currentVersion = getCurrentVersion()) {
  if (!manifest || manifest.schemaVersion !== 1 || !parseVersion(manifest.version)
      || !Array.isArray(manifest.downloads)) throw new Error('Invalid TerkWerX release manifest');
  const download = manifest.downloads.find(file => file.platform === platform && file.arch === arch && file.kind === 'installer');
  let installer = null;
  if (download) {
    if (!/^[a-f0-9]{64}$/i.test(download.sha256) || !Number.isSafeInteger(download.size) || download.size <= 0
        || typeof download.filename !== 'string' || !/^[\w.-]+$/.test(download.filename)
        || !download.filename.startsWith(`Studio-Inventory-v${manifest.version}-`)) {
      throw new Error('Invalid installer metadata');
    }
    const url = trustedUrl(download.url, true);
    if (decodeURIComponent(new URL(url).pathname.split('/').pop()) !== download.filename) throw new Error('Installer filename does not match URL');
    installer = { filename: download.filename, url, size: download.size, sha256: download.sha256.toLowerCase() };
  }
  return {
    currentVersion,
    latestVersion: manifest.version,
    updateAvailable: compareVersions(manifest.version, currentVersion) > 0,
    releaseUrl: RELEASE_URL,
    releaseNotes: typeof manifest.releaseNotes === 'string' ? manifest.releaseNotes.slice(0, 10000) : null,
    publishedAt: typeof manifest.publishedAt === 'string' ? manifest.publishedAt : null,
    platform, arch, installer, source: 'TerkWerX', error: null
  };
}

async function checkForUpdate({ force = false } = {}) {
  const base = {
    currentVersion: getCurrentVersion(), latestVersion: null, updateAvailable: false,
    releaseUrl: RELEASE_URL, installer: null, platform: process.platform, arch: process.arch,
    source: 'TerkWerX', checkedAt: new Date().toISOString(), error: null
  };
  if (process.env.STUDIO_SKIP_UPDATE_CHECK === '1') return { ...base, skipped: true };
  if (pending) return pending;
  const maxAge = cache.result?.error ? 60000 : CACHE_MS;
  if (!force && cache.result && Date.now() - cache.at < maxAge) return cache.result;
  pending = (async () => {
    let result;
    try { result = { ...base, ...releaseInfo(await fetchLatestRelease()) }; }
    catch (error) { result = { ...base, error: error.message }; }
    cache = { at: Date.now(), result };
    return result;
  })();
  try { return await pending; }
  finally { pending = null; }
}

module.exports = { getCurrentVersion, compareVersions, checkForUpdate, releaseInfo, fetchLatestRelease };
