/**
 * Install Chromium for Playwright when devDependency is present (CI + local).
 * Skips silently if playwright is not installed (production npm ci --omit=dev).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const playwrightPkg = path.join(root, 'node_modules', 'playwright');

if (!fs.existsSync(playwrightPkg)) {
  process.exit(0);
}

if (process.env.SKIP_PLAYWRIGHT_INSTALL === '1') {
  process.exit(0);
}

try {
  execSync('npx playwright install chromium', {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
} catch {
  console.warn('Playwright Chromium install skipped or failed — run: npx playwright install chromium');
}