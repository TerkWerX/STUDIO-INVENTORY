const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.STUDIO_DATA_DIR
  ? path.resolve(process.env.STUDIO_DATA_DIR)
  : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'inventory.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

for (const dir of [DATA_DIR, UPLOADS_DIR, path.join(UPLOADS_DIR, 'photos'),
  path.join(UPLOADS_DIR, 'manuals'), path.join(UPLOADS_DIR, 'software'),
  path.join(UPLOADS_DIR, 'logos'), path.join(DATA_DIR, 'backups')]) {
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

function runMigrations() {
  const itemCols = db.prepare('PRAGMA table_info(items)').all().map(c => c.name);
  if (!itemCols.includes('update_checks_enabled')) {
    db.exec('ALTER TABLE items ADD COLUMN update_checks_enabled INTEGER NOT NULL DEFAULT 1');
  }

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

function enrichItem(item) {
  if (!item) return null;
  const attachments = getAttachmentsForItem(item.id);
  return {
    ...item,
    update_checks_enabled: item.update_checks_enabled !== 0,
    tags: getTagsForItem(item.id),
    attachments,
    photos: attachments.filter(a => a.type === 'photo'),
    manuals: attachments.filter(a => a.type === 'manual' || a.type === 'document'),
    software: attachments.filter(a => a.type === 'software')
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
    update_checks_enabled: updateChecks
  };
}

function itemUploadDir(itemId, type) {
  const sub = { photo: 'photos', manual: 'manuals', document: 'manuals', software: 'software' }[type] || 'manuals';
  const dir = path.join(UPLOADS_DIR, sub, String(itemId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return { dir, sub };
}

function removeItemUploadDirs(itemId) {
  for (const sub of ['photos', 'manuals', 'software']) {
    const dir = path.join(UPLOADS_DIR, sub, String(itemId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
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
  syncBrandsFromItems
};