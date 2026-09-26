/**
 * CSV writing that survives real gear notes and real spreadsheet apps.
 *
 * - Any cell containing a comma, quote, or line break is quoted (RFC 4180),
 *   so a multi-line description stays one row.
 * - Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR at the
 *   start) gets a leading apostrophe. Excel, Numbers and Google Sheets show the
 *   text as typed; Studio Inventory's own CSV import removes the apostrophe.
 * - A UTF-8 byte-order mark lets Excel read accents and symbols correctly.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;
const BOM = '﻿';

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}

function toCsv(headers, rows) {
  return BOM + csvRow(headers) + rows.map(csvRow).join('');
}

module.exports = { csvCell, csvRow, toCsv, FORMULA_START };
