import { escapeHtml, fileUrl } from '../utils.js';
import { STUDIO_STATUS_LABELS } from '../lib/completeness-ui.js';

export function renderFloorplanTab(floorplans, locations, items, selectedId = null) {
  const locs = [...new Set([
    ...locations,
    ...floorplans.map(f => f.location),
    ...items.map(i => i.location).filter(Boolean)
  ])].filter(Boolean).sort();

  const active = selectedId
    ? floorplans.find(f => String(f.id) === String(selectedId))
    : floorplans[0];

  return `
    <div class="floorplan-toolbar">
      <div class="form-group">
        <label for="floorplan-select">Room / Location</label>
        <select id="floorplan-select">
          <option value="">— Select location —</option>
          ${locs.map(loc => {
            const fp = floorplans.find(f => f.location === loc);
            const selected = active && (fp ? fp.id === active.id : active.location === loc && !fp);
            return `<option value="${fp ? fp.id : `loc:${encodeURIComponent(loc)}`}" ${selected ? 'selected' : ''}>${escapeHtml(loc)}${fp ? '' : ' (new)'}</option>`;
          }).join('')}
        </select>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="floorplan-create">Create for Location</button>
    </div>

    <div id="floorplan-panel">
      ${active ? renderFloorplanEditor(active, items) : renderFloorplanEmpty(locs)}
    </div>
  `;
}

function renderFloorplanEmpty(locs) {
  return `
    <div class="empty-state">
      <h3>No floorplan yet</h3>
      <p>Pick a location above and create a floorplan, then upload a photo of the room.</p>
      ${locs.length ? `<p class="text-muted-sm">Locations in your inventory: ${locs.map(escapeHtml).join(', ')}</p>` : ''}
    </div>
  `;
}

function renderFloorplanEditor(fp, allItems) {
  const roomItems = allItems.filter(i => i.location === fp.location && !i.parent_item_id);
  const placedIds = new Set((fp.items || []).map(i => i.id));
  const unplaced = roomItems.filter(i => !placedIds.has(i.id));

  return `
    <div class="card floorplan-editor" data-floorplan-id="${fp.id}" data-location="${escapeHtml(fp.location)}">
      <div class="card-header">
        <div>
          <h3 class="section-title">${escapeHtml(fp.location)}</h3>
          <p class="text-muted-sm">Drag pins on the photo · only gear in this location</p>
        </div>
        <div class="btn-group">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer">
            ${fp.image_path ? 'Replace Photo' : 'Upload Room Photo'}
            <input type="file" id="floorplan-image-input" accept="image/*" hidden>
          </label>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-floorplan" data-id="${fp.id}">Delete</button>
        </div>
      </div>

      ${fp.image_path ? `
        <div class="floorplan-canvas" id="floorplan-canvas">
          <img src="${fileUrl(fp.image_path)}" alt="Room floorplan" class="floorplan-bg" draggable="false">
          ${(fp.items || []).map(pin => `
            <button type="button" class="floorplan-pin" data-item-id="${pin.id}"
              style="left:${pin.x_pct}%;top:${pin.y_pct}%"
              title="${escapeHtml(pin.name)}">
              <span class="floorplan-pin-dot"></span>
              <span class="floorplan-pin-label">${escapeHtml(pin.name)}</span>
            </button>
          `).join('')}
        </div>
        <p class="text-muted-sm floorplan-save-hint" id="floorplan-save-status">Drag pins to reposition — saves automatically</p>
      ` : `
        <div class="floorplan-no-image">
          <p class="text-muted">Upload a photo of <strong>${escapeHtml(fp.location)}</strong> — sketch, wide shot, or floor diagram all work.</p>
        </div>
      `}

      ${unplaced.length ? `
        <div class="floorplan-palette">
          <h4 class="subsection-title">Place on map</h4>
          <div class="floorplan-palette-items">
            ${unplaced.map(it => `
              <button type="button" class="btn btn-secondary btn-sm" data-action="floorplan-add" data-id="${it.id}">
                + ${escapeHtml(it.name)}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${(fp.items || []).length ? `
        <ul class="floorplan-legend">
          ${fp.items.map(pin => `
            <li>
              <button type="button" class="btn btn-ghost btn-sm" data-action="view-item" data-id="${pin.id}">
                ${escapeHtml(pin.name)}
              </button>
              ${pin.studio_status && pin.studio_status !== 'in_studio'
                ? `<span class="text-muted-sm"> · ${STUDIO_STATUS_LABELS[pin.studio_status] || pin.studio_status}</span>` : ''}
              <button type="button" class="btn btn-ghost btn-sm" data-action="floorplan-remove" data-id="${pin.id}">×</button>
            </li>
          `).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

export function collectFloorplanPins(floorplanId) {
  const canvas = document.querySelector(`.floorplan-editor[data-floorplan-id="${floorplanId}"] #floorplan-canvas`);
  if (!canvas) return [];
  return [...canvas.querySelectorAll('.floorplan-pin')].map(pin => ({
    item_id: Number(pin.dataset.itemId),
    x_pct: parseFloat(pin.style.left) || 50,
    y_pct: parseFloat(pin.style.top) || 50
  }));
}