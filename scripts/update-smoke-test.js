const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { releaseInfo, compareVersions, fetchLatestRelease, checkForUpdate } = require('../lib/version');
const manifest = { schemaVersion: 1, version: '2.9.0', downloads: [
  { platform: 'win32', arch: 'x64', kind: 'installer', filename: 'Studio-Inventory-v2.9.0-Windows-Setup.exe', url: 'https://www.terkwerx.com/downloads/studio-inventory/Studio-Inventory-v2.9.0-Windows-Setup.exe', size: 123, sha256: 'a'.repeat(64) },
  { platform: 'darwin', arch: 'arm64', kind: 'installer', filename: 'Studio-Inventory-v2.9.0-macOS.dmg', url: 'https://www.terkwerx.com/downloads/studio-inventory/Studio-Inventory-v2.9.0-macOS.dmg', size: 456, sha256: 'b'.repeat(64) }
] };

test('stable version ordering, no downgrades, exact server architecture', () => {
 assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
 assert.equal(compareVersions('2.8.0', '2.8.0'), 0);
 assert.equal(releaseInfo(manifest, 'win32', 'x64', '2.8.0').updateAvailable, true);
 assert.equal(releaseInfo(manifest, 'win32', 'x64', '3.0.0').updateAvailable, false);
 assert.match(releaseInfo(manifest, 'darwin', 'arm64').installer.filename, /macOS/);
 assert.equal(releaseInfo(manifest, 'darwin', 'x64').installer, null);
 assert.equal(releaseInfo(manifest, 'linux', 'arm64').installer, null);
 assert.throws(() => releaseInfo({ ...manifest, version: '2.9.0-beta' }));
});

test('reject untrusted URLs, invalid checksums, and mismatched installer versions', () => {
 for (const change of [
  { url: 'https://evil.example/payload.exe' },
  { url: 'http://www.terkwerx.com/downloads/studio-inventory/file.exe' },
  { url: 'https://www.terkwerx.com:444/downloads/studio-inventory/file.exe' },
  { url: 'https://www.terkwerx.com/downloads/studio-inventory/../../payload.exe' },
  { sha256: 'bad' }, { size: -1 }, { filename: 'Studio-Inventory-v2.8.0-Windows-Setup.exe' }
 ]) assert.throws(() => releaseInfo({ ...manifest, downloads: [{ ...manifest.downloads[0], ...change }] }, 'win32', 'x64'));
});

test('HTTPS errors, malformed feeds, redirects, cache, and forced refresh', async t => {
 let count = 0;
 let statusCode = 200;
 let body = JSON.stringify(manifest);
 let location;
 t.mock.method(https, 'get', (url, options, callback) => {
  count++;
  const req = new EventEmitter();
  req.destroy = error => { req.emit('error', error); req.emit('close'); };
  process.nextTick(() => {
   const res = new PassThrough();
   res.statusCode = statusCode; res.headers = { location };
   callback(res);
   res.end(body);
   req.emit('close');
  });
  return req;
 });
 const before = process.env.STUDIO_SKIP_UPDATE_CHECK;
 delete process.env.STUDIO_SKIP_UPDATE_CHECK;
 try {
  assert.equal((await checkForUpdate({ force: true })).latestVersion, '2.9.0');
  const cached = count;
  await checkForUpdate(); assert.equal(count, cached);
  await checkForUpdate({ force: true }); assert.equal(count, cached + 1);
  statusCode = 404;
  const failure = await checkForUpdate({ force: true });
  assert.match(failure.error, /404/); assert.equal(failure.updateAvailable, false);
  statusCode = 200; body = '<html>Not JSON</html>';
  await assert.rejects(fetchLatestRelease(), /invalid update manifest/);
  body = 'x'.repeat(262145);
  await assert.rejects(fetchLatestRelease(), /too large/);
  statusCode = 302; location = 'https://evil.example/latest.json';
  await assert.rejects(fetchLatestRelease(), /Invalid TerkWerX/);
  location = 'https://terkwerx.com/downloads/studio-inventory/latest.json';
  await assert.rejects(fetchLatestRelease(), /Too many/);
  process.env.STUDIO_SKIP_UPDATE_CHECK = '1';
  assert.equal((await checkForUpdate({ force: true })).skipped, true);
 } finally {
  if (before === undefined) delete process.env.STUDIO_SKIP_UPDATE_CHECK;
  else process.env.STUDIO_SKIP_UPDATE_CHECK = before;
 }
});
