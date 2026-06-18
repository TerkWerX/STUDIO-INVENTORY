const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const {
  db, DB_PATH, DATA_DIR, UPLOADS_DIR, initSchema,
  enrichItem, setItemTags, sanitizeItemInput, itemUploadDir,
  removeItemUploadDirs, DEFAULT_CATEGORIES, DEFAULT_LOCATIONS,
  ensureBrand, getBrandsWithCounts, syncBrandsFromItems, brandSlug, LOGOS_DIR,
  addMaintenanceEntry, deleteMaintenanceEntry
} = require('./db');
const { summarizeCompleteness, computeItemCompleteness } = require('./lib/completeness');
const { parseCsv, mapRowToItem } = require('./lib/csv-import');
const { fetchBrandLogoFromWeb, fetchAllInventoryBrandLogos } = require('./lib/fetch-brand-logo');
const { getCurrentVersion, checkForUpdate } = require('./lib/version');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3847;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

initSchema();
syncBrandsFromItems();

// Fetch logos for all brands in inventory that lack a quality logo (sample set, etc.)
setTimeout(() => {
  fetchAllInventoryBrandLogos().then(r => {
    if (r.fetched > 0) console.log(`  Brand logos: fetched ${r.fetched}, skipped ${r.skipped}, failed ${r.failed}`);
  }).catch(err => console.warn('  Brand logo batch:', err.message));
}, 2500);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

function safeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

