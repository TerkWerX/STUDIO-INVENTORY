import { escapeHtml, formatCurrency, formatDate, fileUrl, brandLogoHtml } from './utils.js';

const root = document.getElementById('scan-root');
const params = new URLSearchParams(window.location.search);
const itemId = params.get('id');
const accessToken = params.get('access') || '';

function protectedFileUrl(relativePath) {
  const base = fileUrl(relativePath);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}item=${encodeURIComponent(itemId)}&access=${encodeURIComponent(accessToken)}`;
}

async function loadItem(id) {
  const qs = accessToken ? `?access=${encodeURIComponent(accessToken)}` : '';
  const res = await fetch(`/api/public/items/${encodeURIComponent(id)}${qs}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Item not found' : 'Could not load item');
  return res.json();
}

function renderItem(item) {
  const photo = item.photos?.[0];
  const manuals = item.manuals || [];
  const software = item.software || [];
  const editUrl = `/?view=item-form&edit=${item.id}`;
  const detailUrl = `/?view=item-detail&id=${item.id}`;

  const brandBanner = item.brand ? `
    <div class="scan-brand-banner">
      ${brandLogoHtml(
        { name: item.brand, logo_path: item.brand_logo_path },
        'scan-brand-logo',
        { large: true, srcOverride: protectedFileUrl(item.brand_logo_path) }
      )}
      <div>
        <span class="scan-brand-label">Manufacturer</span>
        <strong>${escapeHtml(item.brand)}</strong>
        ${item.model ? `<span class="text-muted-sm">${escapeHtml(item.model)}</span>` : ''}
      </div>
    </div>
  ` : '';

  return `
    <article class="scan-card">
      ${brandBanner}
      ${photo ? `<div class="scan-photo"><img src="${protectedFileUrl(photo.relative_path)}" alt=""></div>` : ''}
      <div class="scan-card-body">
        <h1 class="scan-title">${escapeHtml(item.name)}</h1>
        ${item.common_name ? `<p class="scan-subtitle">${escapeHtml(item.common_name)}</p>` : ''}
        ${!item.brand && item.model ? `<p class="scan-meta">${escapeHtml(item.model)}</p>` : ''}

        <dl class="scan-facts">
          ${item.serial_number ? `<div><dt>Serial</dt><dd>${escapeHtml(item.serial_number)}</dd></div>` : ''}
          <div><dt>Location</dt><dd>${escapeHtml(item.location) || '—'}</dd></div>
          <div><dt>Category</dt><dd>${escapeHtml(item.category)}</dd></div>
          <div><dt>Condition</dt><dd><span class="condition-badge condition-${escapeHtml(item.condition)}">${escapeHtml(item.condition)}</span></dd></div>
          <div><dt>Replacement</dt><dd class="value-cell">${formatCurrency(item.replacement_value * (item.quantity || 1))}</dd></div>
          ${item.requires_power ? `<div><dt>Power</dt><dd>${escapeHtml([item.power_adapter_voltage, item.power_adapter_current, item.power_adapter_polarity].filter(Boolean).join(' · ') || 'Required')}</dd></div>` : ''}
          ${item.purchase_date ? `<div><dt>Purchased</dt><dd>${formatDate(item.purchase_date)}</dd></div>` : ''}
          ${(item.instrument_details || []).map(detail => `<div><dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value === true ? 'Yes' : detail.value === false ? 'No' : detail.value)}</dd></div>`).join('')}
        </dl>

        ${item.description ? `<p class="scan-desc">${escapeHtml(item.description)}</p>` : ''}
        ${item.power_adapter_notes ? `<p class="scan-desc"><strong>Power notes:</strong> ${escapeHtml(item.power_adapter_notes)}</p>` : ''}

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
              <a href="${protectedFileUrl(m.relative_path)}" target="_blank" rel="noopener" class="scan-file-link">
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
              <a href="${protectedFileUrl(s.relative_path)}" download class="scan-file-link">
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
