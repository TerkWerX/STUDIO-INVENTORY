import { escapeHtml, DEFAULT_TAGS, buildValueEstimateUrl, brandLogoHtml } from '../utils.js';

export function renderItemForm(item, meta) {
  const isEdit = !!item;
  const data = item || {
    name: '', common_name: '', category: '', brand: '', model: '',
    serial_number: '', year: '', purchase_date: '', purchase_price: 0,
    replacement_value: 0, replacement_value_note: '', condition: 'Good',
    condition_notes: '', location: '', description: '', quantity: 1,
    update_checks_enabled: true, warranty_end_date: '', warranty_note: '', tags: []
  };
  const tagNames = (data.tags || []).map(t => typeof t === 'string' ? t : t.name);
  const checksOn = data.update_checks_enabled !== false && data.update_checks_enabled !== 0;

  return `
    <h2 class="page-title">${isEdit ? 'Edit Item' : 'Add New Item'}</h2>
    <p class="page-subtitle">${isEdit ? 'Update inventory record' : 'Enter details for physical studio gear'}</p>

    <form id="item-form" class="card">
      <input type="hidden" id="item-id" value="${data.id || ''}">

      <div class="form-grid">
        <div class="form-group">
          <label for="name">Name *</label>
          <input type="text" id="name" required value="${escapeHtml(data.name)}" placeholder="e.g. Fender Stratocaster">
        </div>
        <div class="form-group">
          <label for="common_name">Common Name</label>
          <input type="text" id="common_name" value="${escapeHtml(data.common_name)}" placeholder="e.g. Main Strat">
        </div>
        <div class="form-group">
          <label for="category">Category</label>
          <select id="category">
            <option value="">Select...</option>
            ${meta.categories.map(c => `<option value="${escapeHtml(c)}" ${data.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="brand">Brand</label>
          <div class="brand-input-row">
            <input type="text" id="brand" list="brand-suggest-list" value="${escapeHtml(data.brand)}" placeholder="Start typing to match brands...">
            <div id="brand-logo-preview" class="brand-logo-preview hidden"></div>
          </div>
          <datalist id="brand-suggest-list">
            ${(meta.brands || []).map(b => `<option value="${escapeHtml(b.name)}">`).join('')}
          </datalist>
        </div>
        <div class="form-group">
          <label for="model">Model</label>
          <input type="text" id="model" value="${escapeHtml(data.model)}">
        </div>
        <div class="form-group">
          <label for="serial_number">Serial Number</label>
          <input type="text" id="serial_number" value="${escapeHtml(data.serial_number)}">
        </div>
        <div class="form-group">
          <label for="year">Year / Manufacture Date</label>
          <input type="text" id="year" value="${escapeHtml(data.year)}" placeholder="e.g. 2021">
        </div>
        <div class="form-group">
          <label for="location">Location in Studio</label>
          <select id="location">
            <option value="">Select...</option>
            ${meta.locations.map(l => `<option value="${escapeHtml(l)}" ${data.location === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="condition">Condition</label>
          <select id="condition">
            ${meta.conditions.map(c => `<option value="${c}" ${data.condition === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="quantity">Quantity</label>
          <input type="number" id="quantity" min="1" max="9999" value="${data.quantity || 1}">
        </div>
        <div class="form-group">
          <label for="purchase_date">Purchase Date</label>
          <input type="date" id="purchase_date" value="${escapeHtml(data.purchase_date)}">
        </div>
        <div class="form-group">
          <label for="purchase_price">Purchase Price ($)</label>
          <input type="number" id="purchase_price" min="0" step="0.01" value="${data.purchase_price || 0}">
        </div>
        <div class="form-group">
          <label for="warranty_end_date">Warranty Ends</label>
          <input type="date" id="warranty_end_date" value="${escapeHtml(data.warranty_end_date || '')}">
          <p class="text-muted-sm" style="margin-top:0.35rem">Leave blank if unknown or expired/not applicable.</p>
        </div>
        <div class="form-group">
          <label for="warranty_note">Warranty Note</label>
          <input type="text" id="warranty_note" value="${escapeHtml(data.warranty_note || '')}" placeholder="e.g. Sweetwater 2-year, manufacturer 1-year">
        </div>
        <div class="form-group">
          <label for="replacement_value">Replacement Value ($)</label>
          <div style="display:flex;gap:0.5rem;align-items:stretch">
            <input type="number" id="replacement_value" min="0" step="0.01" value="${data.replacement_value || 0}" style="flex:1">
            <button type="button" class="btn btn-accent btn-sm" id="form-auto-estimate" style="min-height:var(--touch-min)">Auto-Estimate</button>
          </div>
        </div>
        <div class="form-group full-width">
          <label for="replacement_value_note">Replacement Value Note</label>
          <input type="text" id="replacement_value_note" value="${escapeHtml(data.replacement_value_note)}" placeholder="Source or estimation method (e.g. Reverb avg June 2026)">
        </div>
        <div class="form-group full-width">
          <label for="condition_notes">Condition Notes</label>
          <input type="text" id="condition_notes" value="${escapeHtml(data.condition_notes)}">
        </div>
        <div class="form-group full-width">
          <label for="description">Description / Notes</label>
          <textarea id="description">${escapeHtml(data.description)}</textarea>
        </div>
        <div class="form-group">
          <label>Driver/Software Update Checks</label>
          <label class="toggle-label">
            <input type="checkbox" id="update_checks_enabled" ${checksOn ? 'checked' : ''}>
            <span>Enable "Check for Updates" for this item</span>
          </label>
          <p class="text-muted-sm" style="margin-top:0.35rem">Disable for end-of-life or unsupported gear.</p>
        </div>
        <div class="form-group full-width">
          <label>Tags</label>
          <div class="tag-input-wrap" id="tag-container">
            ${tagNames.map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <button type="button" data-remove-tag>&times;</button></span>`).join('')}
            <input type="text" id="tag-input" placeholder="Add tag..." class="tag-inline-input">
          </div>
          <div class="tag-suggestions">
            ${[...DEFAULT_TAGS, ...meta.tags.map(t => t.name)].filter((v, i, a) => a.indexOf(v) === i).map(t =>
              `<button type="button" class="tag-suggestion" data-add-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
            ).join('')}
          </div>
        </div>
      </div>

      <div class="btn-group" style="margin-top:2rem">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Item'}</button>
        <button type="button" class="btn btn-secondary" data-nav="inventory">Cancel</button>
      </div>
    </form>
  `;
}

export function collectFormData() {
  const tags = [...document.querySelectorAll('#tag-container .tag-chip')].map(el => el.dataset.tag);
  return {
    name: document.getElementById('name').value,
    common_name: document.getElementById('common_name').value,
    category: document.getElementById('category').value,
    brand: document.getElementById('brand').value,
    model: document.getElementById('model').value,
    serial_number: document.getElementById('serial_number').value,
    year: document.getElementById('year').value,
    location: document.getElementById('location').value,
    condition: document.getElementById('condition').value,
    quantity: document.getElementById('quantity').value,
    purchase_date: document.getElementById('purchase_date').value,
    purchase_price: document.getElementById('purchase_price').value,
    warranty_end_date: document.getElementById('warranty_end_date').value,
    warranty_note: document.getElementById('warranty_note').value,
    replacement_value: document.getElementById('replacement_value').value,
    replacement_value_note: document.getElementById('replacement_value_note').value,
    condition_notes: document.getElementById('condition_notes').value,
    description: document.getElementById('description').value,
    update_checks_enabled: document.getElementById('update_checks_enabled').checked,
    tags
  };
}

export function bindBrandSuggest(brands = []) {
  const input = document.getElementById('brand');
  const preview = document.getElementById('brand-logo-preview');
  if (!input || !preview) return;

  const updatePreview = () => {
    const match = brands.find(b => b.name.toLowerCase() === input.value.trim().toLowerCase());
    if (match?.logo_path) {
      preview.innerHTML = brandLogoHtml(match, 'brand-logo-preview-img');
      preview.classList.remove('hidden');
    } else {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    }
  };

  input.addEventListener('input', updatePreview);
  input.addEventListener('change', updatePreview);
  updatePreview();
}

export function bindAutoEstimate() {
  document.getElementById('form-auto-estimate')?.addEventListener('click', async () => {
    const brand = document.getElementById('brand').value;
    const model = document.getElementById('model').value;
    const name = document.getElementById('name').value;
    window.open(buildValueEstimateUrl(brand, model, name), '_blank');
    const { showModal } = await import('../utils.js');
    const val = await showModal({
      title: 'Enter Replacement Value',
      message: 'After checking Reverb/eBay listings, enter the estimated replacement value:',
      confirmText: 'Apply Value',
      cancelText: 'Skip',
      prompt: true,
      promptValue: document.getElementById('replacement_value').value
    });
    if (val !== null && val !== false) {
      document.getElementById('replacement_value').value = val;
      const note = document.getElementById('replacement_value_note');
      if (!note.value) note.value = `Manual estimate from Reverb/eBay search (${new Date().toLocaleDateString()})`;
    }
  });
}