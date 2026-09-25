const FORMER = new Set(['sold', 'stolen', 'destroyed', 'given_away']);

function asOf(item) {
  const event = item.latest_value_event || item.value_events?.[0];
  const date = String(event?.recorded_at || item.value_updated_at || '').slice(0, 10);
  if (event?.note === 'Opening snapshot') {
    return date ? `Opening snapshot, not an appraisal ${date}` : 'Opening snapshot, not an appraisal';
  }
  return date;
}

function receiptOnFile(item) {
  if ((item.receipts || []).length) return 'Yes';
  if ((item.attachments || []).some(entry => entry.type === 'receipt')) return 'Yes';
  return 'No';
}

export function insurancePdfTables(items, formatMoney = (value) => String(value ?? '')) {
  const owned = items.filter(item => !FORMER.has(item.studio_status));
  const former = items.filter(item => FORMER.has(item.studio_status));
  return {
    ownedHeaders: ['Name', 'Brand', 'Model', 'Serial', 'Location', 'Condition', 'Purchase', 'Replacement', 'As of', 'Receipt'],
    ownedRows: owned.map(item => [
      item.name,
      item.brand,
      item.model,
      item.serial_number,
      item.location,
      item.condition,
      formatMoney(item.purchase_price),
      formatMoney((item.replacement_value || 0) * (item.quantity || 1)),
      asOf(item),
      receiptOnFile(item)
    ]),
    formerHeaders: ['Name', 'Brand', 'Model', 'Serial', 'Status', 'Date', 'Note', 'Purchase'],
    formerRows: former.map(item => [
      item.name,
      item.brand,
      item.model,
      item.serial_number,
      item.studio_status,
      item.disposition_date || '',
      item.studio_status_note || '',
      formatMoney(item.purchase_price)
    ])
  };
}
