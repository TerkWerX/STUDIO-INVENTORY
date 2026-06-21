import {
  parsePolygon, polygonClosed, polygonPointsAttr, polygonOutlinePointsAttr,
  cornerMarkersForVertices, drawGuidesMarkup, snapDrawPoint, edgeCount,
  fitPolygonToMeasureBox, autoWallLengths,
  applyRoomDisplay, nearestEdge, snapPointerToCanvas,
  wallEdgeLabelsMarkup, floorImageViewFromFp, floorTextureImageAttrs
} from './floorplan-geometry.js';
import { formatLengthInput, lengthStep, lengthUnitLabel, toFeet } from './measurement.js';
import { forwardWheelScroll } from '../utils.js';

const ZOOM_LOCK_KEY = 'studio-zoom-lock';

export function initFloorplanEditor(root, {
  fp, onSaveGeometry, onSaveFloorView, onRefresh, onToast, onOpenWall, initialMode
}) {
  if (!root) return () => {};

  let mode = initialMode || 'draw';
  let vertices = parsePolygon(fp.polygon);
  /** False while drawing until user clicks near the first corner; true for saved outlines. */
  let shapeClosed = polygonClosed(vertices);
  let selectedWallEdge = null;
  let dirtyGeometry = false;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let zoomLocked = localStorage.getItem(ZOOM_LOCK_KEY) === '1';
  let floorView = floorImageViewFromFp(fp);
  let floorDragMode = false;
  let floorPanning = false;
  let floorPanStart = null;
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 8;
  const PAN_THRESHOLD = 10;

  const svg = root.querySelector('.floorplan-svg');
  const viewportEl = root.querySelector('.floorplan-viewport') || root.querySelector('.floorplan-svg-canvas');
  const stageEl = root.querySelector('.floorplan-canvas-stage');
  const guidesG = svg?.querySelector('.floorplan-draw-guides');
  const statusEl = root.querySelector('#floorplan-save-status');
  const dimPanel = root.querySelector('#floorplan-dimensions-panel');
  const wallsPanel = root.querySelector('#floorplan-walls-panel');
  const mapChrome = root.querySelector('#floorplan-map-chrome');
  const wallWorkspace = root.querySelector('#floorplan-wall-workspace');
  let dimensionUnit = dimPanel?.querySelector('#fp-unit')?.value || fp.unit || 'ft';

  const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };

  function showRoomOverview() {
    wallWorkspace?.classList.add('hidden');
    mapChrome?.classList.remove('hidden');
    wallsPanel?.classList.toggle('hidden', mode !== 'walls');
    selectedWallEdge = null;
    renderPolygon();
  }

  function showWallWorkspace() {
    mapChrome?.classList.add('hidden');
    wallWorkspace?.classList.remove('hidden');
    wallsPanel?.classList.add('hidden');
  }

  function applyStageTransform() {
    if (!stageEl) return;
    stageEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function updateZoomLockUi() {
    const lockCb = root.querySelector('#fp-zoom-lock');
    const hint = root.querySelector('.floorplan-zoom-hint');
    if (lockCb) lockCb.checked = zoomLocked;
    root.querySelectorAll('[data-action="fp-zoom-in"], [data-action="fp-zoom-out"], [data-action="fp-zoom-fit"]').forEach(btn => {
      btn.disabled = zoomLocked;
    });
    viewportEl?.classList.toggle('floorplan-zoom-locked', zoomLocked);
    if (hint) {
      hint.textContent = zoomLocked
        ? 'Zoom locked — scroll the page freely; uncheck Lock zoom to adjust'
        : 'Fit = full room · wheel/pinch zoom in · drag to pan';
    }
  }

  function setZoomAt(newZoom, focalX, focalY) {
    if (!viewportEl || zoomLocked) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
    const rect = viewportEl.getBoundingClientRect();
    const fx = focalX - rect.left;
    const fy = focalY - rect.top;
    const scale = clamped / zoom;
    panX = fx - scale * (fx - panX);
    panY = fy - scale * (fy - panY);
    zoom = clamped;
    applyStageTransform();
  }

  function fitCanvasView() {
    if (zoomLocked) return;
    zoom = 1;
    panX = 0;
    panY = 0;
    applyStageTransform();
  }

  function clearDrawGuides() {
    if (guidesG) guidesG.innerHTML = '';
  }

  function updateDrawCursor() {
    viewportEl?.classList.toggle('floorplan-draw-active', mode === 'draw' && !shapeClosed);
    if (mode !== 'draw' || shapeClosed) clearDrawGuides();
  }

  function pointerDrawPoint(clientX, clientY, excludeIndex = -1) {
    const raw = snapPointerToCanvas(svg, clientX, clientY);
    return snapDrawPoint(raw, vertices, { excludeIndex });
  }

  function updateDrawPreview(clientX, clientY) {
    if (mode !== 'draw' || shapeClosed || !guidesG) {
      clearDrawGuides();
      updateDrawActions();
      return;
    }
    const snap = pointerDrawPoint(clientX, clientY);
    guidesG.innerHTML = drawGuidesMarkup(snap, vertices);
    updateDrawActions(snap.closing);
  }

  function updateDrawActions(nearClose = false) {
    const undoBtn = root.querySelector('[data-action="fp-undo-vertex"]');
    const closeBtn = root.querySelector('[data-action="fp-close-polygon"]');
    if (undoBtn) undoBtn.disabled = vertices.length === 0 || shapeClosed;
    if (closeBtn) {
      closeBtn.disabled = vertices.length < 3 || shapeClosed;
      closeBtn.classList.toggle('btn-primary', nearClose && vertices.length >= 3);
      closeBtn.classList.toggle('btn-secondary', !nearClose || vertices.length < 3);
    }
  }

  function closeShape() {
    if (vertices.length < 3 || shapeClosed) return false;
    shapeClosed = true;
    dirtyGeometry = true;
    renderPolygon();
    updateDrawCursor();
    updateDrawActions();
    setStatus('Shape closed — set tape-measure dimensions next');
    return true;
  }

  function applyFloorTextureAttrs() {
    const img = svg?.querySelector('.floorplan-floor-texture');
    if (!img) return;
    const attrs = floorTextureImageAttrs(floorView);
    img.setAttribute('x', String(attrs.x));
    img.setAttribute('y', String(attrs.y));
    img.setAttribute('width', String(attrs.width));
    img.setAttribute('height', String(attrs.height));
    img.setAttribute('preserveAspectRatio', attrs.preserveAspectRatio);
  }

  function syncFloorUi() {
    const scaleInput = root.querySelector('#fp-floor-scale');
    const scaleVal = root.querySelector('#fp-floor-scale-val');
    if (scaleInput) scaleInput.value = String(floorView.scale);
    if (scaleVal) scaleVal.textContent = `${floorView.scale.toFixed(2)}×`;
    root.querySelectorAll('[data-action="fp-floor-fit"]').forEach(btn => {
      const active = btn.dataset.fit === floorView.fit;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-secondary', !active);
    });
    const dragBtn = root.querySelector('#fp-floor-drag');
    if (dragBtn) {
      dragBtn.classList.toggle('btn-primary', floorDragMode);
      dragBtn.classList.toggle('btn-secondary', !floorDragMode);
      dragBtn.textContent = floorDragMode ? 'Dragging floor…' : 'Drag to position';
    }
    viewportEl?.classList.toggle('floorplan-floor-drag-active', floorDragMode);
    const hint = root.querySelector('#floorplan-floor-hint');
    if (hint) {
      hint.textContent = floorDragMode
        ? 'Drag the floor image to reframe — release to save.'
        : 'Fill room crops to the outline — zoom out or switch to Show full image, then drag to frame the floor.';
    }
  }

  const saveFloorViewDebounced = debounceLocal(async () => {
    fp.floor_image_scale = floorView.scale;
    fp.floor_image_x = floorView.focusX;
    fp.floor_image_y = floorView.focusY;
    fp.floor_image_fit = floorView.fit;
    await onSaveFloorView?.({
      floor_image_scale: floorView.scale,
      floor_image_x: floorView.focusX,
      floor_image_y: floorView.focusY,
      floor_image_fit: floorView.fit
    });
    setStatus('Floor framing saved');
  }, 420);

  function renderPolygon() {
    if (!svg) return;
    svg.classList.toggle('has-floor-image', Boolean(fp.image_path && shapeClosed));
    const floorClip = svg.querySelector('.floorplan-floor-clip');
    if (floorClip) {
      floorClip.setAttribute('points', shapeClosed ? polygonPointsAttr(vertices) : '');
    }
    applyFloorTextureAttrs();
    const fill = svg.querySelector('.floorplan-room-fill');
    const outline = svg.querySelector('.floorplan-room-outline');
    const vertsG = svg.querySelector('.floorplan-vertices');
    if (fill) fill.setAttribute('points', shapeClosed ? polygonPointsAttr(vertices) : '');
    if (outline) {
      outline.setAttribute('points', polygonOutlinePointsAttr(vertices, shapeClosed));
    }
    if (vertsG) {
      vertsG.innerHTML = mode === 'draw' ? cornerMarkersForVertices(vertices, shapeClosed) : '';
    }
    const labels = svg.querySelector('.floorplan-wall-labels');
    if (labels && shapeClosed) {
      labels.innerHTML = wallEdgeLabelsMarkup(vertices, { ...fp, polygon: vertices });
    } else if (labels) labels.innerHTML = '';

    const picks = svg.querySelector('.floorplan-wall-picks');
    if (picks && mode === 'walls' && shapeClosed) {
      picks.innerHTML = [...Array(edgeCount(vertices))].map((_, i) => {
        const [a, b] = [vertices[i], vertices[(i + 1) % vertices.length]];
        const active = selectedWallEdge === i ? ' floorplan-wall-pick-active' : '';
        return `<line class="floorplan-wall-pick${active}" data-edge="${i}"
          x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      }).join('');
      picks.querySelectorAll('.floorplan-wall-pick').forEach(line => {
        line.addEventListener('click', (e) => {
          e.stopPropagation();
          openWall(Number(line.dataset.edge));
        });
      });
    } else if (picks) picks.innerHTML = '';
  }

  function openWall(edge) {
    if (!shapeClosed) {
      onToast?.('Close the room shape first', 'error');
      return;
    }
    if (!fp.ceiling_height && !dimPanel?.querySelector('#fp-ceiling-height')?.value) {
      onToast?.('Set ceiling height in step 2 first', 'error');
      setMode('dimensions');
      return;
    }
    selectedWallEdge = edge;
    renderPolygon();
    showWallWorkspace();
    onOpenWall?.(edge, { onBack: showRoomOverview });
  }

  function setMode(next) {
    mode = next;
    viewportEl?.classList.toggle('floorplan-pan-active', mode !== 'draw' || shapeClosed);
    root.querySelectorAll('[data-fp-mode]').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.fpMode === mode);
      btn.classList.toggle('btn-secondary', btn.dataset.fpMode !== mode);
    });
    root.querySelectorAll('.floorplan-draw-hint').forEach(el => {
      el.classList.toggle('hidden', el.dataset.hintFor !== mode);
    });
    dimPanel?.classList.toggle('hidden', mode !== 'dimensions');
    wallsPanel?.classList.toggle('hidden', mode !== 'walls');
    root.classList.toggle('floorplan-mode-walls', mode === 'walls');
    if (mode !== 'walls') showRoomOverview();
    renderPolygon();
    updateDrawCursor();
    if (mode === 'walls' && shapeClosed) {
      setStatus('Click a wall edge or pick a wall below');
    }
  }

  async function saveGeometry() {
    const unit = dimPanel?.querySelector('#fp-unit')?.value || fp.unit || 'ft';
    const bounds_width = toFeet(dimPanel?.querySelector('#fp-bounds-width')?.value, unit);
    const bounds_depth = toFeet(dimPanel?.querySelector('#fp-bounds-depth')?.value, unit);
    const wallInputs = [...(dimPanel?.querySelectorAll('.fp-wall-len') || [])];
    let wall_lengths = wallInputs.map(inp => toFeet(inp.value, unit));
    const ceiling_height = toFeet(dimPanel?.querySelector('#fp-ceiling-height')?.value, unit) || fp.ceiling_height || 9.5;

    if (bounds_width > 0 && bounds_depth > 0 && shapeClosed && vertices.length >= 3) {
      vertices = fitPolygonToMeasureBox(vertices);
      if (!wall_lengths.some(l => l > 0)) {
        wall_lengths = autoWallLengths(vertices, bounds_width, bounds_depth);
      }
      applyRoomDisplay(viewportEl, bounds_width, bounds_depth);
      fitCanvasView();
    }

    await onSaveGeometry({
      map_mode: 'draw',
      polygon: vertices,
      unit,
      bounds_width,
      bounds_depth,
      ceiling_height,
      wall_lengths
    });

    fp.unit = unit;
    fp.bounds_width = bounds_width;
    fp.bounds_depth = bounds_depth;
    fp.ceiling_height = ceiling_height;
    fp.wall_lengths = wall_lengths;
    fp.polygon = vertices;
    dimensionUnit = unit;
    dirtyGeometry = false;
    wallInputs.forEach((inp, i) => {
      if (wall_lengths[i] > 0) inp.value = formatLengthInput(wall_lengths[i], unit);
    });
    renderPolygon();
    setStatus(bounds_width && bounds_depth
      ? `Room scaled to ${formatLengthInput(bounds_width, unit)}×${formatLengthInput(bounds_depth, unit)} ${unit}`
      : 'Room shape saved');
  }

  function dimensionInputs() {
    return [
      dimPanel?.querySelector('#fp-bounds-width'),
      dimPanel?.querySelector('#fp-bounds-depth'),
      dimPanel?.querySelector('#fp-ceiling-height'),
      ...(dimPanel?.querySelectorAll('.fp-wall-len') || [])
    ].filter(Boolean);
  }

  function convertDimensionInputs(nextUnit) {
    const previousUnit = dimensionUnit || 'ft';
    dimensionInputs().forEach(input => {
      const feet = toFeet(input.value, previousUnit);
      input.step = String(lengthStep(nextUnit));
      input.value = feet > 0 ? formatLengthInput(feet, nextUnit) : '';
    });
    dimPanel?.querySelectorAll('.fp-unit-label').forEach(el => {
      el.textContent = lengthUnitLabel(nextUnit);
    });
    dimensionUnit = nextUnit;
    dirtyGeometry = true;
  }

  root.querySelectorAll('[data-fp-mode]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.fpMode));
  });

  root.querySelectorAll('[data-action="fp-open-wall"]').forEach(btn => {
    btn.addEventListener('click', () => openWall(Number(btn.dataset.edge)));
  });

  const pointers = new Map();
  let panning = false;
  let panStart = { x: 0, y: 0 };
  let pinchStart = null;
  let tapCandidate = null;

  function pointerDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function updatePointer(id, x, y) {
    const p = pointers.get(id);
    if (p) pointers.set(id, { ...p, x, y });
  }

  function canPanHere(_target) {
    return true;
  }

  root.querySelector('#fp-floor-scale')?.addEventListener('input', (e) => {
    floorView.scale = Math.min(3, Math.max(1, parseFloat(e.target.value) || 1));
    syncFloorUi();
    applyFloorTextureAttrs();
    saveFloorViewDebounced();
  });

  root.querySelectorAll('[data-action="fp-floor-fit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      floorView.fit = btn.dataset.fit === 'contain' ? 'contain' : 'cover';
      syncFloorUi();
      applyFloorTextureAttrs();
      saveFloorViewDebounced();
    });
  });

  root.querySelector('[data-action="fp-floor-drag"]')?.addEventListener('click', () => {
    floorDragMode = !floorDragMode;
    syncFloorUi();
  });

  root.querySelector('[data-action="fp-floor-reset-view"]')?.addEventListener('click', () => {
    floorView = { scale: 1, focusX: 0.5, focusY: 0.5, fit: 'cover' };
    syncFloorUi();
    applyFloorTextureAttrs();
    saveFloorViewDebounced();
  });

  viewportEl?.addEventListener('pointermove', (e) => {
    if (floorPanning && floorPanStart) {
      const rect = viewportEl.getBoundingClientRect();
      const dxNorm = (e.clientX - floorPanStart.x) / rect.width;
      const dyNorm = (e.clientY - floorPanStart.y) / rect.height;
      floorView.focusX = Math.min(1, Math.max(0, floorPanStart.focusX - dxNorm / floorView.scale));
      floorView.focusY = Math.min(1, Math.max(0, floorPanStart.focusY - dyNorm / floorView.scale));
      applyFloorTextureAttrs();
      return;
    }
    if (pointers.has(e.pointerId)) updatePointer(e.pointerId, e.clientX, e.clientY);

    if (pointers.size === 2 && pinchStart && !zoomLocked) {
      const pts = [...pointers.values()];
      const dist = pointerDistance(pts[0], pts[1]);
      const ratio = dist / pinchStart.distance;
      const newZoom = pinchStart.zoom * ratio;
      const applied = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom)) / pinchStart.zoom;
      const rect = viewportEl.getBoundingClientRect();
      const fx = pinchStart.midX - rect.left;
      const fy = pinchStart.midY - rect.top;
      panX = fx - applied * (fx - pinchStart.panX);
      panY = fy - applied * (fy - pinchStart.panY);
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
      applyStageTransform();
      return;
    }

    if (tapCandidate) {
      const dx = e.clientX - tapCandidate.startX;
      const dy = e.clientY - tapCandidate.startY;
      if (Math.hypot(dx, dy) > PAN_THRESHOLD) {
        tapCandidate.moved = true;
        panning = true;
        panStart = { x: e.clientX - panX, y: e.clientY - panY };
        viewportEl.classList.add('floorplan-panning');
        tapCandidate = null;
      }
    }

    if (panning) {
      panX = e.clientX - panStart.x;
      panY = e.clientY - panStart.y;
      applyStageTransform();
      return;
    }

    if (mode === 'draw' && !shapeClosed) updateDrawPreview(e.clientX, e.clientY);
  });

  viewportEl?.addEventListener('pointerleave', () => {
    clearDrawGuides();
    if (!pointers.size) viewportEl?.classList.remove('floorplan-panning');
  });

  viewportEl?.addEventListener('pointerdown', (e) => {
    if (!canPanHere(e.target)) return;
    if (floorDragMode && fp.image_path) {
      e.preventDefault();
      floorPanning = true;
      floorPanStart = {
        x: e.clientX,
        y: e.clientY,
        focusX: floorView.focusX,
        focusY: floorView.focusY
      };
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewportEl.setPointerCapture(e.pointerId);

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStart = {
        distance: pointerDistance(pts[0], pts[1]),
        zoom,
        panX,
        panY,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2
      };
      panning = false;
      tapCandidate = null;
      return;
    }

    if (mode === 'draw' && !shapeClosed) {
      tapCandidate = {
        startX: e.clientX,
        startY: e.clientY,
        moved: false
      };
      return;
    }

    if (mode === 'walls' && shapeClosed && !e.target.closest('.floorplan-wall-pick')) {
      tapCandidate = {
        startX: e.clientX,
        startY: e.clientY,
        moved: false
      };
      return;
    }

    panning = true;
    panStart = { x: e.clientX - panX, y: e.clientY - panY };
    viewportEl.classList.add('floorplan-pan-active', 'floorplan-panning');
  });

  function finishPointer(e) {
    if (floorPanning) {
      floorPanning = false;
      floorPanStart = null;
      saveFloorViewDebounced();
      return;
    }
    const pendingTap = tapCandidate && !tapCandidate.moved ? { ...tapCandidate } : null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;

    if (pendingTap && pointers.size === 0 && mode === 'walls' && shapeClosed) {
      const snap = pointerDrawPoint(pendingTap.startX, pendingTap.startY);
      const hit = nearestEdge(snap, vertices);
      if (hit.dist < 5) openWall(hit.edge);
      return;
    }

    if (pendingTap && pointers.size === 0 && mode === 'draw' && !shapeClosed) {
      const snap = pointerDrawPoint(pendingTap.startX, pendingTap.startY);
      if (snap.closing) {
        closeShape();
      } else {
        vertices = [...vertices, { x: snap.x, y: snap.y }];
        dirtyGeometry = true;
        renderPolygon();
        updateDrawActions();
        setStatus(
          vertices.length < 3
            ? 'Add corners (min 3) — walls snap to 90°'
            : `${vertices.length} corners — click the green ring or Close shape when done`
        );
      }
    }

    if (pointers.size === 0) {
      panning = false;
      tapCandidate = null;
      viewportEl?.classList.remove('floorplan-panning');
      if (mode !== 'draw' || shapeClosed) viewportEl?.classList.remove('floorplan-pan-active');
    }
  }

  viewportEl?.addEventListener('pointerup', finishPointer);
  viewportEl?.addEventListener('pointercancel', finishPointer);

  viewportEl?.addEventListener('wheel', (e) => {
    if (zoomLocked) {
      forwardWheelScroll(e);
      return;
    }
    e.preventDefault();
    setZoomAt(zoom * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX, e.clientY);
  }, { passive: false });

  root.querySelector('#fp-zoom-lock')?.addEventListener('change', (e) => {
    zoomLocked = e.target.checked;
    localStorage.setItem(ZOOM_LOCK_KEY, zoomLocked ? '1' : '0');
    updateZoomLockUi();
  });

  root.querySelector('[data-action="fp-zoom-in"]')?.addEventListener('click', () => {
    const rect = viewportEl.getBoundingClientRect();
    setZoomAt(zoom * 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  root.querySelector('[data-action="fp-zoom-out"]')?.addEventListener('click', () => {
    const rect = viewportEl.getBoundingClientRect();
    setZoomAt(zoom / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  root.querySelector('[data-action="fp-zoom-fit"]')?.addEventListener('click', fitCanvasView);

  root.querySelector('[data-action="fp-undo-vertex"]')?.addEventListener('click', () => {
    if (!vertices.length || shapeClosed) return;
    vertices = vertices.slice(0, -1);
    shapeClosed = false;
    dirtyGeometry = true;
    renderPolygon();
    updateDrawCursor();
    updateDrawActions();
    setStatus(vertices.length
      ? `${vertices.length} corner${vertices.length === 1 ? '' : 's'} — undo again or keep drawing`
      : 'Last corner removed — click to draw corners');
  });

  root.querySelector('[data-action="fp-close-polygon"]')?.addEventListener('click', () => {
    if (!closeShape()) {
      onToast?.('Need at least 3 corners before closing', 'error');
    }
  });

  root.querySelector('[data-action="fp-clear-polygon"]')?.addEventListener('click', async () => {
    vertices = [];
    shapeClosed = false;
    dirtyGeometry = true;
    renderPolygon();
    updateDrawCursor();
    updateDrawActions();
    setStatus('Shape cleared — click to draw corners');
  });

  root.querySelector('[data-action="fp-save-geometry"]')?.addEventListener('click', async () => {
    if (!shapeClosed) {
      onToast('Close the room shape first (click near the first corner)', 'error');
      return;
    }
    try {
      await saveGeometry();
      onToast('Room map saved', 'success');
    } catch (err) {
      onToast(err.message, 'error');
    }
  });

  dimPanel?.querySelector('#fp-bounds-width')?.addEventListener('change', () => { dirtyGeometry = true; renderPolygon(); });
  dimPanel?.querySelector('#fp-bounds-depth')?.addEventListener('change', () => { dirtyGeometry = true; renderPolygon(); });
  dimPanel?.querySelector('#fp-unit')?.addEventListener('change', (e) => {
    convertDimensionInputs(e.target.value);
  });

  applyRoomDisplay(viewportEl, fp.bounds_width, fp.bounds_depth);
  fitCanvasView();
  updateZoomLockUi();
  syncFloorUi();

  setMode(shapeClosed ? (initialMode || 'draw') : 'draw');
  renderPolygon();
  updateDrawCursor();
  updateDrawActions();

  return { openWall, showRoomOverview, setMode };
}

function debounceLocal(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
