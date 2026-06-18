function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  }).filter(r => Object.values(r).some(v => String(v).trim()));
  return { headers, rows };
}

const COLUMN_MAP = {
  name: 'name',
  common_name: 'common_name',
  category: 'category',
  brand: 'brand',
  model: 'model',
  serial_number: 'serial_number',
  serial: 'serial_number',
  year: 'year',
  location: 'location',
  condition: 'condition',
  quantity: 'quantity',
  purchase_date: 'purchase_date',
  purchase_price: 'purchase_price',
  replacement_value: 'replacement_value',
  replacement_value_note: 'replacement_value_note',
  warranty_end_date: 'warranty_end_date',
  warranty_note: 'warranty_note',
  studio_status: 'studio_status',
  studio_status_note: 'studio_status_note',
  description: 'description',
  condition_notes: 'condition_notes',
  tags: 'tags'
};

function mapRowToItem(row, sanitizeItemInput) {
  const body = {};
  for (const [src, dest] of Object.entries(COLUMN_MAP)) {
    if (row[src] != null && String(row[src]).trim() !== '') body[dest] = row[src];
  }
  const data = sanitizeItemInput(body);
  const tags = String(body.tags || row.tags || '')
    .split(/[;|]/)
    .map(t => t.trim())
    .filter(Boolean);
  return { data, tags };
}

module.exports = { parseCsv, mapRowToItem, COLUMN_MAP };