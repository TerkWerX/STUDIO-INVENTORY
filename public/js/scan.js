import { escapeHtml, formatCurrency, formatDate, fileUrl } from './utils.js';

const root = document.getElementById('scan-root');
const itemId = new URLSearchParams(window.location.search).get('id');

async function loadItem(id) {
  const res = await fetch(`/api/items/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Item not found' : 'Could not load item');
  return res.json();
}

function renderItem(item) {
  const photo = item.photos?.[0];
  const manuals = item.manuals || [];
  const software = item.software || [];
  const editUrl = `/?view=item-form&edit=${item.id}`;
  const detailUrl = `/?view=item-detail&id=${item.id}`;

  return `
    <article class="scan-card">
      ${photo ? `<div class="scan-photo"><img src="${fileUrl(photo.relative_path)}" alt=""></div>` : ''}
      <div class="scan-card-body">
        <h1 class="scan-title">${escapeHtml(item.name)}</h1>
        ${item.common_name ? `<p class="scan-subtitle">${escapeHtml(item.common_name)}</p>` : ''}
        <p class="scan-meta">${escapeHtml(item.brand)} ${escapeHtml(item.model)}</p>

        <dl class="scan-facts">
          ${item.serial_number ? `<div><dt>Serial</dt><dd>${escapeHtml(item.serial_number)}</dd></div>` : ''}
          <div><dt>Location</dt><dd>${escapeHtml(item.location) || '—'}</dd></div>
          <div><dt>Category</dt><dd>${escapeHtml(item.category)}</dd></div>
          <div><dt>Condition</dt><dd><span class="condition-badge condition-${item.condition}">${item.condition}</span></dd></div>
          <div><dt>Replacement</dt><dd class="value-cell">${formatCurrency(item.replacement_value * (item.quantity || 1))}</dd></div>
          ${item.purchase_date ? `<div><dt>Purchased</dt><dd>${formatDate(item.purchase_date)}</dd></div>` : ''}
        </dl>

        ${item.description ? `<p class="scan-desc">${escapeHtml(item.description)}</p>` : ''}

        <div class="scan-actions">
          <a class="btn btn-primary scan-btn" href="${detailUrl}">Full Details</a>
          <a class="btn btn-accent scan-btn" href="${editUrl}">Edit / Add Data</a>
        </div>
      </div>
    </article>

    <section class="scan-section card">
      <h2 class="section-title">Manuals &amp; Documents</h2>
      ${manuals.length ? `
        <ul class="scan-link-list">
          ${manuals.map(m => `
            <li>
              <a href="${fileUrl(m.relative_path)}" target="_blank" rel="noopener" class="scan-file-link">
                <span class="scan-file-icon">📄</span>
                <span>
                  <strong>${escapeHtml(m.original_name)}</strong>
                  ${m.description ? `<span class="text-muted-sm">${escapeHtml(m.description)}</span>` : ''}
                </span>
              </a>
            </li>
          `).join('')}
        </ul>
      ` : `<p class="text-muted">No manuals yet. <a href="${editUrl}">Add a manual</a></p>`}
    </section>

    <section class="scan-section card">
      <h2 class="section-title">Software &amp; Drivers</h2>
      ${software.length ? `
        <ul class="scan-link-list">
          ${software.map(s => `
            <li>
              <a href="${fileUrl(s.relative_path)}" download class="scan-file-link">
                <span class="scan-file-icon">💾</span>
                <span>
                  <strong>${escapeHtml(s.original_name)}</strong>
                  ${s.version ? `<span class="text-muted-sm">v${escapeHtml(s.version)}</span>` : ''}
                  ${s.description ? `<span class="text-muted-sm">${escapeHtml(s.description)}</span>` : ''}
                </span>
              </a>
            </li>
          `).join('')}
        </ul>
      ` : `<p class="text-muted">No archived software. <a href="${editUrl}">Archive a driver</a></p>`}
    </section>

    <p class="scan-footer text-muted-sm">Item #${item.id} · Scan again anytime to access docs and edit data</p>
  `;
}

async function init() {
  if (!itemId) {
    root.innerHTML = `<div class="scan-error card"><h2>Invalid label</h2><p>No item ID in this QR code. Reprint the label from Studio Inventory.</p><a href="/" class="btn btn-primary">Open App</a></div>`;
    return;
  }

  try {
    const item = await loadItem(itemId);
    document.title = `${item.name} — Studio Inventory`;
    root.innerHTML = renderItem(item);
  } catch (err) {
    root.innerHTML = `<div class="scan-error card"><h2>Cannot load item</h2><p>${escapeHtml(err.message)}</p><p class="text-muted-sm">Make sure the Studio Inventory server is running on this network.</p><a href="/" class="btn btn-primary">Open App</a></div>`;
  }
}

init();