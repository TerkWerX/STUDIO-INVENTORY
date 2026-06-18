const https = require('https');
const path = require('path');

const PKG = require(path.join(__dirname, '..', 'package.json'));
const REPO = process.env.STUDIO_GITHUB_REPO || 'TerkWerX/STUDIO-INVENTORY';
const CACHE_MS = Number(process.env.STUDIO_UPDATE_CACHE_MS) || 6 * 60 * 60 * 1000;

let cache = { at: 0, result: null };

function parseVersion(input) {
  const m = String(input || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function getCurrentVersion() {
  return PKG.version;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'Studio-Inventory',
          Accept: 'application/vnd.github+json'
        },
        timeout: 12000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub API ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('GitHub API timeout')));
    req.end();
  });
}

async function checkForUpdate({ force = false } = {}) {
  if (process.env.STUDIO_SKIP_UPDATE_CHECK === '1') {
    return {
      currentVersion: getCurrentVersion(),
      updateAvailable: false,
      skipped: true
    };
  }

  const now = Date.now();
  if (!force && cache.result && now - cache.at < CACHE_MS) {
    return cache.result;
  }

  const currentVersion = getCurrentVersion();
  const base = {
    currentVersion,
    updateAvailable: false,
    latestVersion: null,
    releaseUrl: `https://github.com/${REPO}/releases/latest`,
    releaseNotes: null,
    publishedAt: null,
    checkedAt: new Date().toISOString(),
    error: null
  };

  try {
    const release = await fetchLatestRelease();
    if (!release) {
      cache = { at: now, result: base };
      return base;
    }

    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const result = {
      ...base,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url || base.releaseUrl,
      releaseNotes: release.body || null,
      publishedAt: release.published_at || null
    };
    cache = { at: now, result };
    return result;
  } catch (err) {
    const result = { ...base, error: err.message };
    cache = { at: now, result };
    return result;
  }
}

module.exports = {
  getCurrentVersion,
  compareVersions,
  checkForUpdate
};