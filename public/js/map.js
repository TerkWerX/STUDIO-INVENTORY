import { api } from './api.js';
import { escapeHtml, mapMarkerLogoHtml } from './utils.js';
import {
  polygonClosed, polygonPointsAttr, polygonOutlinePointsAttr, applyRoomDisplay,
  pinPositionLabel, edgeCount, floorTextureSvgMarkup, floorImageViewFromFp
} from './lib/floorplan-geometry.js';
import { fileUrl } from './utils.js';
import { openWallElevation } from './lib/wall-elevation.js';
import { openWallPhotoEditor } from './lib/wall-photo-editor.js';

const root = document.getElementById('map-root');
const select = document.getElementById('map-floorplan-select');
const roomLabel = document.getElementById('map-room-label');
const sheet = document.getElementById('map-item-sheet');
const sheetBody = document.getElementById('map-item-sheet-body');

let floorplans = [];
let activeFp = null;
let placeItem = null;
let highlightItemId = null;
let pendingWallEdge = null;

function showToast(msg) {
  roomLabel.textContent = msg;
  setTimeout(() => {
    if (activeFp) roomLabel.textContent = activeFp.location;
  }, 2500);
}

function buildPinPayload(fp) {
  return (fp?.items || []).map(p => ({
    item_id: p.id,
    x_pct: p.x_pct,
    y_pct: p.y_pct,
    placement: p.placement || 'floor',
    wall_edge: p.wall_edge,
    wall_t: p.wall_t,
    height_ft: p.height_ft,
    icon_mode: p.icon_mode,
    wall_photo_path: p.wall_photo_path,
    photo_width_ft: p.photo_width_ft,
    photo_height_ft: p.photo_height_ft,
    rotation_deg: p.rotation_deg || 0,
    wall_display: p.wall_display !== false
  }));
}

async function mergePinUpdates(fpId, updates) {
  const fp = floorplans.find(f => f.id === fpId) || activeFp;
  const pins = buildPinPayload(fp);
  for (const u of updates) {
    const row = pins.find(p => p.item_id === u.item_id);
    if (row) Object.assign(row, u);
    else pins.push({ item_id: u.item_id, x_pct: 50, y_pct: 50, ...u });
  }
  const updated = await api.setFloorplanItems(fpId, pins);
  const idx = floorplans.findIndex(f => f.id === fpId);
  if (idx >= 0) floorplans[idx] = updated;
  activeFp = updated;
  return updated;
}

async function openPhotoHangForPin(fp, pin) {
  const item = await api.item(pin.id);
  openWallPhotoEditor({
    item,
    pin,
    unit: fp.unit || 'ft',
    onSave: async (patch) => {
      const pins = buildPinPayload(fp);
      const row = pins.find(p => p.item_id === pin.id);
      if (row) Object.assign(row, { placement: 'wall', wall_display: true, ...patch });
      else pins.push({ item_id: pin.id, placement: 'wall', wall_display: true, ...patch });
      const updated = await api.setFloorplanItems(fp.id, pins);
      await api.saveWallCutout(pin.id, patch).catch(() => {});
      const idx = floorplans.findIndex(f => f.id === fp.id);
      if (idx >= 0) floorplans[idx] = updated;
      activeFp = updated;
      renderFloorplan(activeFp.id);
      showToast('Wall photo hang updated');
    },
    onToast: showToast
  });
}

function openWallForPlacement(edge) {
  if (!activeFp || !placeItem) return;
  openWallElevation({
    fp: activeFp,
    wallEdge: edge,
    items: activeFp.items || [],
    pendingItem: placeItem,
    onUploadWallPhoto: (file) => api.uploadWallBackground(activeFp.id, edge, file),
    onSaveWallCalibration: (data) => api.setWallBackgroundCalibration(activeFp.id, edge, data),
    onSave: async (updates) => {
      await mergePinUpdates(activeFp.id, updates.map(u => ({
        ...u,
        placement: 'wall',
        wall_edge: edge
      })));
      placeItem = null;
      pendingWallEdge = null;
      history.replaceState(null, '', `/map.html?fp=${activeFp.id}`);
      renderFloorplan(activeFp.id);
      showToast('Item placed on wall');
    },
    onPhotoEdit: (pin) => openPhotoHangForPin(activeFp, pin),
    onToast: showToast
  });
}

