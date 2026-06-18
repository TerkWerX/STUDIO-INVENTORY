import { formatCurrency, formatDate, escapeHtml, fileUrl } from '../utils.js';

export function renderReports(items, stats) {
  const { totals } = stats;
  const byCategory = groupBy(items, 'category');
  const byLocation = groupBy(items, 'location');

  return `
    <h2 class="page-title">Reports</h2>
    <p class="page-subtitle">Generate and export inventory reports</p>

    <div class="btn-group" style="margin-bottom:2rem">
      <button type="button" class="btn btn-primary" id="export-pdf-full">Export Full PDF</button>
      <button type="button" class="btn btn-secondary" id="export-pdf-category">PDF by Category</button>
      <button type="button" class="btn btn-secondary" id="export-pdf-location">PDF by Location</button>
      <button type="button" class="btn btn-secondary" id="export-pdf-highvalue">PDF High-Value</button>
      <button type="button" class="btn btn-secondary" id="export-csv">Export CSV</button>
      <button type="button" class="btn btn-secondary" id="export-json">Export JSON</button>
      <button type="button" class="btn btn-ghost" onclick="window.print()">Print View</button>
    </div>

    <div class="report-totals">
      <div class="report-total-item">
        <div class="label">Total Items</div>
        <div class="value">${totals.item_count}</div>
      </div>
      <div class="report-total-item">
        <div class="label">Total Purchase Value</div>
        <div class="value">${formatCurrency(totals.total_purchase)}</div>
      </div>
      <div class="report-total-item">
        <div class="label">Total Replacement Value</div>
        <div class="value">${formatCurrency(totals.total_replacement)}</div>
      </div>
    </div>

    <div class="card report-section" id="report-full">
      <h3 class="section-title">Full Inventory Summary</h3>
      <div class="form-group" style="max-width:300px;margin-bottom:1rem">
        <label for="high-value-threshold">High-Value Threshold ($)</label>
        <input type="number" id="high-value-threshold" value="500" min="0" step="50">
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Category</th><th>Brand</th><th>Serial</th>
              <th>Location</th><th>Condition</th><th>Purchase</th><th>Replacement</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td>${escapeHtml(i.name)}</td>
                <td>${escapeHtml(i.category)}</td>
                <td>${escapeHtml(i.brand)} ${escapeHtml(i.model)}</td>
                <td>${escapeHtml(i.serial_number)}</td>
                <td>${escapeHtml(i.location)}</td>
                <td>${i.condition}</td>
                <td>${formatCurrency(i.purchase_price)}</td>
                <td class="value-cell">${formatCurrency(i.replacement_value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card report-section">
      <h3 class="section-title">Categorized Breakdown</h3>
      ${Object.entries(byCategory).sort((a, b) => sumValue(b[1]) - sumValue(a[1])).map(([cat, catItems]) => `
        <div style="margin-bottom:1.5rem">
          <h4 style="font-size:var(--font-lg);margin-bottom:0.5rem">${escapeHtml(cat || 'Uncategorized')} — ${catItems.length} items, ${formatCurrency(sumValue(catItems))}</h4>
        </div>
      `).join('')}
    </div>

    <div class="card report-section">
      <h3 class="section-title">Items by Location</h3>
      ${Object.entries(byLocation).sort((a, b) => b[1].length - a[1].length).map(([loc, locItems]) => `
        <div style="margin-bottom:1rem">
          <strong>${escapeHtml(loc || 'Unassigned')}</strong>: ${locItems.length} items (${formatCurrency(sumValue(locItems))})
        </div>
      `).join('')}
    </div>
  `;
}

