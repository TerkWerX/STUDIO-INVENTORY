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
  path.join(UPLOADS_DIR, 'receipts'), path.join(UPLOADS_DIR, 'logos'),
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

  const attCols2 = db.prepare('PRAGMA table_info(attachments)').all().map(c => c.name);
  if (!attCols2.includes('extracted_text')) {
    db.exec("ALTER TABLE attachments ADD COLUMN extracted_text TEXT DEFAULT ''");
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
  let brand_logo_path = '';
  if (item.brand) {
    const brandRow = db.prepare('SELECT logo_path FROM brands WHERE name = ? COLLATE NOCASE').get(item.brand);
    brand_logo_path = brandRow?.logo_path || '';
  }
  return {
    ...item,
    brand_logo_path,
    update_checks_enabled: item.update_checks_enabled !== 0,
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
    })
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
    insurance_policy_note: str(body.insurance_policy_note, 500)
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

    return db.prepare('SELECT * FROM loan_log WHERE id = ?').get(result.lastInsertRowid);
  });

  return enrichLoanRow(tx());
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

    return db.prepare('SELECT * FROM loan_log WHERE id = ?').get(loanId);
  });

  return enrichLoanRow(tx());
}

function deleteLoanEntry(id) {
  const loan = db.prepare('SELECT * FROM loan_log WHERE id = ?').get(id);
  if (!loan) throw new Error('Loan entry not found');
  if (!loan.returned_at) throw new Error('Cannot delete an active loan — mark it returned first');
  db.prepare('DELETE FROM loan_log WHERE id = ?').run(id);
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
  getSignalChains
};