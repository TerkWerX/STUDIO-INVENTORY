import { escapeHtml, formatCurrency, formatDate, fileUrl, getWarrantyStatus } from '../utils.js';

function absUrl(relativePath) {
  if (!relativePath) return '';
  const path = fileUrl(relativePath);
  return `${window.location.origin}${path}`;
}

function printStyles() {
  return `
    @page { size: letter; margin: 0.65in 0.5in 0.65in 1.15in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #111;
      background: #fff;
    }
    .binder-page {
      page-break-after: always;
      break-after: page;
      min-height: 9.5in;
      position: relative;
    }
    .binder-page:last-child { page-break-after: auto; break-after: auto; }
    .binder-kicker {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #666;
      border-bottom: 1px solid #ccc;
      padding-bottom: 0.35rem;
      margin-bottom: 0.75rem;
    }
    .binder-title {
      font-size: 22pt;
      margin: 0 0 0.25rem;
      line-height: 1.15;
    }
    .binder-subtitle {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      color: #444;
      margin: 0 0 1rem;
    }
    .binder-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.45rem 1.25rem;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10pt;
      margin-bottom: 1rem;
    }
    .binder-field label {
      display: block;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #777;
      margin-bottom: 0.1rem;
    }
    .binder-field strong { font-weight: 600; }
    .binder-field.full { grid-column: 1 / -1; }
    .binder-photos {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.75rem 0 1rem;
    }
    .binder-photos img {
      max-width: 2.35in;
      max-height: 2in;
      object-fit: cover;
      border: 1px solid #ccc;
    }
    .binder-note {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9.5pt;
      background: #f7f7f7;
      border-left: 3px solid #999;
      padding: 0.5rem 0.65rem;
      margin: 0.5rem 0;
    }
    .binder-attachments {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9pt;
      margin-top: 1rem;
      padding-top: 0.65rem;
      border-top: 1px solid #ddd;
    }
    .binder-attachments h4 {
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #666;
      margin: 0 0 0.35rem;
    }
    .binder-attachments ul { margin: 0; padding-left: 1.1rem; }
    .binder-footer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8pt;
      color: #888;
      border-top: 1px solid #ddd;
      padding-top: 0.35rem;
      display: flex;
      justify-content: space-between;
    }
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      min-height: 9in;
      padding-top: 1.5in;
    }
    .cover-page h1 {
      font-size: 30pt;
      margin: 0 0 0.5rem;
      letter-spacing: 0.02em;
    }
    .cover-page h2 {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14pt;
      font-weight: normal;
      color: #444;
      margin: 0 0 2rem;
    }
    .cover-stats {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      line-height: 1.8;
      text-align: left;
      border: 2px solid #111;
      padding: 1rem 1.5rem;
      min-width: 4.5in;
    }
    .index-table {
      width: 100%;
      border-collapse: collapse;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9.5pt;
    }
    .index-table th, .index-table td {
      border-bottom: 1px solid #ddd;
      padding: 0.35rem 0.25rem;
      text-align: left;
      vertical-align: top;
    }
    .index-table th {
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #666;
    }
    .index-table .page-col { width: 2.5rem; text-align: right; }
    .print-toolbar {
      font-family: Arial, Helvetica, sans-serif;
      padding: 0.75rem 1rem;
      background: #1a2332;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .print-toolbar button {
      background: #fff;
      color: #1a2332;
      border: none;
      padding: 0.45rem 0.9rem;
      font-weight: 600;
      cursor: pointer;
      border-radius: 4px;
    }
    .print-toolbar span { font-size: 10pt; opacity: 0.9; }
    @media print {
      .print-toolbar { display: none !important; }
      body { background: #fff; }
    }
  `;
}

function warrantyPrintLine(item) {
  const w = getWarrantyStatus(item.warranty_end_date);
  if (w.status === 'none') {
    return item.warranty_note ? `Not recorded — ${item.warranty_note}` : 'Not recorded';
  }
  return `${w.label} (ends ${formatDate(w.endDate)})${item.warranty_note ? ` — ${item.warranty_note}` : ''}`;
}

