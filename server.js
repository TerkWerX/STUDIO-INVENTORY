const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const Tesseract = require('tesseract.js');
// Start the log file before anything else can fail, so a startup error is recorded too.
const { installLogFile, readRecentLog } = require('./lib/log-file');
const LOG_FILE = installLogFile(process.env.STUDIO_DATA_DIR
  ? path.resolve(process.env.STUDIO_DATA_DIR)
  : path.join(__dirname, 'data'));
const dbApi = require('./db');
if (dbApi.catalogLock) {
  require('./lib/move-catalog').listen({
    port: Number(process.env.PORT || 3847),
    message: dbApi.catalogLock,
    dbPath: dbApi.DB_PATH,
    dataDir: dbApi.DATA_DIR
  });
  return;
}
const {
  db, DB_PATH, DATA_DIR, UPLOADS_DIR, initSchema,
  enrichItem, enrichItems, setItemTags, sanitizeItemInput, getTagsForItem, getAssemblyTotals, itemUploadDir,
  removeItemUploadDirs, resolveUploadPath, removeUploadFile, DEFAULT_CATEGORIES, DEFAULT_LOCATIONS,
  ensureBrand, getBrandsWithCounts, syncBrandsFromItems, brandSlug, LOGOS_DIR,
  isFormerStatus, ownedStatusSql, cascadeFormerStatus, restoreCascadedChildren,
  recordItemChanges, recordReplacementValue, getValueEvents, getItemAudit,
  addMaintenanceEntry, deleteMaintenanceEntry,
  getActiveLoans, getRecentLoanHistory, checkoutItem, returnLoan, deleteLoanEntry,
  getRacks, getSignalChains,
  getFloorplans, getFloorplan, createFloorplan, updateFloorplanImage, clearFloorplanFloorImage,
  updateFloorplanFloorView, updateFloorplanGeometry,
  setFloorplanItems, updateFloorplanItems, deleteFloorplan, getItemMapPlacement, saveItemWallCutout, clearItemWallCutout, wallPhotoDir,
  floorplanWallPhotosDir, updateFloorplanWallPhoto, updateFloorplanWallCalibration, resolveWallRehang,
  SOFTWARE_CATEGORIES, LICENSE_TYPES, ACTIVATION_METHODS, PLUGIN_FORMATS,
  softwareLicenseDir, getAllSoftware, getSoftware, createSoftware, updateSoftware,
  updateSoftwareScreenshot, clearSoftwareScreenshot, deleteSoftware,
  getSoftwareRenewals, getSoftwareTotals
} = require('./db');
const { parseLookupCode } = require('./lib/lookup-code');
const { summarizeCompleteness, computeItemCompleteness } = require('./lib/completeness');
const { parseCsv, mapRowToItem } = require('./lib/csv-import');
const { toCsv } = require('./lib/csv-export');
const { instrumentProfiles } = require('./lib/instrument-profiles');
const {
  readSettings, writeSettings, commitCatalogEncryption, regenerateGuestToken, isValidGuestToken,
  setOwnerPin, verifyOwnerPin, createOwnerSessionToken, revokeOwnerSessionToken,
  isValidOwnerSessionToken, itemScanToken, isValidItemScanToken, ownerPinConfigured
} = require('./lib/studio-settings');
const { indexManualAttachment, searchManuals, pdfParseAvailable } = require('./lib/pdf-index');
const { findGearDocuments, DOCUMENT_KINDS } = require('./lib/manual-finder');
const { fetchBrandLogoFromWeb, fetchAllInventoryBrandLogos } = require('./lib/fetch-brand-logo');
const { getCurrentVersion, checkForUpdate } = require('./lib/version');
const {
  validateBackupDir, backupDiskWarning, warmBackupDiskInfo, writeFolderBackup, writeRecoveryCopy, createDownloadZipStream,
  openBackupZip, readZipEntry, verifyBackupZip, extractZipPrefixes, removeDecryptedLeftovers,
  RECOVERY_NAME, RECOVERY_PREVIOUS_NAME
} = require('./lib/folder-backup');
const { isPlainSqlite } = require('./lib/open-database');
const { getDataKey } = require('./lib/data-key');
const { safeFetch } = require('./lib/safe-fetch');
const { isLocalRequest, hostGuard, crossSiteGuard } = require('./lib/request-guard');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3847;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_MANUAL_DOWNLOAD_SIZE = 50 * 1024 * 1024;
const FLOORPLANS_DIR = path.join(UPLOADS_DIR, 'floorplans');
const MANUAL_INBOX_DIR = path.join(DATA_DIR, 'manual-inbox');
const OCR_DATA_DIR = path.join(__dirname, 'ocr');
const OCR_CACHE_DIR = path.join(DATA_DIR, 'ocr-cache');
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_BACKUP_KEEP = 7;

process.on('unhandledRejection', (reason) => {
  console.error('  Unexpected error (the server keeps running):', reason);
});

initSchema();
try {
  readSettings();
} catch (err) {
  // Keep serving the local catalog; settings-dependent requests will report this error.
  console.error(`\n  ${err.message}\n`);
}
if (!fs.existsSync(FLOORPLANS_DIR)) fs.mkdirSync(FLOORPLANS_DIR, { recursive: true });
if (!fs.existsSync(MANUAL_INBOX_DIR)) fs.mkdirSync(MANUAL_INBOX_DIR, { recursive: true });
if (!fs.existsSync(OCR_CACHE_DIR)) fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });

const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif']
]);

/**
 * Tags from a request: a list of names, or one comma-separated string.
 * Anything else is refused rather than stored as nonsense.
 */
function tagListFromInput(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || list.some(tag => typeof tag !== 'string' && typeof tag !== 'number')) {
    throw clientError('Tags must be a list of words');
  }
  const names = [...new Set(list.map(tag => String(tag).trim().slice(0, 60)).filter(Boolean))];
  if (names.length > 50) throw clientError('An item can have at most 50 tags');
  return names;
}

/** Time plus randomness for stored file names, so two uploads in the same millisecond can't collide. */
function uniqueStamp() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/** An error caused by the request itself; the error handler answers 400 with its message. */
function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true });
}

function imageExtension(file, { allowSvg = false } = {}) {
  const mime = String(file?.mimetype || '').toLowerCase().split(';')[0];
  if (allowSvg && mime === 'image/svg+xml') return '.svg';
  return IMAGE_EXTENSIONS.get(mime) || '';
}

function isAcceptedImage(file, options) {
  return !!imageExtension(file, options);
}

const softwareScreenshotUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, softwareLicenseDir(req.params.id)),
    filename: (_req, file, cb) => {
      const ext = imageExtension(file) || '.jpg';
      cb(null, `screenshot-${uniqueStamp()}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAcceptedImage(file));
  }
});
syncBrandsFromItems();

function brandLogoLookupsEnabled() {
  try { return !!readSettings().brandLogoLookups; } catch { return false; }
}

// Give brands without a logo one at startup. Online lookups only when the owner
// has turned them on; otherwise a local text badge, and nothing leaves this computer.
setTimeout(() => {
  const offline = !brandLogoLookupsEnabled();
  fetchAllInventoryBrandLogos({ offline }).then(r => {
    if (r.fetched > 0) console.log(`  Brand logos: ${offline ? 'generated' : 'fetched'} ${r.fetched}, skipped ${r.skipped}, failed ${r.failed}`);
  }).catch(err => console.warn('  Brand logo batch:', err.message));
}, 2500);

const app = express();
app.disable('x-powered-by');

// Express 4 does not pass a rejected promise from an async route to the error
// handler, and on Node 22 an unhandled rejection stops the whole server. Every
// route and middleware registered on `app` goes through this wrapper, so a
// failing async route answers with an error instead of taking the app down.
function forwardAsyncErrors(handler) {
  if (Array.isArray(handler)) return handler.map(forwardAsyncErrors);
  // Leave error handlers (4 arguments), routers and sub-apps as they are.
  if (typeof handler !== 'function' || handler.length > 3 || handler.handle || handler.stack) return handler;
  return function asyncSafe(req, res, next) {
    const result = handler(req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
  };
}
for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'use']) {
  const register = app[method].bind(app);
  app[method] = (...args) => register(...args.map(forwardAsyncErrors));
}
// Refuse public DNS names in Host (DNS rebinding) before anything else runs.
app.use(hostGuard);
// Reject writes sent by another site, including from a browser on this computer.
app.use(crossSiteGuard);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  // script-src has no 'unsafe-inline': injected <script>, onerror="…" and javascript: links
  // cannot run even if some text slips through unescaped. The DYMO Connect framework is
  // the one third-party script (loaded only when printing to a DYMO LabelWriter).
  res.setHeader('Content-Security-Policy', [
    "script-src 'self' https://qajavascriptsdktests.azurewebsites.net",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'"
  ].join('; '));
  next();
});
// Every :id in this API is a positive integer row id. Validate it before any
// route middleware (including multer, which builds folder paths from it) runs.
app.param('id', (req, res, next, value) => {
  if (/^[1-9]\d{0,15}$/.test(String(value))) return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.status(404).type('text/plain').send('Not found');
});
app.param('edge', (req, res, next, value) => {
  if (/^\d{1,2}$/.test(String(value)) && Number(value) <= 47) return next();
  return res.status(400).json({ error: 'Invalid wall' });
});

/** Stop before an upload is written when the target record does not exist. */
function requireRow(table, message) {
  const stmt = () => db.prepare(`SELECT id FROM ${table} WHERE id = ?`);
  return (req, res, next) => {
    if (stmt().get(req.params.id)) return next();
    return res.status(404).json({ error: message });
  };
}
const requireItem = requireRow('items', 'Item not found');
const requireFloorplan = requireRow('floorplans', 'Floorplan not found');
const requireSoftware = requireRow('software_licenses', 'Software license not found');

// One value per query parameter: ?brand=a&brand=b arrives as an array, which
// every endpoint here would otherwise pass straight into SQL or a comparison.
app.set('query parser', 'simple');
app.use((req, _res, next) => {
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) req.query[key] = String(value[0] ?? '');
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, max-age=604800');
  if (isLocalRequest(req) || isValidOwnerToken(ownerTokenFromRequest(req))) return next();

  const isLogo = req.path.startsWith('/logos/');
  // Guest links show gear photos and brand logos, never receipts or license files.
  if (req.query.guest_token && (isLogo || req.path.startsWith('/photos/'))
      && isValidGuestToken(req.query.guest_token)) return next();

  // A QR label unlocks the files its own item page shows: photos, manuals, software.
  // The item is always taken from the file path, never from the query string.
  const match = req.path.match(/^\/(photos|manuals|software)\/(\d+)\//);
  const itemId = match ? match[2] : (isLogo ? req.query.item : '');
  if (itemId && isValidItemScanToken(itemId, req.query.access)) return next();

  return res.status(401).json({ error: 'Authentication or a valid share link is required.' });
}, express.static(UPLOADS_DIR, {
  maxAge: '7d',
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.svg') res.setHeader('Content-Security-Policy', 'sandbox');
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.svg', '.pdf'].includes(ext)) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath).replace(/["\r\n]/g, '_')}"`);
    }
  }
}));

function safeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

/** Keep a short alphanumeric extension (".exe", ".zip"); drop anything else. */
function plainExtension(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}

function makeUploadStorage(type, options = {}) {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      const itemId = req.params.id;
      const { dir } = itemUploadDir(itemId, type);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = typeof options.extension === 'function'
        ? options.extension(file)
        : options.imageOnly
          ? imageExtension(file, { allowSvg: !!options.allowSvg })
          : plainExtension(file.originalname);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  });
}

function createUploader(type, options = {}) {
  return multer({
    // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
    defParamCharset: 'utf8',
    storage: makeUploadStorage(type, options),
    limits: { fileSize: options.maxSize || MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (options.filter) return options.filter(file, cb);
      cb(null, true);
    }
  });
}

const photoUpload = createUploader('photo', {
  maxSize: 25 * 1024 * 1024,
  imageOnly: true,
  filter: (file, cb) => {
    if (isAcceptedImage(file)) cb(null, true);
    else cb(clientError('Only image files allowed for photos'));
  }
});

const manualUpload = createUploader('manual', {
  maxSize: 50 * 1024 * 1024,
  extension: (file) => ({
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt'
  })[file.mimetype] || imageExtension(file),
  filter: (file, cb) => {
    const ok = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'].includes(file.mimetype) || isAcceptedImage(file);
    cb(null, ok);
  }
});

const receiptUpload = createUploader('receipt', {
  maxSize: 25 * 1024 * 1024,
  extension: (file) => file.mimetype === 'application/pdf' ? '.pdf' : imageExtension(file),
  filter: (file, cb) => {
    const ok = file.mimetype === 'application/pdf' || isAcceptedImage(file);
    cb(null, ok);
  }
});

const softwareUpload = createUploader('software', { maxSize: MAX_FILE_SIZE });

const wallPhotoUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, wallPhotoDir(req.params.id)),
    filename: (_req, file, cb) => {
      const ext = imageExtension(file) || '.png';
      cb(null, `wall-${uniqueStamp()}${ext}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAcceptedImage(file));
  }
});

const wallBackgroundUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, floorplanWallPhotosDir(req.params.id)),
    filename: (req, file, cb) => {
      const ext = imageExtension(file) || '.jpg';
      cb(null, `wall-${req.params.edge}-${uniqueStamp()}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAcceptedImage(file));
  }
});

const floorplanUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FLOORPLANS_DIR),
    filename: (req, file, cb) => {
      const ext = imageExtension(file) || '.jpg';
      cb(null, `fp-${req.params.id}-${uniqueStamp()}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAcceptedImage(file));
  }
});

const logoUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGOS_DIR),
    filename: (req, file, cb) => {
      const name = req.body.name || req.params.name || 'custom';
      const slug = brandSlug(name);
      const ext = imageExtension(file, { allowSvg: true }) || '.png';
      cb(null, `${slug}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAcceptedImage(file, { allowSvg: true })) cb(null, true);
    else cb(clientError('Logo must be an image (PNG, SVG, WebP)'));
  }
});

const BACKUP_INCOMING_DIR = path.join(DATA_DIR, 'backups', '.incoming');
if (!fs.existsSync(BACKUP_INCOMING_DIR)) fs.mkdirSync(BACKUP_INCOMING_DIR, { recursive: true });

/**
 * Backups read the catalog and its files; restores, imports and encryption
 * replace them. Any number of backups can run together, but a replacing job
 * runs alone, so a backup never captures a half-restored catalog and a restore
 * never swaps files out from under a backup. Returns a release function.
 */
const maintenance = { shared: 0, exclusive: '' };
function beginMaintenance(kind, label) {
  if (maintenance.exclusive) {
    throw clientError(`${maintenance.exclusive} is in progress. Try again when it finishes.`, 409);
  }
  if (kind === 'exclusive' && maintenance.shared > 0) {
    throw clientError('A backup is running. Try again when it finishes.', 409);
  }
  if (kind === 'exclusive') maintenance.exclusive = label;
  else maintenance.shared++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (kind === 'exclusive') maintenance.exclusive = '';
    else maintenance.shared--;
  };
}

/** Run a route under the maintenance lock; answers 409 while a conflicting job runs. */
function withMaintenance(kind, label, handler) {
  return async (req, res, next) => {
    let release;
    try {
      release = beginMaintenance(kind, label);
    } catch (err) {
      return res.status(err.status).json({ error: err.message });
    }
    try {
      return await handler(req, res, next);
    } finally {
      release();
    }
  };
}

