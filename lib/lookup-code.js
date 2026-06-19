/**
 * Parse barcode / QR / keyboard-wedge input into item lookup hints.
 */
function parseLookupCode(raw) {
  const code = String(raw || '').trim();
  if (!code) return null;

  const urlId = code.match(/(?:scan\.html\?id=|\/scan\/|item-detail[^&]*&id=|edit=)(\d+)/i);
  if (urlId) return { type: 'id', value: parseInt(urlId[1], 10) };

  const prefixed = code.match(/^(?:SI|INV)[-:#]?(\d+)$/i);
  if (prefixed) return { type: 'id', value: parseInt(prefixed[1], 10) };

  if (/^\d{1,8}$/.test(code)) return { type: 'id', value: parseInt(code, 10) };

  return { type: 'serial', value: code };
}

module.exports = { parseLookupCode };