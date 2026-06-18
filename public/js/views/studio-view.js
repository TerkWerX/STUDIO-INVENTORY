import { escapeHtml, formatCurrency } from '../utils.js';
import { STUDIO_STATUS_LABELS } from '../lib/completeness-ui.js';

export function renderStudioView({ map, racks, chains, items }, tab = 'rooms') {
  const tabs = [
    { id: 'rooms', label: 'Rooms & Zones' },
    { id: 'racks', label: 'Racks' },
    { id: 'chains', label: 'Signal Chains' }
  ];

  return `
    <h2 class="page-title">Studio View</h2>
    <p class="page-subtitle">Where gear lives, rack layout, and signal flow — optimized for your studio map</p>

    <div class="studio-tabs btn-group" style="margin-bottom:1.5rem">
      ${tabs.map(t => `
        <button type="button" class="btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'}" data-studio-tab="${t.id}">${t.label}</button>
      `).join('')}
    </div>

    <div id="studio-tab-panel">
      ${tab === 'rooms' ? renderRoomsTab(map) : ''}
      ${tab === 'racks' ? renderRacksTab(racks, items) : ''}
      ${tab === 'chains' ? renderChainsTab(chains, items) : ''}
    </div>
  `;
}

function renderRoomsTab(map) {
  const zones = map?.zones || [];
  if (!zones.length) {
    return `<div class="empty-state"><h3>No locations yet</h3><p>Add items with a location to see your studio map.</p></div>`;
  }
  return `
    <div class="zone-grid">
      ${zones.map(z => `
        <div class="zone-card">
          <div class="zone-card-header">
            <h3>${escapeHtml(z.location || 'Unassigned')}</h3>
            <span class="zone-meta">${z.item_count} items · ${formatCurrency(z.total_value)}</span>
          </div>
          <ul class="zone-item-list">
            ${(z.items || []).map(it => `
              <li>
                <button type="button" class="zone-item-btn" data-action="view-item" data-id="${it.id}">
                  <strong>${escapeHtml(it.name)}</strong>
                  <span class="text-muted-sm">${escapeHtml(it.category)}${it.studio_status && it.studio_status !== 'in_studio' ? ` · ${STUDIO_STATUS_LABELS[it.studio_status] || it.studio_status}` : ''}</span>
                  <span class="zone-item-value">${formatCurrency(it.replacement_value)}</span>
                </button>
              </li>
            `).join('') || '<li class="text-muted">No items</li>'}
          </ul>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRacksTab(racks, items) {
  const itemOptions = items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
  return `
    <div class="card" style="margin-bottom:1.5rem">
      <h3 class="section-title">New Rack</h3>
      <form id="new-rack-form" class="form-grid">
        <div class="form-group"><label for="rack-name">Name</label><input id="rack-name" placeholder="e.g. Main Studio Rack" required></div>
        <div class="form-group"><label for="rack-location">Location</label><input id="rack-location" placeholder="e.g. Control Room"></div>
        <div class="form-group full-width"><label for="rack-notes">Notes</label><input id="rack-notes" placeholder="e.g. 12U Middle Atlantic"></div>
        <div class="form-group"><button type="submit" class="btn btn-primary">Create Rack</button></div>
      </form>
    </div>

    ${!(racks || []).length ? '<div class="empty-state"><h3>No racks defined</h3><p>Create a rack to map what lives where in your cabinet.</p></div>' : ''}

    ${(racks || []).map(rack => `
      <div class="card rack-card" data-rack-id="${rack.id}">
        <div class="card-header">
          <div>
            <h3 class="section-title">${escapeHtml(rack.name)}</h3>
            <p class="text-muted-sm">${escapeHtml(rack.location || '')}${rack.notes ? ` · ${escapeHtml(rack.notes)}` : ''}</p>
          </div>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-rack" data-id="${rack.id}">Delete</button>
        </div>
        <div class="rack-slots">
          ${(rack.items || []).length ? (rack.items || []).map((slot, idx) => `
            <div class="rack-slot" data-rack-item="${slot.id}">
              <span class="rack-slot-pos">${escapeHtml(slot.slot_label || `U${slot.position ?? idx + 1}`)}</span>
              <button type="button" class="rack-slot-name" data-action="view-item" data-id="${slot.id}">${escapeHtml(slot.name)}</button>
              <span class="text-muted-sm">${escapeHtml(slot.brand)} ${escapeHtml(slot.model)}</span>
              <button type="button" class="btn btn-sm btn-ghost" data-action="rack-remove-item" data-rack="${rack.id}" data-item="${slot.id}">×</button>
            </div>
          `).join('') : '<p class="text-muted">Empty rack — add gear below.</p>'}
        </div>
        <div class="rack-add-row">
          <select class="rack-add-select" data-rack="${rack.id}">
            <option value="">Add gear to rack…</option>
            ${itemOptions}
          </select>
          <input type="text" class="rack-slot-input" data-rack="${rack.id}" placeholder="Slot label (e.g. U4)">
          <button type="button" class="btn btn-secondary btn-sm" data-action="rack-add-item" data-rack="${rack.id}">Add</button>
        </div>
      </div>
    `).join('')}
  `;
}

function renderChainsTab(chains, items) {
  const itemOptions = items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
  return `
    <div class="card" style="margin-bottom:1.5rem">
      <h3 class="section-title">New Signal Chain</h3>
      <form id="new-chain-form" class="form-grid">
        <div class="form-group"><label for="chain-name">Name</label><input id="chain-name" placeholder="e.g. Vocal Chain" required></div>
        <div class="form-group full-width"><label for="chain-desc">Description</label><input id="chain-desc" placeholder="e.g. SM7B → Cloudlifter → 1176 → Apollo"></div>
        <div class="form-group"><button type="submit" class="btn btn-primary">Create Chain</button></div>
      </form>
    </div>

    ${!(chains || []).length ? '<div class="empty-state"><h3>No signal chains yet</h3><p>Map how audio flows through your studio.</p></div>' : ''}

    ${(chains || []).map(chain => `
      <div class="card chain-card" data-chain-id="${chain.id}">
        <div class="card-header">
          <div>
            <h3 class="section-title">${escapeHtml(chain.name)}</h3>
            ${chain.description ? `<p class="text-muted-sm">${escapeHtml(chain.description)}</p>` : ''}
          </div>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-chain" data-id="${chain.id}">Delete</button>
        </div>
        <div class="signal-flow">
          ${(chain.items || []).length ? (chain.items || []).map((step, idx) => `
            <div class="signal-step">
              <button type="button" class="signal-step-btn" data-action="view-item" data-id="${step.id}">
                <span class="signal-step-num">${idx + 1}</span>
                <strong>${escapeHtml(step.name)}</strong>
                <span class="text-muted-sm">${escapeHtml(step.brand)} ${escapeHtml(step.model)}</span>
              </button>
              ${idx < chain.items.length - 1 ? '<span class="signal-arrow" aria-hidden="true">→</span>' : ''}
              <button type="button" class="btn btn-sm btn-ghost signal-remove" data-action="chain-remove-item" data-chain="${chain.id}" data-item="${step.id}">×</button>
            </div>
          `).join('') : '<p class="text-muted">Empty chain — add gear in signal order.</p>'}
        </div>
        <div class="chain-add-row">
          <select class="chain-add-select" data-chain="${chain.id}">
            <option value="">Add next in chain…</option>
            ${itemOptions}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" data-action="chain-add-item" data-chain="${chain.id}">Add</button>
        </div>
      </div>
    `).join('')}
  `;
}

export function rackItemsPayload(rackId) {
  const slots = [...document.querySelectorAll(`.rack-card[data-rack-id="${rackId}"] .rack-slot`)];
  return slots.map((el, i) => ({
    item_id: Number(el.dataset.rackItem),
    position: i,
    slot_label: el.querySelector('.rack-slot-pos')?.textContent?.trim() || ''
  }));
}

export function chainItemsPayload(chainId) {
  const steps = [...document.querySelectorAll(`.chain-card[data-chain-id="${chainId}"] .signal-step`)];
  return steps.map((el, i) => ({
    item_id: Number(el.querySelector('.signal-step-btn')?.dataset.id || el.querySelector('[data-id]')?.dataset.id),
    position: i
  })).filter(r => r.item_id);
}