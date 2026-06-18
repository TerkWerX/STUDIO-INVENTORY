const CHECK_LABELS = {
  photo: 'Photo',
  serial: 'Serial number',
  receipt: 'Receipt',
  manual: 'Manual',
  valueCurrent: 'Value updated this year'
};

const STUDIO_STATUSES = {
  in_studio: 'In studio',
  loaned: 'Loaned out',
  in_repair: 'In repair',
  storage: 'In storage',
  away: 'Away'
};

function isValueCurrent(item) {
  if (!item.replacement_value || item.replacement_value <= 0) return false;
  const ref = item.value_updated_at || item.updated_at;
  if (!ref) return false;
  const year = new Date().getFullYear();
  const refYear = new Date(String(ref).includes('T') ? ref : `${ref}T12:00:00`).getFullYear();
  return refYear >= year;
}

function computeItemCompleteness(item) {
  const checks = {
    photo: (item.photos?.length || 0) > 0,
    serial: !!(String(item.serial_number || '').trim()),
    receipt: (item.receipts?.length || 0) > 0,
    manual: (item.manuals?.length || 0) > 0,
    valueCurrent: isValueCurrent(item)
  };
  const keys = Object.keys(checks);
  const done = keys.filter(k => checks[k]).length;
  const score = Math.round((done / keys.length) * 100);
  const status = score === 100 ? 'complete' : score >= 60 ? 'partial' : 'incomplete';
  const missing = keys.filter(k => !checks[k]).map(k => CHECK_LABELS[k]);
  return { checks, score, status, missing, labels: CHECK_LABELS };
}

function summarizeCompleteness(items) {
  const enriched = items.map(item => ({ item, ...computeItemCompleteness(item) }));
  const gaps = { photo: 0, serial: 0, receipt: 0, manual: 0, valueCurrent: 0 };
  for (const row of enriched) {
    for (const [key, ok] of Object.entries(row.checks)) {
      if (!ok) gaps[key]++;
    }
  }
  const incomplete = enriched.filter(r => r.status !== 'complete');
  const avgScore = enriched.length
    ? Math.round(enriched.reduce((s, r) => s + r.score, 0) / enriched.length)
    : 100;
  return {
    averageScore: avgScore,
    totalItems: enriched.length,
    completeCount: enriched.filter(r => r.status === 'complete').length,
    gaps,
    gapLabels: CHECK_LABELS,
    needsAttention: incomplete
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map(r => ({
        id: r.item.id,
        name: r.item.name,
        category: r.item.category,
        score: r.score,
        status: r.status,
        missing: r.missing
      }))
  };
}

module.exports = {
  CHECK_LABELS,
  STUDIO_STATUSES,
  isValueCurrent,
  computeItemCompleteness,
  summarizeCompleteness
};