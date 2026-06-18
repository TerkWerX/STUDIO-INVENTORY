import {
  formatCurrency, formatDate, escapeHtml, fileUrl, brandLogoHtml, isDriverCategory,
  buildDriverSearchUrl, buildValueEstimateUrl, openLightbox
} from '../utils.js';

export function renderInventory(items, meta, filters) {
  const f = filters || {};
  return `
    <h2 class="page-title">Inventory</h2>
    <p class="page-subtitle">${items.length} item${items.length !== 1 ? 's' : ''} found</p>

    <div class="toolbar">
      <div class="form-group search-box">
        <label for="search-input">Search</label>
        <input type="search" id="search-input" placeholder="Search name, brand, serial, tags..." value="${escapeHtml(f.q || '')}" autofocus>
      </div>
      <div class="filter-group">
        <div class="form-group">
          <label for="filter-category">Category</label>
          <select id="filter-category">
            <option value="">All Categories</option>
            ${meta.categories.map(c => `<option value="${escapeHtml(c)}" ${f.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="filter-location">Location</label>
          <select id="filter-location">
            <option value="">All Locations</option>
            ${meta.locations.map(l => `<option value="${escapeHtml(l)}" ${f.location === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="filter-condition">Condition</label>
          <select id="filter-condition">
            <option value="">All Conditions</option>
            ${meta.conditions.map(c => `<option value="${c}" ${f.condition === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="filter-tag">Tag</label>
          <select id="filter-tag">
            <option value="">All Tags</option>
            ${meta.tags.map(t => `<option value="${escapeHtml(t.name)}" ${f.tag === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="filter-min-value">Min Value</label>
          <input type="number" id="filter-min-value" min="0" placeholder="$0" value="${f.min_value || ''}" style="min-width:120px">
        </div>
        <div class="form-group">
          <label for="filter-max-value">Max Value</label>
          <input type="number" id="filter-max-value" min="0" placeholder="Any" value="${f.max_value || ''}" style="min-width:120px">
        </div>
        <div class="form-group">
          <label for="filter-sort">Sort</label>
          <select id="filter-sort">
            <option value="name" ${f.sort === 'name' ? 'selected' : ''}>Name A–Z</option>
            <option value="name_desc" ${f.sort === 'name_desc' ? 'selected' : ''}>Name Z–A</option>
            <option value="value" ${f.sort === 'value' ? 'selected' : ''}>Value High–Low</option>
            <option value="value_asc" ${f.sort === 'value_asc' ? 'selected' : ''}>Value Low–High</option>
            <option value="purchase_date" ${f.sort === 'purchase_date' ? 'selected' : ''}>Purchase Date</option>
            <option value="category" ${f.sort === 'category' ? 'selected' : ''}>Category</option>
            <option value="location" ${f.sort === 'location' ? 'selected' : ''}>Location</option>
          </select>
        </div>
        <button type="button" class="btn btn-secondary" id="clear-filters">Clear</button>
      </div>
    </div>

    ${items.length === 0 ? `
      <div class="empty-state">
        <h3>No items found</h3>
        <p>Try adjusting your search or add a new item.</p>
        <button type="button" class="btn btn-primary" data-nav="item-form" style="margin-top:1rem">Add Item</button>
      </div>
    ` : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Category</th><th>Brand / Model</th><th>Location</th><th>Condition</th><th>Qty</th><th>Replacement</th></tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr data-action="view-item" data-id="${item.id}">
                <td><strong>${escapeHtml(item.name)}</strong>${item.common_name ? `<br><span class="text-muted-sm">${escapeHtml(item.common_name)}</span>` : ''}</td>
                <td><span class="category-pill">${escapeHtml(item.category)}</span></td>
                <td>${escapeHtml(item.brand)}${item.model ? ' / ' + escapeHtml(item.model) : ''}</td>
                <td>${escapeHtml(item.location)}</td>
                <td><span class="condition-badge condition-${item.condition}">${item.condition}</span></td>
                <td>${item.quantity}</td>
                <td class="value-cell">${formatCurrency(item.replacement_value * item.quantity)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

export function renderItemDetail(item) {
  const photos = item.photos || [];
  const manuals = item.manuals || [];
  const software = item.software || [];
  const showDriverSection = isDriverCategory(item.category) || software.length > 0;

  const brandDisplay = item.brand
    ? brandLogoHtml({ name: item.brand, logo_path: item.brand_logo_path }, 'item-brand-logo', { large: true })
    : '';

  return `
    <div class="detail-header">
      <div>
        <h2 class="page-title" style="margin:0">${escapeHtml(item.name)}</h2>
        ${item.common_name ? `<p class="page-subtitle" style="margin:0.25rem 0 0">${escapeHtml(item.common_name)}</p>` : ''}
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-secondary" data-nav="inventory">Back</button>
        <button type="button" class="btn btn-ghost" data-action="print-label" data-id="${item.id}">Print Owner Label</button>
        <button type="button" class="btn btn-accent" data-action="auto-estimate" data-brand="${escapeHtml(item.brand)}" data-model="${escapeHtml(item.model)}" data-name="${escapeHtml(item.name)}">Auto-Estimate Value</button>
        <button type="button" class="btn btn-primary" data-action="edit-item" data-id="${item.id}">Edit</button>
        <button type="button" class="btn btn-danger" data-action="delete-item" data-id="${item.id}">Delete</button>
      </div>
    </div>

    ${item.brand ? `
    <div class="item-brand-hero" aria-label="Brand: ${escapeHtml(item.brand)}">
      <div class="item-brand-hero-logo">${brandDisplay}</div>
      <div class="item-brand-hero-info">
        <span class="item-brand-hero-label">Manufacturer</span>
        <strong class="item-brand-hero-name">${escapeHtml(item.brand)}</strong>
        ${item.model ? `<span class="item-brand-hero-model text-muted">${escapeHtml(item.model)}</span>` : ''}
      </div>
    </div>
    ` : ''}

    <div class="card photo-drop-zone" data-photo-drop-zone data-item-id="${item.id}">
      <div class="photo-drop-overlay" aria-hidden="true">
        <span class="photo-drop-overlay-icon">+</span>
        <span class="photo-drop-overlay-text">Drop photos to upload</span>
      </div>
      <div class="card-header">
        <h3 class="section-title">Photos</h3>
        <label class="btn btn-secondary" style="cursor:pointer">
          Add Photos<input type="file" accept="image/*" multiple data-action="upload-photos" data-id="${item.id}" hidden>
        </label>
      </div>
      <p class="photo-drop-hint text-muted-sm">Drag and drop images here, or use <strong>Add Photos</strong></p>
      ${photos.length ? `
        <div class="photo-gallery">
          ${photos.map((p, i) => `
            <button type="button" class="photo-thumb-btn" data-action="lightbox" data-index="${i}"
              data-url="${fileUrl(p.relative_path)}" data-name="${escapeHtml(p.original_name)}">
              <img src="${fileUrl(p.relative_path)}" alt="${escapeHtml(p.original_name)}" class="photo-thumb">
            </button>
          `).join('')}
        </div>
      ` : `<p class="text-muted photo-drop-empty">No photos yet. Drop images here or upload from all angles for insurance documentation.</p>`}
    </div>

    <div class="card">
      <div class="detail-grid">
        <div class="detail-field"><div class="field-label">Category</div><div class="field-value">${escapeHtml(item.category)}</div></div>
        <div class="detail-field"><div class="field-label">Brand</div><div class="field-value">${escapeHtml(item.brand)}</div></div>
        <div class="detail-field"><div class="field-label">Model</div><div class="field-value">${escapeHtml(item.model)}</div></div>
        <div class="detail-field"><div class="field-label">Serial Number</div><div class="field-value">${escapeHtml(item.serial_number) || '—'}</div></div>
        <div class="detail-field"><div class="field-label">Year</div><div class="field-value">${escapeHtml(item.year) || '—'}</div></div>
        <div class="detail-field"><div class="field-label">Location</div><div class="field-value">${escapeHtml(item.location)}</div></div>
        <div class="detail-field"><div class="field-label">Condition</div><div class="field-value"><span class="condition-badge condition-${item.condition}">${item.condition}</span></div></div>
        <div class="detail-field"><div class="field-label">Quantity</div><div class="field-value">${item.quantity}</div></div>
        <div class="detail-field"><div class="field-label">Purchase Date</div><div class="field-value">${formatDate(item.purchase_date)}</div></div>
        <div class="detail-field"><div class="field-label">Purchase Price</div><div class="field-value">${formatCurrency(item.purchase_price)}</div></div>
        <div class="detail-field"><div class="field-label">Replacement Value</div><div class="field-value value-cell">${formatCurrency(item.replacement_value)}</div></div>
        <div class="detail-field"><div class="field-label">Value Note</div><div class="field-value field-value-sm">${escapeHtml(item.replacement_value_note) || '—'}</div></div>
        <div class="detail-field"><div class="field-label">Update Checks</div><div class="field-value">${item.update_checks_enabled ? '<span class="status-on">Enabled</span>' : '<span class="status-off">Disabled</span>'}</div></div>
      </div>
      ${item.condition_notes ? `<div class="detail-field mt-1"><div class="field-label">Condition Notes</div><div class="field-value field-value-sm">${escapeHtml(item.condition_notes)}</div></div>` : ''}
      ${item.description ? `<div class="detail-field mt-1"><div class="field-label">Description</div><div class="field-value field-value-sm">${escapeHtml(item.description)}</div></div>` : ''}
      ${item.tags?.length ? `
        <div class="mt-1">
          <div class="field-label">Tags</div>
          <div class="tag-row">${item.tags.map(t => `<span class="tag-chip">${escapeHtml(t.name)}</span>`).join('')}</div>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="section-title">Manuals &amp; Documents</h3>
        <label class="btn btn-secondary" style="cursor:pointer">
          Upload Document<input type="file" accept=".pdf,application/pdf,.doc,.docx,.txt" data-action="upload-manual" data-id="${item.id}" hidden>
        </label>
      </div>
      ${manuals.length ? `
        <div class="doc-list">
          ${manuals.map(a => `
            <div class="doc-item">
              <span class="doc-icon">📄</span>
              <div class="doc-info">
                <strong>${escapeHtml(a.original_name)}</strong>
                ${a.description ? `<div class="text-muted-sm">${escapeHtml(a.description)}</div>` : ''}
              </div>
              <div class="btn-group">
                <a href="${fileUrl(a.relative_path)}" target="_blank" class="btn btn-sm btn-primary">Open</a>
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-attachment" data-id="${a.id}">Remove</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-muted">No manuals attached.</p>'}
    </div>

    ${showDriverSection ? `
    <div class="card software-card">
      <div class="card-header">
        <h3 class="section-title">Software &amp; Drivers Archive</h3>
        <div class="btn-group">
          ${item.update_checks_enabled ? `
            <button type="button" class="btn btn-accent" data-action="check-updates"
              data-brand="${escapeHtml(item.brand)}" data-model="${escapeHtml(item.model)}">Check for Updates</button>
          ` : `<span class="status-off" style="padding:0.5rem 1rem">Update checks disabled</span>`}
        </div>
      </div>
      <p class="text-muted" style="margin-bottom:1rem">Archive drivers, firmware, and control software. All versions are preserved for compatibility.</p>

      <form id="software-archive-form" class="software-form">
        <div class="form-grid">
          <div class="form-group full-width">
            <label for="sw-url">Download URL (from manufacturer)</label>
            <input type="url" id="sw-url" placeholder="https://manufacturer.com/support/driver.exe" required>
          </div>
          <div class="form-group">
            <label for="sw-version">Version</label>
            <input type="text" id="sw-version" placeholder="e.g. 5.2.1">
          </div>
          <div class="form-group">
            <label for="sw-desc">Description</label>
            <input type="text" id="sw-desc" placeholder="e.g. Windows driver v5.2">
          </div>
        </div>
        <div class="btn-group" style="margin-top:1rem">
          <button type="submit" class="btn btn-primary">Download &amp; Archive</button>
          <label class="btn btn-secondary" style="cursor:pointer">
            Upload File<input type="file" data-action="upload-software" data-id="${item.id}" hidden>
          </label>
        </div>
      </form>

      ${software.length ? `
        <div class="software-list" style="margin-top:1.5rem">
          <h4 class="subsection-title">Archived Files (${software.length})</h4>
          ${software.map(s => `
            <div class="software-item">
              <div class="software-meta">
                <strong>${escapeHtml(s.original_name)}</strong>
                ${s.version ? `<span class="version-badge">v${escapeHtml(s.version)}</span>` : ''}
                <div class="text-muted-sm">${escapeHtml(s.description) || 'No description'}</div>
                <div class="text-muted-sm">Archived ${formatDate(s.created_at?.split(' ')[0])}${s.source_url ? ` · <a href="${escapeHtml(s.source_url)}" target="_blank" rel="noopener">Source</a>` : ''}</div>
              </div>
              <div class="btn-group">
                <a href="${fileUrl(s.relative_path)}" download class="btn btn-sm btn-primary">Download</a>
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-attachment" data-id="${s.id}">Remove</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="text-muted" style="margin-top:1rem">No software archived yet.</p>'}
    </div>
    ` : ''}
  `;
}

export function filterImageFiles(fileList) {
  return [...fileList].filter(f => f.type.startsWith('image/'));
}

export function bindPhotoDropZone(container, item, { onUpload, onError }) {
  const zone = container.querySelector('[data-photo-drop-zone]');
  if (!zone) return;

  let dragDepth = 0;

  const hasFiles = (e) =>
    [...(e.dataTransfer?.types || [])].includes('Files');

  const setActive = (active) => {
    zone.classList.toggle('photo-drop-active', active);
  };

  zone.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    setActive(true);
  });

  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setActive(true);
  });

  zone.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setActive(false);
  });

  const blockFileDrag = (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
  };
  const blockFileDropOutside = (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files') && !zone.contains(e.target)) {
      e.preventDefault();
    }
  };
  document.addEventListener('dragover', blockFileDrag);
  document.addEventListener('drop', blockFileDropOutside);

  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    setActive(false);

    const files = filterImageFiles(e.dataTransfer?.files || []);
    if (!files.length) {
      onError?.('No image files detected — use JPG, PNG, WebP, etc.');
      return;
    }

    zone.classList.add('photo-drop-uploading');
    try {
      await onUpload(item.id, files);
    } catch (err) {
      onError?.(err.message);
    } finally {
      zone.classList.remove('photo-drop-uploading');
    }
  });
}

export function bindLightbox(photos) {
  const images = photos.map(p => ({ url: fileUrl(p.relative_path), name: p.original_name }));
  document.querySelectorAll('[data-action="lightbox"]').forEach(btn => {
    btn.addEventListener('click', () => openLightbox(images, parseInt(btn.dataset.index, 10)));
  });
}

export { buildDriverSearchUrl, buildValueEstimateUrl };