function makeUploadStorage(type) {
  return multer.diskStorage({
    destination: (req, _file, cb) => {
      const itemId = req.params.id;
      const { dir } = itemUploadDir(itemId, type);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  });
}

function createUploader(type, options = {}) {
  return multer({
    storage: makeUploadStorage(type),
    limits: { fileSize: options.maxSize || MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (options.filter) return options.filter(file, cb);
      cb(null, true);
    }
  });
}

const photoUpload = createUploader('photo', {
  maxSize: 25 * 1024 * 1024,
  filter: (file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed for photos'));
  }
});

const manualUpload = createUploader('manual', {
  maxSize: 50 * 1024 * 1024,
  filter: (file, cb) => {
    const ok = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'].includes(file.mimetype) || file.mimetype.startsWith('image/');
    cb(null, ok);
  }
});

const receiptUpload = createUploader('receipt', {
  maxSize: 25 * 1024 * 1024,
  filter: (file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    cb(null, ok);
  }
});

const softwareUpload = createUploader('software', { maxSize: MAX_FILE_SIZE });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOGOS_DIR),
    filename: (req, file, cb) => {
      const name = req.body.name || req.params.name || 'custom';
      const slug = brandSlug(name);
      const ext = ['.png', '.svg', '.webp', '.jpg', '.jpeg'].includes(path.extname(file.originalname).toLowerCase())
        ? path.extname(file.originalname).toLowerCase() : '.png';
      cb(null, `${slug}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Logo must be an image (PNG, SVG, WebP)'));
  }
});

function insertAttachment(itemId, file, type, extra = {}) {
  const sub = { photo: 'photos', manual: 'manuals', document: 'manuals', software: 'software', receipt: 'receipts' }[type] || 'manuals';
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

function buildSearchQuery(params) {
  const conditions = [];
  const values = {};

  if (params.q) {
    conditions.push(`(
      i.name LIKE @q OR i.common_name LIKE @q OR i.brand LIKE @q OR
      i.model LIKE @q OR i.serial_number LIKE @q OR i.description LIKE @q OR
      i.location LIKE @q OR i.category LIKE @q OR i.replacement_value_note LIKE @q OR
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
    values.min_value = parseFloat(params.min_value);
  }
  if (params.max_value) {
    conditions.push('i.replacement_value <= @max_value');
    values.max_value = parseFloat(params.max_value);
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
  if (match) return safeFilename(decodeURIComponent(match[1].replace(/"/g, '')));
  const urlPath = new URL(url).pathname;
  const base = path.basename(urlPath);
  return safeFilename(base || 'download.bin');
}

// --- API ---

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: getCurrentVersion(),
    itemCount: db.prepare('SELECT COUNT(*) as c FROM items').get().c,
    dbPath: DB_PATH
  });
});

app.get('/api/update-check', async (_req, res) => {
  res.json(await checkForUpdate());
});

app.get('/api/stats', (_req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) as item_count, COALESCE(SUM(quantity),0) as total_quantity,
      COALESCE(SUM(purchase_price*quantity),0) as total_purchase,
      COALESCE(SUM(replacement_value*quantity),0) as total_replacement FROM items
  `).get();
  const allItems = db.prepare('SELECT * FROM items ORDER BY name').all().map(enrichItem);
  const completeness = summarizeCompleteness(allItems);
  const warrantyExpiring = db.prepare(`
    SELECT id, name, category, warranty_end_date, warranty_note, replacement_value
    FROM items
    WHERE warranty_end_date != ''
      AND date(warranty_end_date) >= date('now')
      AND date(warranty_end_date) <= date('now', '+30 days')
    ORDER BY warranty_end_date ASC
    LIMIT 15
  `).all();
  const awayItems = db.prepare(`
    SELECT id, name, category, studio_status, studio_status_note, location
    FROM items
    WHERE studio_status != 'in_studio'
    ORDER BY name ASC
    LIMIT 20
  `).all();
  res.json({
    totals,
    byCategory: db.prepare(`SELECT category, COUNT(*) as count, COALESCE(SUM(replacement_value*quantity),0) as total_value FROM items GROUP BY category ORDER BY total_value DESC`).all(),
    byLocation: db.prepare(`SELECT location, COUNT(*) as count, COALESCE(SUM(replacement_value*quantity),0) as total_value FROM items GROUP BY location ORDER BY count DESC`).all(),
    recent: db.prepare(`SELECT id,name,category,replacement_value,created_at FROM items ORDER BY created_at DESC LIMIT 5`).all(),
    highValue: db.prepare(`SELECT id,name,category,replacement_value,serial_number FROM items WHERE replacement_value>=500 ORDER BY replacement_value DESC LIMIT 10`).all(),
    completeness,
    warrantyExpiring,
    awayItems
  });
});

app.get('/api/meta', (_req, res) => {
  const categories = db.prepare(`SELECT DISTINCT category FROM items WHERE category!='' ORDER BY category`).all().map(r => r.category);
  const locations = db.prepare(`SELECT DISTINCT location FROM items WHERE location!='' ORDER BY location`).all().map(r => r.location);
  res.json({
    categories: [...new Set([...DEFAULT_CATEGORIES, ...categories])],
    locations: [...new Set([...DEFAULT_LOCATIONS, ...locations])],
    tags: db.prepare('SELECT id,name FROM tags ORDER BY name').all(),
    brands: getBrandsWithCounts(),
    conditions: ['New', 'Excellent', 'Good', 'Fair', 'Poor']
  });
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
  const name = decodeURIComponent(req.params.name || '').trim();
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

function queueBrandLogoFetch(brandName) {
  if (!brandName) return;
  ensureBrand(brandName);
  fetchBrandLogoFromWeb(brandName).catch(err =>
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
  res.json(db.prepare(`SELECT i.* FROM items i ${where} ORDER BY ${orderBy}`).all(values).map(enrichItem));
});

app.get('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(enrichItem(item));
});

function requestBaseUrl(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}`;
}

app.get('/api/items/:id/qr', async (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  const scanUrl = `${requestBaseUrl(req)}/scan/${req.params.id}`;
  try {
    const png = await QRCode.toBuffer(scanUrl, { type: 'png', margin: 1, width: 280, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/items/:id/photo-qr', async (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  const uploadUrl = `${requestBaseUrl(req)}/photo-upload.html?id=${req.params.id}`;
  try {
    const png = await QRCode.toBuffer(uploadUrl, { type: 'png', margin: 1, width: 280, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', (req, res) => {
  const data = sanitizeItemInput(req.body);
  const result = db.prepare(`
    INSERT INTO items (name,common_name,category,brand,model,serial_number,year,
      purchase_date,purchase_price,replacement_value,replacement_value_note,
      condition,condition_notes,location,description,quantity,update_checks_enabled,
      warranty_end_date,warranty_note,studio_status,studio_status_note,value_updated_at)
    VALUES (@name,@common_name,@category,@brand,@model,@serial_number,@year,
      @purchase_date,@purchase_price,@replacement_value,@replacement_value_note,
      @condition,@condition_notes,@location,@description,@quantity,@update_checks_enabled,
      @warranty_end_date,@warranty_note,@studio_status,@studio_status_note,
      CASE WHEN @replacement_value > 0 THEN datetime('now') ELSE NULL END)
  `).run(data);
  setItemTags(result.lastInsertRowid, req.body.tags || []);
  if (data.brand) queueBrandLogoFetch(data.brand);
  res.status(201).json(enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(result.lastInsertRowid)));
});

app.put('/api/items/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  const data = sanitizeItemInput(req.body);
  const existing = db.prepare('SELECT replacement_value, value_updated_at FROM items WHERE id=?').get(req.params.id);
  const valueChanged = existing && Number(existing.replacement_value) !== Number(data.replacement_value);
  db.prepare(`
    UPDATE items SET name=@name,common_name=@common_name,category=@category,brand=@brand,
      model=@model,serial_number=@serial_number,year=@year,purchase_date=@purchase_date,
      purchase_price=@purchase_price,replacement_value=@replacement_value,
      replacement_value_note=@replacement_value_note,condition=@condition,
      condition_notes=@condition_notes,location=@location,description=@description,
      quantity=@quantity,update_checks_enabled=@update_checks_enabled,
      warranty_end_date=@warranty_end_date,warranty_note=@warranty_note,
      studio_status=@studio_status,studio_status_note=@studio_status_note,
      value_updated_at=CASE WHEN @value_changed = 1 AND @replacement_value > 0
        THEN datetime('now') ELSE value_updated_at END,
      updated_at=datetime('now') WHERE id=@id
  `).run({ ...data, id: req.params.id, value_changed: valueChanged ? 1 : 0 });
  setItemTags(req.params.id, req.body.tags || []);
  if (data.brand) queueBrandLogoFetch(data.brand);
  res.json(enrichItem(db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id)));
});

app.delete('/api/items/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  removeItemUploadDirs(req.params.id);
  db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
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
      INSERT INTO items (name,common_name,category,brand,model,serial_number,year,
        purchase_date,purchase_price,replacement_value,replacement_value_note,
        condition,condition_notes,location,description,quantity,update_checks_enabled,
        warranty_end_date,warranty_note,studio_status,studio_status_note,value_updated_at)
      VALUES (@name,@common_name,@category,@brand,@model,@serial_number,@year,
        @purchase_date,@purchase_price,@replacement_value,@replacement_value_note,
        @condition,@condition_notes,@location,@description,@quantity,@update_checks_enabled,
        @warranty_end_date,@warranty_note,@studio_status,@studio_status_note,
        CASE WHEN @replacement_value > 0 THEN datetime('now') ELSE NULL END)
    `);

    let imported = 0;
    const errors = [];
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        try {
          const { data, tags } = mapRowToItem(rows[i], sanitizeItemInput);
          const result = insert.run(data);
          setItemTags(result.lastInsertRowid, tags);
          if (data.brand) ensureBrand(data.brand);
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

app.post('/api/items/:id/photos', photoUpload.array('files', 20), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.files?.length) return res.status(400).json({ error: 'No photos uploaded' });
  const created = req.files.map(f => insertAttachment(req.params.id, f, 'photo'));
  res.status(201).json(created);
});

app.post('/api/items/:id/manuals', manualUpload.single('file'), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const docType = req.file.mimetype === 'application/pdf' ? 'manual' : 'document';
  res.status(201).json(insertAttachment(req.params.id, req.file, docType));
});

app.post('/api/items/:id/receipts', receiptUpload.single('file'), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No receipt file uploaded' });
  res.status(201).json(insertAttachment(req.params.id, req.file, 'receipt', {
    description: String(req.body.description || '').slice(0, 500)
  }));
});

app.post('/api/items/:id/software/upload', softwareUpload.single('file'), (req, res) => {
  if (!db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id))
    return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json(insertAttachment(req.params.id, req.file, 'software', {
    version: String(req.body.version || '').slice(0, 100),
    description: String(req.body.description || '').slice(0, 500)
  }));
});

app.post('/api/items/:id/software/archive', async (req, res) => {
  const item = db.prepare('SELECT id FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { url, version = '', description = '' } = req.body;
  if (!url || !isValidDownloadUrl(url))
    return res.status(400).json({ error: 'Valid http/https URL required' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'StudioInventory/1.0 (local backup)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

    const origName = filenameFromResponse(url, response.headers);
    const verPrefix = version ? `${safeFilename(version)}-` : '';
    const storedName = `${Date.now()}-${verPrefix}${origName}`;
    const { dir, sub } = itemUploadDir(req.params.id, 'software');
    const fullPath = path.join(dir, storedName);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) throw new Error('File exceeds 100MB limit');
    fs.writeFileSync(fullPath, buffer);

    const mime = response.headers.get('content-type') || 'application/octet-stream';
    const att = insertAttachment(req.params.id, {
      filename: storedName,
      original_name: origName,
      mimetype: mime.split(';')[0]
    }, 'software', {
      version: String(version).slice(0, 100),
      description: String(description).slice(0, 500),
      source_url: url
    });
    res.status(201).json(att);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Download failed' });
  }
});

app.delete('/api/attachments/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  const fp = path.join(UPLOADS_DIR, att.relative_path || att.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM attachments WHERE id=?').run(req.params.id);
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

app.get('/api/documents', (_req, res) => {
  res.json(db.prepare(`
    SELECT a.*, i.name as item_name FROM attachments a
    JOIN items i ON i.id=a.item_id
    WHERE a.type IN ('manual','document','software')
    ORDER BY a.type, a.original_name
  `).all());
});

app.get('/api/export/json', (_req, res) => {
  const data = {
    exported_at: new Date().toISOString(),
    version: '2.0',
    items: db.prepare('SELECT * FROM items ORDER BY name').all().map(enrichItem),
    tags: db.prepare('SELECT * FROM tags ORDER BY name').all(),
    brands: getBrandsWithCounts()
  };
  res.setHeader('Content-Disposition', 'attachment; filename="studio-inventory-export.json"');
  res.json(data);
});

app.get('/api/export/sql', (_req, res) => {
  const tables = ['items', 'tags', 'item_tags', 'attachments', 'brands'];
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
  const items = db.prepare(`SELECT * FROM items ${where} ORDER BY ${orderBy}`).all(values);
  const headers = ['id','name','common_name','category','brand','model','serial_number','year',
    'purchase_date','purchase_price','replacement_value','replacement_value_note','condition',
    'condition_notes','location','description','quantity','update_checks_enabled','tags'];
  const esc = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let csv = headers.join(',') + '\n';
  for (const item of items) {
    const e = enrichItem(item);
    csv += headers.map(h => h === 'tags' ? esc(e.tags.map(t => t.name).join('; ')) : esc(item[h])).join(',') + '\n';
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="studio-inventory.csv"');
  res.send(csv);
});

app.post('/api/import/json', (req, res) => {
  const { items, replace = false } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid import data' });
  try {
    const count = db.transaction(() => {
      if (replace) {
        const all = db.prepare('SELECT relative_path,filename FROM attachments').all();
        for (const a of all) {
          const fp = path.join(UPLOADS_DIR, a.relative_path || a.filename);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        const ids = db.prepare('SELECT id FROM items').all();
        for (const { id } of ids) removeItemUploadDirs(id);
        db.exec('DELETE FROM attachments;DELETE FROM item_tags;DELETE FROM tags;DELETE FROM items;');
      }
      const insert = db.prepare(`
        INSERT INTO items (name,common_name,category,brand,model,serial_number,year,
          purchase_date,purchase_price,replacement_value,replacement_value_note,
          condition,condition_notes,location,description,quantity,update_checks_enabled)
        VALUES (@name,@common_name,@category,@brand,@model,@serial_number,@year,
          @purchase_date,@purchase_price,@replacement_value,@replacement_value_note,
          @condition,@condition_notes,@location,@description,@quantity,@update_checks_enabled)
      `);
      let n = 0;
      for (const raw of items) {
        const data = sanitizeItemInput(raw);
        const r = insert.run(data);
        setItemTags(r.lastInsertRowid, (raw.tags || []).map(t => typeof t === 'string' ? t : t.name));
        n++;
      }
      return n;
    })();
    res.json({ ok: true, imported: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.get('/scan/:id', (req, res) => {
  res.redirect(`/scan.html?id=${encodeURIComponent(req.params.id)}`);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Studio Inventory v${getCurrentVersion()} running at http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Uploads:  ${UPLOADS_DIR}\n`);

  checkForUpdate().then((info) => {
    if (info.updateAvailable) {
      console.log(`  Update available: v${info.latestVersion} (you have v${info.currentVersion})`);
      console.log(`  Download: ${info.releaseUrl}\n`);
    } else if (info.error) {
      console.log(`  Update check skipped (${info.error})\n`);
    }
  }).catch(() => {});
});