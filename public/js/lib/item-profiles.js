import { escapeHtml } from '../utils.js';

export function findItemProfile(profiles, profileId) {
  return (profiles || []).find(profile => profile.id === profileId) || null;
}

export function renderProfileOptions(profiles, selectedId = '') {
  const groups = new Map();
  for (const profile of profiles || []) {
    if (!groups.has(profile.group)) groups.set(profile.group, []);
    groups.get(profile.group).push(profile);
  }
  return [...groups.entries()].map(([group, entries]) => `
    <optgroup label="${escapeHtml(group)}">
      ${entries.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedId ? 'selected' : ''}>${escapeHtml(profile.label)}</option>`).join('')}
    </optgroup>
  `).join('');
}

function fieldValue(specs, key) {
  return Object.prototype.hasOwnProperty.call(specs || {}, key) ? specs[key] : '';
}

function renderField(definition, value) {
  const id = `instrument-spec-${definition.key}`;
  const common = `id="${id}" data-instrument-spec="${escapeHtml(definition.key)}" data-spec-type="${escapeHtml(definition.type)}"`;
  if (definition.type === 'boolean') {
    return `
      <div class="form-group profile-spec-field">
        <label>${escapeHtml(definition.label)}</label>
        <label class="toggle-label">
          <input type="checkbox" ${common} ${value === true ? 'checked' : ''}>
          <span>Yes</span>
        </label>
      </div>`;
  }
  if (definition.type === 'select') {
    return `
      <div class="form-group profile-spec-field">
        <label for="${id}">${escapeHtml(definition.label)}</label>
        <select ${common}>
          <option value="">Select...</option>
          ${(definition.options || []).map(option => `<option value="${escapeHtml(option)}" ${String(value) === String(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
      </div>`;
  }
  if (definition.type === 'textarea') {
    return `
      <div class="form-group profile-spec-field full-width">
        <label for="${id}">${escapeHtml(definition.label)}</label>
        <textarea ${common} placeholder="${escapeHtml(definition.placeholder || '')}">${escapeHtml(value)}</textarea>
      </div>`;
  }
  const numberAttrs = definition.type === 'number'
    ? `type="number" min="${definition.min ?? 0}" max="${definition.max ?? 99999}" step="${definition.step ?? 'any'}"`
    : 'type="text"';
  return `
    <div class="form-group profile-spec-field">
      <label for="${id}">${escapeHtml(definition.label)}</label>
      <input ${numberAttrs} ${common} value="${escapeHtml(value)}" placeholder="${escapeHtml(definition.placeholder || '')}">
    </div>`;
}

export function renderProfileEditor(profile, specs = {}) {
  if (!profile) {
    return `
      <p class="text-muted-sm profile-empty-message">
        Select an item profile to show the details and related parts that are useful for that kind of instrument or studio equipment.
      </p>`;
  }
  return `
    <div class="profile-editor-heading">
      <div>
        <h3 class="section-title">${escapeHtml(profile.label)} details</h3>
        <p class="text-muted-sm">These fields are stored with this item and can be expanded without changing the rest of your inventory.</p>
      </div>
      <span class="profile-category-badge">${escapeHtml(profile.category)}</span>
    </div>
    <div class="profile-fields-grid">
      ${(profile.fields || []).map(definition => renderField(definition, fieldValue(specs, definition.key))).join('')}
    </div>
    ${(profile.suggestedAccessories || []).length ? `
      <div class="profile-suggestions-preview">
        <strong>Common related records</strong>
        <p class="text-muted-sm">After saving, these can be added as separately priced accessories or sub-items.</p>
        <div class="profile-suggestion-chips">
          ${profile.suggestedAccessories.map(entry => `<span>${escapeHtml(entry.name)}${entry.optional ? ' (optional)' : ''}</span>`).join('')}
        </div>
      </div>` : ''}
  `;
}

export function collectProfileSpecs(root = document) {
  const specs = {};
  root.querySelectorAll('[data-instrument-spec]').forEach(input => {
    const key = input.dataset.instrumentSpec;
    if (!key) return;
    if (input.dataset.specType === 'boolean') {
      specs[key] = !!input.checked;
    } else if (input.value !== '') {
      specs[key] = input.dataset.specType === 'number' ? Number(input.value) : input.value;
    }
  });
  return specs;
}

function displayValue(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value ?? '');
}

export function renderProfileDetailsCard(item, profiles) {
  const profile = findItemProfile(profiles, item.instrument_type);
  if (!profile) return '';
  const specs = item.instrument_specs || {};
  const rows = (profile.fields || [])
    .filter(definition => Object.prototype.hasOwnProperty.call(specs, definition.key) && specs[definition.key] !== '')
    .map(definition => `
      <div class="detail-field">
        <div class="field-label">${escapeHtml(definition.label)}</div>
        <div class="field-value">${escapeHtml(displayValue(specs[definition.key])) || '—'}</div>
      </div>`)
    .join('');
  return `
    <div class="card instrument-profile-card">
      <div class="card-header">
        <h3 class="section-title">${escapeHtml(profile.label)} specifications</h3>
        <span class="profile-category-badge">${escapeHtml(profile.group)}</span>
      </div>
      ${rows ? `<div class="detail-grid">${rows}</div>` : '<p class="text-muted-sm">No type-specific specifications recorded yet.</p>'}
    </div>`;
}

export function renderAccessoryRecommendations(item, profiles) {
  const profile = findItemProfile(profiles, item.instrument_type);
  const suggestions = profile?.suggestedAccessories || [];
  if (!suggestions.length) return '';
  const children = item.accessories || [];
  return `
    <div class="card recommended-accessories-card">
      <div class="card-header">
        <div>
          <h3 class="section-title">Suggested parts &amp; accessories</h3>
          <p class="text-muted-sm">Add only what you actually own. Every part gets its own cost, receipt, compatibility notes, and sub-items.</p>
        </div>
      </div>
      <div class="recommended-accessory-grid">
        ${suggestions.map((entry, index) => {
          const matches = children.filter(child => child.instrument_type === entry.instrument_type
            && (child.name || '').toLowerCase().includes(entry.name.toLowerCase().split(' / ')[0]));
          return `
            <div class="recommended-accessory-item">
              <div>
                <strong>${escapeHtml(entry.name)}</strong>
                <span class="text-muted-sm">${escapeHtml(entry.category)}${entry.optional ? ' · optional' : ''}${matches.length ? ` · ${matches.length} recorded` : ''}</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" data-action="add-recommended-accessory" data-suggestion-index="${index}">Add</button>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}
