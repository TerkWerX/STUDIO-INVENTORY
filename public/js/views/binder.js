import { escapeHtml, formatCurrency } from '../utils.js';
import { isPdfManual } from '../lib/binder-print.js';

export function renderBinderPage(items, stats, studioName) {
  const totalValue = stats?.totals?.total_replacement || 0;
  const itemCount = items.length;

  const itemRows = items.map(item => {
    const manuals = item.manuals || [];
    const pdfManuals = manuals.filter(isPdfManual);
    return `
      <tr data-item-row="${item.id}">
        <td><input type="checkbox" class="binder-item-check" value="${item.id}" checked aria-label="Include ${escapeHtml(item.name)}"></td>
        <td><strong>${escapeHtml(item.name)}</strong>${item.common_name ? `<br><span class="text-muted-sm">${escapeHtml(item.common_name)}</span>` : ''}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.location)}</td>
        <td>
          <button type="button" class="btn btn-sm btn-secondary" data-action="binder-print-one" data-id="${item.id}">Print Page</button>
        </td>
        <td>
          ${pdfManuals.length
            ? pdfManuals.map(m => `
              <button type="button" class="btn btn-sm btn-ghost" data-action="binder-print-manual"
                data-path="${escapeHtml(m.relative_path)}" data-name="${escapeHtml(m.original_name)}"
                title="Print PDF manual (optional)">Print PDF</button>
            `).join(' ')
            : '<span class="text-muted-sm">—</span>'}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <h2 class="page-title">Binder Print</h2>
    <p class="page-subtitle">Print gear records for a 3-ring binder — one page per item, with optional manual PDFs</p>

    <div class="card" style="border-left:4px solid var(--accent)">
      <h3 class="section-title">How this works</h3>
      <ul style="list-style:disc;padding-left:1.5rem;color:var(--text-secondary);line-height:1.9">
        <li><strong>Full binder</strong> — cover page, index, and one page per item (photos included).</li>
        <li><strong>New gear</strong> — after adding an item, you can print just that page to slip into your binder.</li>
        <li><strong>Manuals</strong> — never printed automatically. Use <strong>Print PDF</strong> only when you want a paper manual.</li>
        <li>Pages use a <strong>left margin</strong> for 3-hole punching on US Letter paper.</li>
      </ul>
    </div>

    <div class="card">
      <h3 class="section-title">Binder options</h3>
      <div class="form-grid" style="margin-bottom:1rem">
        <div class="form-group">
          <label for="binder-studio-name">Studio / Owner name (cover page)</label>
          <input type="text" id="binder-studio-name" value="${escapeHtml(studioName)}" placeholder="My Home Studio">
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="binder-include-photos" checked> Include photos on gear pages
          </label>
        </div>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-primary" id="binder-print-full">Print Complete Binder</button>
        <button type="button" class="btn btn-secondary" id="binder-print-selected">Print Selected Pages</button>
        <button type="button" class="btn btn-ghost" id="binder-print-index">Print Index Only</button>
      </div>
      <p class="text-muted-sm" style="margin-top:0.75rem">
        ${itemCount} items · ${formatCurrency(totalValue)} total replacement value
      </p>
    </div>

    ${itemCount ? `
      <div class="card">
        <div class="card-header">
          <h3 class="section-title">Gear pages &amp; manuals</h3>
          <div class="btn-group">
            <button type="button" class="btn btn-sm btn-ghost" id="binder-select-all">Select all</button>
            <button type="button" class="btn btn-sm btn-ghost" id="binder-select-none">Select none</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:2.5rem"></th>
                <th>Item</th>
                <th>Category</th>
                <th>Location</th>
                <th>Gear page</th>
                <th>Manual PDFs</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
      </div>
    ` : `
      <div class="empty-state">
        <h3>No gear to print yet</h3>
        <p>Add items to your inventory, then return here to print your binder.</p>
      </div>
    `}
  `;
}

export function getBinderOptionsFromDom() {
  return {
    studioName: document.getElementById('binder-studio-name')?.value?.trim() || 'Studio Inventory',
    includePhotos: document.getElementById('binder-include-photos')?.checked !== false
  };
}

export function getSelectedBinderItemIds() {
  return [...document.querySelectorAll('.binder-item-check:checked')].map(el => el.value);
}