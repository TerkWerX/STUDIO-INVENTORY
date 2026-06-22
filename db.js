const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { computeItemCompleteness } = require('./lib/completeness');

const DATA_DIR = process.env.STUDIO_DATA_DIR
  ? path.resolve(process.env.STUDIO_DATA_DIR)
  : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'inventory.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

for (const dir of [DATA_DIR, UPLOADS_DIR, path.join(UPLOADS_DIR, 'photos'),
  path.join(UPLOADS_DIR, 'manuals'), path.join(UPLOADS_DIR, 'software'),
  path.join(UPLOADS_DIR, 'software-licenses'), path.join(UPLOADS_DIR, 'receipts'),
  path.join(UPLOADS_DIR, 'logos'), path.join(UPLOADS_DIR, 'wall-photos'),
  path.join(DATA_DIR, 'backups')]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const LOGOS_DIR = path.join(UPLOADS_DIR, 'logos');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DEFAULT_CATEGORIES = [
  'Guitar', 'Bass', 'Keyboard', 'Drum Kit', 'Microphone', 'Audio Interface',
  'Mixer', 'Control Surface', 'Speaker/Monitor', 'Amplifier', 'Pedal',
  'Cable/Accessory', 'Other'
];

const DEFAULT_LOCATIONS = [
  'Main Rack', 'Desk', 'Storage', "Daughter's Area", 'Other'
];

const DRIVER_CATEGORIES = new Set([
  'Audio Interface', 'Mixer', 'Control Surface', 'Keyboard'
]);

const SOFTWARE_CATEGORIES = ['DAW', 'Plugin', 'Instrument', 'Utility', 'Notation', 'Bundle', 'Other'];
const LICENSE_TYPES = ['perpetual', 'subscription', 'educational', 'nfr', 'oem', 'rent_to_own'];
const ACTIVATION_METHODS = ['account', 'ilok', 'ilok_cloud', 'challenge', 'machine', 'usb_dongle', 'other'];
const PLUGIN_FORMATS = ['vst3', 'au', 'aax', 'standalone', 'multiple', 'other'];

function runMigrations() {
  const itemCols = db.prepare('PRAGMA table_info(items)').all().map(c => c.name);
  if (!itemCols.includes('update_checks_enabled')) {
    db.exec('ALTER TABLE items ADD COLUMN update_checks_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!itemCols.includes('warranty_end_date')) {
    db.exec("ALTER TABLE items ADD COLUMN warranty_end_date TEXT DEFAULT ''");
  }
  if (!itemCols.includes('warranty_note')) {
    db.exec("ALTER TABLE items ADD COLUMN warranty_note TEXT DEFAULT ''");
  }
  if (!itemCols.includes('studio_status')) {
    db.exec("ALTER TABLE items ADD COLUMN studio_status TEXT NOT NULL DEFAULT 'in_studio'");
  }
  if (!itemCols.includes('studio_status_note')) {
    db.exec("ALTER TABLE items ADD COLUMN studio_status_note TEXT DEFAULT ''");
  }
  if (!itemCols.includes('value_updated_at')) {
    db.exec('ALTER TABLE items ADD COLUMN value_updated_at TEXT DEFAULT NULL');
    db.exec(`UPDATE items SET value_updated_at = updated_at WHERE replacement_value > 0 AND value_updated_at IS NULL`);
  }
  if (!itemCols.includes('parent_item_id')) {
    db.exec('ALTER TABLE items ADD COLUMN parent_item_id INTEGER DEFAULT NULL REFERENCES items(id) ON DELETE SET NULL');
  }
  if (!itemCols.includes('depreciated_value')) {
    db.exec('ALTER TABLE items ADD COLUMN depreciated_value REAL DEFAULT 0');
  }
  if (!itemCols.includes('on_insurance_policy')) {
    db.exec('ALTER TABLE items ADD COLUMN on_insurance_policy INTEGER NOT NULL DEFAULT 0');
  }
  if (!itemCols.includes('insurance_policy_note')) {
    db.exec("ALTER TABLE items ADD COLUMN insurance_policy_note TEXT DEFAULT ''");
  }
  if (!itemCols.includes('wall_cutout_path')) {
    db.exec("ALTER TABLE items ADD COLUMN wall_cutout_path TEXT DEFAULT ''");
    db.exec('ALTER TABLE items ADD COLUMN wall_cutout_width_ft REAL DEFAULT 0');
    db.exec('ALTER TABLE items ADD COLUMN wall_cutout_height_ft REAL DEFAULT 0');
    db.exec("ALTER TABLE items ADD COLUMN wall_cutout_calibration_json TEXT DEFAULT '{}'");
  }
  if (!itemCols.includes('requires_power')) {
    db.exec('ALTER TABLE items ADD COLUMN requires_power INTEGER NOT NULL DEFAULT 0');
    db.exec("ALTER TABLE items ADD COLUMN power_adapter_voltage TEXT DEFAULT ''");
    db.exec("ALTER TABLE items ADD COLUMN power_adapter_current TEXT DEFAULT ''");
    db.exec("ALTER TABLE items ADD COLUMN power_adapter_polarity TEXT DEFAULT ''");
    db.exec("ALTER TABLE items ADD COLUMN power_adapter_notes TEXT DEFAULT ''");
  }

  const attCols2 = db.prepare('PRAGMA table_info(attachments)').all().map(c => c.name);
  if (!attCols2.includes('extracted_text')) {
    db.exec("ALTER TABLE attachments ADD COLUMN extracted_text TEXT DEFAULT ''");
  }

  const fpCols = db.prepare('PRAGMA table_info(floorplans)').all().map(c => c.name);
  if (fpCols.length && !fpCols.includes('map_mode')) {
    db.exec("ALTER TABLE floorplans ADD COLUMN map_mode TEXT NOT NULL DEFAULT 'draw'");
    db.exec("ALTER TABLE floorplans ADD COLUMN polygon_json TEXT DEFAULT ''");
    db.exec("ALTER TABLE floorplans ADD COLUMN unit TEXT NOT NULL DEFAULT 'ft'");
    db.exec("ALTER TABLE floorplans ADD COLUMN bounds_width REAL DEFAULT 0");
    db.exec("ALTER TABLE floorplans ADD COLUMN bounds_depth REAL DEFAULT 0");
    db.exec("ALTER TABLE floorplans ADD COLUMN wall_lengths_json TEXT DEFAULT ''");
    db.exec(`UPDATE floorplans SET map_mode = 'photo' WHERE image_path IS NOT NULL AND image_path != ''`);
  }

  const fpiCols = db.prepare('PRAGMA table_info(floorplan_items)').all().map(c => c.name);
  if (fpiCols.length && !fpiCols.includes('placement')) {
    db.exec("ALTER TABLE floorplan_items ADD COLUMN placement TEXT NOT NULL DEFAULT 'floor'");
    db.exec('ALTER TABLE floorplan_items ADD COLUMN wall_edge INTEGER DEFAULT NULL');
    db.exec('ALTER TABLE floorplan_items ADD COLUMN wall_t REAL DEFAULT NULL');
  }
  if (fpCols.length && !fpCols.includes('ceiling_height')) {
    db.exec('ALTER TABLE floorplans ADD COLUMN ceiling_height REAL NOT NULL DEFAULT 9.5');
  }
  if (fpiCols.length && !fpiCols.includes('height_ft')) {
    db.exec('ALTER TABLE floorplan_items ADD COLUMN height_ft REAL DEFAULT NULL');
    db.exec("ALTER TABLE floorplan_items ADD COLUMN icon_mode TEXT NOT NULL DEFAULT 'logo'");
    db.exec("ALTER TABLE floorplan_items ADD COLUMN wall_photo_path TEXT DEFAULT ''");
    db.exec('ALTER TABLE floorplan_items ADD COLUMN photo_width_ft REAL DEFAULT 0');
    db.exec('ALTER TABLE floorplan_items ADD COLUMN photo_height_ft REAL DEFAULT 0');
    db.exec("ALTER TABLE floorplan_items ADD COLUMN photo_calibration_json TEXT DEFAULT '{}'");
  }
  if (fpCols.length && !fpCols.includes('wall_photos_json')) {
    db.exec("ALTER TABLE floorplans ADD COLUMN wall_photos_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (fpCols.length && !fpCols.includes('floor_image_scale')) {
    db.exec('ALTER TABLE floorplans ADD COLUMN floor_image_scale REAL NOT NULL DEFAULT 1');
    db.exec('ALTER TABLE floorplans ADD COLUMN floor_image_x REAL NOT NULL DEFAULT 0.5');
    db.exec('ALTER TABLE floorplans ADD COLUMN floor_image_y REAL NOT NULL DEFAULT 0.5');
    db.exec("ALTER TABLE floorplans ADD COLUMN floor_image_fit TEXT NOT NULL DEFAULT 'cover'");
  }
  if (fpiCols.length && !fpiCols.includes('wall_display')) {
    db.exec('ALTER TABLE floorplan_items ADD COLUMN wall_display INTEGER NOT NULL DEFAULT 1');
  }
  if (fpiCols.length && !fpiCols.includes('rotation_deg')) {
    db.exec('ALTER TABLE floorplan_items ADD COLUMN rotation_deg REAL DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      service_date TEXT NOT NULL DEFAULT (date('now')),
      service_type TEXT NOT NULL DEFAULT 'maintenance',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_item ON maintenance_log(item_id);

    CREATE TABLE IF NOT EXISTS loan_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      borrower_name TEXT NOT NULL,
      borrower_contact TEXT DEFAULT '',
      loaned_at TEXT NOT NULL DEFAULT (date('now')),
      due_date TEXT DEFAULT NULL,
      returned_at TEXT DEFAULT NULL,
      note TEXT DEFAULT '',
      condition_out TEXT DEFAULT '',
      condition_in TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_loan_item ON loan_log(item_id);
    CREATE INDEX IF NOT EXISTS idx_loan_active ON loan_log(item_id, returned_at);

    CREATE TABLE IF NOT EXISTS racks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rack_items (
      rack_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      slot_label TEXT DEFAULT '',
      PRIMARY KEY (rack_id, item_id),
      FOREIGN KEY (rack_id) REFERENCES racks(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS signal_chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signal_chain_items (
      chain_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chain_id, item_id),
      FOREIGN KEY (chain_id) REFERENCES signal_chains(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_item_id);

    CREATE TABLE IF NOT EXISTS floorplans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL UNIQUE,
      image_path TEXT DEFAULT '',
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS floorplan_items (
      floorplan_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      x_pct REAL NOT NULL DEFAULT 50,
      y_pct REAL NOT NULL DEFAULT 50,
      placement TEXT NOT NULL DEFAULT 'floor',
      wall_edge INTEGER DEFAULT NULL,
      wall_t REAL DEFAULT NULL,
      height_ft REAL DEFAULT NULL,
      icon_mode TEXT NOT NULL DEFAULT 'logo',
      wall_photo_path TEXT DEFAULT '',
      photo_width_ft REAL DEFAULT 0,
      photo_height_ft REAL DEFAULT 0,
      rotation_deg REAL DEFAULT 0,
      photo_calibration_json TEXT DEFAULT '{}',
      wall_display INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (floorplan_id, item_id),
      FOREIGN KEY (floorplan_id) REFERENCES floorplans(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS software_licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      publisher TEXT DEFAULT '',
      version TEXT DEFAULT '',
      category TEXT DEFAULT 'Plugin',
      license_key TEXT DEFAULT '',
      license_type TEXT NOT NULL DEFAULT 'perpetual',
      activation_method TEXT NOT NULL DEFAULT 'account',
      plugin_format TEXT DEFAULT 'vst3',
      seats INTEGER NOT NULL DEFAULT 1,
      renewal_date TEXT DEFAULT NULL,
      purchase_date TEXT DEFAULT '',
      purchase_price REAL DEFAULT 0,
      replacement_value REAL DEFAULT 0,
      host_item_id INTEGER DEFAULT NULL,
      screenshot_path TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (host_item_id) REFERENCES items(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_software_name ON software_licenses(name);
    CREATE INDEX IF NOT EXISTS idx_software_publisher ON software_licenses(publisher);
    CREATE INDEX IF NOT EXISTS idx_software_category ON software_licenses(category);
    CREATE INDEX IF NOT EXISTS idx_software_renewal ON software_licenses(renewal_date);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS manual_fts USING fts5(
      attachment_id UNINDEXED,
      item_name,
      file_name,
      body,
      tokenize='porter'
    );
  `);

  const attCols = db.prepare('PRAGMA table_info(attachments)').all().map(c => c.name);
  if (!attCols.includes('relative_path')) {
    db.exec(`
      ALTER TABLE attachments ADD COLUMN relative_path TEXT DEFAULT '';
      ALTER TABLE attachments ADD COLUMN version TEXT DEFAULT '';
      ALTER TABLE attachments ADD COLUMN description TEXT DEFAULT '';
      ALTER TABLE attachments ADD COLUMN source_url TEXT DEFAULT '';
      ALTER TABLE attachments ADD COLUMN metadata TEXT DEFAULT '{}';
    `);
    db.exec(`UPDATE attachments SET relative_path = filename WHERE relative_path = '' OR relative_path IS NULL`);
  }
}

function brandSlug(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      common_name TEXT DEFAULT '',
      category TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      year TEXT DEFAULT '',
      purchase_date TEXT DEFAULT '',
      purchase_price REAL DEFAULT 0,
      replacement_value REAL DEFAULT 0,
      replacement_value_note TEXT DEFAULT '',
      condition TEXT DEFAULT 'Good',
      condition_notes TEXT DEFAULT '',
      location TEXT DEFAULT '',
      description TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      requires_power INTEGER NOT NULL DEFAULT 0,
      power_adapter_voltage TEXT DEFAULT '',
      power_adapter_current TEXT DEFAULT '',
      power_adapter_polarity TEXT DEFAULT '',
      power_adapter_notes TEXT DEFAULT '',
      update_checks_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (item_id, tag_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      relative_path TEXT NOT NULL DEFAULT '',
      mime_type TEXT DEFAULT '',
      type TEXT DEFAULT 'other',
      version TEXT DEFAULT '',
      description TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_location ON items(location);
    CREATE INDEX IF NOT EXISTS idx_items_condition ON items(condition);
    CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments(type);

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      logo_path TEXT DEFAULT '',
      is_custom INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
    CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);
  `);
  runMigrations();
}

function ensureBrand(brandName) {
  const name = String(brandName || '').trim().slice(0, 150);
  if (!name) return null;
  const existing = db.prepare('SELECT * FROM brands WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return existing;
  const result = db.prepare('INSERT INTO brands (name, logo_path) VALUES (?, ?)').run(name, '');
  return db.prepare('SELECT * FROM brands WHERE id = ?').get(result.lastInsertRowid);
}

function getBrandsWithCounts() {
  return db.prepare(`
    SELECT b.id, b.name, b.logo_path, b.is_custom,
      (SELECT COUNT(*) FROM items i WHERE i.brand = b.name COLLATE NOCASE) as item_count
    FROM brands b
    ORDER BY item_count DESC, b.name ASC
  `).all();
}

function syncBrandsFromItems() {
  const itemBrands = db.prepare(`
    SELECT DISTINCT brand FROM items WHERE brand != '' ORDER BY brand
  `).all();
  for (const { brand } of itemBrands) ensureBrand(brand);
}

function getTagsForItem(itemId) {
  return db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN item_tags it ON it.tag_id = t.id
    WHERE it.item_id = ?
    ORDER BY t.name
  `).all(itemId);
}

function getAttachmentsForItem(itemId) {
  return db.prepare(`
    SELECT id, filename, original_name, relative_path, mime_type, type,
           version, description, source_url, metadata, created_at
    FROM attachments WHERE item_id = ? ORDER BY type, created_at DESC
  `).all(itemId).map(a => ({
    ...a,
    metadata: safeJsonParse(a.metadata)
  }));
}

function safeJsonParse(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

function parseItemWallCutout(item) {
  const path = String(item?.wall_cutout_path || '').trim();
  if (!path) return null;
  return {
    path,
    width_ft: Math.max(0, parseFloat(item.wall_cutout_width_ft) || 0),
    height_ft: Math.max(0, parseFloat(item.wall_cutout_height_ft) || 0),
    calibration: safeJsonParse(item.wall_cutout_calibration_json)
  };
}

function saveItemWallCutout(itemId, data = {}) {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId);
  if (!item) throw new Error('Item not found');
  const wall_cutout_path = String(data.wall_photo_path || data.wall_cutout_path || '').slice(0, 500);
  const wall_cutout_width_ft = Math.max(0, parseFloat(data.photo_width_ft) || 0);
  const wall_cutout_height_ft = Math.max(0, parseFloat(data.photo_height_ft) || 0);
  const wall_cutout_calibration_json = JSON.stringify(
    data.photo_calibration && typeof data.photo_calibration === 'object'
      ? data.photo_calibration : safeJsonParse(data.photo_calibration_json)
  );
  db.prepare(`
    UPDATE items SET wall_cutout_path = ?, wall_cutout_width_ft = ?, wall_cutout_height_ft = ?,
      wall_cutout_calibration_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(wall_cutout_path, wall_cutout_width_ft, wall_cutout_height_ft,
    wall_cutout_calibration_json, itemId);
  return enrichItem(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
}

function clearItemWallCutout(itemId) {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId);
  if (!item) throw new Error('Item not found');
  db.prepare(`
    UPDATE items SET wall_cutout_path = '', wall_cutout_width_ft = 0, wall_cutout_height_ft = 0,
      wall_cutout_calibration_json = '{}', updated_at = datetime('now')
    WHERE id = ?
  `).run(itemId);
  return enrichItem(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
}

function enrichItem(item) {
  if (!item) return null;
  const attachments = getAttachmentsForItem(item.id);
  let brand_logo_path = '';
  if (item.brand) {
    const brandRow = db.prepare('SELECT logo_path FROM brands WHERE name = ? COLLATE NOCASE').get(item.brand);
    brand_logo_path = brandRow?.logo_path || '';
  }
  return {
    ...item,
    brand_logo_path,
    update_checks_enabled: item.update_checks_enabled !== 0,
    requires_power: item.requires_power !== 0,
    tags: getTagsForItem(item.id),
    attachments,
    photos: attachments.filter(a => a.type === 'photo'),
    manuals: attachments.filter(a => a.type === 'manual' || a.type === 'document'),
    software: attachments.filter(a => a.type === 'software'),
    receipts: attachments.filter(a => a.type === 'receipt'),
    maintenance: getMaintenanceForItem(item.id),
    loans: getLoansForItem(item.id),
    activeLoan: enrichLoanRow(getActiveLoanForItem(item.id)),
    parent: getParentSummary(item.parent_item_id),
    accessories: getAccessoryItems(item.id).map(child => {
      const att = getAttachmentsForItem(child.id);
      return {
        ...child,
        on_insurance_policy: child.on_insurance_policy !== 0,
        update_checks_enabled: child.update_checks_enabled !== 0,
        requires_power: child.requires_power !== 0,
        photos: att.filter(a => a.type === 'photo'),
        tags: getTagsForItem(child.id)
      };
    }),
    on_insurance_policy: item.on_insurance_policy !== 0,
    completeness: computeItemCompleteness({
      ...item,
      photos: attachments.filter(a => a.type === 'photo'),
      manuals: attachments.filter(a => a.type === 'manual' || a.type === 'document'),
      receipts: attachments.filter(a => a.type === 'receipt')
    }),
    map_placement: getItemMapPlacement(item.id),
    wall_cutout: parseItemWallCutout(item)
  };
}

function setItemTags(itemId, tagNames) {
  db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const linkTag = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)');

  for (const raw of tagNames || []) {
    const name = String(raw).trim();
    if (!name) continue;
    insertTag.run(name);
    const tag = findTag.get(name);
    if (tag) linkTag.run(itemId, tag.id);
  }
}

function sanitizeItemInput(body) {
  const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
  const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : Math.max(0, n);
  };
  const qty = (v) => {
    const n = parseInt(v, 10);
    return isNaN(n) || n < 1 ? 1 : Math.min(n, 9999);
  };
  const conditions = ['New', 'Excellent', 'Good', 'Fair', 'Poor'];
  const condition = conditions.includes(body.condition) ? body.condition : 'Good';
  const updateChecks = body.update_checks_enabled === false || body.update_checks_enabled === 0 || body.update_checks_enabled === '0' ? 0 : 1;
  const statuses = ['in_studio', 'loaned', 'in_repair', 'storage', 'away'];
  const studio_status = statuses.includes(body.studio_status) ? body.studio_status : 'in_studio';
  const parentId = body.parent_item_id != null && body.parent_item_id !== ''
    ? parseInt(body.parent_item_id, 10) : null;

  return {
    name: str(body.name, 300) || 'Unnamed Item',
    common_name: str(body.common_name, 300),
    category: str(body.category, 100),
    brand: str(body.brand, 150),
    model: str(body.model, 150),
    serial_number: str(body.serial_number, 200),
    year: str(body.year, 50),
    purchase_date: str(body.purchase_date, 20),
    purchase_price: num(body.purchase_price),
    replacement_value: num(body.replacement_value),
    replacement_value_note: str(body.replacement_value_note, 500),
    condition,
    condition_notes: str(body.condition_notes, 1000),
    location: str(body.location, 150),
    description: str(body.description, 5000),
    quantity: qty(body.quantity),
    update_checks_enabled: updateChecks,
    warranty_end_date: str(body.warranty_end_date, 20),
    warranty_note: str(body.warranty_note, 500),
    studio_status,
    studio_status_note: str(body.studio_status_note, 500),
    parent_item_id: parentId && !isNaN(parentId) ? parentId : null,
    depreciated_value: num(body.depreciated_value),
    on_insurance_policy: body.on_insurance_policy === true || body.on_insurance_policy === 1 || body.on_insurance_policy === '1' ? 1 : 0,
    insurance_policy_note: str(body.insurance_policy_note, 500),
    requires_power: body.requires_power === true || body.requires_power === 1 || body.requires_power === '1' ? 1 : 0,
    power_adapter_voltage: str(body.power_adapter_voltage, 100),
    power_adapter_current: str(body.power_adapter_current, 100),
    power_adapter_polarity: str(body.power_adapter_polarity, 150),
    power_adapter_notes: str(body.power_adapter_notes, 1000)
  };
}

function getParentSummary(parentId) {
  if (!parentId) return null;
  const p = db.prepare('SELECT id, name, common_name FROM items WHERE id = ?').get(parentId);
  return p || null;
}

function getAccessoryItems(parentId) {
  return db.prepare('SELECT * FROM items WHERE parent_item_id = ? ORDER BY name').all(parentId);
}

function getRacks() {
  const racks = db.prepare('SELECT * FROM racks ORDER BY sort_order, name').all();
  return racks.map(rack => ({
    ...rack,
    items: db.prepare(`
      SELECT ri.position, ri.slot_label, i.id, i.name, i.brand, i.model, i.category, i.replacement_value
      FROM rack_items ri
      JOIN items i ON i.id = ri.item_id
      WHERE ri.rack_id = ?
      ORDER BY ri.position ASC, i.name ASC
    `).all(rack.id)
  }));
}

function parsePolygonJson(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  } catch {
    return [];
  }
}

function parseWallLengthsJson(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(n => Math.max(0, parseFloat(n) || 0)) : [];
  } catch {
    return [];
  }
}

function parseWallPhotosJson(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function enrichFloorplanRow(fp) {
  const polygon = parsePolygonJson(fp.polygon_json);
  const wall_lengths = parseWallLengthsJson(fp.wall_lengths_json);
  const map_mode = fp.map_mode || ((fp.image_path && String(fp.image_path).trim()) ? 'photo' : 'draw');
  return {
    ...fp,
    map_mode,
    polygon,
    wall_lengths,
    unit: ['in', 'ft', 'cm', 'm'].includes(fp.unit) ? fp.unit : 'ft',
    bounds_width: Math.max(0, parseFloat(fp.bounds_width) || 0),
    bounds_depth: Math.max(0, parseFloat(fp.bounds_depth) || 0),
    ceiling_height: Math.max(0, parseFloat(fp.ceiling_height) || 9.5),
    wall_photos: parseWallPhotosJson(fp.wall_photos_json),
    floor_image_scale: Math.min(4, Math.max(1, parseFloat(fp.floor_image_scale) || 1)),
    floor_image_x: Math.min(1, Math.max(0, parseFloat(fp.floor_image_x ?? 0.5) || 0.5)),
    floor_image_y: Math.min(1, Math.max(0, parseFloat(fp.floor_image_y ?? 0.5) || 0.5)),
    floor_image_fit: fp.floor_image_fit === 'contain' ? 'contain' : 'cover'
  };
}

function enrichFloorplanItemRow(row) {
  const calibration = safeJsonParse(row.photo_calibration_json);
  return {
    id: row.item_id,
    x_pct: row.x_pct,
    y_pct: row.y_pct,
    placement: row.placement || 'floor',
    wall_edge: row.wall_edge,
    wall_t: row.wall_t,
    height_ft: row.height_ft != null ? parseFloat(row.height_ft) : null,
    icon_mode: row.icon_mode === 'photo' ? 'photo' : 'logo',
    wall_photo_path: row.wall_photo_path || '',
    photo_width_ft: Math.max(0, parseFloat(row.photo_width_ft) || 0),
    photo_height_ft: Math.max(0, parseFloat(row.photo_height_ft) || 0),
    rotation_deg: parseFloat(row.rotation_deg) || 0,
    photo_calibration: calibration,
    name: row.name,
    category: row.category,
    brand: row.brand,
    model: row.model,
    replacement_value: row.replacement_value,
    brand_logo_path: row.brand_logo_path || '',
    wall_display: row.wall_display !== 0,
    studio_status: row.studio_status || 'in_studio'
  };
}

function getFloorplans() {
  const plans = db.prepare('SELECT * FROM floorplans ORDER BY location ASC').all();
  return plans.map(fp => {
    const base = enrichFloorplanRow(fp);
    return {
      ...base,
      items: db.prepare(`
        SELECT fi.item_id, fi.x_pct, fi.y_pct, fi.placement, fi.wall_edge, fi.wall_t,
          fi.height_ft, fi.icon_mode, fi.wall_photo_path, fi.photo_width_ft, fi.photo_height_ft,
          fi.rotation_deg, fi.photo_calibration_json, fi.wall_display,
          i.name, i.category, i.brand, i.model, i.studio_status, i.replacement_value,
          b.logo_path as brand_logo_path
        FROM floorplan_items fi
        JOIN items i ON i.id = fi.item_id
        LEFT JOIN brands b ON b.name = i.brand COLLATE NOCASE
        WHERE fi.floorplan_id = ?
        ORDER BY i.name ASC
      `).all(fp.id).map(enrichFloorplanItemRow)
    };
  });
}

function getFloorplan(id) {
  const fp = db.prepare('SELECT * FROM floorplans WHERE id = ?').get(id);
  if (!fp) return null;
  return getFloorplans().find(p => p.id === fp.id) || null;
}

function createFloorplan({ location, notes }) {
  const loc = String(location || '').trim();
  if (!loc) throw new Error('Location is required');
  const existing = db.prepare('SELECT id FROM floorplans WHERE location = ?').get(loc);
  if (existing) throw new Error('A floorplan already exists for this location');
  const result = db.prepare(`
    INSERT INTO floorplans (location, notes) VALUES (?, ?)
  `).run(loc, String(notes || '').trim().slice(0, 2000));
  return getFloorplan(result.lastInsertRowid);
}

function updateFloorplanImage(id, imagePath, width = 0, height = 0) {
  db.prepare(`
    UPDATE floorplans SET image_path = ?, width = ?, height = ?, map_mode = 'draw', updated_at = datetime('now')
    WHERE id = ?
  `).run(imagePath, width, height, id);
  return getFloorplan(id);
}

function clearFloorplanFloorImage(id) {
  const fp = getFloorplan(id);
  if (!fp) throw new Error('Floorplan not found');
  if (fp.image_path) {
    const full = path.join(UPLOADS_DIR, fp.image_path);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
  db.prepare(`
    UPDATE floorplans SET image_path = '', width = 0, height = 0,
      floor_image_scale = 1, floor_image_x = 0.5, floor_image_y = 0.5, floor_image_fit = 'cover',
      updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return getFloorplan(id);
}

function updateFloorplanFloorView(id, body = {}) {
  const existing = db.prepare('SELECT id FROM floorplans WHERE id = ?').get(id);
  if (!existing) throw new Error('Floorplan not found');
  const scale = Math.min(4, Math.max(1, parseFloat(body.floor_image_scale) || 1));
  const x = Math.min(1, Math.max(0, parseFloat(body.floor_image_x) ?? 0.5));
  const y = Math.min(1, Math.max(0, parseFloat(body.floor_image_y) ?? 0.5));
  const fit = body.floor_image_fit === 'contain' ? 'contain' : 'cover';
  db.prepare(`
    UPDATE floorplans SET floor_image_scale = ?, floor_image_x = ?, floor_image_y = ?,
      floor_image_fit = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(scale, x, y, fit, id);
  return getFloorplan(id);
}

function updateFloorplanGeometry(id, body = {}) {
  const existing = db.prepare('SELECT id FROM floorplans WHERE id = ?').get(id);
  if (!existing) throw new Error('Floorplan not found');

  const polygon = Array.isArray(body.polygon) ? body.polygon : [];
  const cleaned = polygon.slice(0, 48).map(p => ({
    x: Math.min(100, Math.max(0, parseFloat(p.x) || 0)),
    y: Math.min(100, Math.max(0, parseFloat(p.y) || 0))
  }));
  const unit = ['in', 'ft', 'cm', 'm'].includes(body.unit) ? body.unit : 'ft';
  const bounds_width = Math.max(0, parseFloat(body.bounds_width) || 0);
  const bounds_depth = Math.max(0, parseFloat(body.bounds_depth) || 0);
  const ceiling_height = body.ceiling_height != null
    ? Math.max(0, parseFloat(body.ceiling_height) || 9.5) : null;
  const map_mode = body.map_mode === 'photo' ? 'photo' : 'draw';
  const wall_lengths = Array.isArray(body.wall_lengths)
    ? body.wall_lengths.slice(0, 48).map(n => Math.max(0, parseFloat(n) || 0))
    : [];

  if (ceiling_height != null) {
    db.prepare(`
      UPDATE floorplans SET map_mode = ?, polygon_json = ?, unit = ?, bounds_width = ?,
        bounds_depth = ?, wall_lengths_json = ?, ceiling_height = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(map_mode, JSON.stringify(cleaned), unit, bounds_width, bounds_depth,
      JSON.stringify(wall_lengths), ceiling_height, id);
  } else {
    db.prepare(`
      UPDATE floorplans SET map_mode = ?, polygon_json = ?, unit = ?, bounds_width = ?,
        bounds_depth = ?, wall_lengths_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(map_mode, JSON.stringify(cleaned), unit, bounds_width, bounds_depth,
      JSON.stringify(wall_lengths), id);
  }

  return getFloorplan(id);
}

function setFloorplanItems(floorplanId, items) {
  const fp = db.prepare('SELECT id, location FROM floorplans WHERE id = ?').get(floorplanId);
  if (!fp) throw new Error('Floorplan not found');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM floorplan_items WHERE floorplan_id = ?').run(floorplanId);
    const insert = db.prepare(`
      INSERT INTO floorplan_items (
        floorplan_id, item_id, x_pct, y_pct, placement, wall_edge, wall_t,
        height_ft, icon_mode, wall_photo_path, photo_width_ft, photo_height_ft,
        rotation_deg, photo_calibration_json, wall_display
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of items || []) {
      const itemId = parseInt(row.item_id, 10);
      if (!itemId) continue;
      const item = db.prepare('SELECT id, location FROM items WHERE id = ?').get(itemId);
      if (!item || item.location !== fp.location) continue;
      const x = Math.min(100, Math.max(0, parseFloat(row.x_pct) || 50));
      const y = Math.min(100, Math.max(0, parseFloat(row.y_pct) || 50));
      const placement = row.placement === 'wall' ? 'wall' : 'floor';
      const wall_edge = placement === 'wall' && row.wall_edge != null && row.wall_edge !== ''
        ? parseInt(row.wall_edge, 10) : null;
      const wall_t = placement === 'wall' && row.wall_t != null && row.wall_t !== ''
        ? Math.min(1, Math.max(0, parseFloat(row.wall_t) || 0)) : null;
      const height_ft = row.height_ft != null && row.height_ft !== ''
        ? Math.max(0, parseFloat(row.height_ft) || 0) : null;
      const icon_mode = row.icon_mode === 'photo' ? 'photo' : 'logo';
      const wall_photo_path = String(row.wall_photo_path || '').slice(0, 500);
      const photo_width_ft = Math.max(0, parseFloat(row.photo_width_ft) || 0);
      const photo_height_ft = Math.max(0, parseFloat(row.photo_height_ft) || 0);
      const rotation_deg = Math.max(-180, Math.min(180, parseFloat(row.rotation_deg) || 0));
      const photo_calibration_json = JSON.stringify(
        row.photo_calibration && typeof row.photo_calibration === 'object'
          ? row.photo_calibration : safeJsonParse(row.photo_calibration_json)
      );
      const wall_display = row.wall_display === false || row.wall_display === 0 || row.wall_display === '0' ? 0 : 1;
      insert.run(floorplanId, itemId, x, y, placement, wall_edge, wall_t,
        height_ft, icon_mode, wall_photo_path, photo_width_ft, photo_height_ft,
        rotation_deg, photo_calibration_json, wall_display);
    }
  });
  tx();
  return getFloorplan(floorplanId);
}

function floorplanWallPhotosDir(floorplanId) {
  const dir = path.join(UPLOADS_DIR, 'floorplans', 'walls', String(floorplanId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function updateFloorplanWallPhoto(floorplanId, edgeIndex, relativePath) {
  const fp = db.prepare('SELECT id FROM floorplans WHERE id = ?').get(floorplanId);
  if (!fp) throw new Error('Floorplan not found');
  const edge = Math.max(0, Math.min(47, parseInt(edgeIndex, 10) || 0));
  const row = db.prepare('SELECT wall_photos_json FROM floorplans WHERE id = ?').get(floorplanId);
  const photos = parseWallPhotosJson(row.wall_photos_json);
  photos[String(edge)] = {
    path: relativePath,
    updated_at: new Date().toISOString(),
    corners: null,
    lens_k: 0,
    calibrated: false
  };
  db.prepare(`
    UPDATE floorplans SET wall_photos_json = ?, updated_at = datetime('now') WHERE id = ?
  `).run(JSON.stringify(photos), floorplanId);
  return getFloorplan(floorplanId);
}

function updateFloorplanWallCalibration(floorplanId, edgeIndex, body = {}) {
  const fp = db.prepare('SELECT id FROM floorplans WHERE id = ?').get(floorplanId);
  if (!fp) throw new Error('Floorplan not found');
  const edge = String(Math.max(0, Math.min(47, parseInt(edgeIndex, 10) || 0)));
  const row = db.prepare('SELECT wall_photos_json FROM floorplans WHERE id = ?').get(floorplanId);
  const photos = parseWallPhotosJson(row.wall_photos_json);
  const existing = photos[edge] || {};
  if (!existing.path) throw new Error('Upload a wall photo first');

  const corners = Array.isArray(body.corners) ? body.corners.slice(0, 4).map(p => ({
    x: Math.min(1, Math.max(0, parseFloat(p.x) || 0)),
    y: Math.min(1, Math.max(0, parseFloat(p.y) || 0))
  })) : existing.corners;
  if (corners.length !== 4) throw new Error('Four corner points required');

  const lens_k = body.lens_k != null
    ? Math.min(0.35, Math.max(-0.35, parseFloat(body.lens_k) || 0))
    : (existing.lens_k || 0);

  photos[edge] = {
    ...existing,
    corners,
    lens_k,
    calibrated: body.calibrated !== false,
    calibrated_at: new Date().toISOString()
  };
  db.prepare(`
    UPDATE floorplans SET wall_photos_json = ?, updated_at = datetime('now') WHERE id = ?
  `).run(JSON.stringify(photos), floorplanId);
  return getFloorplan(floorplanId);
}

function suspendWallPlacement(itemId) {
  const row = db.prepare(`
    SELECT item_id FROM floorplan_items WHERE item_id = ? AND placement = 'wall'
  `).get(itemId);
  if (!row) return false;
  db.prepare('UPDATE floorplan_items SET wall_display = 0 WHERE item_id = ?').run(itemId);
  return true;
}

function resolveWallRehang(itemId, action) {
  const existing = db.prepare('SELECT item_id FROM floorplan_items WHERE item_id = ?').get(itemId);
  if (!existing) throw new Error('Item is not on a room map');

  if (action === 'off_wall') {
    db.prepare(`
      UPDATE floorplan_items SET wall_display = 1, placement = 'floor',
        wall_edge = NULL, wall_t = NULL, height_ft = NULL
      WHERE item_id = ?
    `).run(itemId);
  } else if (action === 'same' || action === 'reposition') {
    db.prepare('UPDATE floorplan_items SET wall_display = 1 WHERE item_id = ?').run(itemId);
  } else {
    throw new Error('Invalid wall rehang action');
  }
  return getItemMapPlacement(itemId);
}

function floorplanItemsPayload(items) {
  return (items || []).map(row => ({
    item_id: row.id || row.item_id,
    x_pct: row.x_pct,
    y_pct: row.y_pct,
    placement: row.placement,
    wall_edge: row.wall_edge,
    wall_t: row.wall_t,
    height_ft: row.height_ft,
    icon_mode: row.icon_mode,
    wall_photo_path: row.wall_photo_path,
    photo_width_ft: row.photo_width_ft,
    photo_height_ft: row.photo_height_ft,
    photo_calibration: row.photo_calibration,
    wall_display: row.wall_display !== false
  }));
}

function deleteFloorplan(id) {
  const fp = db.prepare('SELECT * FROM floorplans WHERE id = ?').get(id);
  if (!fp) throw new Error('Floorplan not found');
  db.prepare('DELETE FROM floorplans WHERE id = ?').run(id);
  return fp;
}

function getSignalChains() {
  const chains = db.prepare('SELECT * FROM signal_chains ORDER BY sort_order, name').all();
  return chains.map(chain => ({
    ...chain,
    items: db.prepare(`
      SELECT sci.position, i.id, i.name, i.brand, i.model, i.category, i.replacement_value
      FROM signal_chain_items sci
      JOIN items i ON i.id = sci.item_id
      WHERE sci.chain_id = ?
      ORDER BY sci.position ASC
    `).all(chain.id)
  }));
}

function getMaintenanceForItem(itemId) {
  return db.prepare(`
    SELECT id, item_id, service_date, service_type, note, created_at
    FROM maintenance_log WHERE item_id = ? ORDER BY service_date DESC, id DESC
  `).all(itemId);
}

function addMaintenanceEntry(itemId, { service_date, service_type, note }) {
  const types = ['maintenance', 'repair', 'calibration', 'strings', 'tubes', 'cleaning', 'other'];
  const type = types.includes(service_type) ? service_type : 'maintenance';
  const date = String(service_date || '').trim().slice(0, 20) || new Date().toISOString().slice(0, 10);
  const result = db.prepare(`
    INSERT INTO maintenance_log (item_id, service_date, service_type, note)
    VALUES (?, ?, ?, ?)
  `).run(itemId, date, type, String(note || '').trim().slice(0, 2000));
  return db.prepare('SELECT * FROM maintenance_log WHERE id = ?').get(result.lastInsertRowid);
}

function deleteMaintenanceEntry(id) {
  db.prepare('DELETE FROM maintenance_log WHERE id = ?').run(id);
}

function buildLoanStatusNote(borrower, dueDate, note) {
  let s = `Loaned to ${borrower}`;
  if (dueDate) s += ` · due ${dueDate}`;
  if (note) s += ` · ${note}`;
  return s.slice(0, 500);
}

function getLoansForItem(itemId) {
  return db.prepare(`
    SELECT id, item_id, borrower_name, borrower_contact, loaned_at, due_date,
      returned_at, note, condition_out, condition_in, created_at
    FROM loan_log WHERE item_id = ? ORDER BY loaned_at DESC, id DESC
  `).all(itemId);
}

function getActiveLoanForItem(itemId) {
  return db.prepare(`
    SELECT id, item_id, borrower_name, borrower_contact, loaned_at, due_date,
      returned_at, note, condition_out, condition_in, created_at
    FROM loan_log WHERE item_id = ? AND returned_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get(itemId) || null;
}

function isLoanOverdue(loan) {
  if (!loan?.due_date) return false;
  return loan.due_date < new Date().toISOString().slice(0, 10);
}

function enrichLoanRow(loan) {
  if (!loan) return null;
  return { ...loan, overdue: isLoanOverdue(loan) };
}

function getActiveLoans() {
  const rows = db.prepare(`
    SELECT l.id, l.item_id, l.borrower_name, l.borrower_contact, l.loaned_at, l.due_date,
      l.returned_at, l.note, l.condition_out, l.condition_in, l.created_at,
      i.name as item_name, i.brand, i.model, i.category, i.replacement_value, i.location
    FROM loan_log l
    JOIN items i ON i.id = l.item_id
    WHERE l.returned_at IS NULL
    ORDER BY
      CASE WHEN l.due_date IS NULL OR l.due_date = '' THEN 1 ELSE 0 END,
      l.due_date ASC,
      l.loaned_at DESC
  `).all();
  return rows.map(enrichLoanRow);
}

function getRecentLoanHistory(limit = 30) {
  const rows = db.prepare(`
    SELECT l.id, l.item_id, l.borrower_name, l.borrower_contact, l.loaned_at, l.due_date,
      l.returned_at, l.note, l.condition_out, l.condition_in, l.created_at,
      i.name as item_name, i.brand, i.model, i.category
    FROM loan_log l
    JOIN items i ON i.id = l.item_id
    WHERE l.returned_at IS NOT NULL
    ORDER BY l.returned_at DESC, l.id DESC
    LIMIT ?
  `).all(limit);
  return rows.map(enrichLoanRow);
}

function checkoutItem(itemId, data = {}) {
  if (getActiveLoanForItem(itemId)) throw new Error('Item is already on loan');

  const borrower_name = String(data.borrower_name || '').trim();
  if (!borrower_name) throw new Error('Borrower name is required');

  const loaned_at = String(data.loaned_at || '').trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const due_date = String(data.due_date || '').trim().slice(0, 10) || null;
  const borrower_contact = String(data.borrower_contact || '').trim().slice(0, 200);
  const note = String(data.note || '').trim().slice(0, 2000);
  const condition_out = String(data.condition_out || '').trim().slice(0, 500);

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO loan_log (item_id, borrower_name, borrower_contact, loaned_at, due_date, note, condition_out)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, borrower_name, borrower_contact, loaned_at, due_date, note, condition_out);

    db.prepare(`
      UPDATE items SET studio_status = 'loaned', studio_status_note = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(buildLoanStatusNote(borrower_name, due_date, note), itemId);

    const wall_removed = suspendWallPlacement(itemId);

    const loan = db.prepare('SELECT * FROM loan_log WHERE id = ?').get(result.lastInsertRowid);
    return { loan, wall_removed };
  });

  const result = tx();
  return { ...enrichLoanRow(result.loan), wall_removed: result.wall_removed };
}

function returnLoan(loanId, data = {}) {
  const loan = db.prepare('SELECT * FROM loan_log WHERE id = ?').get(loanId);
  if (!loan) throw new Error('Loan not found');
  if (loan.returned_at) throw new Error('Item already returned');

  const returned_at = String(data.returned_at || '').trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const condition_in = String(data.condition_in || '').trim().slice(0, 500);
  const returnNote = String(data.return_note || '').trim().slice(0, 2000);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE loan_log
      SET returned_at = ?, condition_in = ?,
        note = CASE WHEN ? != '' THEN note || char(10) || ? ELSE note END
      WHERE id = ?
    `).run(returned_at, condition_in, returnNote, returnNote, loanId);

    db.prepare(`
      UPDATE items SET studio_status = 'in_studio', studio_status_note = '', updated_at = datetime('now')
      WHERE id = ?
    `).run(loan.item_id);

    const placement = getItemMapPlacement(loan.item_id);
    const wall_rehang_pending = !!(placement?.placement === 'wall' && placement.wall_display === false);
    const updatedLoan = db.prepare('SELECT * FROM loan_log WHERE id = ?').get(loanId);
    return { loan: updatedLoan, wall_rehang_pending, wall_placement: placement };
  });

  const result = tx();
  return {
    ...enrichLoanRow(result.loan),
    wall_rehang_pending: result.wall_rehang_pending,
    wall_placement: result.wall_placement
  };
}

function deleteLoanEntry(id) {
  const loan = db.prepare('SELECT * FROM loan_log WHERE id = ?').get(id);
  if (!loan) throw new Error('Loan entry not found');
  if (!loan.returned_at) throw new Error('Cannot delete an active loan — mark it returned first');
  db.prepare('DELETE FROM loan_log WHERE id = ?').run(id);
}

function wallPhotoDir(itemId) {
  const dir = path.join(UPLOADS_DIR, 'wall-photos', String(itemId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getItemMapPlacement(itemId) {
  const row = db.prepare(`
    SELECT fi.*, f.id as floorplan_id, f.location as floorplan_location, f.ceiling_height, f.unit,
      i.name, i.brand, b.logo_path as brand_logo_path
    FROM floorplan_items fi
    JOIN floorplans f ON f.id = fi.floorplan_id
    JOIN items i ON i.id = fi.item_id
    LEFT JOIN brands b ON b.name = i.brand COLLATE NOCASE
    WHERE fi.item_id = ?
  `).get(itemId);
  if (!row) return null;
  return {
    floorplan_id: row.floorplan_id,
    floorplan_location: row.floorplan_location,
    unit: ['in', 'ft', 'cm', 'm'].includes(row.unit) ? row.unit : 'ft',
    ceiling_height: parseFloat(row.ceiling_height) || 9.5,
    ...enrichFloorplanItemRow(row)
  };
}

function itemUploadDir(itemId, type) {
  const sub = { photo: 'photos', manual: 'manuals', document: 'manuals', software: 'software', receipt: 'receipts' }[type] || 'manuals';
  const dir = path.join(UPLOADS_DIR, sub, String(itemId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { dir, sub };
}

function removeItemUploadDirs(itemId) {
  for (const sub of ['photos', 'manuals', 'software', 'receipts']) {
    const dir = path.join(UPLOADS_DIR, sub, String(itemId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function softwareLicenseDir(id) {
  const dir = path.join(UPLOADS_DIR, 'software-licenses', String(id));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeSoftwareLicenseDir(id) {
  const dir = path.join(UPLOADS_DIR, 'software-licenses', String(id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function str(val, max = 500) {
  return String(val ?? '').trim().slice(0, max);
}

function sanitizeSoftwareInput(body = {}) {
  const license_type = LICENSE_TYPES.includes(body.license_type) ? body.license_type : 'perpetual';
  const activation_method = ACTIVATION_METHODS.includes(body.activation_method) ? body.activation_method : 'account';
  const plugin_format = PLUGIN_FORMATS.includes(body.plugin_format) ? body.plugin_format : 'vst3';
  let category = str(body.category, 80) || 'Plugin';
  if (!SOFTWARE_CATEGORIES.includes(category)) category = 'Other';

  const seats = Math.max(1, Math.min(99, parseInt(body.seats, 10) || 1));
  const renewal = str(body.renewal_date, 10) || null;
  const host = body.host_item_id != null && body.host_item_id !== ''
    ? parseInt(body.host_item_id, 10) : null;

  return {
    name: str(body.name, 200),
    publisher: str(body.publisher, 150),
    version: str(body.version, 80),
    category,
    license_key: str(body.license_key, 500),
    license_type,
    activation_method,
    plugin_format,
    seats,
    renewal_date: renewal,
    purchase_date: str(body.purchase_date, 10),
    purchase_price: Math.max(0, parseFloat(body.purchase_price) || 0),
    replacement_value: Math.max(0, parseFloat(body.replacement_value) || 0),
    host_item_id: Number.isFinite(host) ? host : null,
    notes: str(body.notes, 4000)
  };
}

function enrichSoftwareRow(row) {
  if (!row) return null;
  const host = row.host_item_id
    ? db.prepare('SELECT id, name, brand, model FROM items WHERE id = ?').get(row.host_item_id)
    : null;
  const renewalSoon = isSoftwareRenewalSoon(row);
  return {
    ...row,
    host_item: host,
    renewal_soon: renewalSoon,
    renewal_overdue: isSoftwareRenewalOverdue(row)
  };
}

function isSoftwareRenewalOverdue(row) {
  if (!row?.renewal_date || row.license_type !== 'subscription') return false;
  return row.renewal_date < new Date().toISOString().slice(0, 10);
}

function isSoftwareRenewalSoon(row, days = 30) {
  if (!row?.renewal_date || row.license_type !== 'subscription') return false;
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  const limitStr = limit.toISOString().slice(0, 10);
  return row.renewal_date >= today && row.renewal_date <= limitStr;
}

function buildSoftwareQuery(params = {}) {
  const conditions = [];
  const values = {};
  const q = str(params.q, 200);
  if (q) {
    conditions.push(`(
      s.name LIKE @q OR s.publisher LIKE @q OR s.version LIKE @q OR
      s.license_key LIKE @q OR s.notes LIKE @q OR s.category LIKE @q
    )`);
    values.q = `%${q}%`;
  }
  if (params.category) {
    conditions.push('s.category = @category');
    values.category = params.category;
  }
  if (params.license_type) {
    conditions.push('s.license_type = @license_type');
    values.license_type = params.license_type;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortMap = {
    name: 's.name ASC',
    publisher: 's.publisher ASC, s.name ASC',
    value: 's.replacement_value DESC, s.name ASC',
    recent: 's.created_at DESC',
    renewal: `CASE WHEN s.renewal_date IS NULL OR s.renewal_date = '' THEN 1 ELSE 0 END, s.renewal_date ASC`
  };
  const orderBy = sortMap[params.sort] || sortMap.name;
  return { where, values, orderBy };
}

function getAllSoftware(params = {}) {
  const { where, values, orderBy } = buildSoftwareQuery(params);
  const rows = db.prepare(`
    SELECT s.* FROM software_licenses s ${where} ORDER BY ${orderBy}
  `).all(values);
  return rows.map(enrichSoftwareRow);
}

function getSoftware(id) {
  const row = db.prepare('SELECT * FROM software_licenses WHERE id = ?').get(id);
  return enrichSoftwareRow(row);
}

function createSoftware(body) {
  const data = sanitizeSoftwareInput(body);
  if (!data.name) throw new Error('Software name is required');
  if (data.host_item_id && !db.prepare('SELECT id FROM items WHERE id = ?').get(data.host_item_id)) {
    throw new Error('Linked hardware item not found');
  }
  const result = db.prepare(`
    INSERT INTO software_licenses (
      name, publisher, version, category, license_key, license_type, activation_method,
      plugin_format, seats, renewal_date, purchase_date, purchase_price, replacement_value,
      host_item_id, notes
    ) VALUES (
      @name, @publisher, @version, @category, @license_key, @license_type, @activation_method,
      @plugin_format, @seats, @renewal_date, @purchase_date, @purchase_price, @replacement_value,
      @host_item_id, @notes
    )
  `).run(data);
  return getSoftware(result.lastInsertRowid);
}

function updateSoftware(id, body) {
  const existing = db.prepare('SELECT id FROM software_licenses WHERE id = ?').get(id);
  if (!existing) throw new Error('Software license not found');
  const data = sanitizeSoftwareInput(body);
  if (!data.name) throw new Error('Software name is required');
  if (data.host_item_id && !db.prepare('SELECT id FROM items WHERE id = ?').get(data.host_item_id)) {
    throw new Error('Linked hardware item not found');
  }
  db.prepare(`
    UPDATE software_licenses SET
      name=@name, publisher=@publisher, version=@version, category=@category,
      license_key=@license_key, license_type=@license_type, activation_method=@activation_method,
      plugin_format=@plugin_format, seats=@seats, renewal_date=@renewal_date,
      purchase_date=@purchase_date, purchase_price=@purchase_price, replacement_value=@replacement_value,
      host_item_id=@host_item_id, notes=@notes, updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...data, id });
  return getSoftware(id);
}

function updateSoftwareScreenshot(id, relativePath) {
  const existing = db.prepare('SELECT screenshot_path FROM software_licenses WHERE id = ?').get(id);
  if (!existing) throw new Error('Software license not found');
  if (existing.screenshot_path) {
    const old = path.join(UPLOADS_DIR, existing.screenshot_path);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.prepare(`
    UPDATE software_licenses SET screenshot_path = ?, updated_at = datetime('now') WHERE id = ?
  `).run(relativePath, id);
  return getSoftware(id);
}

function clearSoftwareScreenshot(id) {
  const existing = db.prepare('SELECT screenshot_path FROM software_licenses WHERE id = ?').get(id);
  if (!existing) throw new Error('Software license not found');
  if (existing.screenshot_path) {
    const fp = path.join(UPLOADS_DIR, existing.screenshot_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare(`
    UPDATE software_licenses SET screenshot_path = '', updated_at = datetime('now') WHERE id = ?
  `).run(id);
  return getSoftware(id);
}

function deleteSoftware(id) {
  const row = db.prepare('SELECT id FROM software_licenses WHERE id = ?').get(id);
  if (!row) throw new Error('Software license not found');
  db.prepare('DELETE FROM software_licenses WHERE id = ?').run(id);
  removeSoftwareLicenseDir(id);
}

function getSoftwareRenewals(days = 30) {
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  const limitStr = limit.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM software_licenses
    WHERE license_type = 'subscription'
      AND renewal_date IS NOT NULL AND renewal_date != ''
      AND renewal_date <= ?
    ORDER BY renewal_date ASC
    LIMIT 20
  `).all(limitStr);
  return rows.map(row => ({
    ...enrichSoftwareRow(row),
    overdue: row.renewal_date < today
  }));
}

function getSoftwareTotals() {
  return db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(purchase_price), 0) as total_purchase,
      COALESCE(SUM(replacement_value), 0) as total_value
    FROM software_licenses
  `).get();
}

module.exports = {
  db,
  DB_PATH,
  DATA_DIR,
  UPLOADS_DIR,
  LOGOS_DIR,
  DEFAULT_CATEGORIES,
  DEFAULT_LOCATIONS,
  DRIVER_CATEGORIES,
  initSchema,
  enrichItem,
  setItemTags,
  sanitizeItemInput,
  getTagsForItem,
  getAttachmentsForItem,
  itemUploadDir,
  removeItemUploadDirs,
  safeJsonParse,
  brandSlug,
  ensureBrand,
  getBrandsWithCounts,
  syncBrandsFromItems,
  getMaintenanceForItem,
  addMaintenanceEntry,
  deleteMaintenanceEntry,
  getLoansForItem,
  getActiveLoanForItem,
  getActiveLoans,
  getRecentLoanHistory,
  checkoutItem,
  returnLoan,
  deleteLoanEntry,
  isLoanOverdue,
  getParentSummary,
  getAccessoryItems,
  getRacks,
  getSignalChains,
  getFloorplans,
  getFloorplan,
  createFloorplan,
  updateFloorplanImage,
  clearFloorplanFloorImage,
  updateFloorplanFloorView,
  updateFloorplanGeometry,
  setFloorplanItems,
  deleteFloorplan,
  getItemMapPlacement,
  saveItemWallCutout,
  clearItemWallCutout,
  wallPhotoDir,
  floorplanWallPhotosDir,
  updateFloorplanWallPhoto,
  updateFloorplanWallCalibration,
  suspendWallPlacement,
  resolveWallRehang,
  floorplanItemsPayload,
  parseWallPhotosJson,
  SOFTWARE_CATEGORIES,
  LICENSE_TYPES,
  ACTIVATION_METHODS,
  PLUGIN_FORMATS,
  softwareLicenseDir,
  removeSoftwareLicenseDir,
  getAllSoftware,
  getSoftware,
  createSoftware,
  updateSoftware,
  updateSoftwareScreenshot,
  clearSoftwareScreenshot,
  deleteSoftware,
  getSoftwareRenewals,
  getSoftwareTotals,
  sanitizeSoftwareInput
};
