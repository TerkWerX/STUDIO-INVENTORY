const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { installRecoveryKey } = require('./data-key');
const { openWithSuppliedKey } = require('./open-database');
const { isEncryptedBackup } = require('./backup-crypto');

const PENDING_NAME = 'pending-move-restore.zip';

function isLocalAddress(req) {
  const addr = req.socket?.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
}

function page(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Move Studio Inventory</title>
  <style>
    body { font-family: Segoe UI, sans-serif; background: #121820; color: #e8eef5; margin: 0; }
    main { max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; }
    h1 { font-size: 1.6rem; }
    p, li { line-height: 1.45; color: #c5d0dc; }
    form, .card { background: #1c2633; border-radius: 12px; padding: 1rem 1.1rem; margin: 1rem 0; }
    input[type="text"], input[type="file"] { width: 100%; box-sizing: border-box; margin: 0.5rem 0 0.8rem; }
    button { background: #9bcaff; color: #102033; border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-weight: 600; }
    .error { color: #ffb4b4; }
  </style>
</head>
<body>
  <main>
    <h1>This catalog is from another Windows account</h1>
    <p>${escapeHtml(message)}</p>
    <p>You need one of these. Either one brings the inventory back. You do not need both.</p>
    <ul>
      <li>The recovery key you wrote down. That reopens the encrypted catalog.</li>
      <li>The plaintext file <code>studio-inventory-recovery.zip</code> from the USB drive or cloud copy. That does not need the key.</li>
    </ul>
    <form class="card" id="key-form">
      <h2>Use the recovery key</h2>
      <label for="recovery-key">Recovery key</label>
      <input id="recovery-key" name="recoveryKey" type="text" autocomplete="off" spellcheck="false">
      <button type="submit">Open the catalog</button>
      <p class="error" id="key-error"></p>
    </form>
    <form class="card" id="zip-form" enctype="multipart/form-data">
      <h2>Use the recovery ZIP</h2>
      <p>Choose <code>studio-inventory-recovery.zip</code>, not an encrypted <code>.zip.enc</code> file. The encrypted database already on this computer is kept beside it and is not deleted.</p>
      <input name="backup" type="file" accept=".zip" required>
      <button type="submit">Restore this ZIP</button>
      <p class="error" id="zip-error"></p>
    </form>
  </main>
  <script>
    document.getElementById('key-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = document.getElementById('key-error');
      error.textContent = 'Opening...';
      const res = await fetch('/api/move/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryKey: document.getElementById('recovery-key').value })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { error.textContent = body.error || 'That key did not open the catalog.'; return; }
      error.textContent = 'Key saved for this Windows account. Reloading...';
      setTimeout(() => location.reload(), 800);
    });
    document.getElementById('zip-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = document.getElementById('zip-error');
      error.textContent = 'Restoring...';
      const res = await fetch('/api/move/zip', { method: 'POST', body: new FormData(event.target) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { error.textContent = body.error || 'That ZIP could not be restored.'; return; }
      error.textContent = 'ZIP accepted. Reloading...';
      setTimeout(() => location.reload(), 800);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[ch]));
}

function quarantineDatabase(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const moved = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const source = dbPath + suffix;
    if (!fs.existsSync(source)) continue;
    const target = `${dbPath}.previous-machine-${stamp}${suffix}`;
    fs.renameSync(source, target);
    moved.push(target);
  }
  return moved;
}

function assertPlainRecoveryZip(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (isEncryptedBackup(bytes)) {
    throw new Error('That file is an encrypted backup. Type the recovery key, or choose studio-inventory-recovery.zip.');
  }
  let zip;
  try { zip = new AdmZip(bytes); } catch {
    throw new Error('That file is not a Studio Inventory recovery ZIP.');
  }
  const entry = zip.getEntry('backup.json');
  if (!entry) throw new Error('Backup ZIP is missing backup.json');
  const backup = JSON.parse(entry.getData().toString('utf8'));
  if (backup?.manifest?.format !== 'studio-inventory-full-backup' || !backup.tables) {
    throw new Error('This is not a Studio Inventory full backup ZIP');
  }
  return backup;
}

function restartServer() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  setTimeout(() => process.exit(0), 400);
}

function listen({ port, message, dbPath, dataDir }) {
  const app = express();
  const upload = multer({ dest: path.join(dataDir, 'backups', '.incoming'), limits: { fileSize: 1024 * 1024 * 1024 } });
  fs.mkdirSync(path.join(dataDir, 'backups', '.incoming'), { recursive: true });
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    if (!isLocalAddress(req)) return res.status(403).send('Open this page on the studio computer.');
    next();
  });
  app.get('/', (_req, res) => res.type('html').send(page(message)));
  app.get('/api/health', (_req, res) => res.json({ ok: true, moveCatalog: true }));
  app.post('/api/move/key', (req, res) => {
    let database;
    try {
      database = openWithSuppliedKey(dbPath, req.body?.recoveryKey);
      database.prepare('SELECT count(*) AS n FROM sqlite_master').get();
      database.close();
      database = null;
      installRecoveryKey(req.body?.recoveryKey);
      res.json({ ok: true });
      restartServer();
    } catch (err) {
      if (database) {
        try { database.close(); } catch { /* the key did not belong */ }
      }
      res.status(400).json({ error: 'That key did not open the catalog. The Windows key was not replaced.' });
    }
  });
  app.post('/api/move/zip', upload.single('backup'), (req, res) => {
    if (!req.file?.path) return res.status(400).json({ error: 'Choose the recovery ZIP' });
    try {
      assertPlainRecoveryZip(req.file.path);
      const pending = path.join(dataDir, PENDING_NAME);
      fs.copyFileSync(req.file.path, pending);
      quarantineDatabase(dbPath);
      res.json({ ok: true });
      restartServer();
    } catch (err) {
      res.status(400).json({ error: err.message || 'That ZIP could not be restored.' });
    } finally {
      try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  });
  app.listen(port, '127.0.0.1', () => {
    console.log(`\n  Studio Inventory cannot open the encrypted catalog with this Windows account.`);
    console.log(`  Open http://localhost:${port} to type the recovery key or restore the recovery ZIP.\n`);
  });
}

module.exports = {
  listen,
  quarantineDatabase,
  assertPlainRecoveryZip,
  PENDING_NAME
};