function renderItemPage(item, { includePhotos = true, pageLabel = '' } = {}) {
  const photos = (item.photos || []).slice(0, 3);
  const manuals = item.manuals || [];
  const receipts = item.receipts || [];
  const tags = (item.tags || []).map(t => escapeHtml(t.name)).join(', ');

  const photoHtml = includePhotos && photos.length
    ? `<div class="binder-photos">${photos.map(p =>
      `<img src="${absUrl(p.relative_path)}" alt="${escapeHtml(p.original_name)}">`
    ).join('')}</div>`
    : '';

  const manualList = manuals.length
    ? `<div class="binder-attachments"><h4>Manuals on file (print separately if desired)</h4><ul>${manuals.map(m =>
      `<li>${escapeHtml(m.original_name)}${m.mime_type === 'application/pdf' ? ' (PDF)' : ''}</li>`
    ).join('')}</ul></div>`
    : '';

  const receiptList = receipts.length
    ? `<div class="binder-attachments"><h4>Digital receipts on file</h4><ul>${receipts.map(r =>
      `<li>${escapeHtml(r.original_name)}</li>`
    ).join('')}</ul></div>`
    : '';

  return `
    <section class="binder-page item-page">
      <div class="binder-kicker">Studio Inventory · Binder Record · ${pageLabel || `Item #${item.id}`}</div>
      <h1 class="binder-title">${escapeHtml(item.name)}</h1>
      ${item.common_name ? `<p class="binder-subtitle">${escapeHtml(item.common_name)}</p>` : ''}
      ${photoHtml}
      <div class="binder-grid">
        <div class="binder-field"><label>Category</label><strong>${escapeHtml(item.category) || '—'}</strong></div>
        <div class="binder-field"><label>Location</label><strong>${escapeHtml(item.location) || '—'}</strong></div>
        <div class="binder-field"><label>Brand</label><strong>${escapeHtml(item.brand) || '—'}</strong></div>
        <div class="binder-field"><label>Model</label><strong>${escapeHtml(item.model) || '—'}</strong></div>
        <div class="binder-field"><label>Serial Number</label><strong>${escapeHtml(item.serial_number) || '—'}</strong></div>
        <div class="binder-field"><label>Year</label><strong>${escapeHtml(item.year) || '—'}</strong></div>
        <div class="binder-field"><label>Condition</label><strong>${escapeHtml(item.condition) || '—'}</strong></div>
        <div class="binder-field"><label>Quantity</label><strong>${item.quantity ?? 1}</strong></div>
        <div class="binder-field"><label>Purchase Date</label><strong>${formatDate(item.purchase_date)}</strong></div>
        <div class="binder-field"><label>Purchase Price</label><strong>${formatCurrency(item.purchase_price)}</strong></div>
        <div class="binder-field"><label>Replacement Value</label><strong>${formatCurrency(item.replacement_value)}</strong></div>
        <div class="binder-field"><label>Warranty</label><strong>${escapeHtml(warrantyPrintLine(item))}</strong></div>
        ${item.replacement_value_note ? `<div class="binder-field full"><label>Value Note</label><strong>${escapeHtml(item.replacement_value_note)}</strong></div>` : ''}
        ${tags ? `<div class="binder-field full"><label>Tags</label><strong>${tags}</strong></div>` : ''}
      </div>
      ${item.condition_notes ? `<div class="binder-note"><strong>Condition notes:</strong> ${escapeHtml(item.condition_notes)}</div>` : ''}
      ${item.description ? `<div class="binder-note"><strong>Description:</strong> ${escapeHtml(item.description)}</div>` : ''}
      ${manualList}
      ${receiptList}
      <div class="binder-footer">
        <span>Printed ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
        <span>${pageLabel}</span>
      </div>
    </section>
  `;
}

function renderCoverPage(studioName, stats) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totals = stats?.totals || {};
  return `
    <section class="binder-page cover-page">
      <h1>${escapeHtml(studioName || 'Studio Inventory')}</h1>
      <h2>Physical Gear Binder</h2>
      <div class="cover-stats">
        <div><strong>Total items:</strong> ${totals.item_count ?? '—'}</div>
        <div><strong>Total replacement value:</strong> ${formatCurrency(totals.total_replacement)}</div>
        <div><strong>Binder compiled:</strong> ${date}</div>
        <div style="margin-top:0.75rem;font-size:9pt;color:#666">One page per item · 3-hole punch left margin · Manuals printed separately on demand</div>
      </div>
    </section>
  `;
}

function renderIndexPage(items, firstItemPageNum) {
  const rows = items.map((item, i) => `
    <tr>
      <td class="page-col">${firstItemPageNum + i}</td>
      <td><strong>${escapeHtml(item.name)}</strong>${item.common_name ? `<br><span style="color:#666">${escapeHtml(item.common_name)}</span>` : ''}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.location)}</td>
      <td>${escapeHtml(item.serial_number) || '—'}</td>
      <td style="text-align:right">${formatCurrency((item.replacement_value || 0) * (item.quantity || 1))}</td>
    </tr>
  `).join('');

  return `
    <section class="binder-page">
      <div class="binder-kicker">Studio Inventory · Binder Index</div>
      <h1 class="binder-title" style="font-size:18pt">Gear Index</h1>
      <p class="binder-subtitle">${items.length} item${items.length !== 1 ? 's' : ''} — use page numbers to file new pages in your binder</p>
      <table class="index-table">
        <thead>
          <tr><th class="page-col">Pg</th><th>Name</th><th>Category</th><th>Location</th><th>Serial</th><th style="text-align:right">Value</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

