import { escapeHtml, mapMarkerLogoHtml, showChoiceModal, fileUrl } from '../utils.js';
import {
  polygonClosed, polygonPointsAttr, polygonOutlinePointsAttr, applyRoomDisplay,
  floorTextureSvgMarkup, floorImageViewFromFp, edgeCount, formatFeet, wallLengthFt
} from './floorplan-geometry.js';
import { openWallElevation } from './wall-elevation.js';
import { openWallPhotoEditor } from './wall-photo-editor.js';

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

async function mergePinUpdates(api, fp, updates) {
  const pins = buildPinPayload(fp);
  for (const u of updates) {
    const row = pins.find(p => p.item_id === u.item_id);
    if (row) Object.assign(row, u);
    else pins.push({ item_id: u.item_id, x_pct: 50, y_pct: 50, ...u });
  }
  return api.setFloorplanItems(fp.id, pins);
}

async function ensureFloorplan(api, item, floorplans) {
  let fp = (floorplans || []).find(f => f.location === item.location);
  if (!fp) {
    try {
      fp = await api.createFloorplan({ location: item.location });
    } catch {
      const all = await api.floorplans();
      fp = all.find(f => f.location === item.location);
    }
  }
  return fp;
}

function openFloorPlacementOverlay({ fp, item, onSave, onToast }) {
  const verts = fp.polygon || [];
  const closed = polygonClosed(verts);
  if (!closed) {
    onToast?.('Room outline not finished — complete it in Studio Setup', 'error');
    return;
  }

  const existing = (fp.items || []).filter(p => p.placement !== 'wall' && p.id !== item.id);
  const placement = item.map_placement || {};
  const startX = placement.x_pct ?? 50;
  const startY = placement.y_pct ?? 50;
  const hasMeasure = fp.bounds_width > 0 && fp.bounds_depth > 0;

  const overlay = document.createElement('div');
  overlay.className = 'floor-placement-overlay';
  overlay.innerHTML = `
    <div class="floor-placement-modal" role="dialog" aria-modal="true">
      <header class="floor-placement-header">
        <div>
          <h2>Place on floor — ${escapeHtml(item.name)}</h2>
          <p class="text-muted-sm">${escapeHtml(fp.location)} · other floor items shown for reference</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm floor-placement-close" aria-label="Close">&times;</button>
      </header>
      <div class="floor-placement-canvas-wrap ${hasMeasure ? 'floorplan-svg-scaled' : ''}" id="floor-placement-canvas">
        <svg viewBox="0 0 100 100" preserveAspectRatio="${hasMeasure ? 'xMidYMid meet' : 'none'}"
          class="floorplan-svg ${fp.image_path ? 'has-floor-image' : ''}" xmlns="http://www.w3.org/2000/svg">
          <rect class="floorplan-grid-bg" x="0" y="0" width="100" height="100"/>
          ${floorTextureSvgMarkup(fp.id, fp.image_path ? fileUrl(fp.image_path) : '', verts, closed, floorImageViewFromFp(fp))}
          <polygon class="floorplan-room-fill" points="${polygonPointsAttr(verts)}"/>
          <polyline class="floorplan-room-outline" points="${polygonOutlinePointsAttr(verts, closed)}"/>
        </svg>
        <div class="floor-placement-pin-layer">
          ${existing.map(pin => `
            <span class="floor-placement-pin-ref floorplan-pin-logo" style="left:${pin.x_pct}%;top:${pin.y_pct}%"
              title="${escapeHtml(pin.name)}">${mapMarkerLogoHtml(pin)}</span>
          `).join('')}
          <button type="button" class="floor-placement-pin-active floorplan-pin-logo" id="floor-placement-drag"
            style="left:${startX}%;top:${startY}%">${mapMarkerLogoHtml(item)}</button>
        </div>
      </div>
      <footer class="floor-placement-footer">
        <p class="text-muted-sm">Drag the marker to position — existing items stay put so you can avoid overlap.</p>
        <div class="btn-group">
          <button type="button" class="btn btn-secondary btn-sm floor-placement-close">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" id="floor-placement-save">Save position</button>
        </div>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('#floor-placement-canvas');
  if (hasMeasure) applyRoomDisplay(canvas, fp.bounds_width, fp.bounds_depth);

  const close = () => overlay.remove();
  overlay.querySelectorAll('.floor-placement-close').forEach(btn => btn.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const pin = overlay.querySelector('#floor-placement-drag');
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
    const onUp = () => {
      pin.removeEventListener('pointermove', onMove);
      pin.removeEventListener('pointerup', onUp);
    };
    pin.addEventListener('pointermove', onMove);
    pin.addEventListener('pointerup', onUp);
  });

  overlay.querySelector('#floor-placement-save')?.addEventListener('click', async () => {
    try {
      await onSave({
        item_id: item.id,
        x_pct: parseFloat(pin.style.left) || 50,
        y_pct: parseFloat(pin.style.top) || 50,
        placement: 'floor',
        wall_edge: null,
        wall_t: null,
        height_ft: null
      });
      close();
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  });
}

async function pickWallEdge(fp, item, onToast) {
  const edges = edgeCount(fp.polygon || []);
  if (!edges) {
    onToast?.('No walls defined for this room', 'error');
    return null;
  }
  if (item.map_placement?.placement === 'wall' && item.map_placement.wall_edge != null) {
    return Number(item.map_placement.wall_edge);
  }
  const unit = fp.unit || 'ft';
  const choices = [...Array(edges)].map((_, i) => ({
    id: String(i),
    label: `Wall ${i + 1} (${formatFeet(wallLengthFt(fp, i), unit) || 'set length in setup'})`,
    primary: i === 0
  }));
  const pick = await showChoiceModal({
    title: `Which wall for ${item.name}?`,
    message: 'Other items on that wall will appear so you can place without overlap.',
    choices
  });
  return pick != null ? Number(pick) : null;
}

function openWallPlacement({ fp, item, edge, api, onDone, onToast }) {
  openWallElevation({
    fp,
    wallEdge: edge,
    items: fp.items || [],
    pendingItem: item,
    onUploadWallPhoto: (file) => api.uploadWallBackground(fp.id, edge, file),
    onSaveWallCalibration: (data) => api.setWallBackgroundCalibration(fp.id, edge, data),
    onSave: async (updates) => {
      await mergePinUpdates(api, fp, updates.map(u => ({
        ...u,
        placement: 'wall',
        wall_edge: edge
      })));
      onToast?.('Item placed on wall', 'success');
      onDone?.();
    },
    onPhotoEdit: async (pin) => {
      const full = await api.item(pin.id);
      openWallPhotoEditor({
        item: full,
        pin,
        unit: fp.unit || 'ft',
        onSave: async (patch) => {
          const pins = buildPinPayload(fp);
          const row = pins.find(p => p.item_id === pin.id);
          if (row) Object.assign(row, { placement: 'wall', wall_display: true, ...patch });
          await api.setFloorplanItems(fp.id, pins);
          await api.saveWallCutout(pin.id, patch).catch(() => {});
          onToast?.('Wall photo hang updated', 'success');
        },
        onToast
      });
    },
    onToast
  });
}

async function pickRack(racks, item, onToast) {
  const list = racks || [];
  if (!list.length) {
    onToast?.('No racks defined — create one in Studio Setup', 'error');
    return null;
  }
  const choices = list.map((r, i) => ({
    id: String(r.id),
    label: `${r.name}${r.location ? ` (${r.location})` : ''}`,
    primary: i === 0
  }));
  const pick = await showChoiceModal({
    title: `Rack for ${item.name}?`,
    message: 'Item stays in its room location; this adds it to the rack layout.',
    choices
  });
  return pick != null ? list.find(r => String(r.id) === pick) : null;
}

async function pickOtherRoom(floorplans, item) {
  const rooms = [...new Set((floorplans || []).map(f => f.location).filter(Boolean))]
    .filter(loc => loc !== item.location)
    .sort((a, b) => a.localeCompare(b));
  if (!rooms.length) return null;
  const choices = rooms.map((loc, i) => ({
    id: loc,
    label: loc,
    primary: i === 0
  }));
  const pick = await showChoiceModal({
    title: `Move ${item.name} to which room?`,
    message: 'Updates studio location, then you can place it on a wall or floor there.',
    choices
  });
  return pick || null;
}

export async function openItemPlacement({ item, floorplans, racks, api, onToast, onDone }) {
  if (!item.location) {
    onToast?.('Set a Location in Studio on this item first', 'error');
    return;
  }

  const choice = await showChoiceModal({
    title: `Place ${item.name}`,
    message: 'Choose where this item lives in the studio layout.',
    choices: [
      { id: 'wall', label: 'On a wall', primary: true },
      { id: 'floor', label: 'On the floor' },
      { id: 'rack', label: 'In a rack' },
      { id: 'other_room', label: 'Move to another room' },
      { id: 'remove', label: 'Remove from map' }
    ]
  });
  if (!choice) return;

  if (choice === 'remove') {
    const fp = await ensureFloorplan(api, item, floorplans);
    if (!fp) return;
    const pins = buildPinPayload(fp).filter(p => p.item_id !== item.id);
    await api.setFloorplanItems(fp.id, pins);
    onToast?.('Removed from room map', 'success');
    onDone?.();
    return;
  }

  if (choice === 'rack') {
    const rack = await pickRack(racks, item, onToast);
    if (!rack) return;
    const slot = window.prompt(`Slot label for ${rack.name} (e.g. U4):`, '') || '';
    const items = [...(rack.items || []).map((s, i) => ({
      item_id: s.id, position: i, slot_label: s.slot_label || ''
    })), {
      item_id: item.id,
      position: rack.items?.length || 0,
      slot_label: slot
    }];
    await api.setRackItems(rack.id, items);
    onToast?.(`Added to rack “${rack.name}”`, 'success');
    onDone?.();
    return;
  }

  if (choice === 'other_room') {
    const newLoc = await pickOtherRoom(floorplans, item);
    if (!newLoc) {
      onToast?.('No other rooms available', 'error');
      return;
    }
    const tags = (item.tags || []).map(t => typeof t === 'string' ? t : t.name).filter(Boolean);
    await api.updateItem(item.id, { ...item, tags, location: newLoc });
    const updated = { ...item, location: newLoc };
    onToast?.(`Location set to ${newLoc} — place it on the map`, 'info');
    const all = await api.floorplans();
    return openItemPlacement({ item: updated, floorplans: all, racks, api, onToast, onDone });
  }

  const fp = await ensureFloorplan(api, item, floorplans);
  if (!fp || !polygonClosed(fp.polygon || [])) {
    onToast?.('Room not ready — finish setup in Studio Setup', 'error');
    return;
  }

  if (choice === 'floor') {
    openFloorPlacementOverlay({
      fp,
      item,
      onToast,
      onSave: async (patch) => {
        await mergePinUpdates(api, fp, [patch]);
        onToast?.('Item placed on floor', 'success');
        onDone?.();
      }
    });
    return;
  }

  if (choice === 'wall') {
    const edge = await pickWallEdge(fp, item, onToast);
    if (edge == null) return;
    openWallPlacement({ fp, item, edge, api, onToast, onDone });
  }
}
