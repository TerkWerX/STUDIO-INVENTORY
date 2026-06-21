import { escapeHtml, mapMarkerLogoHtml } from '../utils.js';
import {
  polygonClosed, polygonPointsAttr, polygonOutlinePointsAttr, applyRoomDisplay,
  edgeCount, floorTextureSvgMarkup, floorImageViewFromFp
} from '../lib/floorplan-geometry.js';
import { fileUrl } from '../utils.js';
import { isWallPhotoCalibrated } from '../lib/wall-perspective.js';

function wallPhotoStatus(fp, edge) {
  const entry = fp.wall_photos?.[edge] ?? fp.wall_photos?.[String(edge)];
  if (!entry?.path) return 'none';
  if (isWallPhotoCalibrated(entry)) return 'ready';
  return 'needs-align';
}

function wallPhotoStatusLabel(status) {
  if (status === 'ready') return 'Photo ready';
  if (status === 'needs-align') return 'Photo needs align';
  return 'No photo';
}

function readyPlans(floorplans) {
  return (floorplans || []).filter(fp => polygonClosed(fp.polygon || []));
}

export function renderStudioBrowse(floorplans, selectedId = null, highlightItemId = null) {
  const plans = readyPlans(floorplans);

  if (!plans.length) {
    return `
      <div class="studio-browse studio-browse-empty">
        <h2 class="page-title">Studio View</h2>
        <div class="card empty-state">
          <h3>No rooms ready to view</h3>
          <p>Draw a room outline and add floor/wall photos in <strong>Studio Setup</strong> first.</p>
          <button type="button" class="btn btn-primary btn-sm" data-nav="studio-setup">Go to Studio Setup</button>
        </div>
      </div>
    `;
  }

  const active = selectedId
    ? plans.find(f => String(f.id) === String(selectedId)) || plans[0]
    : plans[0];

  const verts = active.polygon || [];
  const closed = polygonClosed(verts);
  const hasMeasure = active.bounds_width > 0 && active.bounds_depth > 0;
  const edges = edgeCount(verts);
  const floorPins = (active.items || []).filter(p => p.placement !== 'wall');

  return `
    <div class="studio-browse" data-studio-browse-fp="${active.id}">
      <header class="studio-browse-header">
        <div>
          <h2 class="page-title studio-browse-title">Studio View</h2>
          <p class="text-muted-sm studio-browse-sub">${escapeHtml(active.location)} — top-down layout · tap gear or open a wall</p>
        </div>
        <div class="studio-browse-room-pick">
          <label for="studio-browse-room" class="text-muted-sm">Room</label>
          <select id="studio-browse-room" class="studio-browse-select">
            ${plans.map(fp => `
              <option value="${fp.id}" ${fp.id === active.id ? 'selected' : ''}>${escapeHtml(fp.location)}</option>
            `).join('')}
          </select>
        </div>
      </header>

      <div class="studio-browse-body" id="studio-browse-body">
        <div class="studio-browse-map-wrap ${hasMeasure ? 'floorplan-svg-scaled' : ''}" id="studio-browse-map"
          data-bounds-width="${active.bounds_width || 0}" data-bounds-depth="${active.bounds_depth || 0}">
          <svg viewBox="0 0 100 100" preserveAspectRatio="${hasMeasure ? 'xMidYMid meet' : 'none'}"
            class="floorplan-svg studio-browse-svg ${active.image_path ? 'has-floor-image' : ''}"
            xmlns="http://www.w3.org/2000/svg">
            <rect class="floorplan-grid-bg" x="0" y="0" width="100" height="100"/>
            ${floorTextureSvgMarkup(active.id, active.image_path ? fileUrl(active.image_path) : '', verts, closed, floorImageViewFromFp(active))}
            <polygon class="floorplan-room-fill" points="${polygonPointsAttr(verts)}"/>
            <polyline class="floorplan-room-outline" points="${polygonOutlinePointsAttr(verts, closed)}"/>
          </svg>
          <div class="studio-browse-pin-layer">
            ${floorPins.map(pin => `
              <button type="button" class="studio-browse-pin floorplan-pin-logo ${highlightItemId && String(pin.id) === String(highlightItemId) ? 'studio-browse-pin-highlight' : ''}"
                data-item-id="${pin.id}" style="left:${pin.x_pct}%;top:${pin.y_pct}%"
                title="${escapeHtml(pin.name)}">
                ${mapMarkerLogoHtml(pin)}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="studio-browse-wall-bar">
          ${[...Array(edges)].map((_, i) => {
            const wallCount = (active.items || []).filter(p => p.placement === 'wall' && Number(p.wall_edge) === i).length;
            const photoStatus = wallPhotoStatus(active, i);
            const gearLabel = wallCount ? `${wallCount} item${wallCount === 1 ? '' : 's'}` : 'No gear yet';
            return `
              <button type="button" class="btn btn-secondary studio-browse-wall-btn studio-browse-wall-${photoStatus}"
                data-studio-wall="${i}">
                <strong>Wall ${i + 1}</strong>
                <span class="text-muted-sm">${wallPhotoStatusLabel(photoStatus)}</span>
                <span class="text-muted-sm">${gearLabel}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

export function applyStudioBrowseLayout(root) {
  const map = root?.querySelector('#studio-browse-map');
  const fpId = root?.dataset?.studioBrowseFp;
  if (!map || !fpId) return;
  const boundsW = parseFloat(map.dataset.boundsWidth) || 0;
  const boundsD = parseFloat(map.dataset.boundsDepth) || 0;
  if (boundsW && boundsD) applyRoomDisplay(map, boundsW, boundsD);
}