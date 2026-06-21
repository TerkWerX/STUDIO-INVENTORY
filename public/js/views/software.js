import { escapeHtml, formatCurrency, formatDate, fileUrl } from '../utils.js';

const LICENSE_LABELS = {
  perpetual: 'Perpetual',
  subscription: 'Subscription',
  educational: 'Educational',
  nfr: 'NFR',
  oem: 'OEM',
  rent_to_own: 'Rent-to-own'
};

const ACTIVATION_LABELS = {
  account: 'Account login',
  ilok: 'iLok USB',
  ilok_cloud: 'iLok Cloud',
  challenge: 'Challenge / response',
  machine: 'Machine authorization',
  usb_dongle: 'USB dongle',
  other: 'Other'
};

const FORMAT_LABELS = {
  vst3: 'VST3',
  au: 'AU',
  aax: 'AAX',
  standalone: 'Standalone',
  multiple: 'Multi-format',
  other: 'Other'
};

export function maskLicenseKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••••••';
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

function formatBadge(text, className = '') {
  return `<span class="sw-badge ${className}">${escapeHtml(text)}</span>`;
}

function screenshotBlock(sw, { large = false } = {}) {
  if (sw.screenshot_path) {
    return `<img class="sw-shot${large ? ' sw-shot-lg' : ''}" src="${fileUrl(sw.screenshot_path)}" alt="${escapeHtml(sw.name)} interface">`;
  }
  return `
    <div class="sw-shot-placeholder${large ? ' sw-shot-lg' : ''}" aria-hidden="true">
      <span class="sw-shot-icon">&#127925;</span>
      <span class="sw-shot-hint">${large ? 'No screenshot yet' : sw.publisher || sw.category}</span>
    </div>
  `;
}