export function renderInsurance(items) {
  const total = items.reduce((s, i) => s + (i.replacement_value || 0) * (i.quantity || 1), 0);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
    <h2 class="page-title">Insurance Report</h2>
    <p class="page-subtitle">Documentation for insurance claims — Generated ${date}</p>

    <div class="btn-group" style="margin-bottom:2rem">
      <button type="button" class="btn btn-primary" id="export-insurance-pdf">Export Insurance PDF</button>
      <button type="button" class="btn btn-ghost" onclick="window.print()">Print</button>
    </div>

    <div class="report-totals">
      <div class="report-total-item">
        <div class="label">Total Insured Items</div>
        <div class="value">${items.length}</div>
      </div>
      <div class="report-total-item">
        <div class="label">Total Replacement Value</div>
        <div class="value">${formatCurrency(total)}</div>
      </div>
    </div>

    <div class="card" id="insurance-report">
      <div style="text-align:center;margin-bottom:2rem;padding-bottom:1rem;border-bottom:2px solid var(--border)">
        <h3 style="font-size:var(--font-xl)">Home Music Studio Inventory</h3>
        <p style="color:var(--text-secondary)">Insurance Documentation Report — ${date}</p>
      </div>

      ${items.map(item => {
        const photo = (item.attachments || []).find(a => a.type === 'photo' || a.mime_type?.startsWith('image/'));
        return `
          <div class="insurance-item">
            ${photo
              ? `<img class="insurance-photo" src="${fileUrl(photo.filename)}" alt="${escapeHtml(item.name)}">`
              : `<div class="insurance-photo-placeholder">No Photo</div>`
            }
            <div>
              <h4 style="font-size:var(--font-lg);margin-bottom:0.5rem">${escapeHtml(item.name)}</h4>
              <p style="color:var(--text-secondary);margin-bottom:0.5rem">${escapeHtml(item.brand)} ${escapeHtml(item.model)} — ${escapeHtml(item.category)}</p>
              <p><strong>Serial:</strong> ${escapeHtml(item.serial_number) || 'N/A'} &nbsp;|&nbsp;
                 <strong>Year:</strong> ${escapeHtml(item.year) || 'N/A'} &nbsp;|&nbsp;
                 <strong>Qty:</strong> ${item.quantity}</p>
              <p><strong>Location:</strong> ${escapeHtml(item.location)} &nbsp;|&nbsp;
                 <strong>Condition:</strong> ${item.condition}</p>
              <p><strong>Purchase:</strong> ${formatDate(item.purchase_date)} — ${formatCurrency(item.purchase_price)}</p>
              ${item.replacement_value_note ? `<p style="font-size:var(--font-sm);color:var(--text-muted)">Value note: ${escapeHtml(item.replacement_value_note)}</p>` : ''}
              ${item.description ? `<p style="margin-top:0.5rem;font-size:var(--font-sm)">${escapeHtml(item.description)}</p>` : ''}
            </div>
            <div class="value-cell" style="font-size:var(--font-xl);text-align:right">
              ${formatCurrency(item.replacement_value * item.quantity)}
            </div>
          </div>
        `;
      }).join('')}

      <div style="text-align:right;padding-top:1.5rem;margin-top:1rem;border-top:2px solid var(--border);font-size:var(--font-xl);font-weight:700">
        Total Replacement Value: ${formatCurrency(total)}
      </div>
    </div>
  `;
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const k = item[key] || '';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function sumValue(items) {
  return items.reduce((s, i) => s + (i.replacement_value || 0) * (i.quantity || 1), 0);
}

export function generatePdf(title, headers, rows, totals) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: rows.length > 20 ? 'landscape' : 'portrait' });
  const date = new Date().toLocaleDateString();

  doc.setFontSize(18);
  doc.text('Studio Inventory', 14, 20);
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text(title, 14, 28);
  doc.text(`Generated: ${date}`, 14, 35);

  doc.autoTable({
    startY: 42,
    head: [headers],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [26, 35, 50] },
    alternateRowStyles: { fillColor: [245, 247, 250] }
  });

  if (totals) {
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Total Items: ${totals.count}`, 14, finalY);
    doc.text(`Purchase Value: ${totals.purchase}`, 14, finalY + 7);
    doc.text(`Replacement Value: ${totals.replacement}`, 14, finalY + 14);
  }

  doc.save(`studio-inventory-${title.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}