export function buildBinderDocument({
  items,
  studioName = 'Studio Inventory',
  stats = null,
  includeCover = true,
  includeIndex = true,
  includeItemPages = true,
  includePhotos = true
} = {}) {
  const sorted = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const parts = [];

  if (includeCover) {
    parts.push(renderCoverPage(studioName, stats));
  }
  const firstItemPage = includeCover ? (includeIndex ? 3 : 2) : (includeIndex ? 2 : 1);
  if (includeIndex && sorted.length) {
    parts.push(renderIndexPage(sorted, firstItemPage));
  }

  if (includeItemPages) {
    sorted.forEach((item, i) => {
      const label = `Page ${firstItemPage + i}`;
      parts.push(renderItemPage(item, { includePhotos, pageLabel: label }));
    });
  }

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${escapeHtml(studioName)} — Binder Print</title>
<style>${printStyles()}</style>
</head><body>
<div class="print-toolbar">
  <button type="button" onclick="window.print()">Print</button>
  <button type="button" onclick="window.close()">Close</button>
  <span>Formatted for US Letter · left margin for 3-hole punch · ${includeItemPages ? `${sorted.length} gear page${sorted.length !== 1 ? 's' : ''}` : 'index / cover'}</span>
</div>
${parts.join('\n')}
</body></html>`;
}

export function openBinderPrint(html, { autoPrint = true, title = 'Binder Print' } = {}) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-up blocked — allow pop-ups to print binder pages');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  if (autoPrint) {
    win.onload = () => {
      setTimeout(() => win.print(), 400);
    };
  }
  return win;
}

export function printBinderDocument(options) {
  const html = buildBinderDocument(options);
  const count = options.items?.length || 0;
  return openBinderPrint(html, {
    autoPrint: options.autoPrint !== false,
    title: `Binder — ${count} item${count !== 1 ? 's' : ''}`
  });
}

export function printBinderItems(items, options = {}) {
  return printBinderDocument({
    items,
    includeCover: false,
    includeIndex: false,
    includeItemPages: true,
    includePhotos: options.includePhotos !== false,
    studioName: options.studioName,
    stats: options.stats,
    autoPrint: options.autoPrint !== false
  });
}

/** Opens a PDF manual in a print-ready window — does not auto-print. */
export function openManualForPrint(relativePath, documentName) {
  const url = absUrl(relativePath);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-up blocked — allow pop-ups to print manuals');
  win.document.write(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${escapeHtml(documentName)} — Print Manual</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; }
  .toolbar {
    padding: 0.75rem 1rem;
    background: #1a2332;
    color: #fff;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .toolbar button {
    background: #fff;
    color: #1a2332;
    border: none;
    padding: 0.45rem 0.9rem;
    font-weight: 600;
    cursor: pointer;
    border-radius: 4px;
  }
  .toolbar span { font-size: 10pt; }
  embed { display: block; width: 100%; height: calc(100vh - 52px); }
  @media print {
    .toolbar { display: none !important; }
    embed { height: 100vh; }
  }
</style></head><body>
<div class="toolbar">
  <button type="button" onclick="window.print()">Print Manual</button>
  <button type="button" onclick="window.close()">Close</button>
  <span>${escapeHtml(documentName)} — use Print when ready (not printed automatically)</span>
</div>
<embed src="${url}" type="application/pdf">
</body></html>`);
  win.document.close();
}

export function isPdfManual(attachment) {
  return attachment?.mime_type === 'application/pdf'
    || (attachment?.original_name || '').toLowerCase().endsWith('.pdf');
}