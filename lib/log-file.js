/**
 * Keeps what the server prints in data/logs/studio-inventory.log as well as on
 * the console. On Windows the app runs without a window, so without this file
 * every error message would be lost.
 *
 * - One line per message, with a timestamp and a level.
 * - Share tokens and PINs in URLs are masked before anything is written.
 * - The file rotates at 5 MB; the three previous files are kept.
 * - Writes are synchronous, so a crash is on disk before the process exits.
 * - Logging never throws: a full disk or locked file must not stop the app.
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_NAME = 'studio-inventory.log';
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

/** Mask secrets that can appear in logged URLs and messages. */
function redact(text) {
  return String(text)
    .replace(/([?&](?:access|token|guest_token|pin|key|recovery_key)=)[^&\s"'#)]+/gi, '$1[hidden]')
    .replace(/(\/api\/guest\/)[^/\s?"')]+/g, '$1[hidden]')
    .replace(/(\bpin["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[hidden]');
}

function logDir(dataDir) {
  return path.join(dataDir, 'logs');
}

function logPath(dataDir) {
  return path.join(logDir(dataDir), LOG_NAME);
}

/**
 * Start copying console output to the log file in dataDir/logs.
 * Returns the log file path, or '' if the folder can't be written.
 */
function installLogFile(dataDir, { maxBytes = MAX_BYTES, keep = KEEP } = {}) {
  const file = logPath(dataDir);
  let fd = null;
  let size = 0;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { size = fs.statSync(file).size; } catch { size = 0; }
    fd = fs.openSync(file, 'a', 0o600);
  } catch {
    return '';
  }

  const rotate = () => {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    for (let i = keep - 1; i >= 1; i--) {
      try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch { /* not there yet */ }
    }
    try { fs.renameSync(file, `${file}.1`); } catch { /* keep writing to the same file */ }
    fd = fs.openSync(file, 'a', 0o600);
    size = 0;
  };

  const write = (level, args) => {
    try {
      const text = redact(util.format(...args)).replace(/\s+$/, '');
      if (!text.trim()) return;
      const line = `${new Date().toISOString()} ${level.padEnd(5)} ${text.replace(/\n/g, '\n    ')}\n`;
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) rotate();
      fs.writeSync(fd, line);
      size += bytes;
    } catch { /* never let logging break the app */ }
  };

  for (const [method, level] of [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      write(level, args);
    };
  }
  // Monitor only: records the crash without changing how Node handles it.
  process.on('uncaughtExceptionMonitor', (err) => write('FATAL', ['Studio Inventory stopped because of an unexpected error:', err]));

  return file;
}

/** The last lines of the log (newest last), for Help & About. */
function readRecentLog(dataDir, maxLines = 300) {
  const file = logPath(dataDir);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift(); // first line is probably cut in half
    return lines.filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { installLogFile, readRecentLog, redact, logDir, logPath };