/** Temporary files a crash during an earlier restore could leave behind. */
function sweepRestoreLeftovers() {
  for (const name of safeReaddir(BACKUP_INCOMING_DIR)) {
    if (/^restore-.*\.zip$/.test(name)) fs.rmSync(path.join(BACKUP_INCOMING_DIR, name), { force: true });
  }
  for (const name of safeReaddir(DATA_DIR)) {
    if (name.startsWith('.restore-stage-')) {
      fs.rmSync(path.join(DATA_DIR, name), { recursive: true, force: true });
    } else if (name.startsWith('.restore-previous-')) {
      // Could be the only copy of files from before an interrupted restore: keep it.
      console.warn(`  Found ${path.join(DATA_DIR, name)} from an interrupted restore. Check it before deleting it.`);
    }
  }
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

const backupUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, BACKUP_INCOMING_DIR),
    filename: (_req, _file, cb) => {
      cb(null, `restore-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.zip`);
    }
  }),
  // Restores stream from disk, so the only real limit is free space. Allow large studios.
  limits: { fileSize: 64 * 1024 * 1024 * 1024 }
});
removeDecryptedLeftovers(BACKUP_INCOMING_DIR);
try {
  sweepRestoreLeftovers();
} catch (err) {
  console.warn('  Could not clean up after an earlier restore:', err.message);
}

const labelScanUpload = multer({
  // Browsers send UTF-8 file names; without this, "Röde.pdf" is stored as "RÃ¶de.pdf".
  defParamCharset: 'utf8',
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, isAcceptedImage(file));
  }
});

const ATTACHMENT_FOLDERS = { photo: 'photos', manual: 'manuals', document: 'manuals', software: 'software', receipt: 'receipts' };

/**
 * Record files that were just written to disk as attachments, in one
 * transaction. If that fails (the item was deleted meanwhile, say), the files
 * are removed again, so uploads/ never keeps files that no record points to.
 * Each file needs { filename, originalname, mimetype, path }.
 */
function recordUploadedFiles(itemId, files, typeFor, extraFor = () => ({})) {
  try {
    return db.transaction(() => files.map(file => insertAttachment(itemId, file, typeFor(file), extraFor(file))))();
  } catch (err) {
    for (const file of files) {
      try { if (file.path) fs.rmSync(file.path, { force: true }); } catch { /* best effort */ }
    }
    if (/FOREIGN KEY/i.test(err.message)) throw clientError('That item was deleted while the file was uploading.', 404);
    throw err;
  }
}

/** Delete an attachment's row and search entry, then its file unless another record still uses it. */
function deleteAttachment(att) {
  db.transaction(() => {
    db.prepare('DELETE FROM manual_fts WHERE attachment_id = ?').run(att.id);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id);
  })();
  const relativePath = att.relative_path || att.filename;
  const stillUsed = db.prepare('SELECT 1 FROM attachments WHERE relative_path = ? LIMIT 1').get(relativePath);
  if (stillUsed) return;
  try {
    removeUploadFile(relativePath);
  } catch (err) {
    console.warn(`  Could not remove ${relativePath}: ${err.message}`);
  }
}

function insertAttachment(itemId, file, type, extra = {}) {
  const sub = ATTACHMENT_FOLDERS[type] || 'manuals';
  const relativePath = `${sub}/${itemId}/${file.filename}`;
  const result = db.prepare(`
    INSERT INTO attachments (
      item_id, filename, original_name, relative_path, mime_type, type,
      version, description, source_url, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId, file.filename, file.originalname, relativePath, file.mimetype, type,
    extra.version || '', extra.description || '', extra.source_url || '',
    JSON.stringify(extra.metadata || {})
  );
  return {
    id: result.lastInsertRowid,
    filename: file.filename,
    original_name: file.originalname,
    relative_path: relativePath,
    mime_type: file.mimetype,
    type,
    version: extra.version || '',
    description: extra.description || '',
    source_url: extra.source_url || ''
  };
}

/** A number from the query string; a value that isn't one is a 400, not an empty list. */
function queryNumber(value, name, { integer = false } = {}) {
  const n = Number(String(value).trim());
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw clientError(`${name} must be a number`);
  return n;
}

function buildSearchQuery(params) {
  const conditions = [];
  const values = {};

  if (params.q) {
    conditions.push(`(
      i.name LIKE @q OR i.common_name LIKE @q OR i.brand LIKE @q OR
      i.model LIKE @q OR i.serial_number LIKE @q OR i.description LIKE @q OR
      i.location LIKE @q OR i.category LIKE @q OR i.instrument_type LIKE @q OR
      i.instrument_specs_json LIKE @q OR i.replacement_value_note LIKE @q OR
      EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
              WHERE it.item_id = i.id AND t.name LIKE @q)
    )`);
    values.q = `%${params.q}%`;
  }
  if (params.brand) {
    conditions.push('i.brand = @brand COLLATE NOCASE');
    values.brand = params.brand;
  }
  if (params.category) { conditions.push('i.category = @category'); values.category = params.category; }
  if (params.location) { conditions.push('i.location = @location'); values.location = params.location; }
  if (params.condition) { conditions.push('i.condition = @condition'); values.condition = params.condition; }
  if (params.tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = i.id AND t.name = @tag COLLATE NOCASE
    )`);
    values.tag = params.tag;
  }
  if (params.min_value) {
    conditions.push('i.replacement_value >= @min_value');
    values.min_value = queryNumber(params.min_value, 'min_value');
  }
  if (params.max_value) {
    conditions.push('i.replacement_value <= @max_value');
    values.max_value = queryNumber(params.max_value, 'max_value');
  }
  if (params.on_policy === '1') {
    conditions.push('i.on_insurance_policy = 1');
  }
  if (params.include_accessories !== '1' && params.include_accessories !== 'true') {
    conditions.push('(i.parent_item_id IS NULL)');
  }
  if (params.parent_id) {
    conditions.push('i.parent_item_id = @parent_id');
    values.parent_id = queryNumber(params.parent_id, 'parent_id', { integer: true });
  }
  if (params.include_former !== '1' && params.include_former !== 'true' && !params.parent_id) {
    conditions.push(ownedStatusSql('i.studio_status'));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortMap = {
    name: 'i.name ASC', name_desc: 'i.name DESC',
    value: 'i.replacement_value DESC', value_asc: 'i.replacement_value ASC',
    purchase_date: 'i.purchase_date DESC', purchase_date_asc: 'i.purchase_date ASC',
    category: 'i.category ASC, i.name ASC', location: 'i.location ASC, i.name ASC',
    updated: 'i.updated_at DESC'
  };
  const orderBy = sortMap[params.sort] || 'i.name ASC';
  return { where, values, orderBy };
}

function isValidDownloadUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function filenameFromResponse(url, headers) {
  const cd = headers.get('content-disposition') || '';
  const match = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match) {
    const raw = match[1].replace(/"/g, '');
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* malformed %-escape: keep it as sent */ }
    return safeFilename(decoded);
  }
  const urlPath = new URL(url).pathname;
  const base = path.basename(urlPath);
  return safeFilename(base || 'download.bin');
}

function extensionForMime(mime) {
  const map = {
    'application/pdf': '.pdf',
    'application/x-pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg'
  };
  return map[String(mime || '').toLowerCase()] || '';
}

function normalizeDownloadName(name, mime, fallback = 'manual.pdf') {
  const clean = safeFilename(name || fallback) || fallback;
  const ext = path.extname(clean);
  const inferred = extensionForMime(mime);
  if (!ext && inferred) return `${clean}${inferred}`;
  if (clean === 'download.bin' && inferred) return `manual${inferred}`;
  return clean;
}

function isManualDownloadAllowed(mime, filename) {
  const type = String(mime || '').toLowerCase();
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (type.includes('text/html')) return false;
  if (type.startsWith('image/')) return true;
  if (['.pdf', '.doc', '.docx', '.txt'].includes(ext)) return true;
  return [
    'application/pdf',
    'application/x-pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/octet-stream',
    'binary/octet-stream',
    'application/download',
    'application/force-download'
  ].includes(type);
}

function mimeForManualFile(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}

function ensureManualInboxDir() {
  if (!fs.existsSync(MANUAL_INBOX_DIR)) fs.mkdirSync(MANUAL_INBOX_DIR, { recursive: true });
  return MANUAL_INBOX_DIR;
}

function manualInboxFiles() {
  ensureManualInboxDir();
  return fs.readdirSync(MANUAL_INBOX_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const fullPath = path.join(MANUAL_INBOX_DIR, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
        mime_type: mimeForManualFile(entry.name),
        allowed: isManualDownloadAllowed(mimeForManualFile(entry.name), entry.name)
      };
    })
    .filter(file => file.allowed)
    .sort((a, b) => new Date(b.modified_at) - new Date(a.modified_at));
}

function openFolder(folderPath) {
  const target = path.resolve(folderPath);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const platform = process.platform;
  const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [target], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function moveFileIntoPlace(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(str = '') {
  return decodeHtmlEntities(String(str).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function directManualCandidate(url, mime = '') {
  try {
    const u = new URL(url);
    const ext = path.extname(u.pathname).toLowerCase();
    const allowedExt = ['.pdf', '.doc', '.docx', '.txt'];
    return allowedExt.includes(ext) || String(mime).toLowerCase().includes('pdf');
  } catch {
    return false;
  }
}

function extractManualLinksFromHtml(pageUrl, html) {
  const candidates = [];
  const seen = new Set();
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) && candidates.length < 20) {
    const rawHref = decodeHtmlEntities(match[1]).trim();
    if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref) || /^mailto:/i.test(rawHref)) continue;
    let url;
    try { url = new URL(rawHref, pageUrl).href; } catch { continue; }
    if (seen.has(url)) continue;
    const label = stripHtml(match[2]);
    const pathname = new URL(url).pathname.toLowerCase();
    const likelyManual = pathname.endsWith('.pdf')
      || /manual|owner|user guide|guide|instructions|download/i.test(label)
      || /manual|owner|user[-_ ]?guide|instructions/i.test(pathname);
    if (!likelyManual) continue;
    seen.add(url);
    candidates.push({
      title: label || path.basename(new URL(url).pathname) || url,
      url,
      displayUrl: url.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      isPdf: directManualCandidate(url)
    });
  }
  return candidates;
}

const COMMON_GEAR_BRANDS = [
  'Alesis', 'Akai', 'Allen & Heath', 'Ampeg', 'Arturia', 'Audient', 'Behringer',
  'Boss', 'Casio', 'Crown', 'Denon', 'Digidesign', 'Elektron', 'Emu', 'Fender',
  'Focusrite', 'Fostex', 'Fractal Audio', 'Hammond', 'Ibanez', 'IK Multimedia',
  'Kemper', 'Korg', 'Line 6', 'Mackie', 'M-Audio', 'Moog', 'Native Instruments',
  'Nord', 'Novation', 'Peavey', 'Pioneer', 'PreSonus', 'QSC', 'Roland', 'RME',
  'Sennheiser', 'Shure', 'Solid State Logic', 'Steinberg', 'Tascam', 'TC Electronic',
  'Universal Audio', 'Waldorf', 'Yamaha', 'Zoom'
];

function normalizedOcrLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function knownBrandNames() {
  const fromDb = db.prepare(`
    SELECT DISTINCT brand as name FROM items WHERE brand IS NOT NULL AND brand != ''
    UNION
    SELECT name FROM brands WHERE name IS NOT NULL AND name != ''
  `).all().map(r => r.name);
  return [...new Set([...fromDb, ...COMMON_GEAR_BRANDS].map(String).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
}

function findKnownBrand(lines) {
  const text = ` ${lines.join(' ')} `.toLowerCase();
  return knownBrandNames().find(brand => {
    const escaped = String(brand).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }) || '';
}

function cleanLabelValue(value) {
  return String(value || '')
    .replace(/^[#:\-.\s]+/, '')
    .replace(/[|]+/g, 'I')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 150);
}

function firstMatch(lines, patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) return { value: cleanLabelValue(match[1]), line };
    }
  }
  return { value: '', line: '' };
}

function parsePowerInfo(lines) {
  const powerLines = lines.filter(line =>
    /\b(input|output|power|adapter|adaptor|dc in|ac in|rating|rated)\b/i.test(line)
    || /\b\d+(?:\.\d+)?\s*(v|vdc|vac|a|ma)\b/i.test(line)
  );
  const source = powerLines.length ? powerLines : lines;
  const voltageMatch = firstMatch(source, [
    /\b(?:(?:dc\s*)?in(?:put)?[:\s-]*)?(\d+(?:\.\d+)?\s*(?:vdc|v\s*dc|v|vac|v\s*ac))(?:\b|[^a-z])/i,
    /\b((?:ac|dc)\s*\d+(?:\.\d+)?\s*v)\b/i
  ]);
  const currentMatch = firstMatch(source, [
    /\b(\d+(?:\.\d+)?\s*(?:ma|mA|a|A))(?:\b|[^a-z])/,
    /\bcurrent[:\s-]*(\d+(?:\.\d+)?\s*(?:ma|mA|a|A))/i
  ]);
  const polarityLine = source.find(line => /center|centre|tip|polarity|negative|positive/i.test(line)) || '';
  let polarity = '';
  if (/center|centre|tip/i.test(polarityLine) && /neg/i.test(polarityLine)) polarity = 'center negative';
  else if (/center|centre|tip/i.test(polarityLine) && /pos/i.test(polarityLine)) polarity = 'center positive';
  else if (/negative/i.test(polarityLine)) polarity = 'negative';
  else if (/positive/i.test(polarityLine)) polarity = 'positive';

  const voltage = cleanLabelValue(voltageMatch.value || (voltageMatch.line.match(/(\d+(?:\.\d+)?\s*(?:vdc|v\s*dc|v|vac|v\s*ac))/i)?.[1] || ''));
  const current = cleanLabelValue(currentMatch.value);
  return {
    requires_power: !!(voltage || current || powerLines.length),
    power_adapter_voltage: voltage.toUpperCase().replace(/\s+/g, ' '),
    power_adapter_current: current.replace(/\s+/g, ' '),
    power_adapter_polarity: polarity,
    power_adapter_notes: powerLines.slice(0, 4).join(' | ')
  };
}

