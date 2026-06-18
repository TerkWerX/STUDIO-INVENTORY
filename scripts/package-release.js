#!/usr/bin/env node
/**
 * Build a self-contained release folder (with node_modules) for Windows or macOS.
 * Usage: node scripts/package-release.js <win|mac> [outputDir]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const platform = (process.argv[2] || '').toLowerCase();
const outRoot = path.resolve(process.argv[3] || path.join(ROOT, 'dist', `studio-inventory-${platform}`));

if (!['win', 'mac'].includes(platform)) {
  console.error('Usage: node scripts/package-release.js <win|mac> [outputDir]');
  process.exit(1);
}

const COPY = [
  'server.js',
  'db.js',
  'seed.js',
  'package.json',
  'package-lock.json',
  'README.md',
  'MAC.md',
  'LICENSE',
  'start-studio-inventory.bat',
  'start-studio-inventory.sh',
  'lib',
  'public',
  'installers',
  'data',
];

const SKIP_DIR_NAMES = new Set(['.git', '.github', 'dist', 'photos', 'docs']);

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeFile(rel, content) {
  const dest = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, platform === 'win' ? 'utf8' : { encoding: 'utf8', mode: 0o755 });
}

function ensureDataDirs() {
  for (const sub of ['uploads', 'backups']) {
    const dir = path.join(outRoot, 'data', sub);
    fs.mkdirSync(dir, { recursive: true });
    const keep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  }
}

console.log(`Packaging Studio Inventory for ${platform} → ${outRoot}`);

if (fs.existsSync(outRoot)) {
  fs.rmSync(outRoot, { recursive: true, force: true });
}
fs.mkdirSync(outRoot, { recursive: true });

for (const item of COPY) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    console.warn(`  skip missing: ${item}`);
    continue;
  }
  copyRecursive(src, path.join(outRoot, item));
}

console.log('  copying node_modules…');
copyRecursive(path.join(ROOT, 'node_modules'), path.join(outRoot, 'node_modules'));

ensureDataDirs();

if (platform === 'win') {
  writeFile(
    'Start Studio Inventory.bat',
    `@echo off\r\ncd /d "%~dp0"\r\necho Starting Studio Inventory at http://localhost:3847\r\nstart "" "http://localhost:3847"\r\nnode server.js\r\npause\r\n`
  );
  writeFile(
    'Install Studio Inventory.bat',
    `@echo off\r\ncd /d "%~dp0"\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installers\\windows\\install.ps1"\r\npause\r\n`
  );
  writeFile(
    'README-INSTALL.txt',
    `Studio Inventory — Windows\r\n\r\nPortable (no install):\r\n  1. Extract this ZIP anywhere\r\n  2. Double-click "Start Studio Inventory.bat"\r\n  3. Your browser opens at http://localhost:3847\r\n\r\nInstall shortcuts (optional):\r\n  Double-click "Install Studio Inventory.bat"\r\n  Creates Start Menu + Desktop shortcuts in %LOCALAPPDATA%\\Studio Inventory\r\n\r\nRequires Node.js only if you run from source (git clone). This package includes everything.\r\n`
  );
} else {
  writeFile(
    'Start Studio Inventory.command',
    `#!/bin/bash\ncd "$(dirname "$0")"\necho "Starting Studio Inventory at http://localhost:3847"\nopen "http://localhost:3847" 2>/dev/null || true\nnode server.js\n`
  );
  writeFile(
    'Install Studio Inventory.command',
    `#!/bin/bash\ncd "$(dirname "$0")"\nbash "./installers/mac/install.sh"\n`
  );
  fs.chmodSync(path.join(outRoot, 'Start Studio Inventory.command'), 0o755);
  fs.chmodSync(path.join(outRoot, 'Install Studio Inventory.command'), 0o755);
  fs.chmodSync(path.join(outRoot, 'start-studio-inventory.sh'), 0o755);
  writeFile(
    'README-INSTALL.txt',
    `Studio Inventory — macOS\r\n\r\nPortable (no install):\r\n  1. Extract this ZIP anywhere\r\n  2. Double-click "Start Studio Inventory.command"\r\n  3. Your browser opens at http://localhost:3847\r\n\r\nInstall to Applications (optional):\r\n  Double-click "Install Studio Inventory.command"\r\n\r\nFirst time: if macOS blocks the script, right-click → Open.\r\nFull guide: MAC.md or https://github.com/TerkWerX/STUDIO-INVENTORY/blob/main/MAC.md\r\n`
  );
}

const version = require(path.join(ROOT, 'package.json')).version;
fs.writeFileSync(path.join(outRoot, 'VERSION.txt'), `${version}\n${platform}\n`);

console.log('Done.');