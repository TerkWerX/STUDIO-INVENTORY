import { escapeHtml, fileUrl } from '../utils.js';
import {
  polygonClosed, polygonPointsAttr, polygonOutlinePointsAttr, edgeCount,
  formatFeet, wallLengthFt, floorTextureSvgMarkup, floorImageViewFromFp
} from '../lib/floorplan-geometry.js';
import { isWallPhotoCalibrated } from '../lib/wall-perspective.js';
import { formatLengthInput, lengthStep, lengthUnitLabel, lengthUnitOptions } from '../lib/measurement.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function renderFloorplanTab(floorplans, _locations, _items, selectedId = null) {
  const plans = asArray(floorplans);

  const active = selectedId
    ? plans.find(f => String(f.id) === String(selectedId))
    : plans[0];

  return `
    <div class="card floorplan-guide">
      <h3 class="section-title">Set up your room base</h3>
      <p class="text-muted-sm" style="margin-bottom:0.75rem">
        Draw the room outline, enter real dimensions, and photograph each wall. This tab builds the floor and wall
        layers only — not where gear goes on the map.
      </p>
      <ol class="floorplan-steps">
        <li><strong>Draw room</strong> — click each corner; click near the first corner to close the shape.</li>
        <li><strong>Tape measure</strong> — room width, depth, ceiling height, and each wall length.</li>
        <li><strong>Wall photos</strong> — pick a wall side; upload &amp; align a photo to the wall frame (length × ceiling height).</li>
      </ol>
      <p class="text-muted-sm">Optional: <strong>Floor image</strong> adds wood, carpet, or tile inside the room outline only.</p>
      <p class="text-muted-sm">To browse the finished layout, open <strong>Studio View</strong> in the sidebar. Place gear from each item's page.</p>
    </div>

    <div class="floorplan-toolbar">
      <div class="form-group">
        <label for="floorplan-select">Your rooms</label>
        <select id="floorplan-select">
          <option value="">— Select a room —</option>
          ${plans.map(fp => {
            const selected = active && fp.id === active.id;
            return `<option value="${fp.id}" ${selected ? 'selected' : ''}>${escapeHtml(fp.location)}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-group floorplan-new-room-field">
        <label for="floorplan-new-location">Or create new room</label>
        <input type="text" id="floorplan-new-location" placeholder="e.g. Control Room" maxlength="80">
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="floorplan-create">Create &amp; draw</button>
    </div>

    <div id="floorplan-panel">
      ${active ? renderFloorplanEditor(active) : renderFloorplanEmpty()}
    </div>
  `;
}

function renderFloorplanEmpty() {
  return `
    <div class="card empty-state floorplan-empty">
      <h3>Create a room first</h3>
      <p>Go to <strong>Rooms &amp; Zones</strong> and click <strong>Create room</strong>, or type a new room name above and click <strong>Create &amp; draw</strong>.</p>
      <p class="text-muted-sm">Then use step 1 (<strong>Draw room</strong>) to click each corner of your room outline.</p>
      <button type="button" class="btn btn-secondary btn-sm" data-studio-tab="rooms">Go to Rooms &amp; Zones</button>
    </div>
  `;
}

function wallPhotoStatus(fp, edge) {
  const entry = fp.wall_photos?.[edge] || fp.wall_photos?.[String(edge)];
  if (!entry?.path) return 'none';
  if (isWallPhotoCalibrated(entry)) return 'ready';
  return 'needs-align';
}

function wallStatusLabel(status) {
  if (status === 'ready') return 'Photo aligned';
  if (status === 'needs-align') return 'Needs alignment';
  return 'No photo yet';
}

function renderDrawMap(fp) {
  const verts = fp.polygon || [];
  const closed = polygonClosed(verts);
  const edges = closed ? edgeCount(verts) : 0;
  const unit = fp.unit || 'ft';
  const ceiling = fp.ceiling_height ?? 9.5;
  const floorView = floorImageViewFromFp(fp);
  const floorScale = floorView.scale;
  const unitLabel = lengthUnitLabel(unit);
  const step = lengthStep(unit);

  return `
    <div class="floorplan-draw-wrap" data-floorplan-id="${fp.id}" data-location="${escapeHtml(fp.location)}">
      <div class="floorplan-mode-bar btn-group">
        <button type="button" class="btn btn-secondary btn-sm" data-fp-mode="draw">1. Draw room</button>
        <button type="button" class="btn btn-secondary btn-sm" data-fp-mode="dimensions">2. Tape measure</button>
        <button type="button" class="btn btn-secondary btn-sm" data-fp-mode="walls">3. Wall photos</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="fp-floor-image"
          title="Wood, carpet, or tile inside the room outline">
          ${fp.image_path ? 'Change floor image' : 'Floor image…'}
        </button>
        ${fp.image_path ? `<button type="button" class="btn btn-ghost btn-sm" data-action="fp-remove-floor-image">Remove floor</button>` : ''}
      </div>

      <p class="text-muted-sm floorplan-draw-hint" data-hint-for="draw">
        Crosshair + 90° wall snap. Click corners in order — no dragging. Misplaced a corner?
        <span class="floorplan-draw-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="fp-undo-vertex" disabled>Remove last point</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="fp-close-polygon" disabled>Close shape</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="fp-clear-polygon">Clear shape</button>
        </span>
      </p>
      <p class="text-muted-sm floorplan-draw-hint hidden" data-hint-for="dimensions">
        Measure with a tape: enter overall width (left→right) and depth (front→back), then type each <strong>wall length</strong> along the outline.
      </p>
      <p class="text-muted-sm floorplan-draw-hint hidden" data-hint-for="walls">
        Click a wall on the room outline or pick a wall below. The view switches to that wall face-on
        (${formatFeet(ceiling, unit)} tall). Upload a photo and align four corners to the frame.
      </p>

      <div class="floorplan-map-chrome" id="floorplan-map-chrome">
        <div class="floorplan-canvas-toolbar">
          <div class="btn-group">
            <button type="button" class="btn btn-secondary btn-sm" data-action="fp-zoom-out" title="Zoom out">−</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="fp-zoom-in" title="Zoom in">+</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="fp-zoom-fit" title="Fit room in view">Fit</button>
          </div>
          <label class="floorplan-zoom-lock-label" title="Keeps zoom fixed so mouse wheel scrolls the page instead of zooming the map">
            <input type="checkbox" id="fp-zoom-lock"> Lock zoom
          </label>
          <span class="text-muted-sm floorplan-zoom-hint">Fit = full room · wheel/pinch zoom in · drag to pan</span>
        </div>
        <div class="floorplan-viewport ${fp.bounds_width && fp.bounds_depth ? 'floorplan-svg-scaled' : ''}" id="floorplan-viewport">
          <div class="floorplan-canvas-stage" id="floorplan-canvas-stage">
            <svg viewBox="0 0 100 100" preserveAspectRatio="${fp.bounds_width && fp.bounds_depth ? 'xMidYMid meet' : 'none'}"
              class="floorplan-svg ${fp.image_path && closed ? 'has-floor-image' : ''}" xmlns="http://www.w3.org/2000/svg">
              <rect class="floorplan-grid-bg" x="0" y="0" width="100" height="100"/>
              ${floorTextureSvgMarkup(fp.id, fp.image_path ? fileUrl(fp.image_path) : '', verts, closed, floorView)}
              ${closed ? `<polygon class="floorplan-room-fill" points="${polygonPointsAttr(verts)}"/>` : ''}
              <polyline class="floorplan-room-outline" points="${polygonOutlinePointsAttr(verts, closed)}"/>
              <g class="floorplan-wall-picks"></g>
              <g class="floorplan-vertices"></g>
              <g class="floorplan-draw-guides"></g>
              <g class="floorplan-wall-labels"></g>
            </svg>
          </div>
        </div>

        <p class="text-muted-sm floorplan-save-hint" id="floorplan-save-status">
          ${closed ? 'Select a wall to photograph' : 'Draw the room outline to begin'}
        </p>

        ${fp.image_path && closed ? `
          <div class="card floorplan-floor-panel" id="floorplan-floor-panel">
            <h4 class="subsection-title">Floor image framing</h4>
            <div class="floorplan-floor-controls">
              <label class="floorplan-floor-zoom">
                Zoom
                <input type="range" id="fp-floor-scale" min="1" max="3" step="0.02" value="${floorScale}">
                <span id="fp-floor-scale-val">${floorScale.toFixed(2)}×</span>
              </label>
              <div class="btn-group floorplan-floor-fit">
                <button type="button" class="btn btn-sm ${floorView.fit === 'cover' ? 'btn-primary' : 'btn-secondary'}"
                  data-action="fp-floor-fit" data-fit="cover">Fill room</button>
                <button type="button" class="btn btn-sm ${floorView.fit === 'contain' ? 'btn-primary' : 'btn-secondary'}"
                  data-action="fp-floor-fit" data-fit="contain">Show full image</button>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" data-action="fp-floor-drag" id="fp-floor-drag">Drag to position</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="fp-floor-reset-view">Reset framing</button>
            </div>
            <p class="text-muted-sm floorplan-floor-hint" id="floorplan-floor-hint">
              Fill room crops to the outline — zoom out or switch to <strong>Show full image</strong>, then drag to frame the floor.
            </p>
          </div>
        ` : ''}

        ${edges ? `
          <div class="card floorplan-walls-panel hidden" id="floorplan-walls-panel">
            <h4 class="subsection-title">Choose a wall</h4>
            <p class="text-muted-sm" style="margin-bottom:0.75rem">Each opens a face-on frame: wall length × ${formatFeet(ceiling, unit)} ceiling.</p>
            <div class="floorplan-wall-pick-grid">
              ${[...Array(edges)].map((_, i) => {
                const status = wallPhotoStatus(fp, i);
                const len = wallLengthFt(fp, i);
                return `
                  <button type="button" class="btn btn-secondary btn-sm floorplan-wall-pick-btn floorplan-wall-pick-${status}"
                    data-action="fp-open-wall" data-edge="${i}">
                    <strong>Wall ${i + 1}</strong>
                    <span class="text-muted-sm">${len > 0 ? formatFeet(len, unit) : 'Set length in step 2'}</span>
                    <span class="floorplan-wall-pick-status">${wallStatusLabel(status)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="floorplan-wall-workspace hidden" id="floorplan-wall-workspace">
        <div class="floorplan-wall-inline-mount wall-elevation-inline" id="floorplan-wall-inline"></div>
      </div>

      <div class="card floorplan-dimensions-panel hidden" id="floorplan-dimensions-panel">
        <h4 class="subsection-title">Real-world dimensions</h4>
        <p class="text-muted-sm" style="margin-bottom:0.75rem">Save fits your outline to these measurements — a 15×15 room becomes a square on the map.</p>
        <div class="form-grid floorplan-dim-grid">
          <div class="form-group">
            <label for="fp-unit">Measurement unit</label>
            <select id="fp-unit">
              ${lengthUnitOptions(unit)}
            </select>
          </div>
          <div class="form-group">
            <label for="fp-bounds-width">Room width <span class="text-muted-sm">(left → right, <span class="fp-unit-label">${unitLabel}</span>)</span></label>
            <input type="number" id="fp-bounds-width" min="0" step="${step}" value="${formatLengthInput(fp.bounds_width, unit)}" placeholder="${unit === 'cm' ? 'e.g. 548.6' : unit === 'm' ? 'e.g. 5.49' : unit === 'in' ? 'e.g. 216' : 'e.g. 18'}">
          </div>
          <div class="form-group">
            <label for="fp-bounds-depth">Room depth <span class="text-muted-sm">(front → back, <span class="fp-unit-label">${unitLabel}</span>)</span></label>
            <input type="number" id="fp-bounds-depth" min="0" step="${step}" value="${formatLengthInput(fp.bounds_depth, unit)}" placeholder="${unit === 'cm' ? 'e.g. 426.7' : unit === 'm' ? 'e.g. 4.27' : unit === 'in' ? 'e.g. 168' : 'e.g. 14'}">
          </div>
          <div class="form-group">
            <label for="fp-ceiling-height">Ceiling height <span class="text-muted-sm">(<span class="fp-unit-label">${unitLabel}</span>)</span></label>
            <input type="number" id="fp-ceiling-height" min="0" step="${step}" value="${formatLengthInput(fp.ceiling_height ?? 9.5, unit)}" placeholder="${unit === 'cm' ? 'e.g. 289.6' : unit === 'm' ? 'e.g. 2.9' : unit === 'in' ? 'e.g. 114' : 'e.g. 9.5'}">
          </div>
        </div>
        ${edges ? `
          <h4 class="subsection-title" style="margin-top:1rem">Wall lengths <span class="text-muted-sm">(tape measure each wall)</span></h4>
          <div class="floorplan-wall-views btn-group" style="margin-bottom:0.75rem">
            ${[...Array(edges)].map((_, i) => `
              <button type="button" class="btn btn-secondary btn-sm" data-action="fp-wall-view" data-edge="${i}">
                Preview Wall ${i + 1}
              </button>
            `).join('')}
          </div>
          <div class="floorplan-wall-lens">
            ${[...Array(edges)].map((_, i) => `
              <div class="form-group">
                <label>Wall ${i + 1} <span class="text-muted-sm">(<span class="fp-unit-label">${unitLabel}</span>)</span></label>
                <input type="number" class="fp-wall-len" data-edge="${i}" min="0" step="${step}"
                  value="${formatLengthInput((fp.wall_lengths || [])[i], unit)}" placeholder="Length">
              </div>
            `).join('')}
          </div>
        ` : '<p class="text-muted-sm">Close the room shape to enter per-wall lengths.</p>'}
        <button type="button" class="btn btn-primary btn-sm" data-action="fp-save-geometry" style="margin-top:1rem">Save dimensions</button>
      </div>
    </div>
  `;
}

function renderLegacyPhotoMap(fp) {
  return `
    <div class="floorplan-editor" data-floorplan-id="${fp.id}" data-location="${escapeHtml(fp.location)}">
      <div class="card-header">
        <div>
          <h3 class="section-title">${escapeHtml(fp.location)} <span class="text-muted-sm">(legacy photo mode)</span></h3>
          <p class="text-muted-sm">Switch to a drawn map for tape-measure accuracy and wall photos.</p>
        </div>
        <div class="btn-group">
          <button type="button" class="btn btn-secondary btn-sm" data-action="fp-switch-draw">Use drawn map</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-floorplan" data-id="${fp.id}">Delete</button>
        </div>
      </div>
      ${fp.image_path ? `
        <div class="floorplan-canvas" id="floorplan-canvas">
          <img src="${fileUrl(fp.image_path)}" alt="Room" class="floorplan-bg" draggable="false">
        </div>
      ` : '<p class="text-muted">No photo uploaded.</p>'}
    </div>
  `;
}

function renderFloorplanEditor(fp) {
  const usePhoto = fp.map_mode === 'photo' && fp.image_path && !(fp.polygon || []).length;

  return `
    <div class="card floorplan-editor-shell">
      <div class="card-header">
        <div>
          <h3 class="section-title">${escapeHtml(fp.location)}</h3>
          <p class="text-muted-sm">Room base setup — outline, floor texture, wall photos. Open <strong>Studio View</strong> to browse the finished layout.</p>
        </div>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete-floorplan" data-id="${fp.id}">Delete</button>
      </div>
      ${usePhoto ? renderLegacyPhotoMap(fp) : renderDrawMap(fp)}
    </div>
  `;
}