function parseLabelScanText(text) {
  const lines = normalizedOcrLines(text);
  const serial = firstMatch(lines, [
    /\b(?:s\/?n|serial(?:\s*(?:no\.?|number|#))?|ser\.?\s*no\.?)[:\s#-]*([a-z0-9][a-z0-9\-/.]{3,})\b/i,
    /\bSN[:\s#-]*([a-z0-9][a-z0-9\-/.]{3,})\b/i
  ]);
  const model = firstMatch(lines, [
    /\b(?:model|mod\.?|m\/n|type)[:\s#-]*([a-z0-9][a-z0-9\-/. ]{1,40})\b/i,
    /\b(?:product|device)[:\s#-]*([a-z0-9][a-z0-9\-/. ]{2,40})\b/i
  ]);
  const suggestions = {
    brand: findKnownBrand(lines),
    model: model.value.replace(/\b(serial|s\/?n|input|output|rating)\b.*$/i, '').trim(),
    serial_number: serial.value,
    ...parsePowerInfo(lines)
  };
  if (suggestions.model && suggestions.serial_number && suggestions.model === suggestions.serial_number) {
    suggestions.model = '';
  }
  return {
    rawText: text,
    lines,
    suggestions,
    matchedLines: {
      model: model.line,
      serial_number: serial.line,
      power: suggestions.power_adapter_notes
    }
  };
}

// --- API ---

function requestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function normalizedBaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function isLoopbackHostname(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

function preferredLanBaseUrl(req) {
  const port = Number(req.socket?.localPort || PORT);
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => (entries || []).map(entry => ({ name, ...entry })))
    .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .sort((a, b) => {
      const virtual = /virtual|vmware|vbox|docker|wsl|hyper-v|vethernet/i;
      return Number(virtual.test(a.name)) - Number(virtual.test(b.name));
    });
  const chosen = candidates[0];
  return chosen ? `${req.protocol}://${chosen.address}:${port}` : requestBaseUrl(req);
}

function shareBaseUrl(req, requested) {
  const normalized = normalizedBaseUrl(requested);
  if (!normalized) {
    const current = normalizedBaseUrl(requestBaseUrl(req));
    try {
      return isLoopbackHostname(new URL(current).hostname) ? preferredLanBaseUrl(req) : current;
    } catch {
      return preferredLanBaseUrl(req);
    }
  }
  return isLoopbackHostname(new URL(normalized).hostname) ? preferredLanBaseUrl(req) : normalized;
}

function scanUrlForItem(req, itemId, requestedBase = '') {
  const base = shareBaseUrl(req, requestedBase);
  return `${base}/scan/${encodeURIComponent(itemId)}?access=${encodeURIComponent(itemScanToken(itemId))}`;
}

app.get('/api/health', (req, res) => {
  const local = isLocalRequest(req);
  const authenticated = local || isValidOwnerToken(ownerTokenFromRequest(req));
  const payload = {
    ok: true,
    version: getCurrentVersion()
  };
  if (authenticated) payload.itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
  if (local) {
    payload.dbPath = DB_PATH;
    payload.appRoot = __dirname.replace(/\\/g, '/');
    payload.lanUrl = preferredLanBaseUrl(req);
  }
  res.json(payload);
});

app.get('/api/update-check', async (req, res) => {
  if (!isLocalRequest(req) && !isValidOwnerToken(ownerTokenFromRequest(req))) {
    return res.status(401).json({ error: 'Owner PIN required for update checks.' });
  }
  res.set('Cache-Control', 'no-store');
  res.json({ ...await checkForUpdate({ force: req.query.force === '1' }), local: isLocalRequest(req) });
});

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return null;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    try {
      return [key, decodeURIComponent(rawValue)];
    } catch {
      return [key, rawValue];
    }
  }).filter(Boolean));
}

function ownerTokenFromRequest(req) {
  return parseCookies(req.get('cookie')).studio_owner_token || '';
}

function isValidOwnerToken(token) {
  return isValidOwnerSessionToken(token);
}

function ownerCookie(req, token, maxAge) {
  const parts = [
    `studio_owner_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ];
  if (req.secure) parts.push('Secure');
  return parts.join('; ');
}

function sendOwnerCookie(req, res, token) {
  res.setHeader('Set-Cookie', ownerCookie(req, token, 60 * 60 * 24 * 30));
}

const loginAttempts = new Map();

function loginAttemptKey(req) {
  return String(req.socket?.remoteAddress || req.ip || 'unknown');
}

function loginAttemptState(req) {
  const key = loginAttemptKey(req);
  const now = Date.now();
  let state = loginAttempts.get(key);
  if (!state || now - state.startedAt >= LOGIN_WINDOW_MS) {
    state = { startedAt: now, failures: 0 };
    loginAttempts.set(key, state);
  }
  return { key, state, now };
}

function loginRateLimited(req, res) {
  if (isLocalRequest(req)) return false;
  const { state, now } = loginAttemptState(req);
  if (state.failures < LOGIN_ATTEMPT_LIMIT) return false;
  const retrySeconds = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - state.startedAt)) / 1000));
  res.setHeader('Retry-After', String(retrySeconds));
  res.status(429).json({ error: 'Too many incorrect PIN attempts. Try again later.' });
  return true;
}

app.get('/api/auth/status', (req, res) => {
  const local = isLocalRequest(req);
  const pinSet = ownerPinConfigured();
  res.json({
    local,
    ownerPinSet: pinSet,
    remoteProtected: !local,
    authenticated: local || isValidOwnerToken(ownerTokenFromRequest(req))
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Owner PIN setup must be done on the studio computer.' });
  }
  try {
    setOwnerPin(req.body?.pin);
    const token = createOwnerSessionToken();
    sendOwnerCookie(req, res, token);
    res.json({ ok: true, ownerPinSet: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not set owner PIN' });
  }
});

app.post('/api/auth/login', (req, res) => {
  if (!ownerPinConfigured()) {
    return res.status(403).json({ error: 'Open Studio Inventory on the studio computer first and set an owner PIN.' });
  }
  if (loginRateLimited(req, res)) return;
  if (!verifyOwnerPin(req.body?.pin)) {
    const attempt = loginAttemptState(req);
    attempt.state.failures += 1;
    loginAttempts.set(attempt.key, attempt.state);
    if (attempt.state.failures >= LOGIN_ATTEMPT_LIMIT) {
      res.setHeader('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
      return res.status(429).json({ error: 'Too many incorrect PIN attempts. Try again in 15 minutes.' });
    }
    return res.status(401).json({ error: 'Incorrect owner PIN' });
  }
  loginAttempts.delete(loginAttemptKey(req));
  const token = createOwnerSessionToken();
  sendOwnerCookie(req, res, token);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  revokeOwnerSessionToken(ownerTokenFromRequest(req));
  res.setHeader('Set-Cookie', ownerCookie(req, '', 0));
  res.json({ ok: true });
});

function ownerMiddleware(req, res, next) {
  if (req.path.startsWith('/guest/')) return next();
  if (req.path.startsWith('/public/')) return next();
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/health') return next();
  if (isLocalRequest(req)) return next();
  if (!ownerPinConfigured()) {
    return res.status(403).json({
      error: 'Remote owner access is locked until an owner PIN is set on the studio computer.',
      ownerAuthRequired: true,
      setupRequired: true
    });
  }
  if (isValidOwnerToken(ownerTokenFromRequest(req))) return next();
  return res.status(401).json({
    error: 'Owner PIN required for remote Studio Inventory access.',
    ownerAuthRequired: true
  });
}

app.use('/api', ownerMiddleware);

/**
 * What the dashboard's completeness summary needs, without enriching every
 * item: the item rows plus how many photos, manuals and receipts each has.
 * (computeItemCompleteness only looks at the lengths of those lists.)
 */
function completenessRows() {
  const counts = new Map(db.prepare(`
    SELECT item_id,
      SUM(type = 'photo') AS photos,
      SUM(type IN ('manual', 'document')) AS manuals,
      SUM(type = 'receipt') AS receipts
    FROM attachments GROUP BY item_id
  `).all().map(row => [row.item_id, row]));
  const none = { photos: 0, manuals: 0, receipts: 0 };
  return db.prepare(`SELECT * FROM items WHERE ${ownedStatusSql('studio_status')} ORDER BY name`).all().map(item => {
    const c = counts.get(item.id) || none;
    return { ...item, photos: { length: c.photos }, manuals: { length: c.manuals }, receipts: { length: c.receipts } };
  });
}

app.get('/api/stats', (_req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) as item_count, COALESCE(SUM(quantity),0) as total_quantity,
      COALESCE(SUM(purchase_price*quantity),0) as total_purchase,
      COALESCE(SUM(replacement_value*quantity),0) as total_replacement,
      COALESCE(SUM(CASE WHEN parent_item_id IS NULL THEN replacement_value*quantity ELSE 0 END),0) as top_level_replacement,
      COALESCE(SUM(CASE WHEN parent_item_id IS NOT NULL THEN replacement_value*quantity ELSE 0 END),0) as nested_replacement
    FROM items
    WHERE ${ownedStatusSql('studio_status')}
  `).get();
  const completeness = summarizeCompleteness(completenessRows());
  const warrantyExpiring = db.prepare(`
    SELECT id, name, category, warranty_end_date, warranty_note, replacement_value
    FROM items
    WHERE ${ownedStatusSql('studio_status')}
      AND warranty_end_date != ''
      AND date(warranty_end_date) >= date('now')
      AND date(warranty_end_date) <= date('now', '+30 days')
    ORDER BY warranty_end_date ASC
    LIMIT 15
  `).all();
  const awayItems = db.prepare(`
    SELECT id, name, category, studio_status, studio_status_note, location
    FROM items
    WHERE ${ownedStatusSql('studio_status')}
      AND studio_status != 'in_studio'
    ORDER BY name ASC
    LIMIT 20
  `).all();
  const activeLoans = getActiveLoans();
  const overdueLoans = activeLoans.filter(l => l.overdue);
  const softwareTotals = getSoftwareTotals();
  const softwareRenewals = getSoftwareRenewals(30);
  res.json({
    totals,
    byCategory: db.prepare(`SELECT category, COUNT(*) as count, COALESCE(SUM(replacement_value*quantity),0) as total_value FROM items WHERE ${ownedStatusSql('studio_status')} GROUP BY category ORDER BY total_value DESC`).all(),
    byLocation: db.prepare(`SELECT location, COUNT(*) as count, COALESCE(SUM(replacement_value*quantity),0) as total_value FROM items WHERE ${ownedStatusSql('studio_status')} GROUP BY location ORDER BY count DESC`).all(),
    recent: db.prepare(`SELECT id,name,category,replacement_value,created_at FROM items WHERE ${ownedStatusSql('studio_status')} ORDER BY created_at DESC LIMIT 5`).all(),
    highValue: db.prepare(`SELECT id,name,category,replacement_value,serial_number FROM items WHERE ${ownedStatusSql('studio_status')} AND replacement_value>=500 ORDER BY replacement_value DESC LIMIT 10`).all(),
    completeness,
    warrantyExpiring,
    awayItems,
    activeLoans,
    overdueLoanCount: overdueLoans.length,
    activeLoanCount: activeLoans.length,
    softwareTotals,
    softwareRenewals,
    softwareRenewalCount: softwareRenewals.length,
    softwareOverdueCount: softwareRenewals.filter(s => s.overdue).length,
    backup: backupPublicStatus()
  });
});

function guestMiddleware(req, res, next) {
  if (!isValidGuestToken(req.params.token)) {
    return res.status(403).json({ error: 'Guest access disabled or invalid link' });
  }
  next();
}

app.get('/api/settings/guest', (req, res) => {
  const s = readSettings();
  const base = requestBaseUrl(req);
  res.json({
    guestEnabled: s.guestEnabled,
    guestToken: s.guestToken,
    guestUrl: `${base}/guest.html?token=${s.guestToken}`,
    pdfSearchEnabled: pdfParseAvailable
  });
});

app.put('/api/settings/guest', (req, res) => {
  const s = writeSettings({ guestEnabled: !!req.body.guestEnabled });
  const base = requestBaseUrl(req);
  res.json({
    guestEnabled: s.guestEnabled,
    guestToken: s.guestToken,
    guestUrl: `${base}/guest.html?token=${s.guestToken}`
  });
});

app.post('/api/settings/guest/regenerate', (req, res) => {
  const s = regenerateGuestToken();
  const base = requestBaseUrl(req);
  res.json({
    guestEnabled: s.guestEnabled,
    guestToken: s.guestToken,
    guestUrl: `${base}/guest.html?token=${s.guestToken}`
  });
});

app.get('/api/settings/brand-logos', (_req, res) => {
  res.json({ lookups: brandLogoLookupsEnabled() });
});

app.put('/api/settings/brand-logos', (req, res) => {
  const settings = writeSettings({ brandLogoLookups: req.body?.lookups === true });
  res.json({ lookups: !!settings.brandLogoLookups });
});

app.get('/api/guest/:token/health', guestMiddleware, (_req, res) => {
  const itemCount = db.prepare(`SELECT COUNT(*) as c FROM items WHERE ${ownedStatusSql('studio_status')}`).get().c;
  res.json({ ok: true, readOnly: true, itemCount });
});

/**
 * What a read-only guest link may see: identification and replacement value
 * for the gear itself. No purchase prices, receipts, notes, loans (borrower
 * names and contact details), maintenance, audit history, or insurance notes.
 */
function guestItemView(item) {
  return {
    id: item.id,
    parent_item_id: item.parent_item_id,
    name: item.name,
    common_name: item.common_name,
    category: item.category,
    instrument_type_label: item.instrument_type_label,
    brand: item.brand,
    brand_logo_path: item.brand_logo_path,
    model: item.model,
    serial_number: item.serial_number,
    year: item.year,
    condition: item.condition,
    location: item.location,
    quantity: item.quantity,
    replacement_value: item.replacement_value,
    photos: (item.photos || []).map(photo => ({
      id: photo.id,
      relative_path: photo.relative_path,
      mime_type: photo.mime_type,
      type: photo.type
    }))
  };
}

app.get('/api/guest/:token/items', guestMiddleware, (req, res) => {
  const { where, values, orderBy } = buildSearchQuery({
    q: req.query.q,
    brand: req.query.brand,
    category: req.query.category,
    location: req.query.location,
    sort: req.query.sort,
    include_accessories: '1'
  });
  res.json(enrichItems(db.prepare(`SELECT i.* FROM items i ${where} ORDER BY ${orderBy}`).all(values))
    .map(guestItemView));
});

app.get('/api/guest/:token/items/:id', guestMiddleware, (req, res) => {
  const item = db.prepare(`SELECT * FROM items WHERE id=? AND ${ownedStatusSql('studio_status')}`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(guestItemView(enrichItem(item)));
});

app.get('/api/guest/:token/stats', guestMiddleware, (_req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) as item_count, COALESCE(SUM(replacement_value*quantity),0) as total_replacement FROM items
    WHERE ${ownedStatusSql('studio_status')}
  `).get();
  res.json({ totals, readOnly: true });
});

function publicItemView(item) {
  const safeAttachment = (attachment) => ({
    id: attachment.id,
    original_name: attachment.original_name,
    relative_path: attachment.relative_path,
    mime_type: attachment.mime_type,
    type: attachment.type,
    version: attachment.version,
    description: attachment.description
  });
  return {
    id: item.id,
    name: item.name,
    common_name: item.common_name,
    category: item.category,
    instrument_type: item.instrument_type,
    instrument_type_label: item.instrument_type_label,
    instrument_specs: item.instrument_specs,
    instrument_details: item.instrument_details,
    brand: item.brand,
    brand_logo_path: item.brand_logo_path,
    model: item.model,
    serial_number: item.serial_number,
    year: item.year,
    purchase_date: item.purchase_date,
    replacement_value: item.replacement_value,
    condition: item.condition,
    location: item.location,
    description: item.description,
    quantity: item.quantity,
    requires_power: item.requires_power,
    power_adapter_voltage: item.power_adapter_voltage,
    power_adapter_current: item.power_adapter_current,
    power_adapter_polarity: item.power_adapter_polarity,
    power_adapter_notes: item.power_adapter_notes,
    photos: (item.photos || []).map(safeAttachment),
    manuals: (item.manuals || []).map(safeAttachment),
    software: (item.software || []).map(safeAttachment)
  };
}

app.get('/api/public/items/:id', (req, res) => {
  if (!isLocalRequest(req)
      && !isValidOwnerToken(ownerTokenFromRequest(req))
      && !isValidItemScanToken(req.params.id, req.query.access)) {
    return res.status(403).json({ error: 'This QR link is invalid or was created by an older release. Reprint the item label.' });
  }
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(publicItemView(enrichItem(item)));
});

function lookupItemByCode(code) {
  const parsed = parseLookupCode(code);
  if (!parsed) return { error: 'empty' };

  if (parsed.type === 'id') {
    const item = db.prepare('SELECT * FROM items WHERE id=?').get(parsed.value);
    if (item) return { match: 'id', item: enrichItem(item) };
  }

  let item = db.prepare('SELECT * FROM items WHERE serial_number = ? COLLATE NOCASE').get(parsed.value);
  if (!item) {
    const safe = String(parsed.value).replace(/[%_]/g, '');
    const rows = db.prepare(`
      SELECT id, name, brand, model, serial_number, location, category
      FROM items WHERE serial_number LIKE ? COLLATE NOCASE
      ORDER BY name LIMIT 8
    `).all(`%${safe}%`);
    if (rows.length === 1) {
      item = db.prepare('SELECT * FROM items WHERE id=?').get(rows[0].id);
    } else if (rows.length > 1) {
      return { match: 'multiple', candidates: rows };
    }
  }
  if (item) return { match: 'serial', item: enrichItem(item) };
  return { error: 'not_found' };
}

app.get('/api/lookup', (req, res) => {
  const result = lookupItemByCode(req.query.code);
  if (result.error === 'empty') return res.status(400).json({ error: 'Code required' });
  if (result.error === 'not_found') return res.status(404).json({ error: 'No matching item' });
  res.json(result);
});

let ocrQueue = Promise.resolve();
function runOcrJob(job) {
  const run = ocrQueue.then(job, job);
  ocrQueue = run.catch(() => {});
  return run;
}

app.post('/api/label-scan', labelScanUpload.single('image'), async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'Label photo required' });
  try {
    const options = { logger: () => {}, cachePath: OCR_CACHE_DIR };
    if (fs.existsSync(path.join(OCR_DATA_DIR, 'eng.traineddata'))) {
      options.langPath = OCR_DATA_DIR;
      options.gzip = false;
    }
    // One OCR job at a time: each one starts a worker that takes a few hundred MB.
    const result = await runOcrJob(() => Tesseract.recognize(req.file.buffer, 'eng', options));
    const text = result?.data?.text || '';
    const parsed = parseLabelScanText(text);
    res.json({
      ok: true,
      confidence: Math.round(result?.data?.confidence || 0),
      ...parsed
    });
  } catch (err) {
    console.error('Label scan failed:', err);
    res.status(500).json({
      error: 'Could not read text from that label photo. Try a closer, sharper photo with the label filling the frame.'
    });
  }
});

app.get('/api/studio/map', (_req, res) => {
  const locations = db.prepare(`
    SELECT location, COUNT(*) as item_count,
      COALESCE(SUM(replacement_value * quantity), 0) as total_value
    FROM items WHERE parent_item_id IS NULL AND ${ownedStatusSql('studio_status')}
    GROUP BY location ORDER BY total_value DESC
  `).all();
  const zones = locations.map(loc => ({
    ...loc,
    items: db.prepare(`
      SELECT id, name, category, brand, model, replacement_value, studio_status
      FROM items WHERE location = ? AND parent_item_id IS NULL AND ${ownedStatusSql('studio_status')}
      ORDER BY replacement_value DESC, name ASC
    `).all(loc.location || '')
  }));
  res.json({ zones });
});

app.get('/api/floorplans', (_req, res) => res.json(getFloorplans()));

app.post('/api/floorplans', (req, res) => {
  try {
    res.status(201).json(createFloorplan(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/floorplans/:id/image', requireFloorplan, floorplanUpload.single('image'), (req, res) => {
  if (!getFloorplan(req.params.id)) return res.status(404).json({ error: 'Floorplan not found' });
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const relativePath = path.join('floorplans', req.file.filename).replace(/\\/g, '/');
  const updated = updateFloorplanImage(req.params.id, relativePath);
  res.json(updated);
});

app.delete('/api/floorplans/:id/floor-image', (req, res) => {
  try {
    res.json(clearFloorplanFloorImage(req.params.id));
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

app.put('/api/floorplans/:id/floor-image/view', (req, res) => {
  try {
    res.json(updateFloorplanFloorView(req.params.id, req.body || {}));
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

app.put('/api/floorplans/:id/geometry', (req, res) => {
  try {
    res.json(updateFloorplanGeometry(req.params.id, req.body || {}));
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

// Replaces every pin; kept for scripts. The app sends PATCH, which only changes the pins it names.
app.put('/api/floorplans/:id/items', (req, res) => {
  try {
    res.json(setFloorplanItems(req.params.id, req.body.items || []));
  } catch (err) {
    res.status(/not found/i.test(err.message) ? 404 : 400).json({ error: err.message });
  }
});

app.patch('/api/floorplans/:id/items', (req, res) => {
  res.json(updateFloorplanItems(req.params.id, req.body || {}));
});

app.delete('/api/floorplans/:id', (req, res) => {
  try {
    deleteFloorplan(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(/not found/i.test(err.message) ? 404 : 400).json({ error: err.message });
  }
});

app.get('/api/items/:id/placement', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(getItemMapPlacement(req.params.id) || { placed: false });
});

app.post('/api/floorplans/:id/walls/:edge/photo', requireFloorplan, wallBackgroundUpload.single('image'), (req, res) => {
  if (!getFloorplan(req.params.id)) return res.status(404).json({ error: 'Floorplan not found' });
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const relativePath = path.join('floorplans', 'walls', String(req.params.id), req.file.filename).replace(/\\/g, '/');
  try {
    res.json(updateFloorplanWallPhoto(req.params.id, req.params.edge, relativePath));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/floorplans/:id/walls/:edge/calibration', (req, res) => {
  if (!getFloorplan(req.params.id)) return res.status(404).json({ error: 'Floorplan not found' });
  try {
    res.json(updateFloorplanWallCalibration(req.params.id, req.params.edge, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/items/:id/wall-rehang', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  try {
    const placement = resolveWallRehang(req.params.id, req.body?.action);
    res.json({ placement, item: enrichItem(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/items/:id/wall-photo', requireItem, wallPhotoUpload.single('image'), (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const relativePath = path.join('wall-photos', String(req.params.id), req.file.filename).replace(/\\/g, '/');
  res.json({ wall_photo_path: relativePath, url: `/uploads/${relativePath.split('/').map(encodeURIComponent).join('/')}` });
});

app.put('/api/items/:id/wall-cutout', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  try {
    res.json(saveItemWallCutout(req.params.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/items/:id/wall-cutout', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  try {
    res.json(clearItemWallCutout(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * The gear list for a rack or signal chain: [{ item_id, position?, slot_label? }].
 * Each item must exist and appear once; anything else is a 400 with a reason.
 */
function memberItemsFromInput(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw clientError('items must be a list');
  const seen = new Set();
  const rows = value.map((row, index) => {
    const itemId = Number(row?.item_id);
    if (!Number.isInteger(itemId) || itemId < 1) throw clientError(`Entry ${index + 1} has no valid item_id`);
    if (seen.has(itemId)) throw clientError(`Item ${itemId} is listed twice`);
    seen.add(itemId);
    const position = Number.isInteger(Number(row.position)) && row.position !== null && row.position !== ''
      ? Number(row.position) : index;
    return { item_id: itemId, position, slot_label: row.slot_label };
  });
  if (rows.length) {
    const found = new Set(db.prepare('SELECT id FROM items WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify([...seen])).map(r => r.id));
    const missing = [...seen].find(id => !found.has(id));
    if (missing) throw clientError(`Item ${missing} not found`);
  }
  return rows;
}

app.get('/api/racks', (_req, res) => res.json(getRacks()));

app.post('/api/racks', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: 'Rack name required' });
  const r = db.prepare(`
    INSERT INTO racks (name, location, notes, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(name, String(req.body.location || '').slice(0, 150),
    String(req.body.notes || '').slice(0, 500), parseInt(req.body.sort_order, 10) || 0);
  res.status(201).json(getRacks().find(x => x.id === r.lastInsertRowid));
});

app.put('/api/racks/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM racks WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Rack not found' });
  if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Rack name required' });
  db.prepare(`
    UPDATE racks SET name=?, location=?, notes=?, sort_order=? WHERE id=?
  `).run(
    String(req.body.name || '').trim().slice(0, 150),
    String(req.body.location || '').slice(0, 150),
    String(req.body.notes || '').slice(0, 500),
    parseInt(req.body.sort_order, 10) || 0,
    req.params.id
  );
  res.json(getRacks().find(x => x.id === Number(req.params.id)));
});