async function init() {
  try {
    floorplans = await api.floorplans();
  } catch (err) {
    root.innerHTML = `<p class="text-muted">${escapeHtml(err.message)}</p>`;
    return;
  }

  if (!floorplans.length) {
    root.innerHTML = '<p class="text-muted">No room maps yet — set up a room in Studio Setup.</p>';
    return;
  }

  const params = new URLSearchParams(location.search);
  const fpParam = params.get('fp');
  const placeParam = params.get('place');
  const wallParam = params.get('wall');
  highlightItemId = params.get('item') ? Number(params.get('item')) : null;

  if (placeParam) {
    try {
      placeItem = await api.item(Number(placeParam));
    } catch {
      showToast('Could not load item for placement');
    }
  }
  if (wallParam != null) pendingWallEdge = Number(wallParam);

  select.innerHTML = floorplans.map(fp => `
    <option value="${fp.id}">${escapeHtml(fp.location)}</option>
  `).join('');

  select.addEventListener('change', () => {
    placeItem = null;
    pendingWallEdge = null;
    highlightItemId = null;
    history.replaceState(null, '', `/map.html?fp=${select.value}`);
    renderFloorplan(Number(select.value));
  });

  const initial = fpParam ? floorplans.find(f => String(f.id) === fpParam) : floorplans[0];
  select.value = String(initial?.id || floorplans[0].id);
  renderFloorplan(Number(select.value));
}

