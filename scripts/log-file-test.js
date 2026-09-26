/**
 * Unit tests (node --test) for the server log file: secrets are masked,
 * the file rotates instead of growing forever, and a crash is recorded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { redact, readRecentLog, logPath } = require('../lib/log-file');

test('share tokens and PINs are masked', () => {
  const line = redact('GET /uploads/photos/7/a.jpg?access=abc123&item=7 failed; '
    + 'GET /api/guest/0f9e8d7c6b5a/items?token=zzz and /scan/7?access=SECRET; body {"pin":"4321"}');
  for (const secret of ['abc123', '0f9e8d7c6b5a', 'zzz', 'SECRET', '4321']) {
    assert.ok(!line.includes(secret), `${secret} leaked: ${line}`);
  }
  assert.ok(line.includes('item=7'), 'ordinary parameters stay readable');
  assert.ok(line.includes('/uploads/photos/7/a.jpg'), 'paths stay readable');
});

function runLogger(dir, script) {
  return spawnSync(process.execPath, ['-e', `
    const { installLogFile } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'log-file'))});
    const file = installLogFile(${JSON.stringify(dir)}, { maxBytes: 4096, keep: 2 });
    ${script}
  `], { encoding: 'utf8' });
}

test('console output is copied to the log with timestamps, and the log rotates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-log-test-'));
  const result = runLogger(dir, `
    console.log('Studio Inventory started');
    console.error(new Error('backup folder missing'));
    for (let i = 0; i < 200; i++) console.warn('line ' + i + ' ' + 'x'.repeat(40));
  `);
  assert.equal(result.status, 0, result.stderr);
  const file = logPath(dir);
  assert.ok(fs.existsSync(file), 'no log file');
  assert.ok(fs.existsSync(`${file}.1`) && fs.existsSync(`${file}.2`), 'log did not rotate');
  assert.ok(!fs.existsSync(`${file}.3`), 'more old logs kept than asked for');
  for (const name of [file, `${file}.1`, `${file}.2`]) {
    assert.ok(fs.statSync(name).size <= 4096 + 200, `${path.basename(name)} grew past the limit`);
  }
  const recent = readRecentLog(dir, 5);
  assert.equal(recent.length, 5);
  assert.match(recent.at(-1), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN  line 199 /);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a crash is written to the log before the process exits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-log-test-'));
  const result = runLogger(dir, `setTimeout(() => { throw new Error('boom at startup'); }, 10);`);
  assert.notEqual(result.status, 0, 'the crash should still stop the process');
  const text = fs.readFileSync(logPath(dir), 'utf8');
  assert.match(text, /FATAL Studio Inventory stopped because of an unexpected error: Error: boom at startup/);
  fs.rmSync(dir, { recursive: true, force: true });
});