app.delete('/api/racks/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM racks WHERE id=?').run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Rack not found' });
  res.json({ ok: true });
});

app.put('/api/racks/:id/items', (req, res) => {
  if (!db.prepare('SELECT id FROM racks WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Rack not found' });
  const items = memberItemsFromInput(req.body.items);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM rack_items WHERE rack_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO rack_items (rack_id, item_id, position, slot_label) VALUES (?,?,?,?)');
    items.forEach((row) => {
      ins.run(req.params.id, row.item_id, row.position, String(row.slot_label || '').slice(0, 50));
    });
  });
  tx();
  res.json(getRacks().find(x => x.id === Number(req.params.id)));
});

app.get('/api/signal-chains', (_req, res) => res.json(getSignalChains()));

app.post('/api/signal-chains', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: 'Chain name required' });
  const r = db.prepare(`
    INSERT INTO signal_chains (name, description, sort_order) VALUES (?, ?, ?)
  `).run(name, String(req.body.description || '').slice(0, 500), parseInt(req.body.sort_order, 10) || 0);
  res.status(201).json(getSignalChains().find(x => x.id === r.lastInsertRowid));
});

app.put('/api/signal-chains/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM signal_chains WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Chain not found' });
  if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Chain name required' });
  db.prepare(`UPDATE signal_chains SET name=?, description=?, sort_order=? WHERE id=?`).run(
    String(req.body.name || '').trim().slice(0, 150),
    String(req.body.description || '').slice(0, 500),
    parseInt(req.body.sort_order, 10) || 0,
    req.params.id
  );
  res.json(getSignalChains().find(x => x.id === Number(req.params.id)));
});

app.delete('/api/signal-chains/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM signal_chains WHERE id=?').run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Chain not found' });
  res.json({ ok: true });
});

app.put('/api/signal-chains/:id/items', (req, res) => {
  if (!db.prepare('SELECT id FROM signal_chains WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Chain not found' });
  const items = memberItemsFromInput(req.body.items);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM signal_chain_items WHERE chain_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO signal_chain_items (chain_id, item_id, position) VALUES (?,?,?)');
    items.forEach((row) => ins.run(req.params.id, row.item_id, row.position));
  });
  tx();
  res.json(getSignalChains().find(x => x.id === Number(req.params.id)));
});

/**
 * Add or remove one piece of gear in a rack or signal chain. The app changes one
 * entry at a time instead of re-sending the whole list, so two devices editing
 * the same rack can't undo each other. (The PUT routes above replace the whole
 * list and are kept for scripts.)
 */
const MEMBER_LISTS = [
  { route: 'racks', owner: 'racks', table: 'rack_items', key: 'rack_id', noun: 'rack', load: getRacks, slots: true },
  { route: 'signal-chains', owner: 'signal_chains', table: 'signal_chain_items', key: 'chain_id', noun: 'signal chain', load: getSignalChains, slots: false }
];
for (const list of MEMBER_LISTS) {
  const found = (id) => db.prepare(`SELECT id FROM ${list.owner} WHERE id = ?`).get(id);
  const current = (id) => list.load().find(x => x.id === Number(id));
  const notFound = `${list.noun[0].toUpperCase()}${list.noun.slice(1)} not found`;

  app.post(`/api/${list.route}/:id/items`, (req, res) => {
    if (!found(req.params.id)) return res.status(404).json({ error: notFound });
    const [entry] = memberItemsFromInput([{ item_id: req.body?.item_id }]);
    const columns = list.slots ? `${list.key}, item_id, position, slot_label` : `${list.key}, item_id, position`;
    const values = list.slots ? '?, ?, COALESCE(MAX(position), -1) + 1, ?' : '?, ?, COALESCE(MAX(position), -1) + 1';
    const params = [req.params.id, entry.item_id];
    if (list.slots) params.push(String(req.body?.slot_label ?? '').slice(0, 50));
    const added = db.prepare(`
      INSERT OR IGNORE INTO ${list.table} (${columns})
      SELECT ${values} FROM ${list.table} WHERE ${list.key} = ?
    `).run(...params, req.params.id);
    if (!added.changes) return res.status(409).json({ error: `That item is already in this ${list.noun}.` });
    res.status(201).json(current(req.params.id));
  });

  // Removing something that's already gone (another device got there first) is fine.
  app.delete(`/api/${list.route}/:id/items/:itemId`, (req, res) => {
    if (!found(req.params.id)) return res.status(404).json({ error: notFound });
    db.prepare(`DELETE FROM ${list.table} WHERE ${list.key} = ? AND item_id = ?`).run(req.params.id, req.params.itemId);
    res.json(current(req.params.id));
  });
}

app.get('/api/manuals/search', (req, res) => {
  res.json(searchManuals(db, req.query.q));
});