function renderFloorplan(id) {
  activeFp = floorplans.find(f => f.id === id) || floorplans[0];
  if (!activeFp) return;
  roomLabel.textContent = activeFp.location;

  const verts = activeFp.polygon || [];
  const closed = polygonClosed(verts);

  if (!closed) {
    root.innerHTML = '<p class="text-muted">This room is not drawn yet. Finish the outline in Studio Setup.</p>';
    return;
  }

  const hasMeasure = activeFp.bounds_width > 0 && activeFp.bounds_depth > 0;
  const placing = Boolean(placeItem);

  root.innerHTML = `
    ${placing ? `
      <div class="map-place-banner card">
        <p><strong>Placing:</strong> ${escapeHtml(placeItem.name)}</p>
        <p class="text-muted-sm">Tap a wall below to hang at true height on the wall photo, or drag the marker on the floor plan.</p>
        <button type="button" class="btn btn-ghost btn-sm" id="map-place-cancel">Cancel</button>
      </div>
    ` : ''}
    <div class="map-tablet-canvas ${hasMeasure ? 'floorplan-svg-scaled' : ''}" id="map-canvas">
      <svg viewBox="0 0 100 100" preserveAspectRatio="${hasMeasure ? 'xMidYMid meet' : 'none'}"
        class="floorplan-svg ${activeFp.image_path ? 'has-floor-image' : ''}" xmlns="http://www.w3.org/2000/svg">
        <rect class="floorplan-grid-bg" x="0" y="0" width="100" height="100"/>
        ${floorTextureSvgMarkup(activeFp.id, activeFp.image_path ? fileUrl(activeFp.image_path) : '', verts, closed, floorImageViewFromFp(activeFp))}
        <polygon class="floorplan-room-fill" points="${polygonPointsAttr(verts)}"/>
        <polyline class="floorplan-room-outline" points="${polygonOutlinePointsAttr(verts, closed)}"/>
      </svg>
      <div class="map-tablet-pin-layer">
        ${(activeFp.items || []).filter(p => p.placement !== 'wall').map(pin => `
          <button type="button" class="map-tablet-pin floorplan-pin-logo ${highlightItemId && pin.id === highlightItemId ? 'map-pin-highlight' : ''}"
            data-item-id="${pin.id}" style="left:${pin.x_pct}%;top:${pin.y_pct}%"
            title="${escapeHtml(pin.name)}">
            ${mapMarkerLogoHtml(pin)}
          </button>
        `).join('')}
        ${placing ? `
          <button type="button" class="map-tablet-pin map-place-pin floorplan-pin-logo" id="map-place-pin"
            style="left:50%;top:50%" title="${escapeHtml(placeItem.name)}">
            ${mapMarkerLogoHtml(placeItem)}
          </button>
        ` : ''}
      </div>
    </div>
    <div class="map-wall-buttons">
      ${[...Array(edgeCount(verts))].map((_, i) => `
        <button type="button" class="btn ${placing ? 'btn-primary' : 'btn-secondary'} btn-sm" data-wall="${i}">
          Wall ${i + 1}${placing ? ' — hang here' : ''}
        </button>
      `).join('')}
    </div>
  `;

  applyRoomDisplay(document.getElementById('map-canvas'), activeFp.bounds_width, activeFp.bounds_depth);

  document.getElementById('map-place-cancel')?.addEventListener('click', () => {
    placeItem = null;
    pendingWallEdge = null;
    history.replaceState(null, '', `/map.html?fp=${activeFp.id}`);
    renderFloorplan(activeFp.id);
  });

  if (placing) {
    bindPlacePinDrag();
    if (pendingWallEdge != null && !Number.isNaN(pendingWallEdge)) {
      openWallForPlacement(pendingWallEdge);
    }
  }

  root.querySelectorAll('.map-tablet-pin:not(.map-place-pin)').forEach(btn => {
    btn.addEventListener('click', () => {
      const pin = (activeFp.items || []).find(p => String(p.id) === btn.dataset.itemId);
      if (!pin) return;
      sheetBody.innerHTML = `
        <h2 class="map-sheet-name">${escapeHtml(pin.name)}</h2>
        <p class="text-muted-sm">${escapeHtml(pin.brand || '')}${pin.model ? ` · ${escapeHtml(pin.model)}` : ''}</p>
        <p class="text-muted-sm">${escapeHtml(pinPositionLabel(pin, activeFp))}</p>
        <a href="/?view=item-detail&id=${pin.id}" class="btn btn-primary btn-sm" style="margin-top:0.75rem">Open item</a>
      `;
      sheet.classList.remove('hidden');
    });
  });

  if (highlightItemId && !placing) {
    const hi = root.querySelector(`.map-tablet-pin[data-item-id="${highlightItemId}"]`);
    hi?.classList.add('map-pin-highlight');
    hi?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  root.querySelectorAll('[data-wall]').forEach(btn => {
    btn.addEventListener('click', () => {
      const edge = Number(btn.dataset.wall);
      if (placing) {
        openWallForPlacement(edge);
        return;
      }
      openWallElevation({
        browseMode: true,
        fp: activeFp,
        wallEdge: edge,
        items: activeFp.items || [],
        fetchItem: (id) => api.item(id),
        onPhotoEdit: (pin) => openPhotoHangForPin(activeFp, pin)
      });
    });
  });
}

function bindPlacePinDrag() {
  const pin = document.getElementById('map-place-pin');
  const canvas = document.getElementById('map-canvas');
  if (!pin || !canvas || !placeItem) return;

  pin.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pin.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const y = ((ev.clientY - rect.top) / rect.height) * 100;
      pin.style.left = `${Math.min(97, Math.max(3, x))}%`;
      pin.style.top = `${Math.min(97, Math.max(3, y))}%`;
    };
    const onUp = async () => {
      pin.removeEventListener('pointermove', onMove);
      pin.removeEventListener('pointerup', onUp);
      const x_pct = parseFloat(pin.style.left) || 50;
      const y_pct = parseFloat(pin.style.top) || 50;
      try {
        await mergePinUpdates(activeFp.id, [{
          item_id: placeItem.id,
          x_pct,
          y_pct,
          placement: 'floor'
        }]);
        placeItem = null;
        pendingWallEdge = null;
        history.replaceState(null, '', `/map.html?fp=${activeFp.id}`);
        renderFloorplan(activeFp.id);
        showToast('Item placed on floor');
      } catch (err) {
        showToast(err.message);
      }
    };
    pin.addEventListener('pointermove', onMove);
    pin.addEventListener('pointerup', onUp);
  });
}

init();
