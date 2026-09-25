#!/usr/bin/env node
// Run after copying tested release downloads into the website folder.
// node scripts/publish-update-manifest.js "J:/TerkWerX page" 2.8.0 "Release notes"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { releaseInfo } = require('../lib/version');
const [website, version = require('../package.json').version, releaseNotes = ''] = process.argv.slice(2);
if (!website || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/publish-update-manifest.js <website folder> [version] [release notes]');
  process.exit(1);
}
const dir = path.resolve(website, 'downloads/studio-inventory');
const targets = [
  ['win32', 'x64', 'installer', 'Windows-Setup.exe'],
  ['win32', 'x64', 'portable', 'Windows.zip'],
  ['darwin', 'arm64', 'installer', 'macOS.dmg'],
  ['darwin', 'arm64', 'portable', 'macOS.zip'],
  ['linux', 'x64', 'installer', 'Linux-x64.tar.gz'],
  ['linux', 'x64', 'portable', 'Linux-x64.zip']
];
const downloads = targets.map(([platform, arch, kind, suffix]) => {
  const filename = `Studio-Inventory-v${version}-${suffix}`;
  const file = path.join(dir, filename);
  const size = fs.statSync(file).size;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { platform, arch, kind, filename, url: `https://www.terkwerx.com/downloads/studio-inventory/${filename}`, size, sha256 };
});
const manifest = { schemaVersion: 1, version, publishedAt: new Date().toISOString(), releaseNotes, downloads };
for (const [platform, arch] of targets) releaseInfo(manifest, platform, arch);
const dest = path.join(dir, 'latest.json');
fs.writeFileSync(dest + '.tmp', JSON.stringify(manifest, null, 2) + '\n');
fs.renameSync(dest + '.tmp', dest);
console.log(`Wrote ${dest} with ${downloads.length} verified download files.`);