app.post('/api/manuals/reindex', async (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, i.name as item_name FROM attachments a
    JOIN items i ON i.id = a.item_id
    WHERE a.type IN ('manual','document')
  `).all();
  let indexed = 0;
  for (const row of rows) {
    const n = await indexManualAttachment(db, row, row.item_name, UPLOADS_DIR);
    if (n > 0) indexed++;
  }
  res.json({ ok: true, total: rows.length, indexed, pdfSearchEnabled: pdfParseAvailable });
});

app.get('/api/meta', (_req, res) => {
  const categories = db.prepare(`SELECT DISTINCT category FROM items WHERE category!='' ORDER BY category`).all().map(r => r.category);
  const locations = db.prepare(`SELECT DISTINCT location FROM items WHERE location!='' ORDER BY location`).all().map(r => r.location);
  res.json({
    categories: [...new Set([...DEFAULT_CATEGORIES, ...categories])],
    locations: [...new Set([...DEFAULT_LOCATIONS, ...locations])],
    tags: db.prepare('SELECT id,name FROM tags ORDER BY name').all(),
    brands: getBrandsWithCounts(),
    conditions: ['New', 'Excellent', 'Good', 'Fair', 'Poor'],
    instrumentProfiles,
    softwareCategories: SOFTWARE_CATEGORIES,
    licenseTypes: LICENSE_TYPES,
    activationMethods: ACTIVATION_METHODS,
    pluginFormats: PLUGIN_FORMATS
  });
});

app.get('/api/software', (req, res) => {
  res.json(getAllSoftware(req.query));
});

app.get('/api/software/:id', (req, res) => {
  const row = getSoftware(req.params.id);
  if (!row) return res.status(404).json({ error: 'Software license not found' });
  res.json(row);
});

app.post('/api/software', (req, res) => {
  try {
    res.status(201).json(createSoftware(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/software/:id', (req, res) => {
  try {
    res.json(updateSoftware(req.params.id, req.body || {}));
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

app.delete('/api/software/:id', (req, res) => {
  const existing = getSoftware(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Software license not found' });
  const erase = req.body?.erase === true || req.body?.erase === 'true';
  if (!erase || String(req.body?.confirmName || '') !== existing.name) {
    return res.status(400).json({ error: 'Type the software name to delete it.' });
  }
  try {
    deleteSoftware(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/software/:id/screenshot', requireSoftware, softwareScreenshotUpload.single('screenshot'), (req, res) => {
  if (!getSoftware(req.params.id)) return res.status(404).json({ error: 'Software license not found' });
  if (!req.file) return res.status(400).json({ error: 'Screenshot image required' });
  const relativePath = path.join('software-licenses', req.params.id, req.file.filename).replace(/\\/g, '/');
  res.json(updateSoftwareScreenshot(req.params.id, relativePath));
});

app.delete('/api/software/:id/screenshot', (req, res) => {
  try {
    res.json(clearSoftwareScreenshot(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/brands', (_req, res) => {
  res.json(getBrandsWithCounts());
});

app.get('/api/brands/:name', (req, res) => {
  const brand = db.prepare('SELECT * FROM brands WHERE name = ? COLLATE NOCASE').get(req.params.name);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  const item_count = db.prepare('SELECT COUNT(*) as c FROM items WHERE brand = ? COLLATE NOCASE').get(brand.name).c;
  res.json({ ...brand, item_count });
});

app.post('/api/brands/fetch-all', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    const results = await fetchAllInventoryBrandLogos({ force });
    res.json({ ok: true, ...results, brands: getBrandsWithCounts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/brands/:name/fetch-logo', async (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Brand name required' });
  ensureBrand(name);
  const force = req.query.force === '1' || req.body?.force === true;
  try {
    const result = await fetchBrandLogoFromWeb(name, { force });
    const brand = db.prepare('SELECT * FROM brands WHERE name = ? COLLATE NOCASE').get(name);
    const item_count = db.prepare('SELECT COUNT(*) as c FROM items WHERE brand = ? COLLATE NOCASE').get(name).c;
    res.json({ ...result, brand: { ...brand, item_count } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Saving an item looks up its brand's logo online at most twice a day per
// brand, so editing gear whose brand has no real logo doesn't hit the network every time.
const LOGO_RETRY_MS = 12 * 60 * 60 * 1000;
const lastLogoLookup = new Map();

function queueBrandLogoFetch(brandName) {
  if (!brandName) return;
  ensureBrand(brandName);
  const key = brandName.toLowerCase();
  let offline = !brandLogoLookupsEnabled();
  if (!offline) {
    if (Date.now() - (lastLogoLookup.get(key) || 0) < LOGO_RETRY_MS) offline = true;
    else lastLogoLookup.set(key, Date.now());
  }
  fetchBrandLogoFromWeb(brandName, { offline }).catch(err =>
    console.warn(`Background logo fetch for ${brandName}:`, err.message)
  );
}

app.post('/api/brands/logo', logoUpload.single('logo'), (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: 'Brand name required' });
  if (!req.file) return res.status(400).json({ error: 'Logo image required' });

  const logoPath = `logos/${req.file.filename}`;
  ensureBrand(name);
  db.prepare('UPDATE brands SET logo_path = ?, is_custom = 1 WHERE name = ? COLLATE NOCASE').run(logoPath, name);
  const brand = db.prepare('SELECT * FROM brands WHERE name = ? COLLATE NOCASE').get(name);
  const item_count = db.prepare('SELECT COUNT(*) as c FROM items WHERE brand = ? COLLATE NOCASE').get(name).c;
  res.json({ ...brand, item_count });
});

app.get('/api/items', (req, res) => {
  const { where, values, orderBy } = buildSearchQuery(req.query);
  res.json(enrichItems(db.prepare(`SELECT i.* FROM items i ${where} ORDER BY ${orderBy}`).all(values)));
});

app.get('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({
    ...enrichItem(item),
    assembly_totals: getAssemblyTotals(item.id),
    value_events: getValueEvents(item.id),
    audit: getItemAudit(item.id)
  });
});

app.get('/api/items/:id/scan-link', (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.json({
    url: scanUrlForItem(req, req.params.id, req.query.base_url),
    accessToken: itemScanToken(req.params.id)
  });
});

app.get('/api/items/:id/qr', async (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  const scanUrl = scanUrlForItem(req, req.params.id, req.query.base_url);
  try {
    const png = await QRCode.toBuffer(scanUrl, { type: 'png', margin: 1, width: 280, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/items/:id/photo-link', (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ error: 'Item not found' });
  }
  const base = shareBaseUrl(req, req.query.base_url);
  res.json({ url: `${base}/photo-upload.html?id=${encodeURIComponent(req.params.id)}` });
});

app.get('/api/items/:id/photo-qr', async (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  const base = shareBaseUrl(req, req.query.base_url);
  const uploadUrl = `${base}/photo-upload.html?id=${encodeURIComponent(req.params.id)}`;
  try {
    const png = await QRCode.toBuffer(uploadUrl, { type: 'png', margin: 1, width: 280, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function validateParentLink(itemId, parentId) {
  if (!parentId) return;
  const first = db.prepare('SELECT id,parent_item_id FROM items WHERE id=?').get(parentId);
  if (!first) throw new Error('The selected parent item no longer exists.');
  if (!itemId) return;

  const targetId = Number(itemId);
  const seen = new Set();
  let current = first;
  while (current) {
    if (Number(current.id) === targetId) {
      throw new Error('An item cannot belong to itself or one of its own sub-items.');
    }
    if (seen.has(Number(current.id))) throw new Error('The selected item hierarchy already contains a loop.');
    seen.add(Number(current.id));
    current = current.parent_item_id
      ? db.prepare('SELECT id,parent_item_id FROM items WHERE id=?').get(current.parent_item_id)
      : null;
  }
}

app.post('/api/items', (req, res) => {
  let data;
  let tags;
  try {
    data = sanitizeItemInput(req.body || {});
    validateParentLink(null, data.parent_item_id);
    tags = tagListFromInput(req.body?.tags);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const itemId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO items (name,common_name,category,instrument_type,instrument_specs_json,brand,model,serial_number,year,
        purchase_date,purchase_price,replacement_value,replacement_value_note,
        condition,condition_notes,location,description,quantity,update_checks_enabled,
        warranty_end_date,warranty_note,studio_status,studio_status_note,disposition_date,value_updated_at,
        parent_item_id,depreciated_value,on_insurance_policy,insurance_policy_note,
        requires_power,power_adapter_voltage,power_adapter_current,power_adapter_polarity,power_adapter_notes)
      VALUES (@name,@common_name,@category,@instrument_type,@instrument_specs_json,@brand,@model,@serial_number,@year,
        @purchase_date,@purchase_price,@replacement_value,@replacement_value_note,
        @condition,@condition_notes,@location,@description,@quantity,@update_checks_enabled,
        @warranty_end_date,@warranty_note,@studio_status,@studio_status_note,@disposition_date,
        CASE WHEN @replacement_value > 0 THEN datetime('now') ELSE NULL END,
        @parent_item_id,@depreciated_value,@on_insurance_policy,@insurance_policy_note,
        @requires_power,@power_adapter_voltage,@power_adapter_current,@power_adapter_polarity,@power_adapter_notes)
    `).run(data);
    if (Number(data.replacement_value) > 0) {
      recordReplacementValue(result.lastInsertRowid, data.replacement_value, data.replacement_value_note);
    }
    setItemTags(result.lastInsertRowid, tags);
    if (isFormerStatus(data.studio_status)) {
      cascadeFormerStatus(result.lastInsertRowid, data.studio_status, data.studio_status_note, data.disposition_date);
    }
    return result.lastInsertRowid;
  })();
  if (data.brand) queueBrandLogoFetch(data.brand);
  res.status(201).json(enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(itemId)));
});

app.put('/api/items/:id', (req, res) => {
  const existingItem = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!existingItem)
    return res.status(404).json({ error: 'Item not found' });
  const merged = { ...existingItem, ...(req.body || {}) };
  let data;
  let tags = null;
  try {
    data = sanitizeItemInput(merged);
    validateParentLink(req.params.id, data.parent_item_id);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tags')) tags = tagListFromInput(req.body.tags);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const valueChanged = Number(existingItem.replacement_value) !== Number(data.replacement_value);
  db.transaction(() => {
    db.prepare(`
      UPDATE items SET name=@name,common_name=@common_name,category=@category,
        instrument_type=@instrument_type,instrument_specs_json=@instrument_specs_json,brand=@brand,
        model=@model,serial_number=@serial_number,year=@year,purchase_date=@purchase_date,
        purchase_price=@purchase_price,replacement_value=@replacement_value,
        replacement_value_note=@replacement_value_note,condition=@condition,
        condition_notes=@condition_notes,location=@location,description=@description,
        quantity=@quantity,update_checks_enabled=@update_checks_enabled,
        warranty_end_date=@warranty_end_date,warranty_note=@warranty_note,
        studio_status=@studio_status,studio_status_note=@studio_status_note,disposition_date=@disposition_date,
        parent_item_id=@parent_item_id,depreciated_value=@depreciated_value,
        on_insurance_policy=@on_insurance_policy,insurance_policy_note=@insurance_policy_note,
        requires_power=@requires_power,power_adapter_voltage=@power_adapter_voltage,
        power_adapter_current=@power_adapter_current,power_adapter_polarity=@power_adapter_polarity,
        power_adapter_notes=@power_adapter_notes,
        value_updated_at=CASE WHEN @value_changed = 1 AND @replacement_value > 0
          THEN datetime('now') ELSE value_updated_at END,
        updated_at=datetime('now') WHERE id=@id
    `).run({ ...data, id: req.params.id, value_changed: valueChanged ? 1 : 0 });
    if (valueChanged) {
      recordReplacementValue(req.params.id, data.replacement_value, data.replacement_value_note);
    }
    recordItemChanges(req.params.id, existingItem, data);
    if (tags) setItemTags(req.params.id, tags);
    if (isFormerStatus(data.studio_status) && !isFormerStatus(existingItem.studio_status)) {
      cascadeFormerStatus(req.params.id, data.studio_status, data.studio_status_note, data.disposition_date);
    } else if (!isFormerStatus(data.studio_status) && isFormerStatus(existingItem.studio_status)) {
      restoreCascadedChildren(req.params.id, existingItem);
    }
    if (data.name !== existingItem.name) {
      db.prepare(`UPDATE manual_fts SET item_name = ?
        WHERE attachment_id IN (SELECT id FROM attachments WHERE item_id = ?)`).run(data.name, req.params.id);
    }
  })();
  if (data.brand) queueBrandLogoFetch(data.brand);
  res.json(enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id)));
});

app.delete('/api/items/:id', (req, res) => {
  const existing = db.prepare('SELECT id, name FROM items WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const erase = req.body?.erase === true || req.body?.erase === 'true';
  if (!erase || String(req.body?.confirmName || '') !== existing.name) {
    return res.status(400).json({
      error: 'Type the item name to erase a duplicate. Use No longer owned to record a sale, theft, or gift.'
    });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM manual_fts WHERE attachment_id IN (SELECT id FROM attachments WHERE item_id = ?)').run(req.params.id);
    db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
  })();
  // Files go after the rows: a locked file can't leave a half-deleted item behind.
  removeItemUploadDirs(req.params.id);
  res.json({ ok: true });
});

app.get('/api/items/:id/maintenance', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id)).maintenance);
});

app.post('/api/items/:id/maintenance', (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  const entry = addMaintenanceEntry(req.params.id, req.body || {});
  res.status(201).json(entry);
});

app.delete('/api/maintenance/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM maintenance_log WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  deleteMaintenanceEntry(req.params.id);
  res.json({ ok: true });
});

app.get('/api/loans', (_req, res) => {
  res.json({
    active: getActiveLoans(),
    recent: getRecentLoanHistory(40)
  });
});

app.get('/api/items/:id/loans', (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const enriched = enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id));
  res.json({ active: enriched.activeLoan, history: enriched.loans });
});