export function renderSoftwareCatalog(licenses, filters = {}) {
  const totalValue = licenses.reduce((s, l) => s + (l.replacement_value || 0), 0);
  const categories = [...new Set(licenses.map(l => l.category).filter(Boolean))].sort();

  return `
    <h2 class="page-title">Software &amp; Plugins</h2>
    <p class="page-subtitle">Catalog your DAWs, VSTs, and licenses — with interface screenshots</p>

    <div class="sw-summary-grid">
      <div class="sw-summary-card">
        <span class="sw-summary-num">${licenses.length}</span>
        <span class="sw-summary-label">in catalog</span>
      </div>
      <div class="sw-summary-card sw-summary-value">
        <span class="sw-summary-num">${formatCurrency(totalValue)}</span>
        <span class="sw-summary-label">catalog value</span>
      </div>
      <div class="sw-summary-card">
        <button type="button" class="btn btn-primary" data-nav="software-form">+ Add Software</button>
      </div>
    </div>

    <div class="card sw-toolbar">
      <div class="sw-toolbar-row">
        <input type="search" id="sw-search" class="sw-search" placeholder="Search name, publisher, serial…"
          value="${escapeHtml(filters.q || '')}" autocomplete="off">
        <select id="sw-filter-category" class="sw-filter-select">
          <option value="">All categories</option>
          ${categories.map(c => `
            <option value="${escapeHtml(c)}" ${filters.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>
          `).join('')}
        </select>
        <select id="sw-filter-sort" class="sw-filter-select">
          <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>Name A–Z</option>
          <option value="publisher" ${filters.sort === 'publisher' ? 'selected' : ''}>Publisher</option>
          <option value="value" ${filters.sort === 'value' ? 'selected' : ''}>Highest value</option>
          <option value="recent" ${filters.sort === 'recent' ? 'selected' : ''}>Recently added</option>
          <option value="renewal" ${filters.sort === 'renewal' ? 'selected' : ''}>Renewal date</option>
        </select>
      </div>
    </div>

    ${licenses.length ? `
      <div class="sw-grid">
        ${licenses.map(sw => renderSoftwareCard(sw)).join('')}
      </div>
    ` : `
      <div class="card empty-state sw-empty">
        <h3>No software cataloged yet</h3>
        <p>Add your DAWs and plugins — snap a screenshot of the plugin UI so your catalog looks great on the big screen.</p>
        <button type="button" class="btn btn-primary" data-nav="software-form">Add Your First Plugin</button>
      </div>
    `}
  `;
}

export function renderSoftwareCard(sw) {
  const renewalWarn = sw.license_type === 'subscription' && sw.renewal_date
    ? (sw.renewal_overdue ? 'sw-card-overdue' : sw.renewal_soon ? 'sw-card-renewal' : '')
    : '';

  return `
    <button type="button" class="sw-card ${renewalWarn}" data-action="view-software" data-id="${sw.id}">
      <div class="sw-card-shot">
        ${screenshotBlock(sw)}
        ${sw.license_type === 'subscription' && sw.renewal_date ? `
          <span class="sw-card-renewal-pill ${sw.renewal_overdue ? 'sw-pill-overdue' : ''}">
            ${sw.renewal_overdue ? 'Overdue' : `Renews ${formatDate(sw.renewal_date)}`}
          </span>
        ` : ''}
      </div>
      <div class="sw-card-body">
        <div class="sw-card-badges">
          ${formatBadge(sw.category, 'sw-badge-cat')}
          ${formatBadge(FORMAT_LABELS[sw.plugin_format] || sw.plugin_format, 'sw-badge-format')}
        </div>
        <strong class="sw-card-name">${escapeHtml(sw.name)}</strong>
        <span class="sw-card-publisher">${escapeHtml(sw.publisher) || 'Unknown publisher'}</span>
        ${sw.version ? `<span class="text-muted-sm">v${escapeHtml(sw.version)}</span>` : ''}
        ${sw.replacement_value > 0 ? `<span class="sw-card-value">${formatCurrency(sw.replacement_value)}</span>` : ''}
      </div>
    </button>
  `;
}

export function renderSoftwareDetail(sw) {
  const hasKey = !!(sw.license_key || '').trim();

  return `
    <div class="sw-detail-header">
      <button type="button" class="btn btn-ghost btn-sm" data-nav="software">&larr; All Software</button>
      <div class="btn-group">
        <button type="button" class="btn btn-secondary btn-sm" data-action="edit-software" data-id="${sw.id}">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete-software" data-id="${sw.id}">Delete</button>
      </div>
    </div>

    <div class="sw-detail-hero card">
      <div class="sw-detail-shot-wrap">
        ${screenshotBlock(sw, { large: true })}
        <label class="btn btn-secondary btn-sm sw-shot-upload">
          ${sw.screenshot_path ? 'Replace Screenshot' : 'Add Screenshot'}
          <input type="file" accept="image/*" data-action="upload-sw-screenshot" data-id="${sw.id}" hidden>
        </label>
        ${sw.screenshot_path ? `
          <button type="button" class="btn btn-ghost btn-sm" data-action="remove-sw-screenshot" data-id="${sw.id}">Remove</button>
        ` : ''}
      </div>
      <div class="sw-detail-info">
        <div class="sw-detail-badges">
          ${formatBadge(sw.category, 'sw-badge-cat')}
          ${formatBadge(LICENSE_LABELS[sw.license_type] || sw.license_type, 'sw-badge-license')}
          ${formatBadge(FORMAT_LABELS[sw.plugin_format] || sw.plugin_format, 'sw-badge-format')}
          ${formatBadge(ACTIVATION_LABELS[sw.activation_method] || sw.activation_method, 'sw-badge-activation')}
        </div>
        <h2 class="sw-detail-title">${escapeHtml(sw.name)}</h2>
        <p class="sw-detail-publisher">${escapeHtml(sw.publisher)}${sw.version ? ` · v${escapeHtml(sw.version)}` : ''}</p>

        <dl class="detail-grid sw-detail-facts">
          <div class="detail-field">
            <div class="field-label">License key / serial</div>
            <div class="field-value sw-license-row">
              ${hasKey ? `
                <code class="sw-license-masked" data-key="${escapeHtml(sw.license_key)}">${escapeHtml(maskLicenseKey(sw.license_key))}</code>
                <button type="button" class="btn btn-ghost btn-sm" data-action="reveal-license">Show</button>
                <button type="button" class="btn btn-ghost btn-sm hidden" data-action="copy-license" data-key="${escapeHtml(sw.license_key)}">Copy</button>
              ` : '<span class="text-muted">Not recorded</span>'}
            </div>
          </div>
          <div class="detail-field">
            <div class="field-label">Seats / activations</div>
            <div class="field-value">${sw.seats || 1}</div>
          </div>
          ${sw.renewal_date ? `
          <div class="detail-field">
            <div class="field-label">Renewal date</div>
            <div class="field-value ${sw.renewal_overdue ? 'sw-overdue-text' : ''}">${formatDate(sw.renewal_date)}</div>
          </div>` : ''}
          <div class="detail-field">
            <div class="field-label">Purchase date</div>
            <div class="field-value">${formatDate(sw.purchase_date)}</div>
          </div>
          <div class="detail-field">
            <div class="field-label">Purchase price</div>
            <div class="field-value value-cell">${formatCurrency(sw.purchase_price)}</div>
          </div>
          <div class="detail-field">
            <div class="field-label">Current value</div>
            <div class="field-value value-cell">${formatCurrency(sw.replacement_value)}</div>
          </div>
        </dl>

        ${sw.host_item ? `
          <p class="sw-host-link">
            Linked hardware:
            <button type="button" class="btn btn-ghost btn-sm" data-action="view-item" data-id="${sw.host_item.id}">
              ${escapeHtml(sw.host_item.name)}
            </button>
          </p>
        ` : ''}

        ${sw.notes ? `<p class="sw-detail-notes">${escapeHtml(sw.notes)}</p>` : ''}
      </div>
    </div>
  `;
}

export function renderSoftwareForm(sw, meta) {
  const isEdit = !!sw;
  const data = sw || {
    name: '', publisher: '', version: '', category: 'Plugin',
    license_key: '', license_type: 'perpetual', activation_method: 'account',
    plugin_format: 'vst3', seats: 1, renewal_date: '', purchase_date: '',
    purchase_price: 0, replacement_value: 0, host_item_id: null, notes: ''
  };
  const cats = meta.softwareCategories || [];
  const licenseTypes = meta.licenseTypes || [];
  const activationMethods = meta.activationMethods || [];
  const formats = meta.pluginFormats || [];
  const hostItems = meta.hostItems || [];

  const opt = (list, val, labels = {}) => list.map(v => `
    <option value="${v}" ${data[v === data.license_type ? 'license_type' : v] === v || data.category === v || data.activation_method === v || data.plugin_format === v ? 'selected' : ''}>
      ${escapeHtml(labels[v] || v)}
    </option>
  `).join('');

  return `
    <h2 class="page-title">${isEdit ? 'Edit Software' : 'Add Software'}</h2>
    <p class="page-subtitle">Catalog a DAW, plugin, or utility — add a UI screenshot to make it pop</p>

    <form id="software-form" class="card">
      <input type="hidden" id="sw-id" value="${data.id || ''}">

      <div class="form-grid">
        <div class="form-group">
          <label for="sw-name">Name *</label>
          <input type="text" id="sw-name" required value="${escapeHtml(data.name)}" placeholder="e.g. FabFilter Pro-Q 3">
        </div>
        <div class="form-group">
          <label for="sw-publisher">Publisher</label>
          <input type="text" id="sw-publisher" value="${escapeHtml(data.publisher)}" placeholder="e.g. FabFilter">
        </div>
        <div class="form-group">
          <label for="sw-version">Version</label>
          <input type="text" id="sw-version" value="${escapeHtml(data.version)}" placeholder="e.g. 3.24">
        </div>
        <div class="form-group">
          <label for="sw-category">Category</label>
          <select id="sw-category">
            ${cats.map(c => `<option value="${escapeHtml(c)}" ${data.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="sw-format">Format</label>
          <select id="sw-format">
            ${formats.map(f => `<option value="${f}" ${data.plugin_format === f ? 'selected' : ''}>${escapeHtml(FORMAT_LABELS[f] || f)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="sw-license-type">License type</label>
          <select id="sw-license-type">
            ${licenseTypes.map(t => `<option value="${t}" ${data.license_type === t ? 'selected' : ''}>${escapeHtml(LICENSE_LABELS[t] || t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="sw-activation">Activation</label>
          <select id="sw-activation">
            ${activationMethods.map(m => `<option value="${m}" ${data.activation_method === m ? 'selected' : ''}>${escapeHtml(ACTIVATION_LABELS[m] || m)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="sw-seats">Seats / activations</label>
          <input type="number" id="sw-seats" min="1" max="99" value="${data.seats || 1}">
        </div>
        <div class="form-group full-width">
          <label for="sw-license-key">License key / serial</label>
          <input type="text" id="sw-license-key" value="${escapeHtml(data.license_key)}" placeholder="Paste serial or activation code" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="sw-purchase-date">Purchase date</label>
          <input type="date" id="sw-purchase-date" value="${escapeHtml(data.purchase_date || '')}">
        </div>
        <div class="form-group" id="sw-renewal-group">
          <label for="sw-renewal-date">Renewal date <span class="text-muted-sm">(subscriptions)</span></label>
          <input type="date" id="sw-renewal-date" value="${escapeHtml(data.renewal_date || '')}">
        </div>
        <div class="form-group">
          <label for="sw-purchase-price">Purchase price</label>
          <input type="number" id="sw-purchase-price" min="0" step="0.01" value="${data.purchase_price || 0}">
        </div>
        <div class="form-group">
          <label for="sw-replacement-value">Current value</label>
          <input type="number" id="sw-replacement-value" min="0" step="0.01" value="${data.replacement_value || 0}">
        </div>
        <div class="form-group">
          <label for="sw-host-item">Linked hardware <span class="text-muted-sm">(optional)</span></label>
          <select id="sw-host-item">
            <option value="">— None —</option>
            ${hostItems.map(it => `
              <option value="${it.id}" ${String(data.host_item_id) === String(it.id) ? 'selected' : ''}>
                ${escapeHtml(it.name)}${it.brand ? ` (${escapeHtml(it.brand)})` : ''}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="form-group full-width">
          <label for="sw-notes">Notes</label>
          <textarea id="sw-notes" rows="3" placeholder="Account email, iLok user ID, where installer lives…">${escapeHtml(data.notes)}</textarea>
        </div>
      </div>

      ${isEdit ? `
        <div class="sw-form-shot card" style="margin-top:1.25rem;padding:1rem">
          <h3 class="section-title">Interface Screenshot</h3>
          <p class="text-muted-sm">Snap the plugin window — makes your catalog easy to browse.</p>
          <div class="sw-form-shot-row">
            ${data.screenshot_path
              ? `<img class="sw-shot-preview" src="${fileUrl(data.screenshot_path)}" alt="">`
              : '<p class="text-muted">No screenshot yet</p>'}
            <label class="btn btn-secondary btn-sm">
              Upload Screenshot
              <input type="file" accept="image/*" id="sw-form-screenshot" hidden>
            </label>
          </div>
        </div>
      ` : `
        <p class="text-muted-sm" style="margin-top:1rem">After saving, open the entry to add an interface screenshot.</p>
      `}

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-action="cancel-software-form">${isEdit ? 'Cancel' : 'Back'}</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add to Catalog'}</button>
      </div>
    </form>
  `;
}

export function collectSoftwareFormData() {
  return {
    name: document.getElementById('sw-name')?.value,
    publisher: document.getElementById('sw-publisher')?.value,
    version: document.getElementById('sw-version')?.value,
    category: document.getElementById('sw-category')?.value,
    plugin_format: document.getElementById('sw-format')?.value,
    license_type: document.getElementById('sw-license-type')?.value,
    activation_method: document.getElementById('sw-activation')?.value,
    seats: document.getElementById('sw-seats')?.value,
    license_key: document.getElementById('sw-license-key')?.value,
    purchase_date: document.getElementById('sw-purchase-date')?.value,
    renewal_date: document.getElementById('sw-renewal-date')?.value,
    purchase_price: document.getElementById('sw-purchase-price')?.value,
    replacement_value: document.getElementById('sw-replacement-value')?.value,
    host_item_id: document.getElementById('sw-host-item')?.value || null,
    notes: document.getElementById('sw-notes')?.value
  };
}