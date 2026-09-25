/**
 * Unit tests (node --test) for the Linux and macOS installers' update path.
 * An update must keep the catalog even when a step fails part way, so each
 * step is made to fail in turn (via stand-in cp/mv/curl commands on PATH).
 * The macOS script only uses tools that behave the same on Linux, so both run
 * here. Skipped on Windows (installers/windows is covered by the release build).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const skip = process.platform === 'win32' ? 'bash installers only' : false;

function makeShims(dir) {
  const shim = (name, body) => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  };
  const real = (name) => spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  const counter = (name) => `n=$(( $(cat "$SHIM_STATE/${name}" 2>/dev/null || echo 0) + 1 )); echo $n > "$SHIM_STATE/${name}"`;
  shim('mv', `${counter('mv')}
for f in \${FAIL_MV:-}; do [[ "$n" == "$f" ]] && { echo "mv: injected failure" >&2; exit 1; }; done
exec "${real('mv')}" "$@"`);
  shim('cp', `${counter('cp')}
"${real('cp')}" "$@" || exit $?
[[ -n "\${FAIL_CP_AT:-}" && "$n" == "$FAIL_CP_AT" ]] && { echo "cp: injected disk full" >&2; exit 1; }
exit 0`);
  shim('curl', '[[ -n "${FAKE_HEALTH:-}" ]] && { echo "$FAKE_HEALTH"; exit 0; }; exit 7');
}

function scenario(kind) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `studio-installer-${kind}-`));
  const pkg = path.join(work, 'pkg');
  const home = path.join(work, 'home');
  const target = path.join(home, 'apps', 'studio-inventory');
  const shims = path.join(work, 'shims');
  const state = path.join(work, 'state');
  for (const dir of [path.join(pkg, 'installers', kind), path.join(pkg, '.runtime'), path.join(pkg, 'data', 'uploads'), home, shims, state]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, 'installers', kind, 'install.sh'), path.join(pkg, 'installers', kind, 'install.sh'));
  fs.writeFileSync(path.join(pkg, 'server.js'), 'new');
  for (const file of ['.runtime/node', 'Start Studio Inventory.sh', 'Start Studio Inventory.command', 'Install Studio Inventory.sh', 'start-studio-inventory.sh', 'data/uploads/.gitkeep']) {
    fs.writeFileSync(path.join(pkg, file), '');
  }
  fs.mkdirSync(path.join(target, 'data', 'uploads', 'photos', '7'), { recursive: true });
  fs.writeFileSync(path.join(target, 'server.js'), 'old');
  fs.writeFileSync(path.join(target, 'data', 'inventory.db'), 'MY GEAR');
  fs.writeFileSync(path.join(target, 'data', 'uploads', 'photos', '7', 'a.jpg'), 'PHOTO');
  makeShims(shims);

  const run = (env = {}) => {
    const args = kind === 'linux'
      ? [path.join(pkg, 'installers', 'linux', 'install.sh'), '--target', target, '--no-start', '--no-shortcuts']
      : [path.join(pkg, 'installers', 'mac', 'install.sh')];
    const result = spawnSync('bash', args, {
      encoding: 'utf8',
      input: 'n\n',
      env: {
        ...process.env,
        HOME: home,
        PATH: `${shims}:${process.env.PATH}`,
        SHIM_STATE: state,
        STUDIO_INVENTORY_INSTALL_DIR: target,
        ...env
      }
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const siblings = () => fs.readdirSync(path.dirname(target)).sort();
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
  return { target, run, read, siblings, cleanup };
}

function assertUnchanged(s, result) {
  assert.notEqual(result.status, 0, result.output);
  assert.equal(s.read(path.join(s.target, 'server.js')), 'old', result.output);
  assert.equal(s.read(path.join(s.target, 'data', 'inventory.db')), 'MY GEAR', result.output);
  assert.equal(s.read(path.join(s.target, 'data', 'uploads', 'photos', '7', 'a.jpg')), 'PHOTO');
  assert.deepEqual(s.siblings(), ['studio-inventory'], 'no half-finished folders left behind');
}

for (const kind of ['linux', 'mac']) {
  test(`${kind} installer: an update replaces the app and keeps the data`, { skip }, () => {
    const s = scenario(kind);
    const result = s.run();
    assert.equal(result.status, 0, result.output);
    assert.equal(s.read(path.join(s.target, 'server.js')), 'new');
    assert.equal(s.read(path.join(s.target, 'data', 'inventory.db')), 'MY GEAR');
    assert.equal(s.read(path.join(s.target, 'data', 'uploads', 'photos', '7', 'a.jpg')), 'PHOTO');
    assert.deepEqual(s.siblings(), ['studio-inventory']);
    s.cleanup();
  });

  test(`${kind} installer: a failure at any step leaves the previous install and data in place`, { skip }, () => {
    for (const env of [{ FAIL_CP_AT: '1' }, { FAIL_MV: '1' }, { FAIL_MV: '2' }, { FAIL_MV: '3' }]) {
      const s = scenario(kind);
      const result = s.run(env);
      assertUnchanged(s, result);
      assert.match(result.output, /Nothing was changed/, JSON.stringify(env));
      s.cleanup();
    }
  });

  test(`${kind} installer: if the rollback itself fails, the data survives and its location is printed`, { skip }, () => {
    const s = scenario(kind);
    const result = s.run({ FAIL_MV: '3 5' });
    assert.notEqual(result.status, 0);
    const where = (/with your inventory data, is in: (.+)/.exec(result.output) || [])[1];
    assert.ok(where, result.output);
    assert.equal(s.read(path.join(where.trim(), 'data', 'inventory.db')), 'MY GEAR');
    s.cleanup();
  });

  test(`${kind} installer: refuses to update while the app is running from the install folder`, { skip }, () => {
    const s = scenario(kind);
    const result = s.run({ FAKE_HEALTH: JSON.stringify({ ok: true, appRoot: s.target }) });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /is running from/);
    assert.equal(s.read(path.join(s.target, 'server.js')), 'old');
    s.cleanup();
  });
}
