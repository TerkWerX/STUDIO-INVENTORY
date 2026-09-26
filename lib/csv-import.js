/**
 * RFC 4180 CSV parsing: quoted cells may contain commas, doubled quotes and
 * line breaks, so a multi-line description imports as one cell.
 */
function parseCsvRecords(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    records.push(row);
  }
  return records;
}

/** Undo the apostrophe that CSV export adds in front of formula-like text. */
function cleanCell(value) {
  const text = String(value ?? '').trim();
  return /^'[=+\-@\t\r]/.test(text) ? text.slice(1).trim() : text;
}

function parseCsv(text) {
  const records = parseCsvRecords(text)
    .map(record => record.map(cleanCell))
    .filter(record => record.some(value => value !== ''));
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = records.slice(1).map(cols => {
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

const COLUMN_MAP = {
  name: 'name',
  common_name: 'common_name',
  category: 'category',
  instrument_type: 'instrument_type',
  item_profile: 'instrument_type',
  instrument_specs_json: 'instrument_specs_json',
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
  parent_item_id: 'parent_item_id',
  depreciated_value: 'depreciated_value',
  on_insurance_policy: 'on_insurance_policy',
  insurance_policy_note: 'insurance_policy_note',
  requires_power: 'requires_power',
  power_adapter_voltage: 'power_adapter_voltage',
  adapter_voltage: 'power_adapter_voltage',
  voltage: 'power_adapter_voltage',
  power_adapter_current: 'power_adapter_current',
  adapter_current: 'power_adapter_current',
  current: 'power_adapter_current',
  power_adapter_polarity: 'power_adapter_polarity',
  polarity: 'power_adapter_polarity',
  power_adapter_notes: 'power_adapter_notes',
  power_notes: 'power_adapter_notes',
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

module.exports = { parseCsv, parseCsvRecords, mapRowToItem, COLUMN_MAP };
