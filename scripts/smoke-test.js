/**
 * CI smoke test: syntax checks, seed, server health endpoint.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SMOKE_PORT || 3848;
const DATA_DIR = path.join(ROOT, 'data', '.smoke-test');
const DB_PATH = path.join(DATA_DIR, 'inventory.db');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function syntaxCheck(file) {
  require('child_process').execSync(`node --check "${file}"`, { cwd: ROOT, stdio: 'inherit' });
}

async function waitForHealth(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) return data;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Health check failed: ${url}`);
}

async function main() {
  console.log('Syntax checks...');
  for (const file of ['server.js', 'db.js', 'seed.js']) {
    syntaxCheck(path.join(ROOT, file));
  }

  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const testEnv = { ...process.env, PORT: String(PORT), STUDIO_DATA_DIR: DATA_DIR };

  console.log('Seeding sample data...');
  await run('node', ['seed.js', '--force'], { env: testEnv });

  console.log(`Starting server on port ${PORT}...`);
  const server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: testEnv,
    stdio: 'ignore'
  });

  try {
    const health = await waitForHealth(`http://127.0.0.1:${PORT}/api/health`);
    console.log('Health OK:', health);

    const brands = await fetch(`http://127.0.0.1:${PORT}/api/brands`).then(r => r.json());
    if (!Array.isArray(brands) || brands.length === 0) throw new Error('Brands API returned empty');
    console.log(`Brands API OK: ${brands.length} brands`);

    const items = await fetch(`http://127.0.0.1:${PORT}/api/items`).then(r => r.json());
    if (!Array.isArray(items) || items.length === 0) throw new Error('Items API returned empty');
    console.log(`Items API OK: ${items.length} items`);

    console.log('Smoke test passed.');
  } finally {
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 300));
    if (fs.existsSync(DATA_DIR)) {
      try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

main().catch(err => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});