app.post('/api/items/:id/loans', (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  try {
    const loan = checkoutItem(req.params.id, req.body || {});
    res.status(201).json({
      loan,
      wall_removed: !!loan.wall_removed,
      item: enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/loans/:id/return', (req, res) => {
  try {
    const loan = returnLoan(req.params.id, req.body || {});
    const item = enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(loan.item_id));
    res.json({
      loan,
      item,
      wall_rehang_pending: !!loan.wall_rehang_pending,
      wall_placement: loan.wall_placement || null
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/loans/:id', (req, res) => {
  try {
    deleteLoanEntry(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/items/:id/completeness', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(computeItemCompleteness(enrichItem(item)));
});

app.post('/api/import/csv', express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: '5mb' }), (req, res) => {
  try {
    const { rows } = parseCsv(req.body || '');
    if (!rows.length) return res.status(400).json({ error: 'No data rows found in CSV' });

    const insert = db.prepare(`
      INSERT INTO items (name,common_name,category,instrument_type,instrument_specs_json,brand,model,serial_number,year,
        purchase_date,purchase_price,replacement_value,replacement_value_note,
        condition,condition_notes,location,description,quantity,update_checks_enabled,
        warranty_end_date,warranty_note,studio_status,studio_status_note,disposition_date,value_updated_at,
        parent_item_id,depreciated_value,on_insurance_policy,insurance_policy_note,
        requires_power,power_adapter_voltage,power_adapter_current,power_adapter_polarity,power_adapter_notes)
      VALUES (@name,@common_name,@category,@instrument_type,@instrument_specs_json,@brand,@model,@serial_number,@year,
        @purchase_date,@purchase_price,@replacement_value,@replacement_value_note,
        @condition,@condition_notes,@location,@description,@quantity,@update_checks_enabled,
        @warranty_end_date,@warranty_note,@studio_status,@studio_status_note,@disposition_date,
        CASE WHEN @replacement_value > 0 THEN datetime('now') ELSE NULL END,
        @parent_item_id,@depreciated_value,@on_insurance_policy,@insurance_policy_note,
        @requires_power,@power_adapter_voltage,@power_adapter_current,@power_adapter_polarity,@power_adapter_notes)
    `);

    let imported = 0;
    const errors = [];
    // Each row is its own savepoint: a row that fails part way leaves nothing behind.
    const importRow = db.transaction((row) => {
      const { data, tags } = mapRowToItem(row, sanitizeItemInput);
      const result = insert.run(data);
      if (Number(data.replacement_value) > 0) {
        recordReplacementValue(result.lastInsertRowid, data.replacement_value, data.replacement_value_note);
      }
      setItemTags(result.lastInsertRowid, tags);
      if (data.brand) ensureBrand(data.brand);
    });
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        try {
          importRow(rows[i]);
          imported++;
        } catch (err) {
          errors.push({ row: i + 2, error: err.message });
        }
      }
    });
    tx();
    syncBrandsFromItems();
    res.json({ ok: true, imported, skipped: errors.length, errors: errors.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items/:id/photos', requireItem, photoUpload.array('files', 20), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.files?.length) return res.status(400).json({ error: 'No photos uploaded' });
  res.status(201).json(recordUploadedFiles(req.params.id, req.files, () => 'photo'));
});

app.post('/api/items/:id/manuals', requireItem, manualUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 12 }
]), async (req, res) => {
  const item = db.prepare('SELECT id, name FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const incoming = [...(req.files?.file || []), ...(req.files?.files || [])];
  if (!incoming.length) return res.status(400).json({ error: 'No file uploaded' });
  const description = String(req.body?.description || '').slice(0, 500);
  const created = recordUploadedFiles(req.params.id, incoming,
    file => (file.mimetype === 'application/pdf' ? 'manual' : 'document'),
    () => ({ description }));
  // Search indexing is a bonus: a PDF that can't be read is still kept.
  for (const att of created) {
    try { await indexManualAttachment(db, att, item.name, UPLOADS_DIR); } catch (err) {
      console.warn(`  Manual search skipped ${att.original_name}: ${err.message}`);
    }
  }
  res.status(201).json(created.length === 1 ? created[0] : created);
});

app.post('/api/items/:id/manuals/archive', async (req, res) => {
  const item = db.prepare('SELECT id, name FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { url, description = '' } = req.body;
  if (!url || !isValidDownloadUrl(url))
    return res.status(400).json({ error: 'Valid http/https manual URL required' });

  try {
    const response = await safeFetch(url, {
      headers: { Accept: 'application/pdf,application/octet-stream,*/*' },
      timeoutMs: 120000,
      maxBytes: MAX_MANUAL_DOWNLOAD_SIZE
    });
    if (!response.ok) {
      response.cancel();
      throw clientError(`The site answered HTTP ${response.status} for that link.`, 502);
    }

    const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const origName = normalizeDownloadName(filenameFromResponse(response.url, response.headers), mime);
    if (!isManualDownloadAllowed(mime, origName)) {
      response.cancel();
      throw new Error('That URL returned a web page instead of a manual file. Copy the direct PDF/manual link and try again.');
    }

    const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${origName}`;
    const { dir } = itemUploadDir(req.params.id, 'manual');
    const fullPath = path.join(dir, storedName);
    // Streamed to disk with the 50 MB cap enforced as bytes arrive.
    await response.toFile(fullPath);

    const docType = mime === 'application/pdf' || path.extname(origName).toLowerCase() === '.pdf' ? 'manual' : 'document';
    const [att] = recordUploadedFiles(req.params.id, [{
      filename: storedName,
      originalname: origName,
      mimetype: mime || 'application/octet-stream',
      path: fullPath
    }], () => docType, () => ({
      description: String(description || 'Downloaded from manual search').slice(0, 500),
      source_url: url
    }));

    try { await indexManualAttachment(db, att, item.name, UPLOADS_DIR); } catch (err) {
      console.warn(`  Manual search skipped ${att.original_name}: ${err.message}`);
    }
    res.status(201).json(att);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Manual download failed' });
  }
});

app.post('/api/items/:id/manuals/import-inbox', async (req, res) => {
  const item = db.prepare('SELECT id, name FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const rawName = String(req.body?.filename || '');
  const filename = path.basename(rawName);
  if (!filename || filename !== rawName)
    return res.status(400).json({ error: 'Choose a file from the Manual Inbox' });

  const srcPath = path.resolve(MANUAL_INBOX_DIR, filename);
  const inboxRoot = path.resolve(MANUAL_INBOX_DIR);
  if (!srcPath.startsWith(inboxRoot + path.sep))
    return res.status(400).json({ error: 'Invalid manual inbox file' });
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Manual inbox file not found' });

  const mime = mimeForManualFile(filename);
  if (!isManualDownloadAllowed(mime, filename))
    return res.status(400).json({ error: 'Only PDF, document, text, or image manual files can be imported' });

  try {
    const stat = fs.statSync(srcPath);
    if (stat.size > MAX_MANUAL_DOWNLOAD_SIZE) throw new Error('Manual file exceeds 50MB limit');
    const originalName = safeFilename(filename);
    const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${originalName}`;
    const { dir } = itemUploadDir(req.params.id, 'manual');
    const fullPath = path.join(dir, storedName);
    moveFileIntoPlace(srcPath, fullPath);

    const docType = mime === 'application/pdf' || path.extname(originalName).toLowerCase() === '.pdf' ? 'manual' : 'document';
    let att;
    try {
      att = insertAttachment(req.params.id, {
        filename: storedName,
        originalname: originalName,
        mimetype: mime
      }, docType, {
        description: 'Imported from Manual Inbox',
        metadata: { imported_from: 'manual-inbox' }
      });
    } catch (err) {
      // Put the file back in the inbox so it isn't lost from view.
      try { if (!fs.existsSync(srcPath)) moveFileIntoPlace(fullPath, srcPath); } catch { /* left in the item folder */ }
      throw err;
    }

    try { await indexManualAttachment(db, att, item.name, UPLOADS_DIR); } catch (err) {
      console.warn(`  Manual search skipped ${att.original_name}: ${err.message}`);
    }
    res.status(201).json({ attachment: att, inbox: { dir: MANUAL_INBOX_DIR, files: manualInboxFiles() } });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Manual inbox import failed' });
  }
});

app.post('/api/items/:id/manuals/web-search', async (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const allowedKinds = new Set([...DOCUMENT_KINDS.map((entry) => entry.id), 'all']);
  const kind = allowedKinds.has(req.body?.kind) ? req.body.kind : 'all';
  const custom = String(req.body?.query || '').trim();
  if (!custom && !String(item.brand || item.model || item.name || '').trim()) {
    return res.status(400).json({ error: 'Add a brand or model before searching for documents' });
  }

  try {
    const found = await findGearDocuments(item, {
      kind,
      query: custom,
      fetchText: async (url) => {
        const response = await safeFetch(url, {
          headers: { Accept: 'text/html,application/xhtml+xml' },
          timeoutMs: 15000,
          maxBytes: 3 * 1024 * 1024
        });
        if (!response.ok) {
          response.cancel();
          throw new Error(`Document search failed: HTTP ${response.status}`);
        }
        return response.text();
      }
    });
    if (!found.results.length && found.errors.length) {
      // Nothing came back because the searches failed, not because nothing exists.
      return res.status(502).json({
        error: `The document search sites could not be reached (${found.errors[0]}). Check the internet connection and try again.`
      });
    }
    res.json({ query: found.query, kind: found.kind, results: found.results, failedSearches: found.errors.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Manual search failed' });
  }
});

app.post('/api/items/:id/manuals/discover', async (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { url } = req.body || {};
  if (!url || !isValidDownloadUrl(url))
    return res.status(400).json({ error: 'Valid http/https URL required' });

  try {
    const response = await safeFetch(url, {
      headers: { Accept: 'text/html,application/pdf,application/xhtml+xml,*/*' },
      timeoutMs: 30000,
      maxBytes: 3 * 1024 * 1024
    });
    if (!response.ok) {
      response.cancel();
      throw new Error(`Could not inspect page: HTTP ${response.status}`);
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (isManualDownloadAllowed(mime, filenameFromResponse(response.url, response.headers)) && !mime.includes('text/html')) {
      // It is the file itself: no need to download it just to look at it.
      response.cancel();
      return res.json({
        pageUrl: url,
        candidates: [{
          title: normalizeDownloadName(filenameFromResponse(url, response.headers), mime),
          url,
          displayUrl: url.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
          isPdf: directManualCandidate(url, mime)
        }]
      });
    }
    const html = await response.text();
    res.json({ pageUrl: url, candidates: extractManualLinksFromHtml(response.url, html) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not inspect page' });
  }
});

app.post('/api/items/:id/receipts', requireItem, receiptUpload.single('file'), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No receipt file uploaded' });
  res.status(201).json(recordUploadedFiles(req.params.id, [req.file], () => 'receipt', () => ({
    description: String(req.body?.description || '').slice(0, 500)
  }))[0]);
});

app.post('/api/items/:id/software/upload', requireItem, softwareUpload.single('file'), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json(recordUploadedFiles(req.params.id, [req.file], () => 'software', () => ({
    version: String(req.body?.version || '').slice(0, 100),
    description: String(req.body?.description || '').slice(0, 500)
  }))[0]);
});

app.post('/api/items/:id/software/archive', async (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { url, version = '', description = '' } = req.body;
  if (!url || !isValidDownloadUrl(url))
    return res.status(400).json({ error: 'Valid http/https URL required' });

  try {
    const response = await safeFetch(url, { timeoutMs: 300000, maxBytes: MAX_FILE_SIZE });
    if (!response.ok) {
      response.cancel();
      throw clientError(`The site answered HTTP ${response.status} for that link.`, 502);
    }

    const origName = filenameFromResponse(response.url, response.headers);
    const verPrefix = version ? `${safeFilename(version)}-` : '';
    const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${verPrefix}${origName}`;
    const { dir } = itemUploadDir(req.params.id, 'software');
    const fullPath = path.join(dir, storedName);
    // Streamed to disk; the 100 MB cap is enforced as bytes arrive.
    await response.toFile(fullPath);

    const mime = response.headers.get('content-type') || 'application/octet-stream';
    const [att] = recordUploadedFiles(req.params.id, [{
      filename: storedName,
      originalname: origName,
      mimetype: mime.split(';')[0],
      path: fullPath
    }], () => 'software', () => ({
      version: String(version).slice(0, 100),
      description: String(description).slice(0, 500),
      source_url: url
    }));
    res.status(201).json(att);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Download failed' });
  }
});

app.delete('/api/attachments/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  deleteAttachment(att);
  res.json({ ok: true });
});

app.get('/api/manuals', (_req, res) => {
  res.json(db.prepare(`
    SELECT a.id,a.original_name,a.relative_path,a.mime_type,a.created_at,
           i.id as item_id,i.name as item_name
    FROM attachments a JOIN items i ON i.id=a.item_id
    WHERE a.type IN ('manual','document')
    ORDER BY a.original_name
  `).all());
});

// The server log, for Help & About. Remote viewers need the owner PIN like every
// other /api route; share tokens are masked in the file itself.
app.get('/api/logs', (_req, res) => {
  res.json({ path: LOG_FILE, lines: LOG_FILE ? readRecentLog(DATA_DIR) : [] });
});

app.post('/api/logs/open', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Open the log folder from the studio computer.' });
  if (!LOG_FILE) return res.status(404).json({ error: 'No log file is being written.' });
  try {
    openFolder(path.dirname(LOG_FILE));
    res.json({ ok: true, path: LOG_FILE });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not open the log folder', path: LOG_FILE });
  }
});

// Stop the app from the studio computer (Help & About, the Windows launcher,
// installer and uninstaller). Refused while a restore, import or encryption
// runs: stopping then would leave the catalog half-replaced.
app.post('/api/shutdown', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Stop Studio Inventory from the studio computer.' });
  if (maintenance.exclusive) {
    return res.status(409).json({ error: `${maintenance.exclusive} is in progress. Stop Studio Inventory when it finishes.` });
  }
  const backup = req.body?.skipBackup !== true;
  console.log(`  Stop requested${backup ? '' : ' (no backup)'}.`);
  res.status(202).json({ ok: true, stopping: true });
  // Answer first, then stop, so the caller knows the request was accepted.
  setImmediate(() => shutdown({ backup }));
});

app.get('/api/manual-inbox', (_req, res) => {
  res.json({ dir: MANUAL_INBOX_DIR, files: manualInboxFiles() });
});

app.post('/api/manual-inbox/open', (_req, res) => {
  try {
    const files = manualInboxFiles();
    openFolder(MANUAL_INBOX_DIR);
    res.json({ ok: true, dir: MANUAL_INBOX_DIR, files });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not open manual inbox folder', dir: MANUAL_INBOX_DIR });
  }
});

app.get('/api/documents', (_req, res) => {
  res.json(db.prepare(`
    SELECT a.*, i.name as item_name FROM attachments a
    JOIN items i ON i.id=a.item_id
    WHERE a.type IN ('manual','document','software')
    ORDER BY a.type, a.original_name
  `).all());
});

const BACKUP_TABLES = [
  'items',
  'tags',
  'item_tags',
  'attachments',
  'brands',
  'maintenance_log',
  'loan_log',
  'racks',
  'rack_items',
  'signal_chains',
  'signal_chain_items',
  'floorplans',
  'floorplan_items',
  'software_licenses',
  'item_value_events',
  'item_audit'
];

const BACKUP_DELETE_ORDER = [
  'manual_fts',
  'item_value_events',
  'item_audit',
  'floorplan_items',
  'signal_chain_items',
  'rack_items',
  'item_tags',
  'attachments',
  'maintenance_log',
  'loan_log',
  'software_licenses',
  'floorplans',
  'signal_chains',
  'racks',
  'brands',
  'tags',
  'items'
];

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function backupPublicStatus() {
  const settings = readSettings();
  const lastAt = settings.autoBackupLastAt || '';
  const ageMs = lastAt ? Date.now() - Date.parse(lastAt) : null;
  const configured = !!settings.autoBackupDir;
  const lastError = settings.autoBackupLastError || '';
  const recoveryPath = configured ? path.join(settings.autoBackupDir, RECOVERY_NAME) : '';
  const recoveryPreviousPath = configured ? path.join(settings.autoBackupDir, RECOVERY_PREVIOUS_NAME) : '';
  let recoveryReady = false;
  let recoveryPreviousReady = false;
  if (recoveryPath && fs.existsSync(recoveryPath)) {
    try { recoveryReady = fs.statSync(recoveryPath).size > 0; } catch { recoveryReady = false; }
  }
  if (recoveryPreviousPath && fs.existsSync(recoveryPreviousPath)) {
    try { recoveryPreviousReady = fs.statSync(recoveryPreviousPath).size > 0; } catch { recoveryPreviousReady = false; }
  }
  return {
    configured,
    dir: settings.autoBackupDir || '',
    keep: Number(settings.autoBackupKeep) || DEFAULT_BACKUP_KEEP,
    lastAt,
    lastPath: settings.autoBackupLastPath || '',
    lastError,
    recoveryPath,
    recoveryReady,
    recoveryPreviousReady,
    encryptionArmed: settings.catalogEncryption === 'armed',
    recoveryKeyConfirmed: !!settings.recoveryKeyConfirmed,
    encryptionBlockers: encryptionBlockers(),
    leftovers: listPlaintextLeftovers().map(file => path.relative(DATA_DIR, file)),
    diskWarning: configured ? backupDiskWarning(settings.autoBackupDir, DATA_DIR) : '',
    warn: !configured || !lastAt || !Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000 || !!lastError
  };
}

function insertBackupRows(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const cols = tableColumns(table).filter(col => rows.some(row => Object.prototype.hasOwnProperty.call(row, col)));
  if (!cols.length) return 0;
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => `@${c}`).join(',')})`;
  const stmt = db.prepare(sql);
  let count = 0;
  for (const row of rows) {
    const data = {};
    for (const col of cols) data[col] = row[col] ?? null;
    stmt.run(data);
    count++;
  }
  return count;
}

async function reindexRestoredManuals() {
  db.prepare('DELETE FROM manual_fts').run();
  const manuals = db.prepare(`
    SELECT a.*, i.name as item_name FROM attachments a
    JOIN items i ON i.id = a.item_id
    WHERE a.type IN ('manual','document')
  `).all();
  let processed = 0;
  let indexed = 0;
  for (const att of manuals) {
    const fp = resolveUploadPath(att.relative_path || att.filename);
    if (!fp || !fs.existsSync(fp)) continue;
    try {
      const chars = await indexManualAttachment(db, att, att.item_name, UPLOADS_DIR);
      processed++;
      if (chars > 0) indexed++;
    } catch (err) {
      console.warn('Manual reindex skipped:', att.original_name, err.message);
    }
  }
  return { processed, indexed };
}

function swapStagedDirectory(target, staged, rollback, state) {
  if (fs.existsSync(target)) {
    fs.renameSync(target, rollback);
    state.oldMoved = true;
  }
  fs.renameSync(staged, target);
  state.newMoved = true;
}

function rollbackDirectorySwap(target, rollback, state) {
  if (state.newMoved && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (state.oldMoved && fs.existsSync(rollback)) {
    fs.renameSync(rollback, target);
  }
}

app.get('/api/export/full', withMaintenance('shared', 'A backup download', async (_req, res) => {
  let zipStream;
  try {
    zipStream = createDownloadZipStream({
      db,
      settings: readSettings(),
      appVersion: getCurrentVersion(),
      tables: BACKUP_TABLES,
      uploadsDir: UPLOADS_DIR,
      inboxDir: MANUAL_INBOX_DIR
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not build backup ZIP' });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="studio-inventory-full-backup-${stamp}.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Streamed straight to the browser: memory stays flat however large uploads/ is.
    await pipeline(zipStream, res);
  } catch (err) {
    console.error('Full backup download stopped:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Could not build backup ZIP' });
    else res.destroy(err);
  }
}));

app.get('/api/backup/folder', (_req, res) => {
  res.json(backupPublicStatus());
});

function listPlaintextLeftovers() {
  const leftovers = [];
  const backups = path.join(DATA_DIR, 'backups');
  if (fs.existsSync(backups)) {
    for (const name of fs.readdirSync(backups)) {
      const full = path.join(backups, name);
      if (name.endsWith('.db') && fs.statSync(full).isFile()) leftovers.push(full);
    }
  }
  const cache = path.join(DATA_DIR, 'ocr-cache');
  if (fs.existsSync(cache)) {
    for (const name of fs.readdirSync(cache)) {
      const full = path.join(cache, name);
      if (fs.statSync(full).isFile()) leftovers.push(full);
    }
  }
  return leftovers;
}

function encryptionBlockers({ skipRecoveryZip = false } = {}) {
  const settings = readSettings();
  const blockers = [];
  if (!settings.autoBackupDir) blockers.push('Choose a backup folder outside the data folder.');
  else {
    try { validateBackupDir(settings.autoBackupDir, DATA_DIR); } catch (err) {
      blockers.push(err.message);
    }
  }
  const recovery = settings.autoBackupDir ? path.join(settings.autoBackupDir, RECOVERY_NAME) : '';
  if (!skipRecoveryZip && (!recovery || !fs.existsSync(recovery))) {
    blockers.push('Write the recovery ZIP first.');
  }
  if (!settings.recoveryKeyConfirmed) blockers.push('Show the recovery key and type it back.');
  if (listPlaintextLeftovers().length) blockers.push('Move old database copies and label-scan leftovers out of data/.');
  return blockers;
}

app.get('/api/backup/recovery-key', (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'The recovery key is only shown on the studio computer.' });
  }
  try {
    writeSettings({ recoveryKeyShown: true });
    res.json({ recoveryKey: getDataKey().toString('base64') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/recovery-key/confirm', (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Confirm the recovery key on the studio computer.' });
  }
  if (!readSettings().recoveryKeyShown) {
    return res.status(400).json({ error: 'Show the recovery key first.' });
  }
  const typed = Buffer.from(String(req.body?.recoveryKey || ''));
  const actual = Buffer.from(getDataKey().toString('base64'));
  if (typed.length !== actual.length || !crypto.timingSafeEqual(typed, actual)) {
    return res.status(400).json({ error: 'That is not the recovery key.' });
  }
  writeSettings({ recoveryKeyConfirmed: true });
  res.json(backupPublicStatus());
});

app.post('/api/backup/move-leftovers', (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Move leftover files from the studio computer.' });
  }
  const settings = readSettings();
  if (!settings.autoBackupDir) return res.status(400).json({ error: 'Choose a backup folder first' });
  try {
    const folder = validateBackupDir(settings.autoBackupDir, DATA_DIR);
    const dest = path.join(folder, 'plaintext-leftovers');
    fs.mkdirSync(dest, { recursive: true });
    const moved = [];
    for (const source of listPlaintextLeftovers()) {
      const target = path.join(dest, path.basename(source));
      fs.copyFileSync(source, target);
      if (fs.statSync(target).size !== fs.statSync(source).size) {
        throw new Error(`Could not copy ${path.basename(source)}`);
      }
      fs.unlinkSync(source);
      moved.push(target);
    }
    res.json({ ok: true, moved, ...backupPublicStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not move leftover files' });
  }
});

app.post('/api/backup/encrypt', withMaintenance('exclusive', 'Catalog encryption', async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Encrypt the catalog from the studio computer.' });
  }
  const settings = readSettings();
  if (!settings.autoBackupDir) return res.status(400).json({ error: 'Choose a backup folder first' });
  const blockers = encryptionBlockers({ skipRecoveryZip: true });
  if (blockers.length) return res.status(400).json({ error: blockers[0], blockers });
  try {
    await writeRecoveryCopy({
      db,
      destDir: settings.autoBackupDir,
      dataDir: DATA_DIR,
      uploadsDir: UPLOADS_DIR,
      inboxDir: MANUAL_INBOX_DIR,
      settings,
      appVersion: getCurrentVersion(),
      tables: BACKUP_TABLES
    });
    const written = encryptionBlockers();
    const recoveryProblem = await verifyBackupZip(path.join(settings.autoBackupDir, RECOVERY_NAME));
    if (recoveryProblem) written.push(recoveryProblem);
    if (written.length) return res.status(400).json({ error: written[0], blockers: written });
    if (isPlainSqlite(DB_PATH)) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.pragma('journal_mode = DELETE');
      db.pragma(`rekey='${getDataKey().toString('hex')}'`);
      db.pragma('journal_mode = WAL');
      db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
      if (isPlainSqlite(DB_PATH)) throw new Error('The catalog is still a plain database.');
    }
    commitCatalogEncryption();
    res.json({ ok: true, ...backupPublicStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not encrypt the catalog' });
  }
}));

app.put('/api/backup/folder', async (req, res) => {
  let dir;
  try {
    dir = validateBackupDir(req.body?.dir, DATA_DIR);
    const keep = Math.max(1, Math.min(30, parseInt(req.body?.keep, 10) || readSettings().autoBackupKeep || DEFAULT_BACKUP_KEEP));
    writeSettings({ autoBackupDir: dir, autoBackupKeep: keep, autoBackupLastError: '' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Answer with the disk advice for the new folder (Windows looks it up in the background).
  await warmBackupDiskInfo(dir, DATA_DIR).catch(() => {});
  res.json(backupPublicStatus());
});

app.post('/api/backup/recovery-copy', withMaintenance('shared', 'A recovery copy', async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'The recovery copy is only written from the studio computer.' });
  }
  const settings = readSettings();
  if (!settings.autoBackupDir) {
    return res.status(400).json({ error: 'Choose a backup folder first' });
  }
  try {
    const result = await writeRecoveryCopy({
      db,
      destDir: settings.autoBackupDir,
      dataDir: DATA_DIR,
      uploadsDir: UPLOADS_DIR,
      inboxDir: MANUAL_INBOX_DIR,
      settings,
      appVersion: getCurrentVersion(),
      tables: BACKUP_TABLES
    });
    res.json({ ok: true, recoveryPath: result.path, ...backupPublicStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not write the recovery copy' });
  }
}));

app.post('/api/backup/folder/run', async (_req, res) => {
  try {
    const result = await writeSavedFolderBackup('manual');
    res.json({ ok: true, ...backupPublicStatus(), kept: result.kept });
  } catch (err) {
    if (err.expose && err.status < 500) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Backup failed', ...backupPublicStatus() });
  }
});

app.get('/api/export/json', (_req, res) => {
  const data = {
    exported_at: new Date().toISOString(),
    version: '2.1',
    scope: 'inventory-catalog',
    items: enrichItems(db.prepare('SELECT * FROM items ORDER BY name').all()),
    software_licenses: db.prepare('SELECT * FROM software_licenses ORDER BY name').all(),
    tags: db.prepare('SELECT * FROM tags ORDER BY name').all(),
    brands: getBrandsWithCounts()
  };
  res.setHeader('Content-Disposition', 'attachment; filename="studio-inventory-export.json"');
  res.json(data);
});

app.get('/api/export/sql', (_req, res) => {
  const tables = BACKUP_TABLES;
  let sql = `-- Studio Inventory SQL Dump\n-- ${new Date().toISOString()}\n\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n`;
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    sql += `DELETE FROM ${table};\n`;
    for (const row of rows) {
      const vals = cols.map(c => {
        const v = row[c];
        if (v === null) return 'NULL';
        if (typeof v === 'number') return v;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      sql += `INSERT INTO ${table} (${cols.join(',')}) VALUES (${vals.join(',')});\n`;
    }
    sql += '\n';
  }
  sql += 'COMMIT;\nPRAGMA foreign_keys=ON;\n';
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', 'attachment; filename="studio-inventory-dump.sql"');
  res.send(sql);
});

app.get('/api/export/csv', (req, res) => {
  const { where, values, orderBy } = buildSearchQuery(req.query);
  const items = db.prepare(`SELECT i.* FROM items i ${where} ORDER BY ${orderBy}`).all(values);
  const headers = ['id','name','common_name','category','instrument_type','instrument_specs_json','brand','model','serial_number','year',
    'purchase_date','purchase_price','replacement_value','replacement_value_note','condition',
    'condition_notes','location','description','quantity','requires_power','power_adapter_voltage',
    'power_adapter_current','power_adapter_polarity','power_adapter_notes','update_checks_enabled','tags'];
  const rows = items.map(item => headers.map(h => (h === 'tags'
    ? getTagsForItem(item.id).map(t => t.name).join('; ')
    : item[h])));
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="studio-inventory.csv"');
  res.send(csv);
});

function existingUploadRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').some(part => part === '..')) return '';
  const full = path.resolve(UPLOADS_DIR, rel);
  const root = path.resolve(UPLOADS_DIR);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return '';
  try {
    if (!fs.statSync(full).isFile()) return '';
  } catch {
    return '';
  }
  return rel;
}

app.post('/api/import/json', withMaintenance('exclusive', 'A catalog import', async (req, res) => {
  const { items, software_licenses: softwareLicenses, replace = false, confirmPhrase = '' } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid import data' });
  if (replace && confirmPhrase !== 'replace the catalog') {
    return res.status(400).json({ error: 'Type "replace the catalog" to replace the inventory. This deletes value history and the edit log.' });
  }
  const hasSoftwareCatalog = Array.isArray(softwareLicenses);
  const copiedFiles = [];

  try {
    const result = db.transaction(() => {
      if (replace) {
        db.prepare('DELETE FROM manual_fts').run();
        if (hasSoftwareCatalog) db.prepare('DELETE FROM software_licenses').run();
        db.prepare('DELETE FROM items').run();
        db.prepare('DELETE FROM tags').run();
      }

      const insertItem = db.prepare(`
        INSERT INTO items (id,name,common_name,category,instrument_type,instrument_specs_json,brand,model,serial_number,year,
          purchase_date,purchase_price,replacement_value,replacement_value_note,
          condition,condition_notes,location,description,quantity,update_checks_enabled,
          warranty_end_date,warranty_note,studio_status,studio_status_note,disposition_date,value_updated_at,
          parent_item_id,depreciated_value,on_insurance_policy,insurance_policy_note,
          requires_power,power_adapter_voltage,power_adapter_current,power_adapter_polarity,power_adapter_notes,
          created_at,updated_at)
        VALUES (@id,@name,@common_name,@category,@instrument_type,@instrument_specs_json,@brand,@model,@serial_number,@year,
          @purchase_date,@purchase_price,@replacement_value,@replacement_value_note,
          @condition,@condition_notes,@location,@description,@quantity,@update_checks_enabled,
          @warranty_end_date,@warranty_note,@studio_status,@studio_status_note,@disposition_date,@value_updated_at,
          NULL,@depreciated_value,@on_insurance_policy,@insurance_policy_note,
          @requires_power,@power_adapter_voltage,@power_adapter_current,@power_adapter_polarity,@power_adapter_notes,
          @created_at,@updated_at)
      `);
      const setParent = db.prepare('UPDATE items SET parent_item_id=? WHERE id=?');
      const insertAttachment = db.prepare(`
        INSERT INTO attachments (id,item_id,filename,original_name,relative_path,mime_type,type,
          version,description,source_url,metadata,extracted_text,created_at)
        VALUES (@id,@item_id,@filename,@original_name,@relative_path,@mime_type,@type,
          @version,@description,@source_url,@metadata,'',@created_at)
      `);
      const insertMaintenance = db.prepare(`
        INSERT INTO maintenance_log (id,item_id,service_date,service_type,note,created_at)
        VALUES (@id,@item_id,@service_date,@service_type,@note,@created_at)
      `);
      const insertLoan = db.prepare(`
        INSERT INTO loan_log (id,item_id,borrower_name,borrower_contact,loaned_at,due_date,
          returned_at,note,condition_out,condition_in,created_at)
        VALUES (@id,@item_id,@borrower_name,@borrower_contact,@loaned_at,@due_date,
          @returned_at,@note,@condition_out,@condition_in,@created_at)
      `);
      const cleanText = (value, max = 2000) => String(value ?? '').slice(0, max);
      const validId = (value) => {
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : null;
      };
      const idMap = new Map();
      const pending = [];

      for (const raw of items) {
        const data = sanitizeItemInput(raw || {});
        const sourceId = validId(raw?.id);
        const inserted = insertItem.run({
          ...data,
          id: replace ? sourceId : null,
          value_updated_at: raw?.value_updated_at ? cleanText(raw.value_updated_at, 40) : null,
          created_at: cleanText(raw?.created_at, 40) || new Date().toISOString(),
          updated_at: cleanText(raw?.updated_at, 40) || new Date().toISOString()
        });
        const newId = Number(inserted.lastInsertRowid);
        if (sourceId) idMap.set(sourceId, newId);
        pending.push({ raw: raw || {}, newId, parentSourceId: validId(raw?.parent_item_id) });
        const rawTags = Array.isArray(raw?.tags) ? raw.tags.map(t => (typeof t === 'string' ? t : t?.name)) : raw?.tags;
        let tags = [];
        try { tags = tagListFromInput(Array.isArray(rawTags) ? rawTags.filter(t => typeof t === 'string') : rawTags); } catch { tags = []; }
        setItemTags(newId, tags);
        if (Number(data.replacement_value) > 0) {
          recordReplacementValue(newId, data.replacement_value, data.replacement_value_note);
        }
      }

      const parentOf = db.prepare('SELECT parent_item_id FROM items WHERE id = ?');
      const wouldLoop = (childId, parentId) => {
        for (let id = parentId, depth = 0; id && depth < 1000; depth++) {
          if (id === childId) return true;
          id = parentOf.get(id)?.parent_item_id;
        }
        return false;
      };
      let skippedParents = 0;
      for (const row of pending) {
        const parentId = row.parentSourceId ? idMap.get(row.parentSourceId) : null;
        if (!parentId) continue;
        if (wouldLoop(row.newId, parentId)) { skippedParents++; continue; }
        setParent.run(parentId, row.newId);
      }

      let importedAttachments = 0;
      let skippedAttachments = 0;
      let importedMaintenance = 0;
      let importedLoans = 0;
      for (const row of pending) {
        const seenAttachments = new Set();
        for (const att of Array.isArray(row.raw.attachments) ? row.raw.attachments : []) {
          const sourceAttachmentId = validId(att?.id);
          if (sourceAttachmentId && seenAttachments.has(sourceAttachmentId)) continue;
          if (sourceAttachmentId) seenAttachments.add(sourceAttachmentId);
          let relativePath = existingUploadRelativePath(att?.relative_path || att?.filename);
          if (!relativePath) {
            skippedAttachments++;
            continue;
          }
          // Merged items get their own copy, so deleting one never removes the other's file.
          const [folder, ownerId, ...rest] = relativePath.split('/');
          if (rest.length && ownerId !== String(row.newId)) {
            const destDir = path.join(UPLOADS_DIR, folder, String(row.newId));
            fs.mkdirSync(destDir, { recursive: true });
            const name = `${crypto.randomBytes(4).toString('hex')}-${rest.join('-')}`;
            fs.copyFileSync(path.join(UPLOADS_DIR, relativePath), path.join(destDir, name));
            copiedFiles.push(path.join(destDir, name));
            relativePath = `${folder}/${row.newId}/${name}`;
          }
          insertAttachment.run({
            id: replace ? sourceAttachmentId : null,
            item_id: row.newId,
            filename: path.basename(relativePath),
            original_name: cleanText(att?.original_name || path.basename(relativePath), 500),
            relative_path: relativePath,
            mime_type: cleanText(att?.mime_type, 200),
            type: cleanText(att?.type || 'other', 50),
            version: cleanText(att?.version, 100),
            description: cleanText(att?.description, 500),
            source_url: cleanText(att?.source_url, 2000),
            metadata: JSON.stringify(att?.metadata && typeof att.metadata === 'object' ? att.metadata : {}),
            created_at: cleanText(att?.created_at, 40) || new Date().toISOString()
          });
          importedAttachments++;
        }

        for (const entry of Array.isArray(row.raw.maintenance) ? row.raw.maintenance : []) {
          insertMaintenance.run({
            id: replace ? validId(entry?.id) : null,
            item_id: row.newId,
            service_date: cleanText(entry?.service_date, 10) || new Date().toISOString().slice(0, 10),
            service_type: cleanText(entry?.service_type || 'maintenance', 80),
            note: cleanText(entry?.note, 2000),
            created_at: cleanText(entry?.created_at, 40) || new Date().toISOString()
          });
          importedMaintenance++;
        }

        for (const entry of Array.isArray(row.raw.loans) ? row.raw.loans : []) {
          insertLoan.run({
            id: replace ? validId(entry?.id) : null,
            item_id: row.newId,
            borrower_name: cleanText(entry?.borrower_name, 300) || 'Unknown borrower',
            borrower_contact: cleanText(entry?.borrower_contact, 200),
            loaned_at: cleanText(entry?.loaned_at, 10) || new Date().toISOString().slice(0, 10),
            due_date: entry?.due_date ? cleanText(entry.due_date, 10) : null,
            returned_at: entry?.returned_at ? cleanText(entry.returned_at, 10) : null,
            note: cleanText(entry?.note, 2000),
            condition_out: cleanText(entry?.condition_out, 500),
            condition_in: cleanText(entry?.condition_in, 500),
            created_at: cleanText(entry?.created_at, 40) || new Date().toISOString()
          });
          importedLoans++;
        }
      }

      let importedSoftware = 0;
      if (hasSoftwareCatalog) {
        for (const raw of softwareLicenses) {
          const hostSourceId = validId(raw?.host_item_id);
          const created = createSoftware({
            ...(raw || {}),
            host_item_id: hostSourceId ? idMap.get(hostSourceId) || null : null
          });
          const screenshotPath = existingUploadRelativePath(raw?.screenshot_path);
          if (screenshotPath) updateSoftwareScreenshot(created.id, screenshotPath);
          importedSoftware++;
        }
      }

      return {
        imported: pending.length,
        skippedParents,
        importedAttachments,
        skippedAttachments,
        importedMaintenance,
        importedLoans,
        importedSoftware
      };
    })();

    syncBrandsFromItems();
    let manualIndex = { processed: 0, indexed: 0 };
    try { manualIndex = await reindexRestoredManuals(); } catch (err) {
      console.warn('JSON import completed, but manual search could not be rebuilt:', err.message);
    }
    res.json({ ...result, ok: true, manualsProcessed: manualIndex.processed, indexedManuals: manualIndex.indexed });
  } catch (err) {
    for (const file of copiedFiles) {
      try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
    }
    const status = err.status || (String(err.code || '').startsWith('SQLITE') ? 500 : 400);
    res.status(status).json({ error: err.message });
  }
}));

async function restoreUploadedBackup(filePath) {
  const restoreId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const stageRoot = path.join(DATA_DIR, `.restore-stage-${restoreId}`);
  const stageUploads = path.join(stageRoot, 'uploads');
  const stageInbox = path.join(stageRoot, 'manual-inbox');
  const rollbackUploads = path.join(DATA_DIR, `.restore-previous-uploads-${restoreId}`);
  const rollbackInbox = path.join(DATA_DIR, `.restore-previous-inbox-${restoreId}`);
  const uploadSwap = { oldMoved: false, newMoved: false };
  const inboxSwap = { oldMoved: false, newMoved: false };
  let restoreSucceeded = false;

  try {
    // Encrypted backups are decrypted to a temporary file, then everything is
    // streamed from disk: restoring never holds the whole backup in memory.
    const opened = await openBackupZip(filePath, { tempDir: BACKUP_INCOMING_DIR });
    let backup;
    let restoredFiles = 0;
    try {
      const raw = await readZipEntry(opened.zipPath, 'backup.json');
      if (!raw) throw new Error('Backup ZIP is missing backup.json');
      try {
        backup = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new Error('This is not a Studio Inventory full backup ZIP (backup.json is damaged)');
      }
      if (backup?.manifest?.format !== 'studio-inventory-full-backup' || !backup.tables) {
        throw new Error('This is not a Studio Inventory full backup ZIP');
      }

      fs.mkdirSync(stageUploads, { recursive: true });
      fs.mkdirSync(stageInbox, { recursive: true });
      restoredFiles = await extractZipPrefixes(opened.zipPath, [
        { prefix: 'uploads', dir: stageUploads },
        { prefix: 'manual-inbox', dir: stageInbox }
      ]);
    } finally {
      opened.cleanup();
    }

    let restoredRows = 0;
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        for (const table of BACKUP_DELETE_ORDER) {
          db.prepare(`DELETE FROM ${table}`).run();
        }
        for (const table of BACKUP_TABLES) {
          restoredRows += insertBackupRows(table, backup.tables[table] || []);
        }

        const violations = db.pragma('foreign_key_check');
        if (violations.length) {
          throw new Error(`Backup contains ${violations.length} invalid database relationship(s)`);
        }

        swapStagedDirectory(UPLOADS_DIR, stageUploads, rollbackUploads, uploadSwap);
        swapStagedDirectory(MANUAL_INBOX_DIR, stageInbox, rollbackInbox, inboxSwap);
      })();
      restoreSucceeded = true;
    } catch (err) {
      try { rollbackDirectorySwap(MANUAL_INBOX_DIR, rollbackInbox, inboxSwap); } catch (rollbackErr) {
        console.error('Could not roll back manual inbox after failed restore:', rollbackErr);
      }
      try { rollbackDirectorySwap(UPLOADS_DIR, rollbackUploads, uploadSwap); } catch (rollbackErr) {
        console.error('Could not roll back uploads after failed restore:', rollbackErr);
      }
      throw err;
    } finally {
      db.pragma('foreign_keys = ON');
    }

    if (backup.settings) {
      try {
        writeSettings({
          guestEnabled: !!backup.settings.guestEnabled,
          guestToken: backup.settings.guestToken || readSettings().guestToken,
          scanLinkSecret: backup.settings.scanLinkSecret || readSettings().scanLinkSecret
        });
      } catch (settingsErr) {
        console.warn('Backup restored, but guest settings could not be updated:', settingsErr.message);
      }
    }

    let manualIndex = { processed: 0, indexed: 0 };
    try {
      manualIndex = await reindexRestoredManuals();
    } catch (indexErr) {
      console.warn('Backup restored, but manual search could not be rebuilt:', indexErr.message);
    }
    const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
    return {
      ok: true,
      tables: BACKUP_TABLES.length,
      rows: restoredRows,
      files: restoredFiles,
      items: itemCount,
      indexedManuals: manualIndex.indexed,
      manualsProcessed: manualIndex.processed
    };
  } finally {
    try { if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    if (restoreSucceeded) {
      try { if (fs.existsSync(rollbackUploads)) fs.rmSync(rollbackUploads, { recursive: true, force: true }); } catch { /* ignore */ }
      try { if (fs.existsSync(rollbackInbox)) fs.rmSync(rollbackInbox, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

app.post('/api/import/full', backupUpload.single('backup'), withMaintenance('exclusive', 'A backup restore', async (req, res) => {
  if (!req.file?.path) return res.status(400).json({ error: 'Choose a Studio Inventory backup ZIP' });
  try {
    res.json(await restoreUploadedBackup(req.file.path));
  } catch (err) {
    const status = /missing backup|not a Studio|unlock|Could not unlock|Encrypted backup/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message || 'Could not restore backup ZIP' });
  } finally {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch { /* cleanup on next run */ }
  }
}));

app.get('/scan/:id', (req, res) => {
  if (!isLocalRequest(req)
      && !isValidOwnerToken(ownerTokenFromRequest(req))
      && !isValidItemScanToken(req.params.id, req.query.access)) {
    return res.status(403).send('This Studio Inventory QR link is invalid or needs to be reprinted.');
  }
  const access = req.query.access ? `&access=${encodeURIComponent(req.query.access)}` : '';
  res.redirect(`/scan.html?id=${encodeURIComponent(req.params.id)}${access}`);
});

// Unknown API routes and missing uploaded files are 404s, not the app's page.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/uploads', (_req, res) => res.status(404).json({ error: 'File not found' }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Registered last so it also covers /scan/:id and the page route above.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = Number(err.status || err.statusCode) || 500;
  if (err instanceof multer.MulterError) status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (status < 400 || status > 599) status = 500;
  const expose = status < 500 || err.expose === true;
  if (!expose) console.error(`  ${req.method} ${req.originalUrl} failed:`, err);
  const message = expose
    ? (err.message || 'Request failed')
    : 'Something went wrong on the studio computer. The details are in the Studio Inventory log (Help & About → Server log).';
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.accepts(['json', 'html']) === 'json') {
    return res.status(status).json({ error: message });
  }
  return res.status(status).type('text/plain').send(message);
});

const AUTO_BACKUP_MS = 24 * 60 * 60 * 1000;
const OPEN_BACKUP_MS = 6 * 60 * 60 * 1000;
let folderBackupRunning = false;
let shuttingDown = false;

function catalogNewerThan(lastMs) {
  for (const suffix of ['', '-wal']) {
    try {
      if (fs.statSync(DB_PATH + suffix).mtimeMs > lastMs) return true;
    } catch { /* no file yet */ }
  }
  return false;
}

function backupIsDue(settings) {
  if (!settings.autoBackupDir) return false;
  const last = Date.parse(settings.autoBackupLastAt || '');
  if (!last) return true;
  if (Date.now() - last > AUTO_BACKUP_MS) return true;
  return catalogNewerThan(last);
}

/**
 * Write a backup to the saved backup folder now. Throws a 409 error when a
 * backup is already running and a 400 error when no folder is set.
 */
async function writeSavedFolderBackup(reason) {
  if (folderBackupRunning) throw clientError('A backup is already running. Try again in a minute.', 409);
  const settings = readSettings();
  if (!settings.autoBackupDir) throw clientError('Choose a backup folder first');
  const release = beginMaintenance('shared', 'A backup');
  folderBackupRunning = true;
  try {
    const result = await writeFolderBackup({
      db,
      destDir: settings.autoBackupDir,
      dataDir: DATA_DIR,
      uploadsDir: UPLOADS_DIR,
      inboxDir: MANUAL_INBOX_DIR,
      settings,
      appVersion: getCurrentVersion(),
      tables: BACKUP_TABLES,
      keep: settings.autoBackupKeep || DEFAULT_BACKUP_KEEP
    });
    recordBackupOutcome({
      autoBackupLastAt: new Date().toISOString(),
      autoBackupLastPath: result.path,
      autoBackupLastError: ''
    });
    console.log(`  Folder backup (${reason}): ${result.path}`);
    return result;
  } catch (err) {
    recordBackupOutcome({ autoBackupLastError: err.message || 'Backup failed' });
    throw err;
  } finally {
    folderBackupRunning = false;
    release();
  }
}

function recordBackupOutcome(fields) {
  try {
    writeSettings(fields);
  } catch (err) {
    console.error('  Could not record the backup result in settings:', err.message);
  }
}

/** Scheduled and shutdown backups: never throws. */
async function runSavedFolderBackup(reason) {
  try {
    return await writeSavedFolderBackup(reason);
  } catch (err) {
    if (!(err.status >= 400 && err.status < 500)) console.error(`  Folder backup failed (${reason}): ${err.message}`);
    return null;
  }
}

function startFolderBackupSchedule() {
  if (process.env.STUDIO_SKIP_AUTO_BACKUP === '1') return;
  const runIf = (reason, isWanted) => {
    try {
      if (isWanted(readSettings())) runSavedFolderBackup(reason);
    } catch (err) {
      console.error(`  Folder backup check failed (${reason}): ${err.message}`);
    }
  };
  setTimeout(() => runIf('startup', backupIsDue), 4000).unref();
  setInterval(() => runIf('interval', settings => !!settings.autoBackupDir), OPEN_BACKUP_MS).unref();
}

/**
 * Stop the app cleanly: an optional last backup, let requests in flight
 * finish, close the catalog (folding the write-ahead log back into it), exit.
 * Used by Ctrl+C / stop signals on macOS and Linux, and by POST /api/shutdown,
 * which is how the Windows launcher, installer and uninstaller stop the app
 * (Windows has no stop signal a program can catch).
 */
async function shutdown({ backup = true } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (backup && process.env.STUDIO_SKIP_AUTO_BACKUP !== '1') {
      const settings = readSettings();
      const last = Date.parse(settings.autoBackupLastAt || '');
      if (settings.autoBackupDir && (!last || Date.now() - last > 15 * 60 * 1000)) {
        await runSavedFolderBackup('shutdown');
      }
    }
  } catch (err) {
    console.error('Shutdown backup failed:', err.message);
  }
  console.log('  Studio Inventory is stopping.');
  await closeHttpServer();
  try {
    db.close(); // folds the write-ahead log back into the catalog file
  } catch (err) {
    console.error('Could not close the catalog cleanly:', err.message);
  }
  process.exit(0);
}

process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());

async function restorePendingMove() {
  const pending = path.join(DATA_DIR, 'pending-move-restore.zip');
  if (!fs.existsSync(pending)) return;
  try {
    const result = await restoreUploadedBackup(pending);
    fs.unlinkSync(pending);
    console.log(`  Restored ${result.items} items from the recovery ZIP.`);
  } catch (err) {
    console.error('  Could not restore the recovery ZIP:', err.message);
    console.error('  The ZIP is still at', pending);
  }
}

let httpServer = null;

/** Stop taking requests and let the ones in flight finish (up to 5 seconds). */
function closeHttpServer() {
  if (!httpServer) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      httpServer.closeAllConnections?.();
      resolve();
    }, 5000);
    force.unref();
    httpServer.close(() => {
      clearTimeout(force);
      resolve();
    });
    httpServer.closeIdleConnections?.();
  });
}

restorePendingMove().then(() => {
httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Studio Inventory v${getCurrentVersion()} running at http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Uploads:  ${UPLOADS_DIR}\n`);
  startFolderBackupSchedule();
  try {
    const backupDir = readSettings().autoBackupDir;
    if (backupDir) warmBackupDiskInfo(backupDir, DATA_DIR).catch(() => {});
  } catch { /* settings problems are reported elsewhere */ }

  checkForUpdate().then((info) => {
    if (info.updateAvailable) {
      console.log(`  Update available: v${info.latestVersion} (you have v${info.currentVersion})`);
      console.log(`  Download: ${info.releaseUrl}\n`);
    } else if (info.error) {
      console.log(`  Update check skipped (${info.error})\n`);
    }
  }).catch(() => {});
});
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Studio Inventory may already be running:`
      + ` open http://localhost:${PORT} in your browser, or close the other copy and start again.\n`);
  } else {
    console.error('\n  Studio Inventory could not start its web server:', err.message, '\n');
  }
  process.exit(1);
});
});
